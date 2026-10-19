const $ = (s, e = document) => e.querySelector(s); const $$ = (s, e = document) => [...e.querySelectorAll(s)];

const pathMatch = location.pathname.match(/^(.*?\/gestao-ferias-abonos)(?:\/|$)/i);
const API_BASE = pathMatch ? pathMatch[1] : '';
const state = { me: null, servidores: [], servidoresArquivados: [], lembretes: [], eventos: [], arquivados: [], alertas: [], auditoria: [], auditAccessUsers: [], setores: [], adminUsers: [], calendarDate: new Date(), calendarFilters:{servidor_id:'',setor_id:'',tipo:''} };

const fmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localIso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const calendarColor = event => {
    const id=Math.abs(Number(event.id)||1);
    const hue=Math.round((id*137.508)%360);
    const saturation=62+(id%3)*6;
    const lightness=72+(id%4)*3;
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
};

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
        $('#adminNav').hidden = !state.me.can_manage_system;
        $('#reportsNav').hidden = !state.me.can_manage_system;
        $('#integrityNav').hidden = !state.me.can_manage_system;
        $('#auditNav').hidden = !state.me.can_view_audit;
        
        // Exibe banner se estiver personificando outro usuário
        const impersonateBanner = $('#impersonateBanner');
        if (impersonateBanner) {
            impersonateBanner.style.display = state.me.is_impersonated ? 'flex' : 'none';
        }

        $('#today').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());
        await reload();
        await showPage('dashboard');
        await showLoginReminders();
    } catch (error) {
        if (error.status === 401) {
            state.me = null;
            $('#auth').hidden = false;
            $('#app').hidden = true;
        } else {
            console.error('Falha ao carregar o sistema:', error);
            toast(error.message || 'Não foi possível carregar o sistema. Atualize a página.', true);
        }     } }  async function reload() {     const [servidores,eventos,arquivados,alertas,estruturaData,lembretes,servidoresArquivados] = await Promise.all([         api('/api/servidores'),         api('/api/eventos'),         api('/api/eventos?archived=1'),         api('/api/alertas'),         api('/api/estrutura'), api('/api/lembretes').catch(error => { if(error.status === 404) { toast('Reinicie o serviço do sistema para ativar os lembretes.', true); return []; } throw error; }), api('/api/servidores?archived=1')     ]); state.servidoresArquivados=servidoresArquivados;state.lembretes=lembretes;state.servidores=servidores;state.eventos=eventos;state.arquivados=arquivados;state.alertas=alertas;state.setores=estruturaData.setores||[];renderAlertBell(); }  $$('[data-page]').forEach(b => b.onclick = () => showPage(b.dataset.page));
if ($('#menuBtn')) $('#menuBtn').onclick = () => $('aside').classList.toggle('open');

$('#logout').onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
        await api('/api/logout', { method: 'POST' });
    } catch (error) {
        // Mesmo com a sessão já expirada, sair deve sempre levar à tela de acesso.
        console.warn('Não foi possível encerrar a sessão no servidor:', error);
    } finally {
        state.me = null;
        $('#app').hidden = true;
        $('#auth').hidden = false;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        window.location.assign(`${API_BASE || ''}/`);
    }
};

if ($('#btnRestoreMaster')) {
    $('#btnRestoreMaster').onclick = async () => {         await api('/api/admin/restore-master', { method: 'POST' });         await boot();     }; }  const titles = {     dashboard: 'Visão geral',     servidores: 'Cadastro de servidores',     ferias: 'Férias',     abono: 'Abonos',     calendario: 'Calendário',     relatorios: 'Relatórios gerenciais',     integridade: 'Integridade do sistema',     estrutura: 'Setores',     arquivados: 'Arquivados',     tutorial: 'Tutorial',     auditoria: 'Auditoria',     perfil: 'Meu perfil',     admin: 'Administração' };  async function showPage(page) {     if (page === 'auditoria' && !state.me?.can_view_audit) page = 'dashboard'; if(['integridade','relatorios','admin'].includes(page)&&!state.me?.can_manage_system)page='dashboard';     $$('nav [data-page]').forEach(x => x.classList.toggle('active', x.dataset.page === page));
    if ($('#pageTitle')) $('#pageTitle').textContent = titles[page] || 'Gestão';
    $('aside').classList.remove('open');
    
    const pageRenderers = { dashboard, servidores, eventos, calendario, relatorios, integridade, estrutura, arquivados, tutorial, auditoria, perfil, admin };
    const renderer = pageRenderers[page === 'ferias' || page === 'abono' ? 'eventos' : page];
    if (!renderer) return;
    const content = $('#content');
    content.innerHTML = '<div class="page"><div class="card empty">Carregando página...</div></div>';
    try {
        await renderer(page);
    } catch (error) {
        console.error(`Falha ao abrir a página ${page}:`, error);
        content.innerHTML = `<div class="page"><div class="card empty"><h3>Não foi possível abrir esta página</h3><p>${esc(error.message)}</p><p>Reinicie o servidor do sistema e atualize o navegador com <strong>Ctrl + F5</strong>.</p></div></div>`;
        toast(error.message, true);
    }
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
                        <button class="icon-btn" onclick="openAttachments(${e.id})" title="Anexos"><i class="bi bi-paperclip"></i><span>Anexos</span></button>
                        ${e.pode_editar ? `${!archived ? `<button class="icon-btn action-edit" onclick="openEvent('${e.tipo}', ${e.id})" title="Editar este registro"><i class="bi bi-pencil-square" aria-hidden="true"></i><span>Editar</span></button>` : ''}<button class="icon-btn action-delete" onclick="deleteEvent(${e.id},${archived})" title="Excluir este registro"><i class="bi bi-trash3" aria-hidden="true"></i><span>Excluir</span></button>` : '<span class="readonly-label" title="Somente quem criou pode alterar"><i class="bi bi-lock-fill" aria-hidden="true"></i> Somente leitura</span>'}
                    </td>
                </tr>
            `).join('')}
        </tbody>
    </table>`;
}

