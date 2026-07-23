document.addEventListener('DOMContentLoaded', () => {
    const statusMsg = document.getElementById('statusMsg');
    const tableWrap = document.getElementById('tableWrap');
    const tableBody = document.getElementById('tableBody');
    const searchInput = document.getElementById('searchInput');
    const logoutBtn = document.getElementById('logoutBtn');

    const detailModal = document.getElementById('detailModal');
    const modalBackdrop = document.getElementById('modalBackdrop');
    const modalCloseBtn = document.getElementById('modalCloseBtn');
    const modalClientName = document.getElementById('modalClientName');
    const modalClientMeta = document.getElementById('modalClientMeta');
    const modalBody = document.getElementById('modalBody');

    let clients = [];

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function renderRows(list) {
        tableBody.innerHTML = list.map((c, idx) => `
            <tr>
                <td>${escapeHtml(c.name)}</td>
                <td>${escapeHtml(c.whatsapp)}</td>
                <td>${escapeHtml(c.username)}</td>
                <td>${escapeHtml(c.password)}</td>
                <td class="col-package">${escapeHtml(c.package)}</td>
                <td>${escapeHtml(c.createdAtFormatted || c.timestamp)}</td>
                <td>${escapeHtml(c.expiresAtFormatted)}</td>
                <td>${escapeHtml(c.ip)}</td>
                <td><button type="button" class="detail-btn" data-idx="${idx}">Ver tudo</button></td>
            </tr>
        `).join('');

        tableBody.querySelectorAll('.detail-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                openModal(list[Number(btn.getAttribute('data-idx'))]);
            });
        });
    }

    function detailRow(label, value, copyable) {
        const safeValue = escapeHtml(value || '------');
        if (!copyable) {
            return `
                <div class="detail-row">
                    <span class="d-label">${label}</span>
                    <div class="d-value-wrap"><span class="d-value">${safeValue}</span></div>
                </div>`;
        }
        const id = `dval-${Math.random().toString(36).slice(2, 9)}`;
        return `
            <div class="detail-row">
                <span class="d-label">${label}</span>
                <div class="d-value-wrap">
                    <span class="d-value" id="${id}">${safeValue}</span>
                    <button type="button" class="d-copy-btn" data-copy-target="${id}" title="Copiar">⧉</button>
                </div>
            </div>`;
    }

    function openModal(client) {
        modalClientName.textContent = client.name || 'Cliente';
        modalClientMeta.textContent = client.whatsapp || '—';

        modalBody.innerHTML = `
            <div class="detail-section">
                <h3>Cliente</h3>
                <div class="detail-card">
                    ${detailRow('Nome', client.name)}
                    ${detailRow('WhatsApp', client.whatsapp, true)}
                    ${detailRow('IP', client.ip)}
                </div>
            </div>

            <div class="detail-section">
                <h3>Conta IPTV</h3>
                <div class="detail-card">
                    ${detailRow('Usuário', client.username, true)}
                    ${detailRow('Senha', client.password, true)}
                    ${detailRow('Pacote', client.package)}
                    ${detailRow('Conexões', client.connections)}
                    ${detailRow('DNS', client.dns, true)}
                </div>
            </div>

            <div class="detail-section">
                <h3>Datas</h3>
                <div class="detail-card">
                    ${detailRow('Criado em', client.createdAtFormatted || client.timestamp)}
                    ${detailRow('Vencimento', client.expiresAtFormatted)}
                </div>
            </div>

            <div class="detail-section">
                <h3>Links</h3>
                <div class="detail-card">
                    ${detailRow('Lista M3U', client.m3u, true)}
                    ${detailRow('Renovar plano', client.payUrl, true)}
                </div>
            </div>

            <details class="detail-raw">
                <summary>Ver registro bruto completo (JSON)</summary>
                <pre>${escapeHtml(JSON.stringify(client, null, 2))}</pre>
            </details>
        `;

        modalBody.querySelectorAll('.d-copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = document.getElementById(btn.getAttribute('data-copy-target'));
                if (!target) return;
                navigator.clipboard.writeText(target.textContent).then(() => {
                    const original = btn.textContent;
                    btn.textContent = '✓';
                    setTimeout(() => { btn.textContent = original; }, 1200);
                });
            });
        });

        detailModal.classList.remove('hidden');
    }

    function closeModal() {
        detailModal.classList.add('hidden');
    }

    modalCloseBtn.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !detailModal.classList.contains('hidden')) closeModal();
    });

    function applyFilter() {
        const term = searchInput.value.trim().toLowerCase();
        if (!term) {
            renderRows(clients);
            return;
        }
        const filtered = clients.filter(c =>
            String(c.name || '').toLowerCase().includes(term) ||
            String(c.whatsapp || '').toLowerCase().includes(term) ||
            String(c.username || '').toLowerCase().includes(term)
        );
        renderRows(filtered);
    }

    async function loadClients() {
        try {
            const res = await fetch('/api/admin/clients');

            if (res.status === 401) {
                window.location.href = '/admin/login';
                return;
            }

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || 'Erro ao carregar dados.');
            }

            clients = data.clients || [];
            statusMsg.classList.add('hidden');
            tableWrap.classList.remove('hidden');
            renderRows(clients);

        } catch (err) {
            statusMsg.textContent = err.message || 'Erro ao carregar dados.';
        }
    }

    searchInput.addEventListener('input', applyFilter);

    logoutBtn.addEventListener('click', async () => {
        await fetch('/admin/logout', { method: 'POST' });
        window.location.href = '/admin/login';
    });

    loadClients();
});
