require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const OpenAI = require('openai');
const { Redis } = require('@upstash/redis');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const ADMIN_DIR = path.join(__dirname, 'admin');
const KV_KEY = 'newserver_database';
const UPSTREAM_URL = 'https://newserver.sigma.st/api/chatbot/64vLbJ4LgG/nVrW8oDKaN';
const CHAT_MODEL = 'gpt-4.1-mini';
const MAX_TOOL_TURNS = 5;
const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h
const ADMIN_COOKIE = 'admin_session';

// Na Vercel, o sistema de arquivos do deploy é somente leitura — não dá para
// gravar em database.json em produção. Se houver um banco Redis conectado
// (aba Storage do projeto na Vercel injeta essas variáveis automaticamente,
// seja via "KV" legado ou via integração Upstash Redis do Marketplace),
// usamos o Redis; caso contrário (ambiente local), caímos no arquivo local.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const useKv = Boolean(KV_URL && KV_TOKEN);
const redis = useKv ? new Redis({ url: KV_URL, token: KV_TOKEN }) : null;

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY não definida. Configure o arquivo .env antes de iniciar o servidor.');
  process.exit(1);
}

if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.error('ADMIN_EMAIL/ADMIN_PASSWORD não definidos. Configure o arquivo .env antes de iniciar o servidor.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// Utilitários de telefone e persistência
// (banco único: usado pelo formulário do site E pelo agente de chat)
// ==========================================
function cleanPhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 10 || cleaned.length === 11) {
    cleaned = '55' + cleaned;
  }
  return cleaned;
}

async function loadDb() {
  if (useKv) {
    const data = await redis.get(KV_KEY);
    return data || { tests: [] };
  }

  try {
    const content = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    return { tests: [] };
  }
}

async function saveDb(dbData) {
  if (useKv) {
    await redis.set(KV_KEY, dbData);
    return;
  }

  await fs.writeFile(DB_FILE, JSON.stringify(dbData, null, 2));
}

function findByPhoneOrIp(dbData, { whatsapp, ip }) {
  return dbData.tests.find(
    t => (whatsapp && t.whatsapp === whatsapp) ||
         (ip && t.ip === ip && ip !== '127.0.0.1' && ip !== '::1')
  );
}

function findByIdentifier(dbData, identifier) {
  const cleanedPhone = cleanPhoneNumber(identifier);
  return dbData.tests.find(
    t => t.whatsapp === cleanedPhone ||
         (t.username && t.username.toLowerCase() === String(identifier).toLowerCase())
  );
}

// Núcleo do antiabuso: usado tanto pelo formulário do site quanto pelo agente de chat.
async function gerarTesteCompartilhado({ name, whatsapp, ip }) {
  if (!name || !whatsapp) {
    return { ok: false, code: 'missing_fields', message: 'Nome e WhatsApp são obrigatórios.' };
  }

  const cleanedPhone = cleanPhoneNumber(whatsapp);
  if (cleanedPhone.length < 12) {
    return { ok: false, code: 'invalid_phone', message: 'Por favor, insira um número de WhatsApp válido com DDD.' };
  }

  const dbData = await loadDb();
  const existing = findByPhoneOrIp(dbData, { whatsapp: cleanedPhone, ip });

  if (existing) {
    return {
      ok: false,
      code: 'already_tested',
      message: 'Você já gerou um teste grátis com este número de WhatsApp ou dispositivo. Limite de 1 teste gratuito por cliente atingido. Se precisar de suporte, entre em contato pelo nosso WhatsApp no rodapé da página.',
      account: existing
    };
  }

  console.log(`Solicitando teste para ${name} (${cleanedPhone}) [IP: ${ip}]`);

  const response = await fetch(UPSTREAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    return { ok: false, code: 'upstream_error', message: `Erro na API externa: ${response.status} ${response.statusText}` };
  }

  const upstream = await response.json();
  if (!upstream || !upstream.username) {
    return { ok: false, code: 'upstream_invalid', message: 'Não foi possível gerar as credenciais de teste neste momento. Tente novamente mais tarde ou entre em contato com o suporte.' };
  }

  const record = {
    // Guarda o retorno completo da API externa (dns, connections, package,
    // createdAt/createdAtFormatted, expiresAt/expiresAtFormatted, payUrl, reply, etc.)
    // para que uma consulta futura sempre tenha a informação real da conta, não um resumo.
    ...upstream,
    name,
    whatsapp: cleanedPhone,
    ip,
    timestamp: new Date().toISOString(),
    expiresAtFormatted: upstream.expiresAtFormatted || '4 horas após a criação',
    m3u: `http://ggbb.fun/get.php?username=${upstream.username}&password=${upstream.password}&type=m3u_plus&output=ts`
  };

  dbData.tests.push(record);
  await saveDb(dbData);

  return { ok: true, code: 'created', upstream, account: record };
}

