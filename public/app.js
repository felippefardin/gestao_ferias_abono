const $ = (s, e = document) => e.querySelector(s); const $$ = (s, e = document) => [...e.querySelectorAll(s)];

const pathMatch = location.pathname.match(/^(.*?\/gestao-ferias-abonos)(?:\/|$)/i);
const API_BASE = pathMatch ? pathMatch[1] : '';
const state = { me: null, servidores: [], eventos: [], arquivados: [], alertas: [], auditoria: [] };

const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, bad = false) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = bad ? '#b83e3e' : '#0b2539';
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3500);
}

function confirmDialog({ title = 'Confirmar ação', message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = {}) {
    const dialog = $('#confirmModal');
    if (!dialog) return Promise.resolve(false);
    $('#confirmModalTitulo').textContent = title;
    $('#confirmModalTexto').textContent = message || 'Deseja continuar?';
    $('#confirmModalConfirmar').textContent = confirmLabel;
    $('#confirmModalCancelar').textContent = cancelLabel;
    dialog.classList.toggle('is-danger', danger);
    dialog.showModal();
    return new Promise(resolve => {
        const finish = value => { dialog.close(); resolve(value); };
        $('#confirmModalConfirmar').onclick = () => finish(true);
        $('#confirmModalCancelar').onclick = () => finish(false);
        dialog.oncancel = event => { event.preventDefault(); finish(false); };
    });
}

async function api(url, opt = {}) {
    const r = await fetch(`${API_BASE}${url}`, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...opt
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
        const e = new Error(data.error || `Não foi possível concluir (erro ${r.status}).`);
        e.data = data;
        e.status = r.status;
        throw e;
    }
    return data;
}

function formData(form) {
    return Object.fromEntries(new FormData(form));
}

/* =========================================================
   SISTEMA DE TEMA DARK E ACESSIBILIDADE DE FONTE
   ========================================================= */
let defaultFontSize = 16;
let currentFontSize = parseFloat(localStorage.getItem('app_font_size')) || defaultFontSize;

function applyFontSize(size) {
    document.documentElement.style.fontSize = size + 'px';
    localStorage.setItem('app_font_size', size);
}

function initThemeAndAccessibility() {
    applyFontSize(currentFontSize);

    $('#btnFontIncrease')?.addEventListener('click', () => {
        currentFontSize = Math.min(currentFontSize + 1, 22);
        applyFontSize(currentFontSize);
    });

    $('#btnFontDecrease')?.addEventListener('click', () => {
        currentFontSize = Math.max(currentFontSize - 1, 12);
        applyFontSize(currentFontSize);
    });

    $('#btnFontReset')?.addEventListener('click', () => {
        currentFontSize = defaultFontSize;
        applyFontSize(currentFontSize);
    });

    const btnDark = $('#btnToggleDark');     function applyDarkMode(isDark) {         if (isDark) {             document.body.classList.add('dark-mode');             if (btnDark) btnDark.innerHTML = '<i class="theme-icon bi bi-sun-fill" aria-hidden="true"></i><span class="theme-text">Modo claro</span>';         } else {             document.body.classList.remove('dark-mode');             if (btnDark) btnDark.innerHTML = '<i class="theme-icon bi bi-moon-stars-fill" aria-hidden="true"></i><span class="theme-text">Modo escuro</span>';         }     }      btnDark?.addEventListener('click', () => {         const isDark = !document.body.classList.contains('dark-mode');         localStorage.setItem('app_dark_mode', isDark ? 'enabled' : 'disabled');         applyDarkMode(isDark);     });      if (localStorage.getItem('app_dark_mode') === 'enabled') {         applyDarkMode(true);     } }  /* =========================================================    AUTENTICAÇÃO E NAVEGAÇÃO    ========================================================= */ $$('[data-auth]').forEach(b => b.onclick = () => {$$('[data-auth]').forEach(x => x.classList.toggle('active', x === b));$('#loginForm').hidden = b.dataset.auth !== 'login';
    $('#registerForm').hidden = b.dataset.auth !== 'register';
    $('#forgotForm').hidden = $('#resetForm').hidden = true;
});

if ($('#forgotBtn')) $('#forgotBtn').onclick = () => { $('#loginForm').hidden = true; $('#forgotForm').hidden = false; }; $$('.backLogin').forEach(b => b.onclick = () => { $('#forgotForm').hidden = true; $('#loginForm').hidden = false; });

$('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const status = $('#loginStatus'), button = $('#loginSubmit');
    status.textContent = 'Verificando acesso...';
    status.className = 'login-status';
    button.disabled = true;
    button.textContent = 'Entrando...';
    try {
        await api('/api/login', { method: 'POST', body: JSON.stringify(formData(e.target)) });
        status.textContent = 'Acesso autorizado.';
        status.className = 'login-status success';
        await boot();
    } catch (x) {
        status.textContent = x.message;
        status.className = 'login-status error';
        toast(x.message, true);
    } finally {
        button.disabled = false;
        button.textContent = 'Entrar';
    }
};

$('#registerForm').onsubmit = async e => {
    e.preventDefault();
    try {
        await api('/api/register', { method: 'POST', body: JSON.stringify(formData(e.target)) });
        toast('Conta criada com sucesso. Faça login para acessar.');
        $('[data-auth="login"]').click();
    } catch (x) {
        toast(x.message, true);
    }
};

$('#forgotForm').onsubmit = async e => {
    e.preventDefault();
    const d = formData(e.target);
    try {
        const r = await api('/api/forgot', { method: 'POST', body: JSON.stringify(d) });
        toast(r.message);
        $('#forgotForm').hidden = true;
        $('#resetForm').hidden = false;
        $('#resetForm [name=email]').value = d.email;
    } catch (x) {
        toast(x.message, true);
    }
};

$('#resetForm').onsubmit = async e => {
    e.preventDefault();
    try {
        await api('/api/reset', { method: 'POST', body: JSON.stringify(formData(e.target)) });
        toast('Senha redefinida com sucesso.');
        $('#resetForm').hidden = true;
        $('#loginForm').hidden = false;
    } catch (x) {
        toast(x.message, true);
    }
};

async function boot() {
    try {
        state.me = await api('/api/me');
        $('#auth').hidden = true;
        $('#app').hidden = false;
        $('#userName').textContent = state.me.username;
        $('#avatar').textContent = state.me.username[0].toUpperCase();
        $('#userRole').textContent = state.me.role === 'master' ? 'Master administrador' : 'Administrador';
        $('#adminNav').hidden = state.me.role !== 'master';
        
        // Exibe banner se estiver personificando outro usuário
        const impersonateBanner = $('#impersonateBanner');
        if (impersonateBanner) {
            impersonateBanner.style.display = state.me.is_impersonated ? 'flex' : 'none';
        }

        $('#today').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());
        await reload();
        showPage('dashboard');
    } catch {
        $('#auth').hidden = false;
        $('#app').hidden = true;     } }  async function reload() {     [state.servidores, state.eventos, state.arquivados, state.alertas] = await Promise.all([         api('/api/servidores'),         api('/api/eventos'),         api('/api/eventos?archived=1'),         api('/api/alertas')     ]); renderAlertBell(); }  $$('[data-page]').forEach(b => b.onclick = () => showPage(b.dataset.page));
