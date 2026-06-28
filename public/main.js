document.addEventListener('DOMContentLoaded', () => {
    
    // ==========================================
    // 1. Menu Mobile Drawer
    // ==========================================
    const menuToggle = document.getElementById('menuToggle');
    const closeDrawer = document.getElementById('closeDrawer');
    const mobileDrawer = document.getElementById('mobileDrawer');
    
    if (menuToggle && mobileDrawer) {
        menuToggle.addEventListener('click', () => {
            mobileDrawer.classList.add('active');
        });
    }
    
    if (closeDrawer && mobileDrawer) {
        closeDrawer.addEventListener('click', () => {
            mobileDrawer.classList.remove('active');
        });
    }

    // Fechar drawer ao clicar em algum link
    const drawerLinks = document.querySelectorAll('.drawer-link');
    drawerLinks.forEach(link => {
        link.addEventListener('click', () => {
            mobileDrawer.classList.remove('active');
        });
    });

    // ==========================================
    // 2. Abas de Dispositivos (Tabs)
    // ==========================================
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remover classe ativa de todos os botões e painéis
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            // Adicionar classe ativa no botão clicado
            btn.classList.add('active');
            
            // Ativar painel correspondente
            const tabId = btn.getAttribute('data-tab');
            const targetPane = document.getElementById(tabId);
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });

    // ==========================================
    // 3. Acordeão de FAQ
    // ==========================================
    const faqQuestions = document.querySelectorAll('.faq-question');

    faqQuestions.forEach(question => {
        question.addEventListener('click', () => {
            const item = question.parentElement;
            const isActive = item.classList.contains('active');

            // Fechar todos os FAQs primeiro para fazer efeito único
            document.querySelectorAll('.faq-item').forEach(i => {
                i.classList.remove('active');
            });

            // Se o clicado não estava ativo, abre ele
            if (!isActive) {
                item.classList.add('active');
            }
        });
    });

    // ==========================================
    // 4. Máscara do WhatsApp Celular
    // ==========================================
    const whatsappInput = document.getElementById('clientWhatsapp');

    if (whatsappInput) {
        whatsappInput.addEventListener('input', (e) => {
            let value = e.target.value;
            // Remove tudo que não é número
            value = value.replace(/\D/g, '');
            
            // Limita a 11 dígitos
            if (value.length > 11) {
                value = value.slice(0, 11);
            }

            // Aplica a máscara
            if (value.length > 10) {
                // Formato Celular: (XX) XXXXX-XXXX
                value = `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
            } else if (value.length > 6) {
                // Formato intermediário
                value = `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`;
            } else if (value.length > 2) {
                value = `(${value.slice(0, 2)}) ${value.slice(2)}`;
            } else if (value.length > 0) {
                value = `(${value}`;
            }
            
            e.target.value = value;
        });
    }

    // ==========================================
    // 5. Geração de Teste Grátis
    // ==========================================
    const trialForm = document.getElementById('trialForm');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    const progressBarFill = document.getElementById('progressBarFill');
    const formErrorMessage = document.getElementById('formErrorMessage');
    
    // Modal de Credenciais
    const credentialsModal = document.getElementById('credentialsModal');
    const modalBackdrop = document.getElementById('modalBackdrop');
    const closeModalBtn = document.getElementById('closeModalBtn');

    if (trialForm) {
        trialForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const name = document.getElementById('clientName').value.trim();
            const whatsapp = whatsappInput.value.trim();
            
            if (!name || !whatsapp) {
                showError('Por favor, preencha todos os campos.');
                return;
            }

            // Ocultar mensagem de erro anterior
            formErrorMessage.classList.add('hidden');
            
            // Iniciar animação do loading overlay
            showLoading(true);
            
            // Passos simulados do loading
            const steps = [
                { progress: 10, text: 'Conectando ao New Server...' },
                { progress: 35, text: 'Validando dados de WhatsApp e IP...' },
                { progress: 60, text: 'Gerando credenciais de IPTV...' },
                { progress: 85, text: 'Configurando liberação de 4 horas...' }
            ];

            let stepIndex = 0;
            const progressInterval = setInterval(() => {
                if (stepIndex < steps.length) {
                    progressBarFill.style.width = `${steps[stepIndex].progress}%`;
                    loadingText.textContent = steps[stepIndex].text;
                    stepIndex++;
                }
            }, 600);

            try {
                const res = await fetch('/api/solicitar-teste', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ name, whatsapp })
                });

                const data = await res.json();
                
                clearInterval(progressInterval);

                if (!res.ok || !data.success) {
                    throw new Error(data.message || 'Falha ao gerar o teste.');
                }

                // Carregamento concluído com sucesso
                progressBarFill.style.width = '100%';
                loadingText.textContent = 'Conta IPTV Criada!';
                
                setTimeout(() => {
                    showLoading(false);
                    // Preencher o modal com as credenciais
                    displayCredentials(data.data);
                }, 500);

            } catch (err) {
                clearInterval(progressInterval);
                showLoading(false);
                showError(err.message);
            }
        });
    }

    function showLoading(show) {
        if (show) {
            progressBarFill.style.width = '0%';
            loadingText.textContent = 'Iniciando conexão...';
            loadingOverlay.classList.remove('hidden');
        } else {
            loadingOverlay.classList.add('hidden');
        }
    }

    function showError(msg) {
        formErrorMessage.textContent = msg;
        formErrorMessage.classList.remove('hidden');
        // Rolar até o erro para o usuário ver no mobile
        formErrorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function displayCredentials(info) {
        // Preencher elementos de credenciais
        document.getElementById('resUsername').textContent = info.username || '------';
        document.getElementById('resPassword').textContent = info.password || '------';
        document.getElementById('resExpires').textContent = info.expiresAtFormatted || '4 horas';
        
        // As listas m3u e dns principal devem ser sempre as que possuem o dns ggbb
        const m3uUrl = `http://ggbb.fun/get.php?username=${info.username}&password=${info.password}&type=m3u_plus&output=ts`;
        document.getElementById('resM3u').textContent = m3uUrl;
        document.getElementById('resUrl').textContent = 'http://ggbb.fun';
        
        // Configurar botão de Checkout
        const checkoutBtn = document.getElementById('resCheckoutBtn');
        if (info.payUrl) {
            checkoutBtn.href = info.payUrl;
        } else {
            checkoutBtn.href = "https://wa.me/5579998130038?text=Ol%C3%A1%21+Gostei+do+teste+gr%C3%A1tis+e+quero+assinar+um+plano.";
        }

        // Mostrar Modal
        credentialsModal.classList.remove('hidden');
    }

    // Fechar Modal
    function closeModal() {
        credentialsModal.classList.add('hidden');
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);

    // Fechar modal com a tecla ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !credentialsModal.classList.contains('hidden')) {
            closeModal();
        }
    });

    // ==========================================
    // 6. Copiar para a Área de Transferência
    // ==========================================
    const copyButtons = document.querySelectorAll('.btn-copy');

    copyButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-copy');
            const targetElem = document.getElementById(targetId);
            
            if (targetElem) {
                const textToCopy = targetElem.textContent || targetElem.innerText;
                
                navigator.clipboard.writeText(textToCopy).then(() => {
                    // Feedback visual temporário no botão
                    const icon = btn.querySelector('i');
                    if (icon) {
                        icon.className = 'fa-solid fa-check text-success';
                        
                        setTimeout(() => {
                            icon.className = 'fa-regular fa-copy';
                        }, 2000);
                    }
                }).catch(err => {
                    console.error('Erro ao copiar texto: ', err);
                });
            }
        });
    });
});
