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

    const btnDark = $('#btnToggleDark');     function applyDarkMode(isDark) {         if (isDark) {             document.body.classList.add('dark-mode');             if (btnDark) btnDark.innerHTML = '<span class="theme-icon">☀️</span> <span class="theme-text">Modo Claro</span>';         } else {             document.body.classList.remove('dark-mode');             if (btnDark) btnDark.innerHTML = '<span class="theme-icon">🌙</span> <span class="theme-text">Modo Dark</span>';         }     }      btnDark?.addEventListener('click', () => {         const isDark = !document.body.classList.contains('dark-mode');         localStorage.setItem('app_dark_mode', isDark ? 'enabled' : 'disabled');         applyDarkMode(isDark);     });      if (localStorage.getItem('app_dark_mode') === 'enabled') {         applyDarkMode(true);     } }  /* =========================================================    AUTENTICAÇÃO E NAVEGAÇÃO    ========================================================= */ $$('[data-auth]').forEach(b => b.onclick = () => {$$('[data-auth]').forEach(x => x.classList.toggle('active', x === b));$('#loginForm').hidden = b.dataset.auth !== 'login';
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
        $('#app').hidden = true;     } }  async function reload() {     [state.servidores, state.eventos, state.arquivados, state.alertas] = await Promise.all([         api('/api/servidores'),         api('/api/eventos'),         api('/api/eventos?archived=1'),         api('/api/alertas')     ]); }  $$('[data-page]').forEach(b => b.onclick = () => showPage(b.dataset.page));
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
                    <td>${fmt(e.alerta_extra)}</td>${archived ? `<td>${e.dias_arquivado > 1826 ? '<span class="redtext">Mais de 5 anos</span>' : Math.max(0, Math.floor(e.dias_arquivado / 365)) + ' ano(s)'}</td>` : ''}
                    <td class="actions">
                        ${!archived ? `<button class="icon-btn" onclick="openEvent('${e.tipo}', ${e.id})">Editar</button>` : ''}
                        <button class="icon-btn" onclick="deleteEvent(${e.id},${archived})">Excluir</button>
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
            <button onclick="openEvent()">+ Novo registro</button>
        </section>
        
        <section class="stats">
            <div class="stat"><span class="dot">♙</span><small>Servidores cadastrados</small><strong>${state.servidores.length}</strong></div>
            <div class="stat"><span class="dot">☀</span><small>Férias ativas ou futuras</small><strong>${state.eventos.filter(x => x.tipo === 'ferias').length}</strong></div>
            <div class="stat"><span class="dot">◷</span><small>Abonos ativos ou futuros</small><strong>${state.eventos.filter(x => x.tipo === 'abono').length}</strong></div>
            <div class="stat"><span class="dot">!</span><small>Alertas atuais</small><strong>${state.alertas.length}</strong></div>
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
        if (acao === 'parar') {
            $(`#alerta-${id}`)?.remove();
        }
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
            <button class="primary" onclick="openServidor()">+ Cadastrar servidor</button>
        </div>
        <div class="table-wrap">
            ${state.servidores.length ? `
            <table>
                <thead>
                    <tr>
                        <th>Nome completo</th>
                        <th>Função</th>
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
            <button class="primary" onclick="openEvent('${tipo}')">+ Novo ${tipo === 'ferias' ? 'período' : 'abono'}</button>
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
        state.auditoria = await api('/api/admin/audit');
    } catch {
        state.auditoria = [];
    }
    $('#content').innerHTML = `
    <div class="page">
        <div class="section-head">
            <div>
                <h3>Logs de Auditoria</h3>
                <small>Histórico completo de ações realizadas no sistema.</small>
            </div>
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
                        <tr>
                            <td>${new Date(a.created_at + 'Z').toLocaleString('pt-BR')}</td>
                            <td>${esc(a.username || 'Sistema')}</td>
                            <td>${esc(a.action)}</td>
                            <td>${esc(a.ip)}</td>
                            <td class="audit-detail" title="${esc(a.details)}">${esc(a.details)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>` : '<div class="empty">Nenhum log de auditoria encontrado.</div>'}
        </div>
    </div>`;
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
        if (confirm('Excluir sua conta permanentemente?')) {
            await api('/api/me', { method: 'DELETE' });
            location.reload();
        }
    };
}