function dashboard() {
    const soon = state.eventos.filter(e => (new Date(e.inicio) - new Date()) / 864e5 <= 30);
    const lowBalances=state.servidores.flatMap(s=>{
        const ferias=Number(s.ferias_total)-Number(s.ferias_usadas),abono=Number(s.abono_total)-Number(s.abonos_usados);
        const alerts=[];
        if(ferias>=0&&ferias<=5)alerts.push({nome:s.nome,tipo:'Férias',saldo:ferias});
        if(abono>=0&&abono<=1)alerts.push({nome:s.nome,tipo:`Abono ${new Date().getFullYear()}`,saldo:abono});
        return alerts;
    });
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

        ${lowBalances.length?`<div class="section-head"><h3>Avisos de saldo baixo</h3></div><div class="low-balance-list">${lowBalances.map(item=>`<div class="low-balance-alert"><i class="bi bi-exclamation-triangle-fill"></i><span><strong>${esc(item.nome)}</strong><small>${item.tipo}: restam ${item.saldo} dia(s)</small></span></div>`).join('')}</div>`:''}

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
                <button type="button" class="secondary" onclick="openImportServers()"><i class="bi bi-upload"></i> Importar CSV</button>
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
                        <th>Setor</th>
                        <th>Saldos</th>
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
                            <td>${esc(s.setor_nome || 'Sem setor')}</td>
                            <td><span class="balance-chip">Férias: ${Number(s.ferias_total)-Number(s.ferias_usadas)} dia(s)</span><br><span class="balance-chip">Abono ${new Date().getFullYear()}: ${Number(s.abono_total)-Number(s.abonos_usados)} dia(s)</span></td>
                            <td class="actions">
                                <button class="icon-btn" onclick="openReminder(${s.id})">Criar lembrete</button><button class="icon-btn" onclick="openServidorHistory(${s.id})">Histórico</button>
                                <button class="icon-btn" onclick="openServidor(${s.id})">Editar</button>
                                <button class="icon-btn" onclick="archiveServidor(${s.id},true)">Arquivar</button><button class="icon-btn" onclick="deleteServidor(${s.id})">Excluir definitivamente</button>
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
 $('#content').innerHTML=`<div class="page"><div class="section-head"><div><h3>Arquivados</h3><small>Servidores arquivados mantêm seus registros, saldos e histórico.</small></div></div><h3>Servidores arquivados</h3><div class="table-wrap">${state.servidoresArquivados.length?`<table><thead><tr><th>Servidor</th><th>Função</th><th>Arquivado em</th><th>Ações</th></tr></thead><tbody>${state.servidoresArquivados.map(s=>`<tr><td>${esc(s.nome)}</td><td>${esc(s.funcao||'—')}</td><td>${new Date(s.archived_at).toLocaleDateString('pt-BR')}</td><td class="actions"><button class="icon-btn" onclick="openServidorHistory(${s.id})">Histórico</button><button class="icon-btn" onclick="archiveServidor(${s.id},false)">Reativar</button><button class="icon-btn" onclick="deleteServidor(${s.id},true)">Excluir definitivamente</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Nenhum servidor arquivado.</div>'}</div><h3>Períodos encerrados</h3><div class="table-wrap">${eventRows(state.arquivados,true)}</div></div>`;
}
window.archiveServidor=async(id,arquivar)=>{
 const servidor=[...state.servidores,...state.servidoresArquivados].find(s=>s.id===id);
 if(!await confirmDialog({title:arquivar?'Arquivar servidor?':'Reativar servidor?',message:arquivar?`${servidor?.nome||'O servidor'} será movido para Arquivados. Todos os registros serão mantidos e os alertas ficarão suspensos enquanto estiver arquivado.`:'O servidor retornará à lista de ativos com seus registros e saldo preservados.',confirmLabel:arquivar?'Arquivar':'Reativar'}))return;
 try{await api(`/api/servidores/${id}/arquivar`,{method:'POST',body:JSON.stringify({arquivar})});await reload();await showPage(arquivar?'servidores':'arquivados');toast(arquivar?'Servidor arquivado.':'Servidor reativado.');}catch(error){toast(error.message,true);}
};

function calendario() {
    const current = state.calendarDate;
    const year = current.getFullYear(), month = current.getMonth();
    const first = new Date(year, month, 1), last = new Date(year, month + 1, 0);
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let day = 1; day <= last.getDate(); day++) cells.push(new Date(year, month, day));
    const allEvents = [...state.eventos, ...state.arquivados, ...state.lembretes.map(l=>({...l,id:-l.id,tipo:'lembrete',inicio:l.data,fim:l.data}))].filter(e=>{
        const servidor=state.servidores.find(s=>s.id===e.servidor_id);
        return (!state.calendarFilters.servidor_id||e.servidor_id===Number(state.calendarFilters.servidor_id))&&(!state.calendarFilters.setor_id||servidor?.setor_id===Number(state.calendarFilters.setor_id))&&(!state.calendarFilters.tipo||e.tipo===state.calendarFilters.tipo);
    });
    const monthStart=localIso(first),monthEnd=localIso(last);
    const monthEvents=allEvents.filter(e=>e.inicio<=monthEnd&&e.fim>=monthStart);
    const legend=monthEvents.map(e=>`<span class="calendar-legend-item"><i style="background:${calendarColor(e)}"></i><span>${esc(e.servidor_nome)} — ${e.tipo==='lembrete'?`Lembrete: ${esc(e.titulo)}`:e.tipo==='ferias'?'Férias':'Abono'} (${fmt(e.inicio)} a ${fmt(e.fim)})</span></span>`).join('');
    $('#content').innerHTML = `<div class="page"><div class="section-head"><div><h3>Calendário da equipe</h3><small>Cada registro possui uma cor própria, repetida durante todo o período.</small></div></div><div class="calendar-toolbar"><div class="filter-bar"><label>Servidor<select onchange="setCalendarFilter('servidor_id',this.value)"><option value="">Todos</option>${state.servidores.map(s=>`<option value="${s.id}" ${String(s.id)===String(state.calendarFilters.servidor_id)?'selected':''}>${esc(s.nome)}</option>`).join('')}</select></label><label>Setor<select onchange="setCalendarFilter('setor_id',this.value)"><option value="">Todos</option>${state.setores.map(s=>`<option value="${s.id}" ${String(s.id)===String(state.calendarFilters.setor_id)?'selected':''}>${esc(s.nome)}</option>`).join('')}</select></label><label>Tipo<select onchange="setCalendarFilter('tipo',this.value)"><option value="">Todos</option><option value="ferias" ${state.calendarFilters.tipo==='ferias'?'selected':''}>Férias</option><option value="lembrete" ${state.calendarFilters.tipo==='lembrete'?'selected':''}>Lembrete</option><option value="abono" ${state.calendarFilters.tipo==='abono'?'selected':''}>Abono</option></select></label><button class="secondary" onclick="clearCalendarFilters()">Limpar filtros</button></div><div class="calendar-nav"><button type="button" onclick="changeCalendarMonth(-1)">‹ Anterior</button><div><strong>${current.toLocaleDateString('pt-BR',{month:'long'}).replace(/^./,c=>c.toUpperCase())}</strong><span>${year}</span></div><button type="button" onclick="changeCalendarMonth(1)">Próximo ›</button></div></div>${legend?`<div class="calendar-legend">${legend}</div>`:'<p class="calendar-empty-note">Nenhum registro neste mês com os filtros selecionados.</p>'}<div class="calendar-week">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>`<strong>${d}</strong>`).join('')}</div><div class="calendar-grid">${cells.map(date=>{if(!date)return '<div class="calendar-day empty-day"></div>';const iso=localIso(date);const items=allEvents.filter(e=>e.inicio<=iso&&e.fim>=iso);return `<div class="calendar-day ${iso===localIso(new Date())?'today':''}"><b>${date.getDate()}</b>${items.map(e=>`<span class="calendar-event" style="background:${calendarColor(e)};color:#162733" title="${esc(e.servidor_nome)} — ${e.tipo==='lembrete'?`Lembrete: ${esc(e.titulo)}`:e.tipo==='ferias'?'Férias':'Abono'}: ${fmt(e.inicio)} a ${fmt(e.fim)}"><strong>${esc(e.servidor_nome)}</strong><small>${e.tipo==='lembrete'?`Lembrete: ${esc(e.titulo)}`:e.tipo==='ferias'?'Férias':'Abono'}</small></span>`).join('')}</div>`;}).join('')}</div></div>`;
}
window.changeCalendarMonth = delta => { state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth()+delta, 1); calendario(); };
window.setCalendarFilter=(key,value)=>{state.calendarFilters[key]=value;calendario();};
window.clearCalendarFilters=()=>{state.calendarFilters={servidor_id:'',setor_id:'',tipo:''};calendario();};

