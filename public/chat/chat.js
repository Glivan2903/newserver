document.addEventListener('DOMContentLoaded', () => {
    const chatWindow = document.getElementById('chatWindow');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatSendBtn = document.getElementById('chatSendBtn');
    const typingIndicator = document.getElementById('typingIndicator');

    // Histórico enviado ao backend a cada requisição (apenas turnos de usuário/assistente)
    const history = [];

    const GREETING = 'Oi! 👋 Eu sou a Bia, da New Server. Posso te ajudar a gerar um teste grátis de 4 horas, consultar o vencimento da sua conta, ou tirar dúvidas sobre planos e configuração. Me conta, no que posso ajudar?';

    function scrollToBottom() {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function addMessage(role, text) {
        const el = document.createElement('div');
        el.className = `msg msg-${role}`;
        el.textContent = text;
        chatWindow.appendChild(el);
        scrollToBottom();
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function fieldRow(label, value, copyable) {
        const safeValue = escapeHtml(value || '------');
        if (!copyable) {
            return `
                <div class="account-row">
                    <span class="label">${label}</span>
                    <div class="value-wrap"><span class="value">${safeValue}</span></div>
                </div>`;
        }
        const id = `val-${Math.random().toString(36).slice(2, 9)}`;
        return `
            <div class="account-row">
                <span class="label">${label}</span>
                <div class="value-wrap">
                    <span class="value" id="${id}">${safeValue}</span>
                    <button type="button" class="btn-copy" data-copy-target="${id}" title="Copiar"><i class="fa-regular fa-copy"></i></button>
                </div>
            </div>`;
    }

    function addAccountCard(type, account) {
        const titleMap = {
            credentials: '<i class="fa-solid fa-circle-check"></i> Teste criado com sucesso',
            existing_account: '<i class="fa-solid fa-circle-info"></i> Teste já existente',
            account_info: '<i class="fa-solid fa-user-check"></i> Dados da conta'
        };

        const card = document.createElement('div');
        card.className = 'account-card';
        card.innerHTML = `
            <div class="account-card-title">${titleMap[type] || 'Conta'}</div>
            ${fieldRow('Nome', account.name)}
            ${fieldRow('Usuário', account.username, true)}
            ${fieldRow('Senha', account.password, true)}
            ${fieldRow('Vencimento', account.expiresAtFormatted)}
            ${fieldRow('Lista M3U', account.m3u, true)}
        `;
        chatWindow.appendChild(card);

        card.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = document.getElementById(btn.getAttribute('data-copy-target'));
                if (!target) return;
                navigator.clipboard.writeText(target.textContent).then(() => {
                    const icon = btn.querySelector('i');
                    icon.className = 'fa-solid fa-check';
                    setTimeout(() => { icon.className = 'fa-regular fa-copy'; }, 1500);
                });
            });
        });

        scrollToBottom();
    }

    function setTyping(show) {
        typingIndicator.classList.toggle('hidden', !show);
        chatSendBtn.disabled = show;
        if (show) scrollToBottom();
    }

    async function sendMessage(text) {
        history.push({ role: 'user', content: text });
        addMessage('user', text);
        setTyping(true);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: history })
            });

            const data = await res.json();
            setTyping(false);

            if (!res.ok) {
                throw new Error(data.error || 'Erro ao conversar com o agente.');
            }

            if (data.reply) {
                history.push({ role: 'assistant', content: data.reply });
                addMessage('bot', data.reply);
            }

            (data.actions || []).forEach(action => {
                addAccountCard(action.type, action.data);
            });

        } catch (err) {
            setTyping(false);
            addMessage('error', err.message || 'Não consegui responder agora. Tente novamente em instantes.');
        }
    }

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        sendMessage(text);
    });

    // Mensagem de boas-vindas (não entra no histórico enviado ao backend)
    addMessage('bot', GREETING);
});