async function admin(tab = 'users') {
    if (state.me.role !== 'master') return;
    const [users, audit] = await Promise.all([api('/api/admin/users'), api('/api/admin/audit')]);
    
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
                            <td>${esc(a.action)}</td>
                            <td>${esc(a.ip)}</td>
                            <td class="audit-detail" title="${esc(a.details)}">${esc(a.details)}</td>
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

window.openServidor = id => {
    const s = state.servidores.find(x => x.id === id) || {};
    modal(`
        <h2>${id ? 'Editar' : 'Cadastrar'} servidor</h2>
        <form id="servidorForm">
            <label>Nome completo *<input name="nome" required value="${esc(s.nome || '')}"></label>
            <label>Função<input name="funcao" value="${esc(s.funcao || '')}"></label>
            <div class="grid2">
                <label>CPF<input name="cpf" value="${esc(s.cpf || '')}"></label>
                <label>Matrícula<input name="matricula" value="${esc(s.matricula || '')}"></label>
            </div>
            <div class="form-actions">
                <button type="button" class="secondary" onclick="modal.close()">Cancelar</button>
                <button class="primary">Salvar</button>
            </div>
        </form>
    `);

    $('#servidorForm').onsubmit = async e => {
        e.preventDefault();
        try {
            await api(id ? `/api/servidores/${id}` : '/api/servidores', {
                method: id ? 'PATCH' : 'POST',
                body: JSON.stringify(formData(e.target))
            });
            $('#modal').close();
            await reload();
            showPage('servidores');
            toast('Servidor salvo.');
        } catch (x) {
            toast(x.message, true);
        }
    };
};

window.deleteServidor = async id => {
    if (!confirm('Excluir este servidor?')) return;
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
                <button type="button" class="secondary" onclick="modal.close()">Cancelar</button>
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
                const list = x.data.conflicts.map(c => `${c.servidor_nome} (${fmt(c.inicio)} a ${fmt(c.fim)})`).join('\n');
                
                // Exibe modal de conflito customizado ou nativo
                const modalConflito = $('#modalConflito');
                if (modalConflito) {
                    $('#modalConflitoTexto').innerHTML = `Existe conflito de datas com:<br><strong>${esc(list)}</strong><br><br>Deseja continuar assim mesmo?`;
                    modalConflito.showModal();
                    
                    $('#btnConflitoContinuar').onclick = async () => {
                        modalConflito.close();
                        d.confirmConflict = true;
                        await enviarRegistro(d);
                    };
                    
                    $('#btnConflitoVoltar').onclick = () => {
                        modalConflito.close();
                    };
                } else if (confirm(`Conflito de datas com:\n${list}\n\nDeseja continuar mesmo assim?`)) {
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
    if (!confirm('Excluir este registro permanentemente?')) return;
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
                <button type="button" class="secondary" onclick="modal.close()">Cancelar</button>
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
                <button type="button" class="secondary" onclick="modal.close()">Cancelar</button>
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
    if (confirm('Entrar como este usuário? Para voltar ao master, clique no botão no topo da tela.')) {
        await api(`/api/admin/impersonate/${id}`, { method: 'POST' });
        await boot();
    }
};

window.deleteUser = async id => {
    if (confirm('Excluir este usuário permanentemente?')) {
        await api(`/api/admin/users/${id}`, { method: 'DELETE' });
        admin('users');
        toast('Usuário excluído.');
    }
};

window.admin = admin;

// Inicialização da aplicação
initThemeAndAccessibility();
boot();