async function relatorios(filters = {}) {
    if(!state.me?.can_manage_system)return showPage('dashboard');
    const query=new URLSearchParams(Object.entries(filters).filter(([,value])=>value)).toString();
    const [summary, backup] = await Promise.all([api(`/api/relatorios/resumo${query?'?'+query:''}`),api('/api/backup/status')]);
    const active = Object.fromEntries(summary.ativos.map(x=>[x.tipo,x.quantidade]));
    $('#content').innerHTML = `<div class="page"><div class="section-head"><div><h3>Relatórios gerenciais</h3><small>Indicadores consolidados para acompanhamento.</small></div><button class="secondary" onclick="window.print()"><i class="bi bi-printer"></i> Imprimir</button></div><form id="reportFilters" class="filter-bar"><label>Data inicial<input type="date" name="inicio" value="${esc(filters.inicio||'')}"></label><label>Data final<input type="date" name="fim" value="${esc(filters.fim||'')}"></label><label>Servidor<select name="servidor_id"><option value="">Todos</option>${state.servidores.map(s=>`<option value="${s.id}" ${String(filters.servidor_id)===String(s.id)?'selected':''}>${esc(s.nome)}</option>`).join('')}</select></label><label>Setor<select name="setor_id"><option value="">Todos</option>${state.setores.map(s=>`<option value="${s.id}" ${String(filters.setor_id)===String(s.id)?'selected':''}>${esc(s.nome)}</option>`).join('')}</select></label><label>Tipo<select name="tipo"><option value="">Todos</option><option value="ferias" ${filters.tipo==='ferias'?'selected':''}>Férias</option><option value="abono" ${filters.tipo==='abono'?'selected':''}>Abono</option></select></label><button class="primary">Aplicar</button><button type="button" class="secondary" id="clearReportFilters">Limpar</button></form><div class="stats"><div class="stat"><small>Servidores cadastrados</small><strong>${summary.totalServidores}</strong></div><div class="stat"><small>Registros filtrados</small><strong>${summary.registros}</strong></div><div class="stat"><small>Férias ativas/futuras</small><strong>${active.ferias||0}</strong></div><div class="stat"><small>Abonos ativos/futuros</small><strong>${active.abono||0}</strong></div><div class="stat ${backup.ok?'':'backup-warning'}"><small>Último backup</small><strong>${backup.latest?new Date(backup.latest.modified).toLocaleDateString('pt-BR'):'Pendente'}</strong></div></div><div class="report-grid"><section class="card"><h3>Registros por mês</h3><table><thead><tr><th>Mês</th><th>Tipo</th><th>Registros</th><th>Dias</th></tr></thead><tbody>${summary.porMes.map(x=>`<tr><td>${esc(x.mes)}</td><td>${x.tipo==='ferias'?'Férias':'Abono'}</td><td>${x.quantidade}</td><td>${Math.round(x.dias||0)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhum registro nos filtros selecionados.</td></tr>'}</tbody></table></section><section class="card"><h3>Resumo por setor</h3><table><thead><tr><th>Setor</th><th>Servidores</th><th>Registros</th></tr></thead><tbody>${summary.porSetor.map(x=>`<tr><td>${esc(x.setor)}</td><td>${x.servidores}</td><td>${x.registros}</td></tr>`).join('')||'<tr><td colspan="3">Nenhum resultado.</td></tr>'}</tbody></table><h3>Status do backup</h3><p class="${backup.ok?'success-text':'redtext'}">${esc(backup.message)}</p><small>${esc(backup.destination)}</small></section></div></div>`;
    $('#reportFilters').onsubmit=e=>{e.preventDefault();relatorios(formData(e.target));};
    $('#clearReportFilters').onclick=()=>relatorios({});
}

async function integridade(){
    if(!state.me.can_manage_system)return showPage('dashboard');
    const health=await api('/api/integridade');
    let backups={files:[],destination:''},backupError='';
    try{backups=await api('/api/backups');}catch(error){backupError=error.message;}
    const labels={server:'Servidor',database:'Banco de dados',email:'E-mail',network:'Rede',backup:'Backup'};
    $('#content').innerHTML=`<div class="page"><div class="section-head"><div><h3>Painel de integridade</h3><small>Verificação realizada em ${new Date(health.checked_at).toLocaleString('pt-BR')}.</small></div><button class="secondary" onclick="integridade()"><i class="bi bi-arrow-clockwise"></i> Verificar novamente</button></div><div class="health-grid">${Object.entries(health.checks).map(([key,item])=>`<article class="health-card ${item.ok?'health-ok':'health-fail'}"><i class="bi ${item.ok?'bi-check-circle-fill':'bi-exclamation-triangle-fill'}"></i><div><h3>${labels[key]}</h3><p>${esc(item.message)}</p></div></article>`).join('')}</div><section class="card backup-manager"><div class="section-head"><div><h3>Validação e restauração de backup</h3><small>A restauração é exclusiva do Master e cria uma cópia de segurança do banco atual.</small></div></div>${backupError?`<p class="redtext">${esc(backupError)}</p>`:`<p><strong>Destino:</strong> ${esc(backups.destination)}</p><div class="table-wrap">${backups.files.length?`<table><thead><tr><th>Arquivo</th><th>Data</th><th>Tamanho</th><th>Ações</th></tr></thead><tbody>${backups.files.map(file=>`<tr><td>${esc(file.name)}</td><td>${new Date(file.modified).toLocaleString('pt-BR')}</td><td>${Math.ceil(file.size/1024)} KB</td><td class="actions"><button class="icon-btn" onclick="validateBackup('${encodeURIComponent(file.name)}')">Validar</button><button class="danger compact-btn" onclick="restoreBackup('${encodeURIComponent(file.name)}')">Restaurar</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Nenhum backup disponível.</div>'}</div>`}</section><div class="tutorial-note"><i class="bi bi-shield-lock-fill"></i><p><strong>Procedimento seguro:</strong> valide o arquivo antes de restaurar. Ao confirmar a restauração, feche o sistema e execute novamente <code>iniciar.bat</code>. Na abertura, o sistema guarda uma cópia do banco atual e aplica o backup selecionado.</p></div></div>`;
}
window.integridade=integridade;
window.validateBackup=async encoded=>{try{const result=await api(`/api/backups/${encoded}/validate`,{method:'POST'});toast(`Backup válido: ${result.file.name}`);}catch(error){toast(error.message,true);}};
window.restoreBackup=async encoded=>{const name=decodeURIComponent(encoded);if(!await confirmDialog({title:'Preparar restauração?',message:`O backup ${name} substituirá os dados atuais na próxima inicialização. Uma cópia de segurança do banco atual será criada automaticamente.`,confirmLabel:'Preparar restauração',danger:true}))return;try{const result=await api(`/api/backups/${encoded}/restore`,{method:'POST'});toast(result.message);}catch(error){toast(error.message,true);}};

async function estrutura() {
    const data = await api('/api/estrutura'); state.setores=data.setores;
    $('#content').innerHTML=`<div class="page"><div class="section-head"><div><h3>Setores</h3><small>Organize os servidores por setor para facilitar filtros e relatórios.</small></div></div><section class="card" style="max-width:900px"><h3>Novo setor</h3><form id="setorForm"><label>Nome<input name="nome" required></label><button class="primary">Adicionar setor</button></form><div class="structure-list">${state.setores.map(x=>`<div><span>${esc(x.nome)}</span><button type="button" class="icon-btn" onclick="deleteStructure('setores',${x.id})">Excluir</button></div>`).join('')||'<small>Nenhum setor.</small>'}</div></section></div>`;
    $('#setorForm').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('/api/setores',{method:'POST',body:JSON.stringify(formData(e.target))});toast('Setor cadastrado.');await estrutura();}catch(error){toast(error.message,true);}finally{button.disabled=false;}};
}
window.deleteStructure=async(type,id)=>{if(await confirmDialog({message:'Deseja excluir este setor? Os servidores permanecerão cadastrados, mas ficarão sem setor.',confirmLabel:'Excluir',danger:true})){try{await api(`/api/${type}/${id}`,{method:'DELETE'});await reload();await estrutura();toast('Setor excluído.');}catch(error){toast(error.message,true);}}};

window.openServidorHistory=async id=>{try{const data=await api(`/api/servidores/${id}/historico`);const s=data.servidor;modal(`<h2>Histórico de ${esc(s.nome)}</h2><div class="history-summary"><span><strong>Setor</strong>${esc(s.setor_nome||'Sem setor')}</span><span><strong>Férias</strong>${s.ferias_total} dias de direito</span><span><strong>Abono anual</strong>${s.abono_total} dias por ano</span></div>${s.archived_at?'<p>Servidor arquivado. Reative-o para criar novos lembretes.</p>':`<button class="primary" onclick="openReminder(${id})">Criar lembrete</button>`}<h3>Compromissos e lembretes</h3>${(data.lembretes||[]).map(l=>`<p><strong>${esc(l.titulo)}</strong> — ${fmt(l.data)}<br>${esc(l.observacoes||'')}</p>`).join('')||'<p>Nenhum lembrete.</p>'}<h3>Movimentações</h3><p>As movimentações detalhadas são registradas a partir desta atualização. Os períodos anteriores continuam abaixo.</p>${(data.movimentos||[]).map(m=>`<details><summary>${esc(m.created_at)} — ${esc(m.acao)}${m.usuario?' · '+esc(m.usuario):''}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(movementDetails(JSON.parse(m.detalhes)))}</pre></details>`).join('')||'<p>Nenhuma movimentação registrada desde a atualização.</p>'}<h3>Férias e abonos</h3><div class="table-wrap">${data.eventos.length?`<table><thead><tr><th>Tipo</th><th>Período</th><th>Observações</th><th>Anexos</th></tr></thead><tbody>${data.eventos.map(e=>`<tr><td>${e.tipo==='ferias'?'Férias':`Abono ${e.inicio.slice(0,4)}`}</td><td>${fmt(e.inicio)} a ${fmt(e.fim)}</td><td>${esc(e.observacoes||'—')}</td><td><button class="icon-btn" onclick="closeModal();openAttachments(${e.id})">${e.anexos} anexo(s)</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Nenhum registro.</div>'}</div>`);}catch(error){toast(error.message,true);}};

window.openImportServers=()=>{modal(`<h2>Importar servidores por CSV</h2><p>Use as colunas: <code>nome,funcao,email,cpf,matricula,ferias_total,abono_total</code>.</p><form id="importForm"><label>Arquivo CSV<input type="file" id="csvFile" accept=".csv,text/csv" required></label><div class="form-actions"><button type="button" class="secondary" onclick="closeModal()">Cancelar</button><button class="primary">Importar</button></div></form>`);$('#importForm').onsubmit=async e=>{e.preventDefault();const file=$('#csvFile').files[0];const text=await file.text();const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);const sep=lines[0].includes(';')?';':',';const headers=lines.shift().split(sep).map(x=>x.trim().toLowerCase());const rows=lines.map(line=>{const values=line.split(sep);return Object.fromEntries(headers.map((h,i)=>[h,(values[i]||'').trim()]));});const result=await api('/api/servidores/importar',{method:'POST',body:JSON.stringify({rows})});closeModal();await reload();servidores();toast(`${result.imported} importado(s); ${result.skipped} ignorado(s).`);};};

