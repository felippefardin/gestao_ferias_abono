require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { AsyncLocalStorage } = require('async_hooks');
const nodemailer = require('nodemailer');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = Number(process.env.PORT || 3000);
// Mantém o banco em uma pasta gravável mesmo quando o projeto no XAMPP
// é copiado pelo Windows com o atributo de somente leitura.
const appDataRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'GestaoFeriasAbonos')
  : path.join(__dirname, '.runtime');
const dataDir = process.env.DATA_DIR || path.join(appDataRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(appDataRoot, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const databasePath = path.join(dataDir, 'gestao.db');
const legacyDatabasePath = path.join(__dirname, 'data', 'gestao.db');
if (!fs.existsSync(databasePath) && databasePath !== legacyDatabasePath && fs.existsSync(legacyDatabasePath)) {
  fs.copyFileSync(legacyDatabasePath, databasePath);
  console.log(`Banco anterior transferido para: ${databasePath}`);
}
const db = new DatabaseSync(databasePath);
const auditContext = new AsyncLocalStorage();
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE,
  cpf TEXT UNIQUE, matricula TEXT UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', active INTEGER NOT NULL DEFAULT 1,
  audit_access INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS servidores (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, funcao TEXT, cpf TEXT, matricula TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY, servidor_id INTEGER NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('ferias','abono')),
  inicio TEXT NOT NULL, fim TEXT NOT NULL, alerta_extra TEXT, observacoes TEXT,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(servidor_id) REFERENCES servidores(id), FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, details TEXT,
  ip TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS alert_preferences (
  evento_id INTEGER NOT NULL, user_id INTEGER NOT NULL, stopped INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(evento_id,user_id),
  FOREIGN KEY(evento_id) REFERENCES eventos(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS impersonations (
  session_token_hash TEXT PRIMARY KEY, master_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(master_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS setores (
  id INTEGER PRIMARY KEY, nome TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS equipes (
  id INTEGER PRIMARY KEY, setor_id INTEGER, nome TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(setor_id,nome), FOREIGN KEY(setor_id) REFERENCES setores(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS anexos (
  id INTEGER PRIMARY KEY, evento_id INTEGER NOT NULL, nome_original TEXT NOT NULL, nome_arquivo TEXT NOT NULL,
  mime_type TEXT, tamanho INTEGER NOT NULL DEFAULT 0, uploaded_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(evento_id) REFERENCES eventos(id) ON DELETE CASCADE, FOREIGN KEY(uploaded_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS notification_log (
  evento_id INTEGER NOT NULL, recipient TEXT NOT NULL, notification_date TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(evento_id,recipient,notification_date),
  FOREIGN KEY(evento_id) REFERENCES eventos(id) ON DELETE CASCADE
);
`);
// Migrações leves para instalações existentes.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('audit_access')) db.exec('ALTER TABLE users ADD COLUMN audit_access INTEGER NOT NULL DEFAULT 0');
const servidorColumns = db.prepare('PRAGMA table_info(servidores)').all().map(column => column.name);
if (!servidorColumns.includes('email')) db.exec('ALTER TABLE servidores ADD COLUMN email TEXT');
if (!servidorColumns.includes('setor_id')) db.exec('ALTER TABLE servidores ADD COLUMN setor_id INTEGER REFERENCES setores(id)');
if (!servidorColumns.includes('equipe_id')) db.exec('ALTER TABLE servidores ADD COLUMN equipe_id INTEGER REFERENCES equipes(id)');
if (!servidorColumns.includes('ferias_total')) db.exec('ALTER TABLE servidores ADD COLUMN ferias_total INTEGER NOT NULL DEFAULT 30');
if (!servidorColumns.includes('abono_total')) db.exec('ALTER TABLE servidores ADD COLUMN abono_total INTEGER NOT NULL DEFAULT 5');
const preferenceColumns = db.prepare('PRAGMA table_info(alert_preferences)').all().map(column => column.name);
if (!preferenceColumns.includes('read_at')) db.exec('ALTER TABLE alert_preferences ADD COLUMN read_at TEXT');

const iso = d => new Date(d).toISOString();
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  return key && crypto.timingSafeEqual(Buffer.from(key, 'hex'), actual);
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function localNetworkIp() {
  const addresses=[];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')) addresses.push(item.address);
  }
  return addresses.find(address=>!address.startsWith('192.168.56.')) || addresses[0] || '127.0.0.1';
}
function normalizedAuditIp(ip) {
  const value=String(ip||'').replace(/^::ffff:/,'');
  return ['127.0.0.1','::1',''].includes(value) ? localNetworkIp() : value;
}
function audit(userId, action, details, ip) {
  const contextIp=auditContext.getStore()?.ip;
  db.prepare('INSERT INTO audit(user_id,action,details,ip) VALUES(?,?,?,?)').run(userId || null, action, JSON.stringify(details || {}), contextIp || normalizedAuditIp(ip));
}

const masterUsername = process.env.MASTER_USERNAME || 'felippe.andreata';
const masterEmail = process.env.MASTER_EMAIL || 'contatotech.tecnologia@gmail.com';
if (!db.prepare('SELECT id FROM users WHERE username=?').get(masterUsername)) {
  const initialPassword = process.env.MASTER_INITIAL_PASSWORD || 'TroqueAgora!2026';
  db.prepare('INSERT INTO users(username,email,password_hash,role) VALUES(?,?,?,?)')
    .run(masterUsername, masterEmail, hashPassword(initialPassword), 'master');
  console.log(`Usuário master criado: ${masterUsername}`);
  if (!process.env.MASTER_INITIAL_PASSWORD) console.log('Senha inicial temporária: TroqueAgora!2026');
}

app.set('trust proxy', ['loopback']);
app.use(express.json({ limit: '8mb' }));
app.use((req,res,next)=>{
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  const auditAddress=forwarded || normalizedAuditIp(req.socket.remoteAddress);
  auditContext.run({ip:auditAddress},next);
});
app.get(['/public/app.js','/public/style.css','/public/fix.css'],(req,res)=>res.sendFile(path.join(__dirname,req.path)));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => { const i=v.indexOf('='); return [v.slice(0,i).trim(), decodeURIComponent(v.slice(i+1))]; }));
}
function auth(req, res, next) {
  const token = cookies(req).session;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  const user = db.prepare(`SELECT u.id,u.username,u.email,u.cpf,u.matricula,u.role,u.audit_access FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.active=1`).get(digest(token));
  if (!user) return res.status(401).json({ error: 'Sessão expirada.' });
  req.user = user; next();
}
function master(req,res,next){ if(req.user.role!=='master') return res.status(403).json({error:'Acesso exclusivo do master.'}); next(); }
function isAuditOwner(user){ return user.role==='master' && String(user.email||'').trim().toLowerCase()===masterEmail.trim().toLowerCase(); }
function canViewAudit(user){ return isAuditOwner(user) || Number(user.audit_access)===1; }
function auditMaster(req,res,next){
  if(!canViewAudit(req.user)) return res.status(403).json({error:'Você não possui permissão para visualizar a auditoria.'});
  next();
}
function auditOwner(req,res,next){
  if(!isAuditOwner(req.user)) return res.status(403).json({error:'Somente o master principal pode administrar o acesso à auditoria.'});
  next();
}

app.post('/api/register', (req,res) => {
  const {username,email,cpf,matricula,password} = req.body;
  if (!username || !password || password.length < 8) return res.status(400).json({error:'Informe usuário e senha com ao menos 8 caracteres.'});
  try {
    const info=db.prepare('INSERT INTO users(username,email,cpf,matricula,password_hash) VALUES(?,?,?,?,?)').run(username.trim(),email?.trim()||null,cpf?.trim()||null,matricula?.trim()||null,hashPassword(password));
    audit(Number(info.lastInsertRowid),'CREATE_ACCOUNT',{username},req.ip); res.json({ok:true});
  } catch { res.status(409).json({error:'Usuário, e-mail, CPF ou matrícula já cadastrado.'}); }
});
app.post('/api/login', (req,res) => {
  const identifier=String(req.body.identifier||'').trim();
  const password=String(req.body.password||'');
  const user=db.prepare('SELECT * FROM users WHERE active=1 AND (username=? COLLATE NOCASE OR email=? COLLATE NOCASE OR cpf=? OR matricula=?)').get(identifier,identifier,identifier,identifier);
  if(!user || !verifyPassword(password,user.password_hash)) { audit(user?.id,'LOGIN_FAILED',{identifier},req.ip); return res.status(401).json({error:'Usuário ou senha incorretos. No primeiro acesso use felippe.andreata e TroqueAgora!2026.'}); }
  const token=crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),user.id,iso(Date.now()+12*60*60*1000));
  audit(user.id,'LOGIN',{},req.ip); res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`); res.json({ok:true});
});
app.post('/api/logout', (req,res)=>{
  const token=cookies(req).session;
  if(token){
    const tokenHash=digest(token);
    const session=db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get(tokenHash);
    db.prepare('DELETE FROM impersonations WHERE session_token_hash=?').run(tokenHash);
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
    if(session) audit(session.user_id,'LOGOUT',{},req.ip);
  }
  res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ok:true});
});
app.get('/api/me',auth,(req,res)=>{
  const tokenHash=digest(cookies(req).session);
  res.json({...req.user,is_impersonated:!!db.prepare('SELECT 1 FROM impersonations WHERE session_token_hash=?').get(tokenHash),can_view_audit:canViewAudit(req.user),can_manage_audit_access:isAuditOwner(req.user)});
});
app.patch('/api/me',auth,(req,res)=>{
  const {email,password,currentPassword}=req.body;
  const current=db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if(!verifyPassword(currentPassword||'',current.password_hash)) return res.status(403).json({error:'Senha atual incorreta.'});
  try { db.prepare('UPDATE users SET email=COALESCE(?,email), password_hash=COALESCE(?,password_hash) WHERE id=?').run(email||null,password?hashPassword(password):null,req.user.id); audit(req.user.id,'UPDATE_PROFILE',{emailChanged:!!email,passwordChanged:!!password},req.ip); res.json({ok:true}); } catch { res.status(409).json({error:'E-mail já utilizado.'}); }
});
app.delete('/api/me',auth,(req,res)=>{ if(req.user.role==='master') return res.status(400).json({error:'A conta master não pode ser excluída aqui.'}); db.prepare('DELETE FROM users WHERE id=?').run(req.user.id); audit(null,'DELETE_OWN_ACCOUNT',{username:req.user.username},req.ip); res.json({ok:true}); });

app.post('/api/forgot', async (req,res)=>{
  const user=db.prepare('SELECT id,email FROM users WHERE email=?').get(req.body.email);
  if(user?.email){ const code=String(crypto.randomInt(100000,999999)); db.prepare('INSERT INTO password_resets(user_id,code_hash,expires_at) VALUES(?,?,?)').run(user.id,digest(code),iso(Date.now()+15*60*1000));
    if(process.env.SMTP_APP_PASSWORD){ const tx=nodemailer.createTransport({service:'gmail',auth:{user:process.env.SMTP_USER||masterEmail,pass:process.env.SMTP_APP_PASSWORD}}); await tx.sendMail({from:process.env.SMTP_USER||masterEmail,to:user.email,subject:'Código para redefinir sua senha',text:`Seu código é ${code}. Ele expira em 15 minutos.`}); }
    else console.log(`[MODO LOCAL] Código de recuperação para ${user.email}: ${code}`);
  } res.json({ok:true,message:'Se o e-mail estiver cadastrado, o código será enviado.'});
});
app.post('/api/reset',(req,res)=>{ const user=db.prepare('SELECT id FROM users WHERE email=?').get(req.body.email); if(!user) return res.status(400).json({error:'Código inválido.'}); const row=db.prepare('SELECT * FROM password_resets WHERE user_id=? AND used=0 AND expires_at>CURRENT_TIMESTAMP ORDER BY id DESC LIMIT 1').get(user.id); if(!row||row.code_hash!==digest(req.body.code||'')) return res.status(400).json({error:'Código inválido ou expirado.'}); if((req.body.password||'').length<8)return res.status(400).json({error:'A nova senha deve ter ao menos 8 caracteres.'}); db.prepare('UPDATE password_resets SET used=1 WHERE id=?').run(row.id); db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(req.body.password),user.id); audit(user.id,'RESET_PASSWORD',{},req.ip); res.json({ok:true}); });

function servidorDuplicates({nome,email,cpf,matricula},excludeId=null){
  const values=[['Nome',nome,'nome'],['E-mail',email,'email'],['CPF/documento',cpf,'cpf'],['Matrícula',matricula,'matricula']];
  const found=[];
  for(const [campo,value,column] of values){
    const clean=String(value||'').trim(); if(!clean) continue;
    const rows=db.prepare(`SELECT id,nome FROM servidores WHERE lower(trim(${column}))=lower(trim(?)) AND (? IS NULL OR id<>?)`).all(clean,excludeId,excludeId);
    rows.forEach(row=>found.push({campo,valor:clean,servidor_id:row.id,servidor_nome:row.nome}));
  }
  return found;
}
app.get('/api/servidores',auth,(req,res)=>res.json(db.prepare(`SELECT s.*,st.nome setor_nome,
  COALESCE((SELECT SUM(julianday(e.fim)-julianday(e.inicio)+1) FROM eventos e WHERE e.servidor_id=s.id AND e.tipo='ferias'),0) ferias_usadas,
  COALESCE((SELECT SUM(julianday(e.fim)-julianday(e.inicio)+1) FROM eventos e WHERE e.servidor_id=s.id AND e.tipo='abono' AND strftime('%Y',e.inicio)=strftime('%Y','now','localtime')),0) abonos_usados
  FROM servidores s LEFT JOIN setores st ON st.id=s.setor_id ORDER BY s.nome`).all()));
app.post('/api/servidores',auth,(req,res)=>{ const {nome,funcao,email,cpf,matricula,setor_id,ferias_total,abono_total,confirmDuplicate}=req.body;if(!nome?.trim())return res.status(400).json({error:'Nome é obrigatório.'});const duplicates=servidorDuplicates(req.body);if(duplicates.length&&!confirmDuplicate)return res.status(409).json({error:'DUPLICATE',duplicates}); const x=db.prepare('INSERT INTO servidores(nome,funcao,email,cpf,matricula,setor_id,equipe_id,ferias_total,abono_total) VALUES(?,?,?,?,?,?,NULL,?,?)').run(nome.trim(),funcao||null,email?.trim()||null,cpf||null,matricula||null,setor_id||null,Number(ferias_total)||30,Number(abono_total)||5);audit(req.user.id,'CREATE_SERVIDOR',{id:Number(x.lastInsertRowid),nome,duplicates:duplicates.map(d=>d.servidor_id)},req.ip);res.json({id:Number(x.lastInsertRowid)}); });
app.patch('/api/servidores/:id',auth,(req,res)=>{ const {nome,funcao,email,cpf,matricula,setor_id,ferias_total,abono_total,confirmDuplicate}=req.body;if(!nome?.trim())return res.status(400).json({error:'Nome é obrigatório.'});const duplicates=servidorDuplicates(req.body,Number(req.params.id));if(duplicates.length&&!confirmDuplicate)return res.status(409).json({error:'DUPLICATE',duplicates});db.prepare('UPDATE servidores SET nome=?,funcao=?,email=?,cpf=?,matricula=?,setor_id=?,equipe_id=NULL,ferias_total=?,abono_total=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nome.trim(),funcao||null,email?.trim()||null,cpf||null,matricula||null,setor_id||null,Number(ferias_total)||30,Number(abono_total)||5,req.params.id);audit(req.user.id,'UPDATE_SERVIDOR',{id:req.params.id,duplicates:duplicates.map(d=>d.servidor_id)},req.ip);res.json({ok:true}); });
app.delete('/api/servidores/:id',auth,(req,res)=>{ try{db.prepare('DELETE FROM servidores WHERE id=?').run(req.params.id);audit(req.user.id,'DELETE_SERVIDOR',{id:req.params.id},req.ip);res.json({ok:true});}catch{res.status(409).json({error:'Este servidor possui registros. Mantenha-o para preservar o histórico.'});} });

app.get('/api/eventos',auth,(req,res)=>{ const archived=req.query.archived==='1'; const op=archived?'<':'>='; res.json(db.prepare(`SELECT e.*,s.nome servidor_nome,u.username criado_por, CASE WHEN e.created_by=? THEN 1 ELSE 0 END pode_editar, CAST(julianday('now')-julianday(e.fim) AS INTEGER) dias_arquivado FROM eventos e JOIN servidores s ON s.id=e.servidor_id LEFT JOIN users u ON u.id=e.created_by WHERE date(e.fim) ${op} date('now') ORDER BY e.inicio`).all(req.user.id)); });
app.get('/api/alertas',auth,(req,res)=>res.json(db.prepare(`SELECT e.*,s.nome servidor_nome,CASE WHEN p.read_at IS NULL THEN 0 ELSE 1 END lido,CAST(julianday(e.inicio)-julianday('now') AS INTEGER) dias FROM eventos e JOIN servidores s ON s.id=e.servidor_id LEFT JOIN alert_preferences p ON p.evento_id=e.id AND p.user_id=? WHERE e.created_by=? AND COALESCE(p.stopped,0)=0 AND date(e.fim)>=date('now') AND ((date(e.inicio) BETWEEN date('now') AND date('now','+20 day')) OR date(e.alerta_extra)>=date('now')) ORDER BY lido,COALESCE(e.alerta_extra,e.inicio),e.inicio`).all(req.user.id,req.user.id)));
app.post('/api/alertas/:id/responder',auth,(req,res)=>{const acao=req.body.acao;if(!['manter','parar'].includes(acao))return res.status(400).json({error:'Resposta de alerta inválida.'});const evento=db.prepare('SELECT id FROM eventos WHERE id=?').get(req.params.id);if(!evento)return res.status(404).json({error:'Registro não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET stopped=excluded.stopped,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id,acao==='parar'?1:0);audit(req.user.id,acao==='parar'?'STOP_ALERT':'KEEP_ALERT',{evento_id:evento.id},req.ip);res.json({ok:true});});
app.post('/api/alertas/:id/lido',auth,(req,res)=>{const evento=db.prepare('SELECT id FROM eventos WHERE id=? AND created_by=?').get(req.params.id,req.user.id);if(!evento)return res.status(404).json({error:'Alerta não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,read_at,updated_at) VALUES(?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id);res.json({ok:true});});
app.post('/api/alertas/ler-todos',auth,(req,res)=>{const ids=db.prepare(`SELECT e.id FROM eventos e WHERE e.created_by=? AND date(e.fim)>=date('now') AND ((date(e.inicio) BETWEEN date('now') AND date('now','+20 day')) OR date(e.alerta_extra)>=date('now'))`).all(req.user.id);const save=db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,read_at,updated_at) VALUES(?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`);db.exec('BEGIN');try{ids.forEach(({id})=>save.run(id,req.user.id));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}res.json({ok:true});});
app.delete('/api/alertas/:id',auth,(req,res)=>{const evento=db.prepare('SELECT id FROM eventos WHERE id=? AND created_by=?').get(req.params.id,req.user.id);if(!evento)return res.status(404).json({error:'Alerta não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,updated_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET stopped=1,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id);audit(req.user.id,'DELETE_ALERT',{evento_id:evento.id},req.ip);res.json({ok:true});});
function eventConflicts(inicio,fim,excludeId=null){return db.prepare(`SELECT e.id,s.nome servidor_nome,e.tipo,e.inicio,e.fim FROM eventos e JOIN servidores s ON s.id=e.servidor_id WHERE date(e.inicio)<=date(?) AND date(e.fim)>=date(?) AND (? IS NULL OR e.id<>?) ORDER BY e.inicio`).all(fim,inicio,excludeId,excludeId);}
function validateEventBalance(servidorId,tipo,inicio,fim,excludeId=null){
  const servidor=db.prepare('SELECT nome,ferias_total,abono_total FROM servidores WHERE id=?').get(servidorId);
  if(!servidor)return 'Servidor não encontrado.';
  const limit=tipo==='ferias'?servidor.ferias_total:servidor.abono_total;
  if(tipo==='abono'){
    if(inicio.slice(0,4)!==fim.slice(0,4))return 'O abono deve começar e terminar dentro do mesmo ano civil.';
    const year=inicio.slice(0,4);
    const requested=Math.floor((new Date(`${fim}T12:00:00`)-new Date(`${inicio}T12:00:00`))/86400000)+1;
    const used=db.prepare(`SELECT COALESCE(SUM(julianday(fim)-julianday(inicio)+1),0) total FROM eventos WHERE servidor_id=? AND tipo='abono' AND substr(inicio,1,4)=? AND (? IS NULL OR id<>?)`).get(servidorId,year,excludeId,excludeId).total;
    if(Number(used)+requested>Number(limit))return `Saldo de abono insuficiente em ${year}. ${servidor.nome} possui ${Math.max(0,Number(limit)-Number(used))} dia(s) disponíveis nesse ano.`;
  } else {
    const requested=Math.floor((new Date(`${fim}T12:00:00`)-new Date(`${inicio}T12:00:00`))/86400000)+1;
    const used=db.prepare(`SELECT COALESCE(SUM(julianday(fim)-julianday(inicio)+1),0) total FROM eventos WHERE servidor_id=? AND tipo='ferias' AND (? IS NULL OR id<>?)`).get(servidorId,excludeId,excludeId).total;
    if(Number(used)+requested>Number(limit))return `Saldo insuficiente. ${servidor.nome} possui ${Math.max(0,Number(limit)-Number(used))} dia(s) disponíveis para férias.`;
  }
  return null;
}
app.post('/api/eventos/check',auth,(req,res)=>res.json(eventConflicts(req.body.inicio,req.body.fim,req.body.id||null)));
app.post('/api/eventos',auth,(req,res)=>{ const {servidor_id,tipo,inicio,fim,alerta_extra,observacoes,confirmConflict}=req.body;if(!servidor_id||!['ferias','abono'].includes(tipo)||!inicio||!fim||fim<inicio)return res.status(400).json({error:'Dados ou período inválidos.'});const balanceError=validateEventBalance(servidor_id,tipo,inicio,fim);if(balanceError)return res.status(409).json({error:balanceError});const conflicts=eventConflicts(inicio,fim);if(conflicts.length&&!confirmConflict)return res.status(409).json({error:'CONFLICT',conflicts});const x=db.prepare('INSERT INTO eventos(servidor_id,tipo,inicio,fim,alerta_extra,observacoes,created_by) VALUES(?,?,?,?,?,?,?)').run(servidor_id,tipo,inicio,fim,alerta_extra||null,observacoes||null,req.user.id);audit(req.user.id,'CREATE_EVENTO',{id:Number(x.lastInsertRowid),tipo,servidor_id,conflicts:conflicts.map(c=>c.id)},req.ip);res.json({id:Number(x.lastInsertRowid)}); });
app.patch('/api/eventos/:id',auth,(req,res)=>{const {servidor_id,tipo,inicio,fim,alerta_extra,observacoes,confirmConflict}=req.body;if(!servidor_id||!['ferias','abono'].includes(tipo)||!inicio||!fim||fim<inicio)return res.status(400).json({error:'Dados ou período inválidos.'});const current=db.prepare('SELECT id,created_by FROM eventos WHERE id=?').get(req.params.id);if(!current)return res.status(404).json({error:'Registro não encontrado.'});if(current.created_by!==req.user.id)return res.status(403).json({error:'Somente o usuário que criou este registro pode editá-lo.'});const balanceError=validateEventBalance(servidor_id,tipo,inicio,fim,Number(req.params.id));if(balanceError)return res.status(409).json({error:balanceError});const conflicts=eventConflicts(inicio,fim,Number(req.params.id));if(conflicts.length&&!confirmConflict)return res.status(409).json({error:'CONFLICT',conflicts});db.prepare('UPDATE eventos SET servidor_id=?,tipo=?,inicio=?,fim=?,alerta_extra=?,observacoes=? WHERE id=? AND created_by=?').run(servidor_id,tipo,inicio,fim,alerta_extra||null,observacoes||null,req.params.id,req.user.id);db.prepare('DELETE FROM alert_preferences WHERE evento_id=?').run(req.params.id);audit(req.user.id,'UPDATE_EVENTO',{id:Number(req.params.id),tipo,servidor_id,conflicts:conflicts.map(c=>c.id)},req.ip);res.json({ok:true});});
app.delete('/api/eventos/:id',auth,(req,res)=>{const current=db.prepare('SELECT id,created_by FROM eventos WHERE id=?').get(req.params.id);if(!current)return res.status(404).json({error:'Registro não encontrado.'});if(current.created_by!==req.user.id)return res.status(403).json({error:'Somente o usuário que criou este registro pode excluí-lo.'});db.prepare('DELETE FROM eventos WHERE id=? AND created_by=?').run(req.params.id,req.user.id);audit(req.user.id,'DELETE_EVENTO',{id:req.params.id},req.ip);res.json({ok:true});});

// Estrutura organizacional por setores.
app.get('/api/estrutura',auth,(req,res)=>res.json({setores:db.prepare('SELECT * FROM setores ORDER BY nome').all()}));
app.post('/api/setores',auth,(req,res)=>{const nome=String(req.body.nome||'').trim();if(!nome)return res.status(400).json({error:'Informe o nome do setor.'});try{const x=db.prepare('INSERT INTO setores(nome) VALUES(?)').run(nome);audit(req.user.id,'CREATE_SETOR',{id:Number(x.lastInsertRowid),nome},req.ip);res.json({id:Number(x.lastInsertRowid)});}catch{return res.status(409).json({error:'Setor já cadastrado.'});}});
app.patch('/api/setores/:id',auth,(req,res)=>{const nome=String(req.body.nome||'').trim();if(!nome)return res.status(400).json({error:'Informe o nome do setor.'});db.prepare('UPDATE setores SET nome=? WHERE id=?').run(nome,req.params.id);audit(req.user.id,'UPDATE_SETOR',{id:req.params.id,nome},req.ip);res.json({ok:true});});
app.delete('/api/setores/:id',auth,(req,res)=>{db.prepare('UPDATE servidores SET setor_id=NULL,equipe_id=NULL WHERE setor_id=?').run(req.params.id);db.prepare('DELETE FROM equipes WHERE setor_id=?').run(req.params.id);db.prepare('DELETE FROM setores WHERE id=?').run(req.params.id);audit(req.user.id,'DELETE_SETOR',{id:req.params.id},req.ip);res.json({ok:true});});

// Importação em lote de servidores.
app.post('/api/servidores/importar',auth,(req,res)=>{const rows=Array.isArray(req.body.rows)?req.body.rows:[];if(!rows.length)return res.status(400).json({error:'Nenhuma linha válida para importar.'});const insert=db.prepare('INSERT INTO servidores(nome,funcao,email,cpf,matricula,setor_id,equipe_id,ferias_total,abono_total) VALUES(?,?,?,?,?,?,NULL,?,?)');let imported=0,skipped=0;db.exec('BEGIN');try{for(const row of rows.slice(0,1000)){const nome=String(row.nome||'').trim();if(!nome||servidorDuplicates(row).length){skipped++;continue;}insert.run(nome,row.funcao||null,row.email||null,row.cpf||null,row.matricula||null,row.setor_id||null,Number(row.ferias_total)||30,Number(row.abono_total)||5);imported++;}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}audit(req.user.id,'IMPORT_SERVIDORES',{imported,skipped},req.ip);res.json({ok:true,imported,skipped});});

// Histórico individual completo.
app.get('/api/servidores/:id/historico',auth,(req,res)=>{const servidor=db.prepare(`SELECT s.*,st.nome setor_nome FROM servidores s LEFT JOIN setores st ON st.id=s.setor_id WHERE s.id=?`).get(req.params.id);if(!servidor)return res.status(404).json({error:'Servidor não encontrado.'});const eventos=db.prepare(`SELECT e.*,u.username criado_por,(SELECT COUNT(*) FROM anexos a WHERE a.evento_id=e.id) anexos FROM eventos e LEFT JOIN users u ON u.id=e.created_by WHERE e.servidor_id=? ORDER BY e.inicio DESC`).all(req.params.id);res.json({servidor,eventos});});

// Anexos de férias e abonos (até 5 MB por arquivo).
app.get('/api/eventos/:id/anexos',auth,(req,res)=>res.json(db.prepare('SELECT id,evento_id,nome_original,mime_type,tamanho,created_at FROM anexos WHERE evento_id=? ORDER BY id DESC').all(req.params.id)));
app.post('/api/eventos/:id/anexos',auth,(req,res)=>{const evento=db.prepare('SELECT id FROM eventos WHERE id=?').get(req.params.id);if(!evento)return res.status(404).json({error:'Registro não encontrado.'});const match=String(req.body.data||'').match(/^data:([^;]+);base64,(.+)$/);if(!match)return res.status(400).json({error:'Arquivo inválido.'});const buffer=Buffer.from(match[2],'base64');if(buffer.length>5*1024*1024)return res.status(413).json({error:'O arquivo deve ter no máximo 5 MB.'});const safeName=String(req.body.nome||'arquivo').replace(/[^a-zA-Z0-9._-]/g,'_');const stored=`${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName}`;fs.writeFileSync(path.join(uploadsDir,stored),buffer);const x=db.prepare('INSERT INTO anexos(evento_id,nome_original,nome_arquivo,mime_type,tamanho,uploaded_by) VALUES(?,?,?,?,?,?)').run(evento.id,String(req.body.nome||'arquivo'),stored,match[1],buffer.length,req.user.id);audit(req.user.id,'UPLOAD_ANEXO',{evento_id:evento.id,anexo_id:Number(x.lastInsertRowid)},req.ip);res.json({id:Number(x.lastInsertRowid)});});
app.get('/api/anexos/:id/download',auth,(req,res)=>{const a=db.prepare('SELECT * FROM anexos WHERE id=?').get(req.params.id);if(!a)return res.status(404).send('Arquivo não encontrado.');res.download(path.join(uploadsDir,a.nome_arquivo),a.nome_original);});
app.delete('/api/anexos/:id',auth,(req,res)=>{const a=db.prepare('SELECT * FROM anexos WHERE id=?').get(req.params.id);if(!a)return res.status(404).json({error:'Anexo não encontrado.'});try{fs.rmSync(path.join(uploadsDir,a.nome_arquivo),{force:true});}catch{}db.prepare('DELETE FROM anexos WHERE id=?').run(a.id);audit(req.user.id,'DELETE_ANEXO',{anexo_id:a.id,evento_id:a.evento_id},req.ip);res.json({ok:true});});

// Indicadores gerenciais e monitoramento do backup.
app.get('/api/relatorios/resumo',auth,(req,res)=>{const porMes=db.prepare(`SELECT substr(inicio,1,7) mes,tipo,COUNT(*) quantidade,SUM(julianday(fim)-julianday(inicio)+1) dias FROM eventos GROUP BY mes,tipo ORDER BY mes DESC LIMIT 24`).all();const porSetor=db.prepare(`SELECT COALESCE(st.nome,'Sem setor') setor,COUNT(DISTINCT s.id) servidores,COUNT(e.id) registros FROM servidores s LEFT JOIN setores st ON st.id=s.setor_id LEFT JOIN eventos e ON e.servidor_id=s.id GROUP BY st.id ORDER BY setor`).all();const ativos=db.prepare(`SELECT tipo,COUNT(*) quantidade FROM eventos WHERE date(fim)>=date('now') GROUP BY tipo`).all();res.json({porMes,porSetor,ativos,totalServidores:db.prepare('SELECT COUNT(*) total FROM servidores').get().total});});
app.get('/api/backup/status',auth,(req,res)=>{const destination=process.env.BACKUP_DIR||'S:\\ATUACAO MEIO\\Divisao de Apoio Administrativo\\Felippe.andreata\\Backup_gerenciador_ferias';try{const files=fs.readdirSync(destination).filter(n=>/^gestao-ferias-abonos_\d{4}-\d{2}-\d{2}\.db$/i.test(n)).map(n=>({name:n,path:path.join(destination,n)})).sort((a,b)=>fs.statSync(b.path).mtimeMs-fs.statSync(a.path).mtimeMs);const latest=files[0];res.json({ok:!!latest,destination,latest:latest?{name:latest.name,size:fs.statSync(latest.path).size,modified:fs.statSync(latest.path).mtime}:null,message:latest?'Backup localizado.':'Nenhum backup localizado.'});}catch(error){res.json({ok:false,destination,latest:null,message:'Destino indisponível: '+error.message});}});

app.get('/api/admin/users',auth,master,(req,res)=>res.json(db.prepare('SELECT id,username,email,cpf,matricula,role,active,created_at FROM users ORDER BY username').all()));
app.post('/api/admin/users',auth,master,(req,res)=>{const {username,email,cpf,matricula,password}=req.body;if(!username?.trim()||!password||password.length<8)return res.status(400).json({error:'Informe usuário e senha com ao menos 8 caracteres.'});try{const role='admin';const x=db.prepare('INSERT INTO users(username,email,cpf,matricula,password_hash,role,active) VALUES(?,?,?,?,?,?,1)').run(username.trim(),email?.trim()||null,cpf?.trim()||null,matricula?.trim()||null,hashPassword(password),role);audit(req.user.id,'ADMIN_CREATE_USER',{target:Number(x.lastInsertRowid),username:username.trim(),role},req.ip);res.json({id:Number(x.lastInsertRowid)});}catch{res.status(409).json({error:'Usuário, e-mail, CPF ou matrícula já cadastrado.'});}});
app.patch('/api/admin/users/:id',auth,master,(req,res)=>{const {username,email,cpf,matricula,role,active,password}=req.body;const old=db.prepare('SELECT role FROM users WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'Usuário não encontrado.'});if(!String(username||'').trim())return res.status(400).json({error:'Informe o nome do usuário.'});if(!['master','admin'].includes(role))return res.status(400).json({error:'Perfil inválido. Use apenas Master ou Administrador.'});const isActive=active===true||active===1||active==='1';if(old.role==='master'&&!isActive)return res.status(400).json({error:'Não desative a conta master.'});try{db.prepare('UPDATE users SET username=?,email=?,cpf=?,matricula=?,role=?,active=?,password_hash=COALESCE(?,password_hash) WHERE id=?').run(String(username).trim(),String(email||'').trim()||null,String(cpf||'').trim()||null,String(matricula||'').trim()||null,role,isActive?1:0,password?hashPassword(password):null,req.params.id);audit(req.user.id,'ADMIN_UPDATE_USER',{target:req.params.id,role},req.ip);res.json({ok:true});}catch(error){if(String(error.message).includes('UNIQUE'))return res.status(409).json({error:'Usuário, e-mail, CPF ou matrícula já está em uso.'});console.error('Erro ao editar usuário:',error);res.status(500).json({error:'Não foi possível atualizar o usuário.'});}});
app.delete('/api/admin/users/:id',auth,master,(req,res)=>{ if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'Não é possível excluir sua própria conta master.'});db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);audit(req.user.id,'ADMIN_DELETE_USER',{target:req.params.id},req.ip);res.json({ok:true}); });
app.post('/api/admin/impersonate/:id',auth,master,(req,res)=>{ const target=db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(req.params.id);if(!target)return res.status(404).json({error:'Usuário não encontrado.'});if(target.id===req.user.id)return res.status(400).json({error:'Você já está nesta conta.'});const token=crypto.randomBytes(32).toString('hex');const tokenHash=digest(token);db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash,target.id,iso(Date.now()+60*60*1000));db.prepare('INSERT INTO impersonations(session_token_hash,master_user_id) VALUES(?,?)').run(tokenHash,req.user.id);audit(req.user.id,'IMPERSONATE',{target:target.id},req.ip);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);res.json({ok:true}); });
app.post('/api/admin/restore-master',auth,(req,res)=>{const oldHash=digest(cookies(req).session);const link=db.prepare(`SELECT i.master_user_id FROM impersonations i JOIN users u ON u.id=i.master_user_id WHERE i.session_token_hash=? AND u.role='master' AND u.active=1`).get(oldHash);if(!link)return res.status(403).json({error:'Esta sessão não está acessando outro usuário.'});const token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),link.master_user_id,iso(Date.now()+12*60*60*1000));db.prepare('DELETE FROM impersonations WHERE session_token_hash=?').run(oldHash);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(oldHash);audit(link.master_user_id,'RESTORE_MASTER',{},req.ip);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);res.json({ok:true});});
app.get('/api/admin/audit',auth,auditMaster,(req,res)=>res.json(db.prepare('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all()));
app.get('/api/audit',auth,auditMaster,(req,res)=>res.json(db.prepare('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all()));
app.get('/api/audit/access',auth,auditOwner,(req,res)=>res.json(db.prepare('SELECT id,username,email,role,active,audit_access FROM users WHERE id<>? ORDER BY username').all(req.user.id)));
app.patch('/api/audit/access/:id',auth,auditOwner,(req,res)=>{
  const target=db.prepare('SELECT id,username,email FROM users WHERE id=?').get(req.params.id);
  if(!target) return res.status(404).json({error:'Usuário não encontrado.'});
  if(String(target.email||'').trim().toLowerCase()===masterEmail.trim().toLowerCase()) return res.status(400).json({error:'O acesso do master principal é permanente.'});
  const enabled=req.body.enabled===true;
  db.prepare('UPDATE users SET audit_access=? WHERE id=?').run(enabled?1:0,target.id);
  audit(req.user.id,enabled?'GRANT_AUDIT_ACCESS':'REVOKE_AUDIT_ACCESS',{target:target.id,username:target.username},req.ip);
  res.json({ok:true,audit_access:enabled});
});

async function sendUpcomingNotifications(){
  if(!process.env.SMTP_APP_PASSWORD)return;
  const today=new Date().toISOString().slice(0,10);
  const rows=db.prepare(`SELECT e.id,e.tipo,e.inicio,e.fim,s.nome servidor_nome,s.email servidor_email,u.email usuario_email
    FROM eventos e JOIN servidores s ON s.id=e.servidor_id LEFT JOIN users u ON u.id=e.created_by
    WHERE date(e.inicio) BETWEEN date('now') AND date('now','+7 day')`).all();
  const tx=nodemailer.createTransport({service:'gmail',auth:{user:process.env.SMTP_USER||masterEmail,pass:process.env.SMTP_APP_PASSWORD}});
  for(const row of rows){
    const recipients=[row.usuario_email,row.servidor_email].filter(Boolean);
    for(const recipient of [...new Set(recipients)]){
      if(db.prepare('SELECT 1 FROM notification_log WHERE evento_id=? AND recipient=? AND notification_date=?').get(row.id,recipient,today))continue;
      try{await tx.sendMail({from:process.env.SMTP_USER||masterEmail,to:recipient,subject:`Lembrete de ${row.tipo==='ferias'?'férias':'abono'} — ${row.servidor_nome}`,text:`O período de ${row.tipo==='ferias'?'férias':'abono'} de ${row.servidor_nome} está programado para ${row.inicio} a ${row.fim}.`});db.prepare('INSERT INTO notification_log(evento_id,recipient,notification_date) VALUES(?,?,?)').run(row.id,recipient,today);}catch(error){console.error('Falha ao enviar notificação:',error.message);}
    }
  }
}
setTimeout(()=>sendUpcomingNotifications().catch(console.error),15000);
setInterval(()=>sendUpcomingNotifications().catch(console.error),60*60*1000);

app.listen(PORT,'0.0.0.0',()=>{
  const ips=[]; for(const list of Object.values(os.networkInterfaces())) for(const n of list||[]) if(n.family==='IPv4'&&!n.internal) ips.push(n.address);
  console.log(`Sistema aberto neste computador: http://localhost:${PORT}`);
  console.log(`Banco de dados gravável: ${databasePath}`);
  ips.forEach(ip=>console.log(`Acesso na rede: http://${ip}:${PORT}`));
});