if ($('#menuBtn')) $('#menuBtn').onclick = () => $('aside').classList.toggle('open');

$('#logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    location.reload();
};

if ($('#btnRestoreMaster')) {
    $('#btnRestoreMaster').onclick = async () => {         await api('/api/admin/restore-master', { method: 'POST' });         await boot();     }; }  const titles = {     dashboard: 'Visão geral',     servidores: 'Cadastro de servidores',     ferias: 'Férias',     abono: 'Abonos',     arquivados: 'Arquivados',     auditoria: 'Auditoria',     perfil: 'Meu perfil',     admin: 'Administração' };  function showPage(page) {     $$('nav [data-page]').forEach(x => x.classList.toggle('active', x.dataset.page === page));
    if ($('#pageTitle')) $('#pageTitle').textContent = titles[page] || 'Gestão';
    $('aside').classList.remove('open');
    
    const pageRenderers = { dashboard, servidores, eventos, arquivados, auditoria, perfil, admin };
    const renderer = pageRenderers[page === 'ferias' || page === 'abono' ? 'eventos' : page];
    if (renderer) renderer(page);
}

/* =========================================================
   RENDERIZADORES DE TABELA E SEÇÕES
   ========================================================= */
function eventRows(items, archived = false) {
    if (!items.length) return `<div class="empty">Nenhum registro encontrado.</div>`;
    return `
    <table>
        <thead>
            <tr>
                <th>Servidor</th>
                <th>Tipo</th>
                <th>Período</th>
                <th>Alerta extra</th>
                <th>Criado por</th>
                ${archived ? '<th>Retenção</th>' : ''}
                <th>Ações</th>
            </tr>
        </thead>
        <tbody>
            ${items.map(e => `
                <tr class="${archived && e.dias_arquivado > 1826 ? 'old' : ''}">
                    <td><strong>${esc(e.servidor_nome)}</strong><br><small>${esc(e.observacoes || '')}</small></td>
                    <td><span class="badge ${e.tipo}">${e.tipo === 'ferias' ? 'Férias' : 'Abono'}</span></td>
                    <td>${fmt(e.inicio)} —${fmt(e.fim)}</td>
                    <td>${fmt(e.alerta_extra)}</td>
                    <td><span class="owner-chip"><i class="bi bi-person-circle" aria-hidden="true"></i>${esc(e.criado_por || 'Conta removida')}</span></td>
                    ${archived ? `<td>${e.dias_arquivado > 1826 ? '<span class="redtext">Mais de 5 anos</span>' : Math.max(0, Math.floor(e.dias_arquivado / 365)) + ' ano(s)'}</td>` : ''}
                    <td class="actions">
                        ${e.pode_editar ? `${!archived ? `<button class="icon-btn action-edit" onclick="openEvent('${e.tipo}', ${e.id})" title="Editar este registro"><i class="bi bi-pencil-square" aria-hidden="true"></i><span>Editar</span></button>` : ''}<button class="icon-btn action-delete" onclick="deleteEvent(${e.id},${archived})" title="Excluir este registro"><i class="bi bi-trash3" aria-hidden="true"></i><span>Excluir</span></button>` : '<span class="readonly-label" title="Somente quem criou pode alterar"><i class="bi bi-lock-fill" aria-hidden="true"></i> Somente leitura</span>'}
                    </td>
                </tr>
            `).join('')}
        </tbody>
    </table>`;
}

