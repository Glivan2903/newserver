document.addEventListener('DOMContentLoaded', () => {
    const statusMsg = document.getElementById('statusMsg');
    const tableWrap = document.getElementById('tableWrap');
    const tableBody = document.getElementById('tableBody');
    const searchInput = document.getElementById('searchInput');
    const logoutBtn = document.getElementById('logoutBtn');

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
            <tr class="detail-row hidden" id="detail-${idx}">
                <td colspan="9"><pre>${escapeHtml(JSON.stringify(list[idx], null, 2))}</pre></td>
            </tr>
        `).join('');

        tableBody.querySelectorAll('.detail-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = document.getElementById(`detail-${btn.getAttribute('data-idx')}`);
                if (row) row.classList.toggle('hidden');
            });
        });
    }

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
