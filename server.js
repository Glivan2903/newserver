const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Função auxiliar para normalizar número de WhatsApp
function cleanPhoneNumber(phone) {
  if (!phone) return '';
  // Remove tudo que não for dígito
  let cleaned = phone.replace(/\D/g, '');
  
  // Se tiver 10 ou 11 dígitos (formato nacional sem código de país), adiciona o 55
  if (cleaned.length === 10 || cleaned.length === 11) {
    cleaned = '55' + cleaned;
  }
  
  return cleaned;
}

// Rota para processar a solicitação de teste
app.post('/api/solicitar-teste', async (req, res) => {
  try {
    const { name, whatsapp } = req.body;
    
    if (!name || !whatsapp) {
      return res.status(400).json({
        success: false,
        message: 'Nome e WhatsApp são obrigatórios.'
      });
    }

    const cleanedPhone = cleanPhoneNumber(whatsapp);
    
    // Validar se o telefone tem um tamanho mínimo aceitável (ex: 55 + DDD + Número = mínimo 12 dígitos)
    if (cleanedPhone.length < 12) {
      return res.status(400).json({
        success: false,
        message: 'Por favor, insira um número de WhatsApp válido com DDD.'
      });
    }

    // Obter IP do cliente (considerando proxies como Cloudflare)
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    // Carregar banco de dados de testes
    let dbData = { tests: [] };
    try {
      const fileContent = await fs.readFile(DB_FILE, 'utf8');
      dbData = JSON.parse(fileContent);
    } catch (err) {
      // Se der erro ao ler, garante que a estrutura existe
      await fs.writeFile(DB_FILE, JSON.stringify(dbData, null, 2));
    }

    // Verificar se o WhatsApp ou o IP já existem no banco
    const alreadyTested = dbData.tests.find(
      test => test.whatsapp === cleanedPhone || (test.ip === ip && ip !== '127.0.0.1' && ip !== '::1')
    );

    if (alreadyTested) {
      return res.status(400).json({
        success: false,
        message: 'Você já gerou um teste grátis com este número de WhatsApp ou dispositivo. Limite de 1 teste gratuito por cliente atingido. Se precisar de suporte, entre em contato pelo nosso WhatsApp no rodapé da página.'
      });
    }

    // Chamar a API externa para gerar o teste
    const upstreamUrl = 'https://newserver.sigma.st/api/chatbot/64vLbJ4LgG/nVrW8oDKaN';
    
    console.log(`Solicitando teste para ${name} (${cleanedPhone}) [IP: ${ip}]`);
    
    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Erro na API externa: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Se a API externa retornou dados válidos (ex: tem username)
    if (data && data.username) {
      // Salvar registro no banco de dados para evitar abuso
      dbData.tests.push({
        name,
        whatsapp: cleanedPhone,
        ip,
        timestamp: new Date().toISOString(),
        username: data.username
      });

      await fs.writeFile(DB_FILE, JSON.stringify(dbData, null, 2));

      return res.json({
        success: true,
        data: data
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Não foi possível gerar as credenciais de teste neste momento. Tente novamente mais tarde ou entre em contato com o suporte.'
      });
    }

  } catch (error) {
    console.error('Erro ao gerar teste:', error);
    return res.status(500).json({
      success: false,
      message: 'Ocorreu um erro interno no servidor ao tentar gerar o teste. Entre em contato com o suporte.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