window.openAttachments=async eventoId=>{const items=await api(`/api/eventos/${eventoId}/anexos`);modal(`<h2>Anexos do registro</h2><form id="attachmentForm"><label>Adicionar arquivo (máximo 5 MB)<input type="file" id="attachmentFile" required></label><button class="primary">Enviar anexo</button></form><div class="attachment-list">${items.map(a=>`<div><a href="${API_BASE}/api/anexos/${a.id}/download" target="_blank">${esc(a.nome_original)}</a><small>${Math.ceil(a.tamanho/1024)} KB</small><button class="icon-btn" onclick="deleteAttachment(${a.id},${eventoId})">Excluir</button></div>`).join('')||'<p class="empty">Nenhum anexo.</p>'}</div>`);$('#attachmentForm').onsubmit=async e=>{e.preventDefault();const file=$('#attachmentFile').files[0];if(file.size>5*1024*1024)return toast('O arquivo deve ter no máximo 5 MB.',true);const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});await api(`/api/eventos/${eventoId}/anexos`,{method:'POST',body:JSON.stringify({nome:file.name,data})});toast('Anexo enviado.');openAttachments(eventoId);};};
window.deleteAttachment=async(id,eventoId)=>{if(await confirmDialog({message:'Excluir este anexo?',confirmLabel:'Excluir',danger:true})){await api(`/api/anexos/${id}`,{method:'DELETE'});openAttachments(eventoId);}};