// ==========================================
// Sessão do painel /admin
// (usa o mesmo Redis do banco de dados em produção; em ambiente local,
// sem Redis configurado, cai numa Map em memória — suficiente para um único
// processo local, mas não confiável entre instâncias serverless na Vercel)
// ==========================================
const adminSessionsMemory = new Map();

async function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const key = `admin_session:${token}`;

  if (useKv) {
    await redis.set(key, true, { ex: ADMIN_SESSION_TTL_SECONDS });
  } else {
    adminSessionsMemory.set(token, Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000);
  }

  return token;
}

async function isValidAdminSession(token) {
  if (!token) return false;

  if (useKv) {
    const exists = await redis.get(`admin_session:${token}`);
    return Boolean(exists);
  }

  const expiresAt = adminSessionsMemory.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    adminSessionsMemory.delete(token);
    return false;
  }
  return true;
}

async function destroyAdminSession(token) {
  if (!token) return;
  if (useKv) {
    await redis.del(`admin_session:${token}`);
  } else {
    adminSessionsMemory.delete(token);
  }
}

async function requireAdminPage(req, res, next) {
  const valid = await isValidAdminSession(req.cookies[ADMIN_COOKIE]);
  if (!valid) return res.redirect('/admin/login');
  next();
}

async function requireAdminApi(req, res, next) {
  const valid = await isValidAdminSession(req.cookies[ADMIN_COOKIE]);
  if (!valid) return res.status(401).json({ success: false, message: 'Não autenticado.' });
  next();
}

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'login.html'));
});

app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Email ou senha inválidos.' });
  }

  const token = await createAdminSession();
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ADMIN_SESSION_TTL_SECONDS * 1000
  });

  return res.json({ success: true });
});

app.post('/admin/logout', async (req, res) => {
  await destroyAdminSession(req.cookies[ADMIN_COOKIE]);
  res.clearCookie(ADMIN_COOKIE);
  res.json({ success: true });
});

app.get('/api/admin/clients', requireAdminApi, async (req, res) => {
  const dbData = await loadDb();
  const clients = [...dbData.tests].reverse();
  res.json({ success: true, clients });
});

app.use('/admin', requireAdminPage, express.static(ADMIN_DIR));

// ==========================================
// Rota usada pelo formulário do site (público)
// ==========================================
app.post('/api/solicitar-teste', async (req, res) => {
  try {
    const { name, whatsapp } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const result = await gerarTesteCompartilhado({ name, whatsapp, ip });

    if (!result.ok) {
      const status = (result.code === 'upstream_error' || result.code === 'upstream_invalid') ? 500 : 400;
      return res.status(status).json({ success: false, message: result.message });
    }

    return res.json({ success: true, data: result.upstream });

  } catch (error) {
    console.error('Erro ao gerar teste:', error);
    return res.status(500).json({
      success: false,
      message: 'Ocorreu um erro interno no servidor ao tentar gerar o teste. Entre em contato com o suporte.'
    });
  }
});

// ==========================================
// Ferramentas do agente de chat (Bia)
// ==========================================
async function toolGerarTeste({ name, whatsapp }, ctx) {
  const result = await gerarTesteCompartilhado({ name, whatsapp, ip: ctx.ip });

  if (!result.ok) {
    if (result.code === 'already_tested') {
      return {
        already_exists: true,
        message: 'Este WhatsApp já possui um teste gerado anteriormente. Informe os dados existentes ao cliente em vez de criar um novo.',
        account: result.account
      };
    }
    return { error: result.message };
  }

  return { created: true, account: result.account };
}