function dashboard() {
    const soon = state.eventos.filter(e => (new Date(e.inicio) - new Date()) / 864e5 <= 30);
    $('#content').innerHTML = `
    <div class="page">
        <section class="hero">
            <div>
                <h1>Olá, ${esc(state.me.username)}.</h1>
                <p>Acompanhe a programação da equipe e não perca nenhum prazo.</p>
            </div>
            <button onclick="openNewRecord()"><i class="bi bi-plus-circle-fill" aria-hidden="true"></i> Novo registro</button>
        </section>
        
        <section class="stats">
            <button type="button" class="stat stat-link" onclick="showPage('servidores')" aria-label="Abrir servidores cadastrados"><span class="dot"><i class="bi bi-people-fill" aria-hidden="true"></i></span><small>Servidores cadastrados</small><strong>${state.servidores.length}</strong><span class="stat-action">Ver servidores <i class="bi bi-arrow-right" aria-hidden="true"></i></span></button>
            <button type="button" class="stat stat-link" onclick="showPage('ferias')" aria-label="Abrir férias ativas ou futuras"><span class="dot"><i class="bi bi-sun-fill" aria-hidden="true"></i></span><small>Férias ativas ou futuras</small><strong>${state.eventos.filter(x => x.tipo === 'ferias').length}</strong><span class="stat-action">Ver férias <i class="bi bi-arrow-right" aria-hidden="true"></i></span></button>
            <button type="button" class="stat stat-link" onclick="showPage('abono')" aria-label="Abrir abonos ativos ou futuros"><span class="dot"><i class="bi bi-calendar2-check-fill" aria-hidden="true"></i></span><small>Abonos ativos ou futuros</small><strong>${state.eventos.filter(x => x.tipo === 'abono').length}</strong><span class="stat-action">Ver abonos <i class="bi bi-arrow-right" aria-hidden="true"></i></span></button>
            <div class="stat"><span class="dot"><i class="bi bi-bell-fill" aria-hidden="true"></i></span><small>Alertas atuais</small><strong>${state.alertas.length}</strong></div>
        </section>

        <div class="section-head"><h3>Alertas e próximos compromissos</h3></div>
        <div class="alert-list">
            ${state.alertas.length ? state.alertas.map(e => `
                <div class="alert-item" id="alerta-${e.id}">
                    <div>
                        <strong>${esc(e.servidor_nome)} ·${e.tipo === 'ferias' ? 'Férias' : 'Abono'}</strong>
                        <small>${fmt(e.inicio)} a${fmt(e.fim)}</small>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="badge ${e.dias <= 5 ? 'warn' : e.tipo}">${e.dias === 0 ? 'Hoje' : e.dias + ' dia(s)'}</span>
                        <button class="icon-btn" onclick="responderAlerta(${e.id}, 'manter')" title="Manter alerta">Manter</button>
                        <button class="icon-btn" onclick="responderAlerta(${e.id}, 'parar')" title="Parar alerta">Parar</button>
                    </div>
                </div>
            `).join('') : '<div class="card empty">Nenhum alerta pendente.</div>'}
        </div>

        <div class="section-head"><h3>Próximos 30 dias</h3></div>
        <div class="table-wrap">${eventRows(soon)}</div>
    </div>`;
}

async function responderAlerta(id, acao) {
    try {
        await api(`/api/alertas/${id}/responder`, { method: 'POST', body: JSON.stringify({ acao }) });
        await reload();
        dashboard();
        toast(acao === 'parar' ? 'Alerta interrompido.' : 'Alerta mantido.');
    } catch (x) {
        toast(x.message, true);
    }
}