function tutorial() {
    const topics = [
        ['inicio', 'Primeiros passos'], ['visao', 'Visão geral'], ['servidores', 'Servidores'], ['registros', 'Férias e abonos'], ['calendario', 'Calendário'],
        ['historico', 'Histórico'], ['lembretes', 'Lembretes individuais'], ['alertas', 'Alertas e e-mail'], ['arquivados', 'Arquivados'], ['relatorios', 'Relatórios'], ['integridade', 'Integridade'], ['estrutura', 'Setores'], ['perfil', 'Meu perfil'],
        ['administracao', 'Administração'], ['auditoria', 'Auditoria'], ['backup', 'Backup'], ['problemas', 'Solução de problemas']
    ];
    $('#content').innerHTML = `
    <div class="page tutorial-page">
        <section class="tutorial-hero">
            <div><span class="tutorial-kicker">Central de ajuda</span><h1>Como usar o Gestão de Férias e Abonos</h1><p>Consulte as instruções completas para cadastrar pessoas, registrar períodos, acompanhar saldos, criar lembretes, arquivar servidores e administrar o sistema.</p></div>
            <i class="bi bi-book-half" aria-hidden="true"></i>
        </section>
        <label class="tutorial-search-label" for="tutorialSearch">Pesquisar no tutorial</label><input id="tutorialSearch" type="search" placeholder="Ex.: cadastrar férias, anexos, calendário, senha..." aria-label="Pesquisar orientações do tutorial" style="width:100%;max-width:640px;padding:12px;margin:12px 0;border:1px solid #aab5bf;border-radius:10px;background:var(--card-bg,transparent);color:inherit"><p id="tutorialSearchStatus" role="status" aria-live="polite"></p><nav class="tutorial-index" aria-label="Tópicos do tutorial">
            ${topics.map(([id, label]) => `<a href="#tutorial-${id}">${label}</a>`).join('')}
        </nav>

        <section class="tutorial-section" id="tutorial-inicio"><h2><span>1</span> Primeiros passos</h2><div class="tutorial-grid"><article><h3>Entrar</h3><ol><li>Informe usuário, e-mail, CPF ou matrícula.</li><li>Digite sua senha. Use o botão de olho para mostrar ou ocultar o que digitou.</li><li>Clique em <strong>Entrar</strong>.</li></ol></article><article><h3>Navegação e aparência</h3><p>Use o menu lateral para abrir cada módulo. No cabeçalho, use <strong>A+</strong>, <strong>A-</strong> e <strong>A</strong> para ajustar a fonte e <strong>Modo escuro</strong> para trocar o tema.</p></article><article><h3>Recuperar senha</h3><ol><li>Clique em <strong>Esqueci minha senha</strong>.</li><li>Informe o e-mail cadastrado.</li><li>Digite o código recebido e cadastre uma nova senha.</li></ol></article></div><p>O botão de olho está disponível em todos os campos de senha: acesso, cadastro de conta, redefinição, perfil e administração de usuários.</p><p><strong>Permissões:</strong> Integridade, Relatórios e Administração são exclusivos da conta com perfil Master e e-mail <strong>contatotech.tecnologia@gmail.com</strong>. Outros administradores e outras contas Master não têm acesso a essas áreas.</p></section>

        <section class="tutorial-section" id="tutorial-visao"><h2><span>2</span> Visão geral</h2><ol><li>Depois de entrar, abra <strong>Visão geral</strong> no menu lateral.</li><li>Confira os indicadores, os próximos períodos de ausência e os avisos.</li><li>Use os atalhos disponíveis para cadastrar servidores ou criar registros.</li><li>Clique no sino para consultar notificações específicas da sua conta.</li></ol><p>Os dados exibidos dependem dos cadastros e períodos registrados no sistema.</p></section>
        <section class="tutorial-section" id="tutorial-servidores"><h2><span>3</span> Cadastrar servidores</h2><ol><li>Abra <strong>Servidores</strong>.</li><li>Clique em <strong>Cadastrar servidor</strong>.</li><li>Informe dados pessoais, setor e os direitos de férias e abonos.</li><li>Clique em <strong>Salvar</strong>.</li></ol><h3>Importação e histórico</h3><p>Use <strong>Importar CSV</strong> para cadastrar várias pessoas. O arquivo pode usar vírgula ou ponto e vírgula e deve conter a coluna <code>nome</code>; também aceita <code>funcao,email,cpf,matricula,ferias_total,abono_total</code>. Em <strong>Histórico</strong>, consulte períodos, anexos, compromissos e movimentações da pessoa. Use <strong>Criar lembrete</strong> para um compromisso individual, <strong>Arquivar</strong> para retirar o cadastro da lista de ativos e <strong>Excluir definitivamente</strong> para apagar o cadastro e todos os dados vinculados, após confirmação.</p><h3>Saldo anual de abono</h3><p>O direito a abono vale de 1º de janeiro a 31 de dezembro. O saldo não utilizado vence e não acumula para o ano seguinte. Um abono não pode atravessar a virada do ano.</p><div class="tutorial-note"><i class="bi bi-info-circle-fill"></i><p>O sistema avisa quando encontra dados semelhantes e impede lançamentos acima do saldo disponível no respectivo ano. Use Arquivar para preservar o cadastro e todos os registros na tela Arquivados. Nessa tela é possível consultar o histórico, reativar ou excluir definitivamente. Excluir definitivamente apaga o servidor, férias, abonos, lembretes, anexos e histórico após confirmação.</p></div></section>

        <section class="tutorial-section" id="tutorial-registros"><h2><span>4</span> Registrar férias e abonos</h2><ol><li>Abra <strong>Férias</strong> ou <strong>Abonos</strong>, ou use <strong>Novo registro</strong>.</li><li>Selecione o servidor e o tipo do registro.</li><li>Informe as datas inicial e final.</li><li>Adicione alerta extra e observações, se necessário.</li><li>Clique em <strong>Salvar registro</strong>.</li></ol><p>Após salvar, use <strong>Anexos</strong> para incluir documentos de até 5 MB. Consulte todos os períodos no menu <strong>Calendário</strong>.</p><h3>Como o saldo é descontado</h3><p>Ao salvar férias ou abono, os dias do período já entram no cálculo do saldo, mesmo quando o início é futuro. A contagem inclui a data inicial, a final, fins de semana e feriados. Exemplo: de 10 a 12 são 3 dias.</p><p>Editar um período recalcula o saldo; excluir esse período devolve os dias ao saldo correspondente. Encerrar ou arquivar um período não devolve dias. Responder a alertas e criar lembretes não desconta saldo.</p><p>O abono é calculado por ano civil; a lista de servidores mostra o saldo do ano atual. As férias consideram todos os períodos cadastrados e não são renovadas automaticamente por ano ou período aquisitivo.</p><h3>Conflito de datas</h3><p>Quando houver sobreposição, escolha <strong>Voltar e ajustar</strong> para corrigir ou <strong>Continuar mesmo assim</strong> quando o lançamento estiver correto.</p><h3>Editar ou excluir</h3><p>Somente quem criou o registro pode alterá-lo. A indicação <strong>Somente leitura</strong> informa que o lançamento pertence a outro usuário.</p></section>

        <section class="tutorial-section" id="tutorial-calendario"><h2><span>5</span> Calendário</h2><p>Abra <strong>Calendário</strong> para visualizar férias, abonos e lembretes individuais por mês. Os compromissos aparecem na data agendada, com o nome do servidor e o título do lembrete. Use <strong>Anterior</strong> e <strong>Próximo</strong> para navegar.</p><ul><li>Cada registro recebe uma cor exclusiva, mantida em todos os dias do período.</li><li>A legenda identifica servidor, tipo e datas.</li><li>Filtre por servidor, setor e tipo; use <strong>Limpar filtros</strong> para voltar à visão completa.</li><li>Ao posicionar o ponteiro sobre o registro, o sistema mostra seus detalhes.</li><li>O dia atual possui uma borda de destaque.</li></ul></section>

        <section class="tutorial-section" id="tutorial-historico"><h2><span>6</span> Histórico do servidor</h2><p>Em <strong>Servidores</strong> ou <strong>Arquivados</strong>, clique em <strong>Histórico</strong>. A tela reúne compromissos, lembretes, férias, abonos e anexos.</p><p>Em <strong>Movimentações</strong>, consulte criação e edição cadastral, inclusão, alteração e exclusão de períodos, criação e respostas de lembretes, arquivamento e reativação. Abra cada item para ver os detalhes; alterações de cadastro e de períodos mostram os valores anteriores e posteriores.</p><p>O registro detalhado começou com a atualização do histórico. Períodos anteriores continuam disponíveis, mas movimentações antigas que não eram registradas não são reconstruídas.</p></section>
        <section class="tutorial-section" id="tutorial-lembretes"><h2><span>7</span> Criar lembretes individuais</h2><ol><li>Abra <strong>Servidores</strong> e clique em <strong>Criar lembrete</strong> na pessoa desejada. Também é possível criar pelo Histórico de um servidor ativo.</li><li>Informe o compromisso, uma data a partir de hoje e, se necessário, observações.</li><li>Clique em <strong>Salvar lembrete</strong>.</li></ol><p>O compromisso fica no calendário e no histórico. O modal de aviso é destinado ao gestor que criou o lembrete e funciona separadamente dos alertas de férias e abonos.</p><h3>Na véspera do compromisso</h3><ul><li><strong>Parar lembrete:</strong> suspende o aviso nos próximos logins daquele dia. Ele volta no dia do compromisso.</li><li><strong>Lembrar depois:</strong> o aviso volta nos próximos logins da véspera, repetindo as duas opções.</li></ul><h3>No dia do compromisso</h3><p>O aviso aparece uma única vez, no primeiro login, independentemente da opção escolhida antes. Depois dessa exibição, não volta nos próximos logins, mesmo ao clicar em Lembrar depois. Após a data, não há novos avisos.</p><p>Enquanto o servidor estiver arquivado, seus alertas ficam suspensos. Reative-o para voltar à rotina de avisos e criar novos lembretes.</p></section>
        <section class="tutorial-section" id="tutorial-alertas"><h2><span>8</span> Alertas, saldos e notificações por e-mail</h2><p>Esta seção trata dos alertas relacionados a férias e abonos. Para compromissos do servidor, consulte <a href="#tutorial-lembretes">Lembretes individuais</a>.</p><ol><li>Clique no sino do cabeçalho.</li><li>Use <strong>Criar</strong>, selecione o registro relacionado e escolha a data.</li><li>Use <strong>Marcar como lido</strong>, <strong>Ler todos</strong> ou <strong>Apagar</strong> para organizar os avisos.</li></ol><p>Na Visão geral, <strong>Manter</strong> preserva o alerta e <strong>Parar</strong> interrompe aquele aviso para sua conta. A seção <strong>Avisos de saldo baixo</strong> aparece quando restam até 5 dias de férias ou até 1 dia de abono no ano. Com o SMTP configurado, o sistema envia lembretes por e-mail para períodos que começam nos próximos sete dias, usando os e-mails cadastrados.</p></section>

        <section class="tutorial-section" id="tutorial-arquivados"><h2><span>9</span> Arquivar, reativar ou excluir servidores</h2><h3>Arquivar sem perder dados</h3><ol><li>Em <strong>Servidores</strong>, clique em <strong>Arquivar</strong> e confirme.</li><li>O servidor sai da lista de ativos e aparece na tela <strong>Arquivados</strong> que já existe.</li><li>Cadastro, saldos, férias, abonos, lembretes, anexos e histórico são preservados. Os alertas ficam suspensos enquanto estiver arquivado.</li></ol><h3>Consultar e reativar</h3><p>Na seção <strong>Servidores arquivados</strong>, use <strong>Histórico</strong> para consultar os dados ou <strong>Reativar</strong> para retornar o servidor à lista de ativos com seus registros e saldos preservados.</p><h3>Excluir definitivamente</h3><p>A opção existe tanto em Servidores quanto nos servidores arquivados. A confirmação <strong>Excluir tudo definitivamente</strong> apaga cadastro, férias, abonos, lembretes, anexos e histórico do servidor. A ação não pode ser desfeita pela interface. Use Arquivar quando precisar preservar os dados.</p><h3>O que são Períodos encerrados?</h3><p>Essa seção da mesma tela mostra férias e abonos de servidores ativos cuja data final já passou. A mudança é automática: um período que terminou em 18/10 aparece como encerrado a partir de 19/10.</p><p>Encerrar um período não arquiva o servidor, não apaga registros e não devolve dias ao saldo. Os períodos de servidores arquivados permanecem acessíveis pelo Histórico de cada pessoa. Se não houver períodos encerrados de servidores ativos, a seção fica vazia.</p></section>
        <section class="tutorial-section" id="tutorial-relatorios"><h2><span>10</span> Relatórios e exportação</h2><p>O painel <strong>Relatórios</strong> é exclusivo da conta Master <strong>contatotech.tecnologia@gmail.com</strong>. Nele, filtre por período, servidor, setor e tipo; consulte totais, registros mensais, resumo por setor e o estado do último backup. Use <strong>Imprimir</strong> para gerar uma cópia do painel.</p><p>Para exportar períodos pelas telas de Férias ou Abonos, siga os passos abaixo.</p><ol><li>Em Férias ou Abonos, clique em <strong>Exportar</strong>.</li><li>Escolha o período e os servidores.</li><li>Selecione <strong>Excel</strong> para gerar CSV ou <strong>PDF</strong> para imprimir e salvar.</li><li>Clique em <strong>Gerar documento</strong>.</li></ol></section>

        <section class="tutorial-section" id="tutorial-integridade"><h2><span>11</span> Integridade e restauração</h2><p>Disponível exclusivamente para a conta com perfil Master e e-mail <strong>contatotech.tecnologia@gmail.com</strong>. O painel verifica servidor, banco de dados, e-mail, rede e último backup.</p><h3>Validar um backup</h3><p>Clique em <strong>Validar</strong> para executar a verificação de integridade e confirmar que o arquivo contém as tabelas essenciais.</p><h3>Restaurar com segurança</h3><ol><li>Valide o backup desejado.</li><li>Clique em <strong>Restaurar</strong> e confirme.</li><li>Feche o sistema e execute novamente <strong>iniciar.bat</strong>.</li></ol><p>Antes de aplicar a restauração, o sistema guarda automaticamente uma cópia de segurança do banco atual.</p></section>

        <section class="tutorial-section" id="tutorial-estrutura"><h2><span>12</span> Setores</h2><ol><li>Abra <strong>Setores</strong>.</li><li>Informe o nome e clique em <strong>Adicionar setor</strong>.</li><li>Ao cadastrar ou editar um servidor, selecione seu setor.</li></ol><p>Essas informações alimentam os relatórios gerenciais e facilitam a organização dos servidores.</p></section>

        <section class="tutorial-section" id="tutorial-perfil"><h2><span>13</span> Meu perfil</h2><p>Clique no seu nome ou avatar no canto superior direito. Nessa página você pode alterar e-mail ou senha, confirmando a operação com a senha atual. A conta master não pode excluir a própria conta.</p><p>Ao terminar, clique em <strong>Sair</strong> no final do menu lateral, especialmente em computadores compartilhados.</p></section>

        <section class="tutorial-section" id="tutorial-administracao"><h2><span>14</span> Administração</h2><p>Disponível exclusivamente para a conta com perfil Master e e-mail <strong>contatotech.tecnologia@gmail.com</strong>. Ter perfil Master em outra conta não concede acesso a esta área.</p><ul><li><strong>Cadastrar usuário:</strong> toda nova conta é criada automaticamente como Administrador.</li><li><strong>Editar:</strong> somente o master pode alterar uma conta entre Administrador e Master, além de controlar status e senha.</li><li><strong>Entrar:</strong> visualize o sistema como outra conta. Use <strong>Voltar ao Adm Master</strong> para retornar.</li><li><strong>Excluir:</strong> remova uma conta que não seja mais necessária.</li></ul><p>O Administrador gerencia servidores, férias, abonos, calendário, lembretes, anexos e setores. Também pode arquivar, reativar e excluir definitivamente servidores, mediante confirmação. Relatórios, Integridade e Administração ficam restritos ao master principal.</p></section>

        <section class="tutorial-section" id="tutorial-auditoria"><h2><span>15</span> Auditoria e permissões</h2><p>A Auditoria registra acessos, alterações, exclusões e outras ações importantes. Use a busca por usuário, ação ou IP e clique em <strong>Ver detalhes</strong>. Nas edições de servidores, registros e usuários, os detalhes mostram cada campo alterado, com os valores <strong>Antes</strong> e <strong>Depois</strong>.</p><h3>Autorizar outro usuário</h3><ol><li>Entre com o master principal.</li><li>Abra <strong>Auditoria</strong>.</li><li>Em <strong>Acesso à Auditoria</strong>, selecione o usuário.</li><li>Clique em <strong>Conceder acesso</strong>.</li></ol><h3>Retirar acesso</h3><p>Na lista de usuários autorizados, clique em <strong>Retirar acesso</strong>. A proteção é aplicada imediatamente; o usuário deve atualizar a página ou entrar novamente para atualizar o menu.</p></section>

        <section class="tutorial-section" id="tutorial-backup"><h2><span>16</span> Backup automático</h2><p>O backup é executado diariamente às <strong>17h30</strong>. Se o computador estiver desligado no horário, a tarefa será recuperada na próxima inicialização. Sem registros novos ou alterados, nenhum arquivo adicional é criado.</p><p>Destino: <code>S:\\ATUACAO MEIO\\Divisao de Apoio Administrativo\\Felippe.andreata\\Backup_gerenciador_ferias</code></p><div class="tutorial-note"><i class="bi bi-hdd-network-fill"></i><p>A unidade S: depende da rede. Durante uma queda de rede, o relatório mostra o destino como indisponível; os dados locais continuam preservados e o status volta ao normal quando a unidade for reconectada.</p></div></section>

        <section class="tutorial-section" id="tutorial-problemas"><h2><span>17</span> Dúvidas frequentes e solução de problemas</h2><p>Encontre orientações para as situações mais comuns. Clique em uma pergunta para ver a resposta.</p><div class="tutorial-faq"><details><summary>Não consigo entrar no sistema. O que verificar?</summary><p>Confira o usuário, e-mail, CPF ou matrícula e a senha informados. Use o botão de olho para conferir a senha e verifique se a tecla Caps Lock está ativada. Se esqueceu a senha, use Esqueci minha senha.</p></details><details><summary>Esqueci minha senha. Como recuperar?</summary><p>Na tela de acesso, clique em Esqueci minha senha e informe o e-mail cadastrado. Digite o código recebido e escolha uma nova senha. Confira também a pasta de spam. Se o e-mail não chegar, peça ao responsável pelo sistema para verificar o envio de mensagens.</p></details><details><summary>O sistema voltou para a tela de login. E agora?</summary><p>A sessão pode ter expirado. Entre novamente. Se isso ocorrer logo após informar seus dados, atualize a página com Ctrl + F5 e tente outra vez. Se persistir, informe ao responsável pelo sistema o horário e a mensagem apresentada.</p></details><details><summary>O site não abre. O que fazer?</summary><p>Confira o endereço utilizado e a conexão com a rede. No computador que hospeda o sistema, o Apache do XAMPP e o serviço iniciado por iniciar.bat precisam estar funcionando. Se você usa outro computador, peça ao responsável para verificar esses serviços.</p></details><details><summary>Outro computador não consegue acessar. Como resolver?</summary><p>Confirme que os computadores estão na mesma rede, que o computador que hospeda o sistema está ligado e que o endereço de acesso está correto. Se continuar sem acesso, peça a verificação das permissões de rede e do Firewall.</p></details><details><summary>Salvei uma alteração, mas ela não apareceu. O que fazer?</summary><p>Confira se houve mensagem de sucesso e se o registro foi salvo. Atualize com Ctrl + F5 e abra novamente a tela. Antes de cadastrar outra vez, procure o registro para evitar duplicações.</p></details><details><summary>O servidor sumiu da lista. Onde procurar?</summary><p>Abra Arquivados e procure na seção Servidores arquivados. Se ele estiver lá, use Histórico para consultar ou Reativar para devolvê-lo à lista de ativos. Se o cadastro foi excluído definitivamente, não é possível reativá-lo pela interface.</p></details><details><summary>Qual é a diferença entre arquivar e excluir definitivamente?</summary><p>Arquivar preserva cadastro, saldos, períodos, lembretes, anexos e histórico, permitindo reativar depois. Excluir definitivamente apaga o servidor e seus registros vinculados após confirmação. Para manter os dados, escolha Arquivar.</p></details><details><summary>Como reativar um servidor arquivado?</summary><p>Abra Arquivados, localize a pessoa em Servidores arquivados e clique em Reativar. Confirme a operação. O cadastro volta à lista de ativos com seus registros e saldos preservados.</p></details><details><summary>O que aparece em Períodos encerrados?</summary><p>São férias e abonos de servidores ativos cuja data final já passou. Eles aparecem automaticamente nessa seção da tela Arquivados. Isso não arquiva a pessoa, não apaga os registros e não devolve dias ao saldo. Os períodos de servidores arquivados são consultados pelo Histórico de cada pessoa.</p></details><details><summary>Por que o saldo diminuiu se as férias ou o abono ainda não começaram?</summary><p>Os dias já entram no cálculo do saldo quando o período é salvo, mesmo com data futura. Ao editar o período, o saldo é recalculado. Ao excluir esse período, os dias voltam ao saldo correspondente.</p></details><details><summary>Como os dias de férias e abonos são contados?</summary><p>A contagem inclui o primeiro e o último dia, além de fins de semana e feriados. Por exemplo, de 10 a 12 são 3 dias. O saldo de abono é calculado por ano civil; as férias consideram todos os períodos cadastrados e não são renovadas automaticamente por ano.</p></details><details><summary>O sistema informa saldo insuficiente. O que conferir?</summary><p>Consulte os direitos cadastrados para o servidor e os períodos já lançados, inclusive os futuros e encerrados. Verifique se há lançamentos repetidos ou datas incorretas. No abono, confira o ano: um período não pode atravessar a virada do ano civil.</p></details><details><summary>Apareceu um aviso de conflito de datas. O que significa?</summary><p>O período informado coincide com outro registro cadastrado. Confira as pessoas e datas apresentadas. Escolha Voltar e ajustar para corrigir ou Continuar mesmo assim quando a sobreposição estiver correta.</p></details><details><summary>Não consigo editar ou excluir um período. Por quê?</summary><p>Somente o usuário que criou o registro de férias ou abono pode editá-lo ou excluí-lo individualmente. A indicação Somente leitura identifica registros criados por outra conta.</p></details><details><summary>Qual a diferença entre alerta de férias e lembrete individual?</summary><p>O alerta de férias ou abono está relacionado a um período registrado. O lembrete individual serve para um compromisso específico do servidor, criado em Servidores → Criar lembrete. Criar ou responder a um lembrete não desconta dias do saldo.</p></details><details><summary>O lembrete não apareceu. O que verificar?</summary><p>Confira a data do compromisso e se você entrou com a conta que criou o lembrete. O aviso aparece nos logins da véspera e uma única vez no dia do compromisso. Se o servidor estiver arquivado, os alertas ficam suspensos. Fora dessas datas, o compromisso pode ser consultado no calendário e no histórico.</p></details><details><summary>Qual a diferença entre Parar lembrete e Lembrar depois?</summary><p>Na véspera, Parar lembrete suspende os avisos nos próximos logins daquele dia; o aviso volta no dia do compromisso. Lembrar depois mantém a repetição nos próximos logins da véspera. No dia do compromisso, o modal aparece apenas no primeiro login, independentemente da opção escolhida.</p></details><details><summary>O calendário está vazio ou não mostra um registro. O que conferir?</summary><p>Verifique o mês selecionado e use Limpar filtros para remover filtros de servidor, setor ou tipo. Lembretes aparecem na data do compromisso. Registros de servidores arquivados ficam disponíveis no Histórico da pessoa, na tela Arquivados.</p></details><details><summary>Como consultar o histórico completo de uma pessoa?</summary><p>Em Servidores ou na seção Servidores arquivados, clique em Histórico. Consulte compromissos, períodos, anexos e movimentações. Os detalhes de movimentações começaram a ser registrados com a atualização dessa funcionalidade; ações antigas não registradas não são reconstruídas.</p></details><details><summary>Não consigo enviar um anexo. O que verificar?</summary><p>Selecione um arquivo de até 5 MB e tente novamente. Se o problema continuar, verifique a conexão e informe ao responsável pelo sistema a mensagem apresentada.</p></details><details><summary>A importação CSV ignorou algumas linhas. Por quê?</summary><p>Confira se o arquivo tem a coluna nome e se cada linha contém um nome preenchido. O sistema ignora linhas sem nome e cadastros identificados como repetidos. Use vírgula ou ponto e vírgula como separador e confira os nomes das colunas descritos na seção Servidores.</p></details><details><summary>O backup não apareceu. O que fazer?</summary><p>Verifique com o responsável se o computador estava ligado e se o destino de backup estava acessível. Sem alterações nos dados, o sistema pode não gerar um novo arquivo. A indisponibilidade da pasta de rede não significa que os dados locais foram apagados.</p></details><details><summary>Como aumentar as letras ou mudar a aparência?</summary><p>No cabeçalho, use A+ para aumentar a fonte, A- para diminuir e A para restaurar o tamanho padrão. Use Modo escuro ou Modo claro para alternar a aparência.</p></details></div><p>Se o problema persistir, anote a mensagem exibida, a tela e o horário em que ocorreu e encaminhe essas informações ao responsável pelo sistema. Nunca compartilhe sua senha.</p></section>
    </div>`;
    const search = $('#tutorialSearch');
    const status = $('#tutorialSearchStatus');
    search?.addEventListener('input', () => {
        const query = search.value.trim().toLocaleLowerCase('pt-BR');
        let visible = 0;
        $$('.tutorial-section', $('#content')).forEach(section => {
            const match = !query || section.textContent.toLocaleLowerCase('pt-BR').includes(query);
            section.hidden = !match;
            if (match) visible++;
        });
        $$('.tutorial-index a', $('#content')).forEach(link => {
            const section = document.querySelector(link.getAttribute('href'));
            link.hidden = !!section?.hidden;
        });
        status.textContent = query ? visible + ' tópico(s) encontrado(s).' : '';
    });
}