async function toolConsultarConta({ identificador }) {
  if (!identificador) {
    return { error: 'Preciso do WhatsApp ou do usuário (username) para consultar a conta.' };
  }

  const dbData = await loadDb();
  const existing = findByIdentifier(dbData, identificador);

  if (!existing) {
    return {
      found: false,
      message: 'Nenhuma conta encontrada com esse WhatsApp ou usuário nos registros.'
    };
  }

  return { found: true, account: existing };
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'gerar_teste',
      description: 'Gera um teste grátis de IPTV de 4 horas para um cliente novo, a partir do nome completo e do WhatsApp. Se o WhatsApp já tiver um teste gerado anteriormente, retorna os dados já existentes em vez de criar um novo.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nome completo do cliente' },
          whatsapp: { type: 'string', description: 'Número de WhatsApp do cliente, com DDD' }
        },
        required: ['name', 'whatsapp']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consultar_conta',
      description: 'Consulta os dados de uma conta/teste já gerado anteriormente (incluindo o vencimento), a partir do WhatsApp ou do usuário (username) informado pelo cliente.',
      parameters: {
        type: 'object',
        properties: {
          identificador: { type: 'string', description: 'Número de WhatsApp ou usuário (username) do cliente' }
        },
        required: ['identificador']
      }
    }
  }
];

// Base de conhecimento pública extraída do site (planos, dispositivos, FAQ).
// Atualize aqui sempre que o site institucional mudar preços ou condições.
const CATALOG_INFO = `
## Sobre a New Server
Streaming IPTV com +100.000 conteúdos (canais abertos e fechados, filmes, séries, esportes, infantil, novelas e lançamentos) em até 4K/FHD, com tecnologia anti-travamento. +25 mil clientes ativos, 99,9% de uptime, suporte 24/7.

## Planos e valores (1 tela simultânea em todos)
- **Mensal**: R$ 29,90/mês. Sem fidelidade, ideal para experimentar.
- **Semestral (mais vendido)**: R$ 149,90 a cada 6 meses (equivale a R$ 24,98/mês). Suporte VIP via WhatsApp.
- **Anual (maior desconto)**: R$ 239,90/ano (equivale a R$ 19,99/mês). Suporte Ultra VIP via WhatsApp.

Todos os planos incluem: +100 mil filmes e séries, canais 4K/FHD/HD, guia de programação (EPG), canais adultos opcionais e suporte via WhatsApp.

Formas de pagamento: Pix, cartão de crédito e boleto. Ativação imediata após confirmação do pagamento. Link de checkout para fechar plano: https://newserverpainel.top/#/checkout/V4D3RlgLaq/oQ1YK7ZDON

## Onde assistir (configuração por dispositivo)
- **Smart TV** (Samsung/Tizen, LG/webOS, Android TV, Roku): instalar um app como IB Player Pro, DupleCast ou DuplexPlay e inserir a lista M3U ou usuário/senha.
- **Smartphone/tablet**: Android → Blink Player Pro ou XCIPTV (Play Store); iPhone/iPad → Smarters Player Lite ou Blink Player Pro.
- **TV Box / Fire Stick / Chromecast / Mi Box**: instalar o app "Downloader" e inserir o código do app próprio, depois logar com usuário e senha.
- **Computador (navegador)**: acessar http://webtv.iptvblinkplayer.com/m3u-login, escolher "Playlist Type: M3U File Url", usar o nome de playlist "newserver" e colar a URL M3U completa.

## Perguntas frequentes
- Internet recomendada: 10 Mega estáveis para HD; 20-30 Mega para Full HD/4K.
- Cada login (teste ou plano padrão) funciona em 1 tela por vez — dois dispositivos ao mesmo tempo derrubam a transmissão. Para mais telas, é preciso um pacote multitela (falar com o suporte).
- Teste grátis: 4 horas de acesso à grade completa, limitado a 1 por cliente (validado por WhatsApp e IP).

## Contato
WhatsApp de vendas/suporte: (79) 99981-30038 — https://wa.me/5579998130038
`;