function servidores() {
    $('#content').innerHTML = `
    <div class="page">
        <div class="section-head">
            <div>
                <h3>Servidores</h3>
                <small>Somente o nome completo é obrigatório.</small>
            </div>
            <div class="section-actions">
                <button type="button" class="secondary" onclick="showPage('dashboard')"><i class="bi bi-arrow-left" aria-hidden="true"></i> Voltar</button>
                <button class="primary" onclick="openServidor()">+ Cadastrar servidor</button>
            </div>
        </div>
        <div class="table-wrap">
            ${state.servidores.length ? `
            <table>
                <thead>
                    <tr>
                        <th>Nome completo</th>
                        <th>Função</th>
                        <th>E-mail</th>
                        <th>CPF</th>
                        <th>Matrícula</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.servidores.map(s => `
                        <tr>
                            <td><strong>${esc(s.nome)}</strong></td>
                            <td>${esc(s.funcao || '—')}</td>
                            <td>${esc(s.email || '—')}</td>
                            <td>${esc(s.cpf || '—')}</td>
                            <td>${esc(s.matricula || '—')}</td>
                            <td class="actions">
                                <button class="icon-btn" onclick="openServidor(${s.id})">Editar</button>
                                <button class="icon-btn" onclick="deleteServidor(${s.id})">Excluir</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>` : '<div class="empty">Nenhum servidor cadastrado.</div>'}
        </div>
    </div>`;
}

function eventos(tipo) {
    const items = state.eventos.filter(e => e.tipo === tipo);
    $('#content').innerHTML = `
    <div class="page">
        <div class="section-head">
            <div>
                <h3>${tipo === 'ferias' ? 'Férias programadas' : 'Abonos programados'}</h3>
                <small>Os alertas padrão aparecem a partir de 20 dias antes.</small>
            </div>
            <div class="section-actions">
                <button type="button" class="secondary" onclick="showPage('dashboard')"><i class="bi bi-arrow-left" aria-hidden="true"></i> Voltar</button>
                <button class="secondary" onclick="openExport('${tipo}')"><i class="bi bi-download" aria-hidden="true"></i> Exportar</button>
                <button class="primary" onclick="openEvent('${tipo}')">+ Novo ${tipo === 'ferias' ? 'período' : 'abono'}</button>
            </div>
        </div>
        <div class="table-wrap">${eventRows(items)}</div>
    </div>`;
}

function arquivados() {
    $('#content').innerHTML = `
    <div class="page">
        <div class="section-head">
            <div>
                <h3>Histórico arquivado</h3>
                <small>Registros encerrados são movidos automaticamente. Itens com mais de 5 anos são destacados.</small>
            </div>
        </div>
        <div class="table-wrap">${eventRows(state.arquivados, true)}</div>
    </div>`;
}

async function auditoria() {
    try {
        state.auditoria = await api('/api/audit');
    } catch {
        state.auditoria = [];
    }
    $('#content').innerHTML = `
    <div class="page">
        <div class="section-head audit-head">
            <div>
                <h3>Logs de Auditoria</h3>
                <small>Histórico completo de ações realizadas no sistema.</small>
            </div>
            <input id="auditSearch" type="search" placeholder="Buscar por usuário, ação ou IP" aria-label="Buscar na auditoria">
        </div>
        <div class="table-wrap">
            ${state.auditoria.length ? `
            <table>
                <thead>
                    <tr>
                        <th>Data / Hora</th>
                        <th>Usuário</th>
                        <th>Ação</th>
                        <th>IP</th>
                        <th>Detalhes</th>
                    </tr>
                </thead>
                <tbody>
                    ${state.auditoria.map(a => `
                        <tr data-audit-row="${esc(`${a.username || 'Sistema'} ${a.action} ${a.ip} ${a.details}`.toLowerCase())}">
                            <td>${new Date(a.created_at + 'Z').toLocaleString('pt-BR')}</td>
                            <td>${esc(a.username || 'Sistema')}</td>
                            <td>${esc(auditActionLabel(a.action))}</td>
                            <td>${esc(a.ip)}</td>
                            <td><button type="button" class="icon-btn" onclick="openAuditDetails(${a.id})">Ver detalhes</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>` : '<div class="empty">Nenhum log de auditoria encontrado.</div>'}
        </div>
    </div>`;
    $('#auditSearch')?.addEventListener('input', e => {
        const term = e.target.value.trim().toLowerCase();
        $$('[data-audit-row]').forEach(row => row.hidden = !row.dataset.auditRow.includes(term));
    });
}

function perfil() {
    $('#content').innerHTML = `
    <div class="page">
        <div class="card" style="max-width:600px">
            <h3>Dados da conta</h3>
            <p style="color:var(--muted)">Login: <strong>${esc(state.me.username)}</strong></p>
            <form id="profileForm">
                <label>Novo e-mail<input type="email" name="email" value="${esc(state.me.email || '')}"></label>
                <label>Nova senha (deixe em branco para manter)<input type="password" name="password" minlength="8"></label>
                <label>Senha atual para confirmar *<input type="password" name="currentPassword" required></label>
                <div class="form-actions">
                    <button type="button" class="danger" id="deleteAccount" ${state.me.role === 'master' ? 'disabled' : ''}>Excluir conta</button>
                    <button class="primary">Salvar alterações</button>
                </div>
            </form>
        </div>
    </div>`;

    $('#profileForm').onsubmit = async e => {
        e.preventDefault();
        try {
            await api('/api/me', { method: 'PATCH', body: JSON.stringify(formData(e.target)) });
            toast('Perfil atualizado.');
            await boot();
        } catch (x) {
            toast(x.message, true);
        }
    };

    $('#deleteAccount').onclick = async () => {
        if (await confirmDialog({ title: 'Excluir sua conta?', message: 'Esta ação é permanente e seus dados de acesso serão removidos. Deseja continuar?', confirmLabel: 'Excluir conta', danger: true })) {
            await api('/api/me', { method: 'DELETE' });
            location.reload();
        }
    };
}

async function admin(tab = 'users') {
    if (state.me.role !== 'master') return;
    const [users, audit] = await Promise.all([api('/api/admin/users'), api('/api/admin/audit')]);
    state.auditoria = audit;
    
    $('#content').innerHTML = `
    <div class="page">
        <div class="section-head">
            <h3>Administração do Sistema</h3>
            ${tab === 'users' ? '<button class="primary" onclick="openCreateUser()">+ Cadastrar Usuário</button>' : ''}
        </div>
        <div class="admin-tabs">
            <button class="${tab === 'users' ? 'active' : ''}" onclick="admin('users')">Usuários</button>
            <button class="${tab === 'audit' ? 'active' : ''}" onclick="admin('audit')">Auditoria</button>
        </div>
        <div class="table-wrap">
            ${tab === 'users' ? `
            <table>
                <thead>
                    <tr>
                        <th>Usuário</th>
                        <th>E-mail</th>
                        <th>Perfil</th>
                        <th>Status</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(u => `
                        <tr>
                            <td>${esc(u.username)}</td>
                            <td>${esc(u.email || '—')}</td>
                            <td>${esc(u.role)}</td>
                            <td>${u.active ? 'Ativo' : 'Inativo'}</td>
                            <td class="actions">
                                <button class="icon-btn" onclick='editUser(${JSON.stringify(u)})'>Editar</button>
                                ${u.id !== state.me.id ? `
                                    <button class="icon-btn" onclick="impersonate(${u.id})">Entrar</button>
                                    <button class="icon-btn" onclick="deleteUser(${u.id})">Excluir</button>
                                ` : ''}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>` : `
            <table>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Usuário</th>
                        <th>Ação</th>
                        <th>IP</th>
                        <th>Detalhes</th>
                    </tr>
                </thead>
                <tbody>
                    ${audit.map(a => `
                        <tr>
                            <td>${new Date(a.created_at + 'Z').toLocaleString('pt-BR')}</td>
                            <td>${esc(a.username || 'Sistema')}</td>
                            <td>${esc(auditActionLabel(a.action))}</td>
                            <td>${esc(a.ip)}</td>
                            <td><button type="button" class="icon-btn" onclick="openAuditDetails(${a.id})">Ver detalhes</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`}
        </div>
    </div>`;
}

/* =========================================================
   MODAIS E EDICÕES (SERVIDORES, FÉRIAS/ABONOS, USUÁRIOS)
   ========================================================= */
function modal(html) {
    $('#modalBody').innerHTML = html;
    $('#modal').showModal();
}

window.closeModal = () => $('#modal')?.close();

window.openNewRecord = () => {
    modal(`
        <h2>O que deseja cadastrar?</h2>
        <p class="export-intro">Escolha uma opção para abrir diretamente o formulário correspondente.</p>
        <div class="record-choice-grid">
            <button type="button" class="record-choice" onclick="closeModal(); openEvent('ferias')">
                <span class="record-choice-icon"><i class="bi bi-sun-fill" aria-hidden="true"></i></span>
                <span><strong>Férias</strong><small>Cadastrar um novo período de férias</small></span><i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="record-choice" onclick="closeModal(); openEvent('abono')">
                <span class="record-choice-icon"><i class="bi bi-calendar2-check-fill" aria-hidden="true"></i></span>
                <span><strong>Abono</strong><small>Cadastrar um novo período de abono</small></span><i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="record-choice" onclick="closeModal(); openServidor()">
                <span class="record-choice-icon"><i class="bi bi-person-plus-fill" aria-hidden="true"></i></span>
                <span><strong>Novo servidor</strong><small>Adicionar uma pessoa ao cadastro</small></span><i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
            <button type="button" class="record-choice" onclick="closeModal(); openNewAlert()">
                <span class="record-choice-icon"><i class="bi bi-bell-fill" aria-hidden="true"></i></span>
                <span><strong>Alerta</strong><small>Definir um aviso para um registro existente</small></span><i class="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
        </div>
        <div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button></div>
    `);
};

window.openNewAlert = () => {
    const ownEvents = state.eventos.filter(evento => evento.pode_editar);
    $('#notificationPanel').hidden = true;
    $('#notificationBell')?.setAttribute('aria-expanded', 'false');
    if (!ownEvents.length) {
        toast('Cadastre primeiro um período de férias ou abono em sua conta.', true);
        return;
    }
    modal(`
        <h2>Criar alerta</h2>
        <form id="newAlertForm">
            <p class="export-intro">O alerta ficará vinculado à sua conta e aparecerá no sino do cabeçalho.</p>
            <label>Registro relacionado *
                <select name="evento_id" required>
                    <option value="">Selecione um registro</option>
                    ${ownEvents.map(e => `<option value="${e.id}">${esc(e.servidor_nome)} — ${e.tipo === 'ferias' ? 'Férias' : 'Abono'} (${fmt(e.inicio)} a ${fmt(e.fim)})</option>`).join('')}
                </select>
            </label>
            <label>Data do alerta *<input type="date" name="alerta_extra" min="${new Date().toISOString().slice(0, 10)}" required></label>
            <div class="form-actions">
                <button type="button" class="secondary" onclick="closeModal()">Cancelar</button>
                <button class="primary"><i class="bi bi-bell-fill" aria-hidden="true"></i> Salvar alerta</button>
            </div>
        </form>
    `);
    $('#newAlertForm').onsubmit = async event => {
        event.preventDefault();
        const data = formData(event.currentTarget);
        const evento = ownEvents.find(item => item.id === Number(data.evento_id));
        if (!evento) return toast('Selecione um registro válido.', true);
        try {
            await api(`/api/eventos/${evento.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    servidor_id: evento.servidor_id, tipo: evento.tipo, inicio: evento.inicio, fim: evento.fim,
                    alerta_extra: data.alerta_extra, observacoes: evento.observacoes || '', confirmConflict: true
                })
            });
            closeModal();
            await reload();
            if ($('#pageTitle')?.textContent === 'Visão geral') dashboard();
            toast('Alerta criado e vinculado à sua conta.');
        } catch (error) {
            toast(error.message, true);
        }
    };
};

function renderAlertBell() {
    const count = $('#notificationCount');
    const list = $('#notificationList');
    if (!count || !list) return;
    const unread = state.alertas.filter(alerta => !alerta.lido).length;
    count.textContent = unread > 99 ? '99+' : String(unread);
    count.hidden = unread === 0;
    if ($('#markAllAlertsRead')) $('#markAllAlertsRead').disabled = unread === 0;
    list.innerHTML = state.alertas.length ? state.alertas.map(alerta => `
        <div class="notification-item ${alerta.lido ? 'is-read' : ''}">
            <span class="notification-item-icon"><i class="bi bi-${alerta.tipo === 'ferias' ? 'sun-fill' : 'calendar2-check-fill'}" aria-hidden="true"></i></span>
            <div><strong>${esc(alerta.servidor_nome)} · ${alerta.tipo === 'ferias' ? 'Férias' : 'Abono'}</strong><small>${fmt(alerta.inicio)} a ${fmt(alerta.fim)}${alerta.alerta_extra ? `<br>Alerta programado: ${fmt(alerta.alerta_extra)}` : ''}</small>
                <div class="notification-actions">${alerta.lido ? '<span class="read-label"><i class="bi bi-check2"></i> Lido</span>' : `<button type="button" onclick="markAlertRead(${alerta.id})">Marcar como lido</button>`}<button type="button" class="delete-alert" onclick="deleteAlert(${alerta.id})"><i class="bi bi-trash3"></i> Apagar</button></div>
            </div>
        </div>
    `).join('') : '<div class="notification-empty"><i class="bi bi-bell-slash" aria-hidden="true"></i><p>Você não possui alertas ativos.</p></div>';
}

window.markAlertRead = async id => {
    try { await api(`/api/alertas/${id}/lido`, { method: 'POST' }); await reload(); toast('Alerta marcado como lido.'); }
    catch (error) { toast(error.message, true); }
};
window.markAllAlertsRead = async () => {
    try { await api('/api/alertas/ler-todos', { method: 'POST' }); await reload(); toast('Todos os alertas foram marcados como lidos.'); }
    catch (error) { toast(error.message, true); }
};
window.deleteAlert = async id => {
    try { await api(`/api/alertas/${id}`, { method: 'DELETE' }); await reload(); toast('Alerta apagado.'); }
    catch (error) { toast(error.message, true); }
};

$('#notificationBell')?.addEventListener('click', event => {
    event.stopPropagation();
    const panel = $('#notificationPanel');
    panel.hidden = !panel.hidden;
    event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
});

$('#notificationPanel')?.addEventListener('click', event => event.stopPropagation());
document.addEventListener('click', () => {
    const panel = $('#notificationPanel');
    if (panel && !panel.hidden) {
        panel.hidden = true;
        $('#notificationBell')?.setAttribute('aria-expanded', 'false');
    }
});

window.openExport = tipo => {
    const label = tipo === 'ferias' ? 'Férias' : 'Abonos';
    modal(`
        <h2>Exportar planilha de ${label}</h2>
        <form id="exportForm" class="export-form">
            <p class="export-intro">Escolha o período, os servidores e o formato do documento. Datas em branco incluem todo o período cadastrado.</p>
            <div class="grid2">
                <label>Período inicial<input type="date" name="inicio"></label>
                <label>Período final<input type="date" name="fim"></label>
            </div>
            <div class="server-picker">
                <div class="server-picker-head"><strong>Servidores</strong><button type="button" class="icon-btn" id="toggleExportServers">Desmarcar todos</button></div>
                <div class="server-picker-list">
                    ${state.servidores.map(s => `<label class="server-check"><input type="checkbox" name="servidores" value="${s.id}" checked><span>${esc(s.nome)}</span></label>`).join('')}
                </div>
            </div>
            <div class="export-format" role="radiogroup" aria-label="Formato do arquivo">
                <label class="format-option"><input type="radio" name="formato" value="excel" checked><span><strong>Excel</strong><br><small>Arquivo .csv compatível com Excel</small></span></label>
                <label class="format-option"><input type="radio" name="formato" value="pdf"><span><strong>PDF</strong><br><small>Documento pronto para salvar ou imprimir</small></span></label>
            </div>
            <div class="form-actions">
                <button type="button" class="secondary" onclick="closeModal()">Cancelar</button>
                <button class="primary"><i class="bi bi-download" aria-hidden="true"></i> Gerar documento</button>
            </div>
        </form>
    `);
    let allSelected = true;
    $('#toggleExportServers').onclick = event => {
        allSelected = !allSelected;
        $$('#exportForm [name="servidores"]').forEach(input => input.checked = allSelected);
        event.currentTarget.textContent = allSelected ? 'Desmarcar todos' : 'Selecionar todos';
    };
    $('#exportForm').onsubmit = event => {
        event.preventDefault();
        const form = event.currentTarget;
        const ids = new Set($$('[name="servidores"]:checked', form).map(input => Number(input.value)));
        const inicio = form.inicio.value;
        const fim = form.fim.value;
        if (inicio && fim && fim < inicio) return toast('A data final deve ser igual ou posterior à inicial.', true);
        if (!ids.size) return toast('Selecione ao menos um servidor.', true);
        const rows = state.eventos.filter(e => e.tipo === tipo && ids.has(Number(e.servidor_id)) && (!inicio || e.fim >= inicio) && (!fim || e.inicio <= fim));
        if (!rows.length) return toast('Nenhum registro encontrado com os filtros informados.', true);
        const meta = { tipo, label, inicio, fim };
        if (form.formato.value === 'excel') exportExcel(rows, meta); else exportPdf(rows, meta);
        closeModal();
        toast(`${rows.length} registro(s) preparado(s) para exportação.`);
    };
};

function exportRows(rows) {
    return rows.map(e => [e.servidor_nome, e.tipo === 'ferias' ? 'Férias' : 'Abono', fmt(e.inicio), fmt(e.fim), fmt(e.alerta_extra), e.observacoes || '', e.criado_por || 'Conta removida']);
}

function exportExcel(rows, meta) {
    const headers = ['Servidor', 'Tipo', 'Data inicial', 'Data final', 'Alerta extra', 'Observações', 'Criado por'];
    const csvCell = value => {
        let text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
        // Impede que conteúdos digitados pelo usuário sejam interpretados como fórmulas.
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    // "sep=;" faz o Excel brasileiro reconhecer as colunas mesmo quando o
    // separador regional do Windows é ponto e vírgula. O BOM preserva acentos.
    const csv = `sep=;\r\n${[headers, ...exportRows(rows)].map(row => row.map(csvCell).join(';')).join('\r\n')}`;
    downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), `${meta.tipo}-${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPdf(rows, meta) {
    const popup = window.open('', '_blank');
    if (!popup) return toast('Permita a abertura de janelas para gerar o PDF.', true);
    popup.opener = null;
    const period = meta.inicio || meta.fim ? `${meta.inicio ? fmt(meta.inicio) : 'Início'} a ${meta.fim ? fmt(meta.fim) : 'Hoje'}` : 'Todos os períodos';
    const body = exportRows(rows).map(row => `<tr>${row.map(value => `<td>${esc(value)}</td>`).join('')}</tr>`).join('');
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${meta.label}</title><style>@page{size:A4 landscape;margin:14mm}body{font-family:Arial;color:#173042}h1{margin:0 0 6px;color:#12314b}.meta{color:#627482;margin-bottom:20px}table{width:100%;border-collapse:collapse;font-size:10px}th{background:#12314b;color:#fff;text-align:left}th,td{padding:8px;border:1px solid #dbe4e9;vertical-align:top}tr:nth-child(even){background:#f4f7f8}.footer{margin-top:14px;font-size:9px;color:#71808c}</style></head><body><h1>Relatório de ${meta.label}</h1><div class="meta">Período: ${period} · ${rows.length} registro(s)</div><table><thead><tr>${['Servidor','Tipo','Data inicial','Data final','Alerta extra','Observações','Criado por'].map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table><div class="footer">Gerado em ${new Date().toLocaleString('pt-BR')}</div><script>window.onload=()=>{window.print()}<\/script></body></html>`);
    popup.document.close();
}

function auditActionLabel(action) {
    const labels = {
        LOGIN: 'Entrada no sistema', LOGIN_FAILED: 'Tentativa de acesso sem sucesso', LOGOUT: 'Saída do sistema',
        CREATE_ACCOUNT: 'Conta criada', CREATE_SERVIDOR: 'Servidor cadastrado', UPDATE_SERVIDOR: 'Servidor atualizado',
        DELETE_SERVIDOR: 'Servidor excluído', CREATE_EVENTO: 'Registro criado', UPDATE_EVENTO: 'Registro atualizado',
        DELETE_EVENTO: 'Registro excluído', ADMIN_CREATE_USER: 'Usuário cadastrado pelo master',
        ADMIN_UPDATE_USER: 'Usuário atualizado pelo master', ADMIN_DELETE_USER: 'Usuário excluído pelo master',
        IMPERSONATE: 'Master acessou outro usuário', RESTORE_MASTER: 'Retorno à conta master',
        KEEP_ALERT: 'Alerta mantido', STOP_ALERT: 'Alerta interrompido', UPDATE_PROFILE: 'Perfil atualizado'
    };
    return labels[action] || action.replaceAll('_', ' ').toLowerCase();
}

window.openAuditDetails = id => {
    const record = state.auditoria.find(item => item.id === id);
    if (!record) return toast('Detalhes não encontrados.', true);
    let details = {};
    try { details = JSON.parse(record.details || '{}'); } catch { details = { informação: record.details }; }
    const entries = Object.entries(details);
    modal(`
        <h2>Detalhes da auditoria</h2>
        <dl class="audit-details-list">
            <div><dt>Data e hora</dt><dd>${new Date(record.created_at + 'Z').toLocaleString('pt-BR')}</dd></div>
            <div><dt>Usuário</dt><dd>${esc(record.username || 'Sistema')}</dd></div>
            <div><dt>Ação</dt><dd>${esc(auditActionLabel(record.action))}</dd></div>
            <div><dt>Endereço IP</dt><dd>${esc(record.ip || '—')}</dd></div>
            ${entries.map(([key, value]) => `<div><dt>${esc(key.replaceAll('_', ' '))}</dt><dd>${esc(Array.isArray(value) ? value.join(', ') : value)}</dd></div>`).join('')}
        </dl>
        ${entries.length ? '' : '<p class="empty compact">Esta ação não possui informações adicionais.</p>'}
        <div class="form-actions"><button type="button" class="primary" onclick="closeModal()">Fechar</button></div>
    `);
};

window.openServidor = id => {
    const s = state.servidores.find(x => x.id === id) || {};
    modal(`
        <h2>${id ? 'Editar' : 'Cadastrar'} servidor</h2>
        <form id="servidorForm">
            <label>Nome completo *<input name="nome" required value="${esc(s.nome || '')}"></label>
            <div class="grid2">
                <label>Função<input name="funcao" value="${esc(s.funcao || '')}"></label>
                <label>E-mail<input type="email" name="email" value="${esc(s.email || '')}"></label>
            </div>
            <div class="grid2">
                <label>CPF<input name="cpf" value="${esc(s.cpf || '')}"></label>
                <label>Matrícula<input name="matricula" value="${esc(s.matricula || '')}"></label>
            </div>
            <div class="form-actions">
                <button type="button" class="secondary" onclick="closeModal()">Cancelar</button>
                <button class="primary">Salvar</button>
            </div>
        </form>
    `);

    $('#servidorForm').onsubmit = async e => {
        e.preventDefault();
        const data = formData(e.target);
        const save = payload => api(id ? `/api/servidores/${id}` : '/api/servidores', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
        try {
            await save(data);
            $('#modal').close();
            await reload();
            showPage('servidores');
            toast('Servidor salvo.');
        } catch (x) {
            if (x.data?.error === 'DUPLICATE') {
                const details = x.data.duplicates.map(item => `${item.campo}: “${item.valor}” — ${item.servidor_nome} está cadastrado com esse dado.`).join('\n');
                const proceed = await confirmDialog({ title: 'Dados repetidos encontrados', message: `${details}\n\nDeseja continuar mesmo assim?`, confirmLabel: 'Continuar mesmo assim', cancelLabel: 'Cancelar' });
                if (!proceed) return;
                try { data.confirmDuplicate = true; await save(data); $('#modal').close(); await reload(); showPage('servidores'); toast('Servidor salvo com dados repetidos.'); }
                catch (error) { toast(error.message, true); }
                return;
            }
            toast(x.message, true);
        }
    };
};

window.deleteServidor = async id => {
    if (!await confirmDialog({ title: 'Excluir servidor?', message: 'O servidor será removido apenas se não possuir registros vinculados.', confirmLabel: 'Excluir servidor', danger: true })) return;
    try {
        await api(`/api/servidores/${id}`, { method: 'DELETE' });
        await reload();
        showPage('servidores');
        toast('Servidor excluído.');
    } catch (x) {
        toast(x.message, true);
    }
};

window.openEvent = (tipo = 'ferias', id = null) => {
    if (!state.servidores.length) {
        toast('Cadastre um servidor primeiro.', true);
        return;
    }
    const evento = id ? state.eventos.find(x => x.id === id) : {};

    modal(`
        <h2>${id ? 'Editar' : 'Novo'} registro</h2>
        <form id="eventForm">
            <label>Servidor *
                <select name="servidor_id" required ${id ? 'disabled' : ''}>
                    <option value="">Selecione</option>
                    ${state.servidores.map(s => `<option value="${s.id}" ${s.id === evento.servidor_id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}
                </select>
            </label>
            <label>Tipo
                <select name="tipo">
                    <option value="ferias" ${(evento.tipo || tipo) === 'ferias' ? 'selected' : ''}>Férias</option>
                    <option value="abono" ${(evento.tipo || tipo) === 'abono' ? 'selected' : ''}>Abono</option>
                </select>
            </label>
            <div class="grid2">
                <label>Data inicial *<input type="date" name="inicio" value="${evento.inicio || ''}" required></label>
                <label>Data final *<input type="date" name="fim" value="${evento.fim || ''}" required></label>
            </div>
            <label>Alerta extra (opcional)<input type="date" name="alerta_extra" value="${evento.alerta_extra || ''}"></label>
            <label>Observações<textarea name="observacoes" rows="3">${esc(evento.observacoes || '')}</textarea></label>
            <div class="form-actions">
                <button type="button" class="secondary" onclick="closeModal()">Cancelar</button>
                <button class="primary">Salvar registro</button>
            </div>
        </form>
    `);

    $('#eventForm').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        if (id) d.servidor_id = evento.servidor_id;

        async function enviarRegistro(payload) {
            const url = id ? `/api/eventos/${id}` : '/api/eventos';
            const method = id ? 'PATCH' : 'POST';
            await api(url, { method, body: JSON.stringify(payload) });
            $('#modal').close();
            await reload();
            showPage(payload.tipo);
            toast(id ? 'Registro atualizado.' : 'Registro criado.');
        }

        try {
            await enviarRegistro(d);
        } catch (x) {
            if (x.data?.error === 'CONFLICT') {
                const list = x.data.conflicts.map(c => `${c.servidor_nome} — ${c.tipo === 'ferias' ? 'Férias' : 'Abono'} (${fmt(c.inicio)} a ${fmt(c.fim)})`);
                
                // Exibe modal de conflito customizado ou nativo
                const modalConflito = $('#modalConflito');
                if (modalConflito) {
                    $('#modalConflitoTexto').innerHTML = `<p>O período informado coincide com:</p><ul>${list.map(item => `<li>${esc(item)}</li>`).join('')}</ul><p><strong>Deseja continuar ou voltar para ajustar as datas?</strong></p>`;
                    modalConflito.showModal();
                    
                    $('#btnConflitoContinuar').onclick = async () => {
                        modalConflito.close();
                        d.confirmConflict = true;
                        try { await enviarRegistro(d); } catch (err) { toast(err.message, true); }
                    };
                    
                    $('#btnConflitoVoltar').onclick = () => {
                        modalConflito.close();
                    };
                } else if (confirm(`Conflito de datas com:\n${list.join('\n')}\n\nDeseja continuar mesmo assim?`)) {
                    d.confirmConflict = true;
                    await enviarRegistro(d);
                }
            } else {
                toast(x.message, true);
            }
        }
    };
};

window.deleteEvent = async (id, archived) => {
    if (!await confirmDialog({ title: 'Excluir registro?', message: 'O registro será removido permanentemente e não poderá ser recuperado.', confirmLabel: 'Excluir registro', danger: true })) return;
    await api(`/api/eventos/${id}`, { method: 'DELETE' });
    await reload();
    showPage(archived ? 'arquivados' : 'dashboard');
    toast('Registro excluído.');
};

window.openCreateUser = () => {
    modal(`
        <h2>Cadastrar usuário</h2>
        <form id="createUserForm">
            <label>Nome de usuário *<input name="username" required></label>
            <label>E-mail<input type="email" name="email"></label>
            <div class="grid2">
                <label>CPF<input name="cpf"></label>
                <label>Matrícula<input name="matricula"></label>
            </div>
            <div class="grid2">
                <label>Perfil
                    <select name="role">
                        <option value="admin">Administrador</option>
                        <option value="master">Master</option>
                    </select>
                </label>
                <label>Senha *<input type="password" name="password" minlength="8" required></label>
            </div>
            <div class="form-actions">
                <button type="button" class="secondary" onclick="closeModal()">Cancelar</button>
                <button class="primary">Cadastrar</button>
            </div>
        </form>
    `);

    $('#createUserForm').onsubmit = async e => {
        e.preventDefault();
        try {
            await api('/api/admin/users', { method: 'POST', body: JSON.stringify(formData(e.target)) });
            $('#modal').close();
            admin('users');
            toast('Usuário cadastrado com sucesso.');
        } catch (x) {
            toast(x.message, true);
        }
    };
};

window.editUser = u => {
    modal(`
        <h2>Editar usuário</h2>
        <form id="userForm">
            <label>Nome de usuário<input name="username" value="${esc(u.username)}" required></label>
            <label>E-mail<input name="email" value="${esc(u.email || '')}"></label>
            <div class="grid2">
                <label>CPF<input name="cpf" value="${esc(u.cpf || '')}"></label>
                <label>Matrícula<input name="matricula" value="${esc(u.matricula || '')}"></label>
            </div>
            <div class="grid2">
                <label>Perfil
                    <select name="role">
                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador</option>
                        <option value="master" ${u.role === 'master' ? 'selected' : ''}>Master</option>
                    </select>
                </label>
                <label>Status
                    <select name="active">
                        <option value="1" ${u.active ? 'selected' : ''}>Ativo</option>
                        <option value="0" ${!u.active ? 'selected' : ''}>Inativo</option>
                    </select>
                </label>
            </div>
            <label>Nova senha (opcional)<input type="password" name="password" minlength="8"></label>
            <div class="form-actions">
                <button type="button" class="secondary" onclick="closeModal()">Cancelar</button>
                <button class="primary">Salvar</button>
            </div>
        </form>
    `);

    $('#userForm').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        d.active = d.active === '1';
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(d) });
        $('#modal').close();
        admin('users');
        toast('Usuário atualizado.');
    };
};

window.impersonate = async id => {
    if (await confirmDialog({ title: 'Acessar como este usuário?', message: 'Você passará a visualizar o sistema com as permissões desta conta. Para voltar ao master, use o botão no topo da tela.', confirmLabel: 'Acessar conta' })) {
        await api(`/api/admin/impersonate/${id}`, { method: 'POST' });
        await boot();
    }
};

window.deleteUser = async id => {
    if (await confirmDialog({ title: 'Excluir usuário?', message: 'A conta será removida permanentemente. Os registros históricos serão preservados quando aplicável.', confirmLabel: 'Excluir usuário', danger: true })) {
        await api(`/api/admin/users/${id}`, { method: 'DELETE' });
        admin('users');
        toast('Usuário excluído.');
    }
};

window.admin = admin;

// Inicialização da aplicação
initThemeAndAccessibility();
boot();