async function auditoria() {
    if (!state.me?.can_view_audit) return showPage('dashboard');
    try {
        const requests = [api('/api/audit')];
        if (state.me.can_manage_audit_access) requests.push(api('/api/audit/access'));
        const [auditRows, accessUsers = []] = await Promise.all(requests);
        state.auditoria = auditRows;
        state.auditAccessUsers = accessUsers;
    } catch {
        state.auditoria = [];
        state.auditAccessUsers = [];
    }
    const availableUsers = state.auditAccessUsers.filter(user => user.active && !user.audit_access);
    const allowedUsers = state.auditAccessUsers.filter(user => user.audit_access);
    $('#content').innerHTML = `
    <div class="page">
        ${state.me.can_manage_audit_access ? `
        <section class="audit-access-panel">
            <div><h3>Acesso à Auditoria</h3><small>Conceda ou retire o acesso de usuários cadastrados.</small></div>
            <div class="audit-access-grant">
                <select id="auditAccessUser" aria-label="Selecionar usuário para acessar a auditoria">
                    <option value="">Selecione um usuário</option>
                    ${availableUsers.map(user => `<option value="${user.id}">${esc(user.username)}${user.email ? ` — ${esc(user.email)}` : ''}</option>`).join('')}
                </select>
                <button type="button" class="primary" id="grantAuditAccess" ${availableUsers.length ? '' : 'disabled'}>Conceder acesso</button>
            </div>
            <div class="audit-access-list">
                <strong>Usuários autorizados</strong>
                ${allowedUsers.length ? allowedUsers.map(user => `<span class="audit-access-user"><span>${esc(user.username)}${user.email ? ` — ${esc(user.email)}` : ''}</span><button type="button" class="danger" onclick="setAuditAccess(${user.id}, false)">Retirar acesso</button></span>`).join('') : '<small>Nenhum outro usuário autorizado.</small>'}
            </div>
        </section>` : ''}
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
    if (state.me.can_manage_audit_access) {
        $('#grantAuditAccess').onclick = () => {
            const id = Number($('#auditAccessUser').value);
            if (id) setAuditAccess(id, true);
        };
    }
}

window.setAuditAccess = async (id, enabled) => {
    try {
        await api(`/api/audit/access/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
        toast(enabled ? 'Acesso à auditoria concedido.' : 'Acesso à auditoria retirado.');
        await auditoria();
    } catch (error) {
        toast(error.message, true);
    }
};

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
    if (!state.me.can_manage_system) return showPage('dashboard');
    if (tab === 'audit' && !state.me.can_view_audit) tab = 'users';
    const users = await api('/api/admin/users');
    state.adminUsers = users;
    const audit = state.me.can_view_audit ? await api('/api/admin/audit') : [];
    state.auditoria = audit;
    
    $('#content').innerHTML = `
    <div class="page">
        <div class="section-head">
            <h3>Administração do Sistema</h3>
            ${tab === 'users' ? '<button class="primary" onclick="openCreateUser()">+ Cadastrar Usuário</button>' : ''}
        </div>
        <div class="admin-tabs">
            <button class="${tab === 'users' ? 'active' : ''}" onclick="admin('users')">Usuários</button>
            ${state.me.can_view_audit ? `<button class="${tab === 'audit' ? 'active' : ''}" onclick="admin('audit')">Auditoria</button>` : ''}
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
                                <button type="button" class="icon-btn" onclick="editUser(${u.id})">Editar</button>
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
        ARCHIVE_SERVIDOR: 'Servidor arquivado', RESTORE_SERVIDOR: 'Servidor reativado', DELETE_EVENTO: 'Registro excluído', ADMIN_CREATE_USER: 'Usuário cadastrado pelo master',
        ADMIN_UPDATE_USER: 'Usuário atualizado pelo master', ADMIN_DELETE_USER: 'Usuário excluído pelo master',
        IMPERSONATE: 'Master acessou outro usuário', RESTORE_MASTER: 'Retorno à conta master',
        KEEP_ALERT: 'Alerta mantido', STOP_ALERT: 'Alerta interrompido', UPDATE_PROFILE: 'Perfil atualizado',
        VALIDATE_BACKUP: 'Backup validado', SCHEDULE_BACKUP_RESTORE: 'Restauração de backup preparada'
    };
    return labels[action] || action.replaceAll('_', ' ').toLowerCase();
}

window.openAuditDetails = id => {
    const record = state.auditoria.find(item => item.id === id);
    if (!record) return toast('Detalhes não encontrados.', true);
    let details = {};
    try { details = JSON.parse(record.details || '{}'); } catch { details = { informação: record.details }; }
    const entries = Object.entries(details);
    const changeKeys=[...new Set([...Object.keys(details.before||{}),...Object.keys(details.after||{})])];
    const changes=changeKeys.filter(key=>String(details.before?.[key]??'')!==String(details.after?.[key]??''));
    const regularEntries=entries.filter(([key])=>!['before','after'].includes(key));
    modal(`
        <h2>Detalhes da auditoria</h2>
        <dl class="audit-details-list">
            <div><dt>Data e hora</dt><dd>${new Date(record.created_at + 'Z').toLocaleString('pt-BR')}</dd></div>
            <div><dt>Usuário</dt><dd>${esc(record.username || 'Sistema')}</dd></div>
            <div><dt>Ação</dt><dd>${esc(auditActionLabel(record.action))}</dd></div>
            <div><dt>Endereço IP</dt><dd>${esc(record.ip || '—')}</dd></div>
            ${regularEntries.map(([key, value]) => `<div><dt>${esc(key.replaceAll('_', ' '))}</dt><dd>${esc(typeof value==='object'?JSON.stringify(value):Array.isArray(value) ? value.join(', ') : value)}</dd></div>`).join('')}
        </dl>
        ${changes.length?`<h3>Alterações realizadas</h3><div class="audit-change-table"><div class="audit-change-head"><strong>Campo</strong><strong>Antes</strong><strong>Depois</strong></div>${changes.map(key=>`<div><strong>${esc(key.replaceAll('_',' '))}</strong><span>${esc(details.before?.[key]??'—')}</span><span>${esc(details.after?.[key]??'—')}</span></div>`).join('')}</div>`:''}
        ${entries.length ? '' : '<p class="empty compact">Esta ação não possui informações adicionais.</p>'}
        <div class="form-actions"><button type="button" class="primary" onclick="closeModal()">Fechar</button></div>
    `);
};

window.openServidor = async id => {
    const s = state.servidores.find(x => x.id === id) || {};
    if (!state.setores.length) {
        const structure = await api('/api/estrutura');
        state.setores = structure.setores;
    }
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
            <label>Setor *<select name="setor_id" required><option value="" disabled ${id ? "" : "selected"}>Selecione um setor</option><option value="sem_setor" ${id && !s.setor_id ? "selected" : ""}>Sem setor</option>${state.setores.map(x=>`<option value="${x.id}" ${Number(s.setor_id)===x.id?'selected':''}>${esc(x.nome)}</option>`).join('')}</select><small>Selecione um setor ou escolha “Sem setor”.</small></label>
            <div class="grid2">
                <label>Direito a férias (dias)<input type="number" min="0" name="ferias_total" value="${Number(s.ferias_total ?? 30)}"></label>
                <label>Direito anual a abono (dias)<input type="number" min="0" name="abono_total" value="${Number(s.abono_total ?? 5)}"></label>
            </div>
            <small style="display:block;margin-top:6px">O direito anual a abono é renovado a cada 1º de janeiro; o saldo vencido não acumula.</small>
            <div class="form-actions">
                <button type="button" class="secondary" onclick="closeModal()">Cancelar</button>
                <button class="primary">Salvar</button>
            </div>
        </form>
    `);

    $('#servidorForm').onsubmit = async e => {
        e.preventDefault();
        const data = formData(e.target);
        if (!data.setor_id) { toast('Selecione um setor ou Sem setor.', true); return; }
        if (data.setor_id === 'sem_setor') data.setor_id = '';
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

window.deleteServidor = async (id,fromArchive=false) => {
 const servidor=[...state.servidores,...state.servidoresArquivados].find(s=>s.id===id);
 if(!await confirmDialog({title:'Excluir definitivamente?',message:`Excluir ${servidor?.nome||'este servidor'} e TODOS os seus dados: férias, abonos, lembretes, anexos e histórico? Esta ação não pode ser desfeita. Para preservar os dados, use Arquivar.`,confirmLabel:'Excluir tudo definitivamente',danger:true}))return;
 try{const result=await api(`/api/servidores/${id}`,{method:'DELETE',body:JSON.stringify({confirmPermanent:true})});await reload();await showPage(fromArchive?'arquivados':'servidores');toast(result.warning||'Servidor e registros excluídos definitivamente.',!!result.warning);}catch(error){toast(error.message,true);}
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
                <label>Perfil<input value="Administrador" disabled></label>
                <label>Senha *<input type="password" name="password" minlength="8" required></label>
            </div>
            <small>Todo novo cadastro é criado como Administrador. Somente o usuário master pode promover ou rebaixar uma conta posteriormente.</small>
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

window.editUser = id => {
    const u = state.adminUsers.find(user => user.id === id);
    if (!u) return toast('Usuário não encontrado. Atualize a página.', true);
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
        const button=e.submitter;button.disabled=true;
        try {
            await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(d) });
            $('#modal').close();
            await admin('users');
            toast('Usuário atualizado.');
        } catch(error) {
            toast(error.message,true);
        } finally {
            button.disabled=false;
        }
    };
};