function dataHoraAtualFormatada() {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function buildSystemPrompt() {
  return `Você é a Bia, atendente virtual da New Server IPTV. Você conversa com clientes de verdade, então seja humana: empática, bem-humorada na medida certa e sempre profissional — nunca informal a ponto de parecer descuidada, nem robótica a ponto de parecer um formulário.

## Data e hora atuais (use como referência real de "agora")
Agora é: ${dataHoraAtualFormatada()} (horário de Brasília, America/Sao_Paulo).
Use SEMPRE essa data/hora — nunca outra — para calcular quanto falta para um vencimento, dizer se está "próximo" ou "longe", ou comparar datas. Ignore qualquer noção de data que você tenha por causa do seu treinamento; a informação acima é a única correta.

## Como você se comporta
- Responda como gente conversando de verdade pelo celular: curto e direto, 1 a 3 frases na maioria das vezes. Nada de textão, nada de discurso de call center.
- Fale natural: contrações ("pra", "tá", "beleza"), sem soar automática ou "roteirizada". Humor leve e emoji com moderação (no máximo 1 por mensagem), nunca forçado.
- Só use lista/tópicos quando o conteúdo realmente pedir organização (ex: comparar planos, passo a passo de configuração). Para o resto, fale em frase corrida, como numa conversa normal.
- Demonstre empatia de verdade: se o cliente reclamar de travamento, cobrança ou perrengue, valide o sentimento antes de resolver ("Poxa, que chato isso, vamos resolver rapidinho").
- Use o nome do cliente quando ele disser, para deixar a conversa mais pessoal.
- Você representa a marca: nunca fale mal da New Server, nunca prometa o que não está na base de conhecimento abaixo.

## Sua base de conhecimento (fatos reais do site — use para responder sobre planos, preços, dispositivos e dúvidas gerais)
${CATALOG_INFO}

## Suas duas ferramentas (ações que só você pode executar)
1. **gerar_teste**: cria um teste grátis de 4 horas para cliente novo. Precisa do nome completo E do WhatsApp antes de chamar.
2. **consultar_conta**: busca os dados de um teste/conta já gerado (inclusive vencimento), a partir do WhatsApp ou usuário.

## Regras inegociáveis
- Nunca invente credenciais, usuário, senha ou datas de vencimento — use exclusivamente o que as ferramentas retornarem.
- Antes de chamar "gerar_teste", confirme que já tem nome completo E WhatsApp. Se faltar algo, peça com simpatia.
- Se "gerar_teste" retornar "already_exists", explique que esse WhatsApp já tem teste gerado e mostre os dados existentes (sem criar outro).
- Se "consultar_conta" não achar nada, avise com empatia e ofereça gerar um teste novo (peça nome + WhatsApp).
- Ao apresentar credenciais, sempre mostre: usuário, senha, vencimento e a lista M3U. O registro da conta também pode trazer outros dados reais (DNS, links alternativos de WebPlayer/HLS, código de app, link de renovação "payUrl", nome do pacote) — se o cliente perguntar por algo assim, use o que estiver no registro; nunca invente o que não estiver lá.
- Preços, planos e passo a passo de configuração você responde direto, usando a base de conhecimento acima — não precisa mandar pro humano só por isso.
- Encaminhe para o suporte humano no WhatsApp (79) 99981-30038 apenas quando: o cliente quiser fechar/pagar um plano com detalhes específicos de cobrança, tiver um problema técnico que os passos de configuração não resolvem, quiser um pacote multitela, ou pedir algo fora do que você sabe fazer.`;
}

// ==========================================
// Rota do agente de chat (servida em /chat)
// ==========================================
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'O campo "messages" é obrigatório e deve ser uma lista não vazia.' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ctx = { ip };

    const conversation = [{ role: 'system', content: buildSystemPrompt() }, ...messages];
    const actions = [];

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const completion = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: conversation,
        tools,
        tool_choice: 'auto'
      });

      const message = completion.choices[0].message;
      conversation.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        return res.json({ reply: message.content, actions });
      }

      for (const toolCall of message.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch (err) {
          args = {};
        }

        let result;
        if (toolCall.function.name === 'gerar_teste') {
          result = await toolGerarTeste(args, ctx);
          if (result.account) {
            actions.push({ type: result.created ? 'credentials' : 'existing_account', data: result.account });
          }
        } else if (toolCall.function.name === 'consultar_conta') {
          result = await toolConsultarConta(args);
          if (result.account) {
            actions.push({ type: 'account_info', data: result.account });
          }
        } else {
          result = { error: 'Ferramenta desconhecida.' };
        }

        conversation.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }
    }

    return res.json({
      reply: 'Desculpe, tive um problema para concluir sua solicitação. Pode tentar novamente?',
      actions
    });

  } catch (error) {
    console.error('Erro em /api/chat:', error);
    return res.status(500).json({ error: 'Ocorreu um erro interno ao processar a conversa.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