window.impersonate = async id => {
    if (await confirmDialog({ title: 'Acessar como este usuário?', message: 'Você passará a visualizar o sistema com as permissões desta conta. Para voltar ao master, use o botão no topo da tela.', confirmLabel: 'Acessar conta' })) {
        try { await api(`/api/admin/impersonate/${id}`, { method: 'POST' }); await boot(); }
        catch(error){ toast(error.message,true); }
    }
};

window.deleteUser = async id => {
    if (await confirmDialog({ title: 'Excluir usuário?', message: 'A conta será removida permanentemente. Os registros históricos serão preservados quando aplicável.', confirmLabel: 'Excluir usuário', danger: true })) {
        try { await api(`/api/admin/users/${id}`, { method: 'DELETE' }); await admin('users'); toast('Usuário excluído.'); }
        catch(error){ toast(error.message,true); }
    }
};

window.admin = admin;

// Inicialização da aplicação
initThemeAndAccessibility();
boot();

window.openReminder = servidorId => {
 const servidor=state.servidores.find(s=>s.id===servidorId);
 if(!servidor)return;
 modal(`<h2>Criar lembrete para ${esc(servidor.nome)}</h2><form id="reminderForm"><label>Compromisso<input name="titulo" required maxlength="200"></label><label>Data<input name="data" type="date" required min="${localIso(new Date())}"></label><label>Observações<textarea name="observacoes" maxlength="4000"></textarea></label><p>O gestor que criar este lembrete receberá o aviso ao entrar na véspera e uma única vez no dia do compromisso. O compromisso ficará no calendário e no histórico.</p><button class="primary">Salvar lembrete</button><button type="button" class="secondary" onclick="closeModal()">Cancelar</button></form>`);
 $('#reminderForm').onsubmit=async event=>{
 event.preventDefault();const button=$('button',event.target);button.disabled=true;
 try{await api('/api/lembretes',{method:'POST',body:JSON.stringify({...formData(event.target),servidor_id:servidorId})});closeModal();await reload();await openServidorHistory(servidorId);toast('Lembrete criado.');}
 catch(error){toast(error.message,true);button.disabled=false;}
 };
};
async function showLoginReminders(){
 try{
 const queue=await api('/api/lembretes/login',{method:'POST'});
 if(!queue.length)return;
 let dialog=document.getElementById('reminderLoginDialog');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='reminderLoginDialog';document.body.appendChild(dialog);}
 dialog.oncancel=event=>event.preventDefault();
 for(const row of queue){
 await new Promise(resolve=>{
 dialog.innerHTML=`<h2>Lembrete de compromisso</h2><p><strong>${esc(row.servidor_nome)}</strong></p><h3>${esc(row.titulo)}</h3><p>Data: ${fmt(row.data)}</p><p style="white-space:pre-wrap">${esc(row.observacoes||'')}</p><p>No dia do compromisso, este aviso aparece uma única vez.</p><div class="actions"><button type="button" class="secondary" data-answer="parar">Parar lembrete</button><button type="button" class="primary" data-answer="depois">Lembrar depois</button></div>`;
 dialog.showModal();
 $$('[data-answer]',dialog).forEach(button=>button.onclick=async()=>{
 $$('button',dialog).forEach(b=>b.disabled=true);
 try{await api(`/api/lembretes/${row.id}/responder`,{method:'POST',body:JSON.stringify({acao:button.dataset.answer})});dialog.close();resolve();}
 catch(error){toast(error.message,true);$$('button',dialog).forEach(b=>b.disabled=false);}
 });
 });
 }
 }catch(error){toast('Não foi possível carregar os lembretes: '+error.message,true);}
}

function movementDetails(details){
 const labels={nome:'Nome',funcao:'Função',email:'E-mail',cpf:'CPF',matricula:'Matrícula',setor_id:'Setor',ferias_total:'Direito a férias',abono_total:'Direito anual a abonos',tipo:'Tipo',inicio:'Início',fim:'Fim',observacoes:'Observações',titulo:'Compromisso',data:'Data',antes:'Antes',depois:'Depois',id:'Código'};
 const value=(key,v)=>v==null||v===''?'—':key==='setor_id'?(state.setores.find(s=>s.id===v)?.nome||v):['inicio','fim','data'].includes(key)?fmt(v):key==='tipo'?(v==='ferias'?'Férias':'Abono'):String(v);
 return Object.entries(details).map(([key,v])=>v&&typeof v==='object'?`${labels[key]||key}:\n${movementDetails(v)}`:`${labels[key]||key}: ${value(key,v)}`).join('\n');
}

// Aplica também aos formulários criados dinamicamente em modais e no perfil.
function enhancePasswordFields(root=document) {
 root.querySelectorAll('input[type="password"]').forEach(input=>{
  if(input.dataset.passwordToggle)return;
  input.dataset.passwordToggle='1';
  const wrapper=document.createElement('span');wrapper.className='password-field';
  input.parentNode.insertBefore(wrapper,input);wrapper.appendChild(input);
  const button=document.createElement('button');button.type='button';button.className='password-toggle';
  button.setAttribute('aria-label','Mostrar senha');button.setAttribute('aria-pressed','false');
  button.title='Mostrar senha';button.innerHTML='<i class="bi bi-eye" aria-hidden="true"></i>';
  button.addEventListener('click',event=>{
   event.preventDefault();const visible=input.type==='password';input.type=visible?'text':'password';
   button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'Ocultar senha':'Mostrar senha');
   button.title=visible?'Ocultar senha':'Mostrar senha';button.innerHTML=visible?'<i class="bi bi-eye-slash" aria-hidden="true"></i>':'<i class="bi bi-eye" aria-hidden="true"></i>';
  });
  wrapper.appendChild(button);
 });
}
enhancePasswordFields();
new MutationObserver(()=>enhancePasswordFields()).observe(document.body,{childList:true,subtree:true});
