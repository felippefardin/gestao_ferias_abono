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
`);
// Migrações leves para instalações existentes.
const servidorColumns = db.prepare('PRAGMA table_info(servidores)').all().map(column => column.name);
if (!servidorColumns.includes('email')) db.exec('ALTER TABLE servidores ADD COLUMN email TEXT');
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
app.use(express.json({ limit: '1mb' }));
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
  const user = db.prepare(`SELECT u.id,u.username,u.email,u.cpf,u.matricula,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.active=1`).get(digest(token));
  if (!user) return res.status(401).json({ error: 'Sessão expirada.' });
  req.user = user; next();
}
function master(req,res,next){ if(req.user.role!=='master') return res.status(403).json({error:'Acesso exclusivo do master.'}); next(); }

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
app.post('/api/logout', auth, (req,res)=>{ const t=cookies(req).session; db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(t)); audit(req.user.id,'LOGOUT',{},req.ip); res.setHeader('Set-Cookie','session=; HttpOnly; Path=/; Max-Age=0'); res.json({ok:true}); });
app.get('/api/me',auth,(req,res)=>{
  const tokenHash=digest(cookies(req).session);
  res.json({...req.user,is_impersonated:!!db.prepare('SELECT 1 FROM impersonations WHERE session_token_hash=?').get(tokenHash)});
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
app.get('/api/servidores',auth,(req,res)=>res.json(db.prepare('SELECT * FROM servidores ORDER BY nome').all()));
app.post('/api/servidores',auth,(req,res)=>{ const {nome,funcao,email,cpf,matricula,confirmDuplicate}=req.body;if(!nome?.trim())return res.status(400).json({error:'Nome é obrigatório.'});const duplicates=servidorDuplicates(req.body);if(duplicates.length&&!confirmDuplicate)return res.status(409).json({error:'DUPLICATE',duplicates}); const x=db.prepare('INSERT INTO servidores(nome,funcao,email,cpf,matricula) VALUES(?,?,?,?,?)').run(nome.trim(),funcao||null,email?.trim()||null,cpf||null,matricula||null);audit(req.user.id,'CREATE_SERVIDOR',{id:Number(x.lastInsertRowid),nome,duplicates:duplicates.map(d=>d.servidor_id)},req.ip);res.json({id:Number(x.lastInsertRowid)}); });
app.patch('/api/servidores/:id',auth,(req,res)=>{ const {nome,funcao,email,cpf,matricula,confirmDuplicate}=req.body;if(!nome?.trim())return res.status(400).json({error:'Nome é obrigatório.'});const duplicates=servidorDuplicates(req.body,Number(req.params.id));if(duplicates.length&&!confirmDuplicate)return res.status(409).json({error:'DUPLICATE',duplicates});db.prepare('UPDATE servidores SET nome=?,funcao=?,email=?,cpf=?,matricula=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nome.trim(),funcao||null,email?.trim()||null,cpf||null,matricula||null,req.params.id);audit(req.user.id,'UPDATE_SERVIDOR',{id:req.params.id,duplicates:duplicates.map(d=>d.servidor_id)},req.ip);res.json({ok:true}); });
app.delete('/api/servidores/:id',auth,(req,res)=>{ try{db.prepare('DELETE FROM servidores WHERE id=?').run(req.params.id);audit(req.user.id,'DELETE_SERVIDOR',{id:req.params.id},req.ip);res.json({ok:true});}catch{res.status(409).json({error:'Este servidor possui registros. Mantenha-o para preservar o histórico.'});} });

app.get('/api/eventos',auth,(req,res)=>{ const archived=req.query.archived==='1'; const op=archived?'<':'>='; res.json(db.prepare(`SELECT e.*,s.nome servidor_nome,u.username criado_por, CASE WHEN e.created_by=? THEN 1 ELSE 0 END pode_editar, CAST(julianday('now')-julianday(e.fim) AS INTEGER) dias_arquivado FROM eventos e JOIN servidores s ON s.id=e.servidor_id LEFT JOIN users u ON u.id=e.created_by WHERE date(e.fim) ${op} date('now') ORDER BY e.inicio`).all(req.user.id)); });
app.get('/api/alertas',auth,(req,res)=>res.json(db.prepare(`SELECT e.*,s.nome servidor_nome,CASE WHEN p.read_at IS NULL THEN 0 ELSE 1 END lido,CAST(julianday(e.inicio)-julianday('now') AS INTEGER) dias FROM eventos e JOIN servidores s ON s.id=e.servidor_id LEFT JOIN alert_preferences p ON p.evento_id=e.id AND p.user_id=? WHERE e.created_by=? AND COALESCE(p.stopped,0)=0 AND date(e.fim)>=date('now') AND ((date(e.inicio) BETWEEN date('now') AND date('now','+20 day')) OR date(e.alerta_extra)>=date('now')) ORDER BY lido,COALESCE(e.alerta_extra,e.inicio),e.inicio`).all(req.user.id,req.user.id)));
app.post('/api/alertas/:id/responder',auth,(req,res)=>{const acao=req.body.acao;if(!['manter','parar'].includes(acao))return res.status(400).json({error:'Resposta de alerta inválida.'});const evento=db.prepare('SELECT id FROM eventos WHERE id=?').get(req.params.id);if(!evento)return res.status(404).json({error:'Registro não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET stopped=excluded.stopped,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id,acao==='parar'?1:0);audit(req.user.id,acao==='parar'?'STOP_ALERT':'KEEP_ALERT',{evento_id:evento.id},req.ip);res.json({ok:true});});
app.post('/api/alertas/:id/lido',auth,(req,res)=>{const evento=db.prepare('SELECT id FROM eventos WHERE id=? AND created_by=?').get(req.params.id,req.user.id);if(!evento)return res.status(404).json({error:'Alerta não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,read_at,updated_at) VALUES(?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id);res.json({ok:true});});
app.post('/api/alertas/ler-todos',auth,(req,res)=>{const ids=db.prepare(`SELECT e.id FROM eventos e WHERE e.created_by=? AND date(e.fim)>=date('now') AND ((date(e.inicio) BETWEEN date('now') AND date('now','+20 day')) OR date(e.alerta_extra)>=date('now'))`).all(req.user.id);const save=db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,read_at,updated_at) VALUES(?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`);db.exec('BEGIN');try{ids.forEach(({id})=>save.run(id,req.user.id));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}res.json({ok:true});});
app.delete('/api/alertas/:id',auth,(req,res)=>{const evento=db.prepare('SELECT id FROM eventos WHERE id=? AND created_by=?').get(req.params.id,req.user.id);if(!evento)return res.status(404).json({error:'Alerta não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,updated_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET stopped=1,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id);audit(req.user.id,'DELETE_ALERT',{evento_id:evento.id},req.ip);res.json({ok:true});});
function eventConflicts(inicio,fim,excludeId=null){return db.prepare(`SELECT e.id,s.nome servidor_nome,e.tipo,e.inicio,e.fim FROM eventos e JOIN servidores s ON s.id=e.servidor_id WHERE date(e.inicio)<=date(?) AND date(e.fim)>=date(?) AND (? IS NULL OR e.id<>?) ORDER BY e.inicio`).all(fim,inicio,excludeId,excludeId);}
app.post('/api/eventos/check',auth,(req,res)=>res.json(eventConflicts(req.body.inicio,req.body.fim,req.body.id||null)));
app.post('/api/eventos',auth,(req,res)=>{ const {servidor_id,tipo,inicio,fim,alerta_extra,observacoes,confirmConflict}=req.body;if(!servidor_id||!['ferias','abono'].includes(tipo)||!inicio||!fim||fim<inicio)return res.status(400).json({error:'Dados ou período inválidos.'});const conflicts=eventConflicts(inicio,fim);if(conflicts.length&&!confirmConflict)return res.status(409).json({error:'CONFLICT',conflicts});const x=db.prepare('INSERT INTO eventos(servidor_id,tipo,inicio,fim,alerta_extra,observacoes,created_by) VALUES(?,?,?,?,?,?,?)').run(servidor_id,tipo,inicio,fim,alerta_extra||null,observacoes||null,req.user.id);audit(req.user.id,'CREATE_EVENTO',{id:Number(x.lastInsertRowid),tipo,servidor_id,conflicts:conflicts.map(c=>c.id)},req.ip);res.json({id:Number(x.lastInsertRowid)}); });
app.patch('/api/eventos/:id',auth,(req,res)=>{const {servidor_id,tipo,inicio,fim,alerta_extra,observacoes,confirmConflict}=req.body;if(!servidor_id||!['ferias','abono'].includes(tipo)||!inicio||!fim||fim<inicio)return res.status(400).json({error:'Dados ou período inválidos.'});const current=db.prepare('SELECT id,created_by FROM eventos WHERE id=?').get(req.params.id);if(!current)return res.status(404).json({error:'Registro não encontrado.'});if(current.created_by!==req.user.id)return res.status(403).json({error:'Somente o usuário que criou este registro pode editá-lo.'});const conflicts=eventConflicts(inicio,fim,Number(req.params.id));if(conflicts.length&&!confirmConflict)return res.status(409).json({error:'CONFLICT',conflicts});db.prepare('UPDATE eventos SET servidor_id=?,tipo=?,inicio=?,fim=?,alerta_extra=?,observacoes=? WHERE id=? AND created_by=?').run(servidor_id,tipo,inicio,fim,alerta_extra||null,observacoes||null,req.params.id,req.user.id);db.prepare('DELETE FROM alert_preferences WHERE evento_id=?').run(req.params.id);audit(req.user.id,'UPDATE_EVENTO',{id:Number(req.params.id),tipo,servidor_id,conflicts:conflicts.map(c=>c.id)},req.ip);res.json({ok:true});});
app.delete('/api/eventos/:id',auth,(req,res)=>{const current=db.prepare('SELECT id,created_by FROM eventos WHERE id=?').get(req.params.id);if(!current)return res.status(404).json({error:'Registro não encontrado.'});if(current.created_by!==req.user.id)return res.status(403).json({error:'Somente o usuário que criou este registro pode excluí-lo.'});db.prepare('DELETE FROM eventos WHERE id=? AND created_by=?').run(req.params.id,req.user.id);audit(req.user.id,'DELETE_EVENTO',{id:req.params.id},req.ip);res.json({ok:true});});

app.get('/api/admin/users',auth,master,(req,res)=>res.json(db.prepare('SELECT id,username,email,cpf,matricula,role,active,created_at FROM users ORDER BY username').all()));
app.post('/api/admin/users',auth,master,(req,res)=>{const {username,email,cpf,matricula,password,role}=req.body;if(!username?.trim()||!password||password.length<8||!['admin','master'].includes(role))return res.status(400).json({error:'Informe usuário, perfil e senha com ao menos 8 caracteres.'});try{const x=db.prepare('INSERT INTO users(username,email,cpf,matricula,password_hash,role,active) VALUES(?,?,?,?,?,?,1)').run(username.trim(),email?.trim()||null,cpf?.trim()||null,matricula?.trim()||null,hashPassword(password),role);audit(req.user.id,'ADMIN_CREATE_USER',{target:Number(x.lastInsertRowid),username:username.trim(),role},req.ip);res.json({id:Number(x.lastInsertRowid)});}catch{res.status(409).json({error:'Usuário, e-mail, CPF ou matrícula já cadastrado.'});}});
app.patch('/api/admin/users/:id',auth,master,(req,res)=>{ const {username,email,cpf,matricula,role,active,password}=req.body; const old=db.prepare('SELECT role FROM users WHERE id=?').get(req.params.id); if(old?.role==='master'&&Number(active)===0)return res.status(400).json({error:'Não desative a conta master.'});db.prepare('UPDATE users SET username=?,email=?,cpf=?,matricula=?,role=?,active=?,password_hash=COALESCE(?,password_hash) WHERE id=?').run(username,email||null,cpf||null,matricula||null,role,active?1:0,password?hashPassword(password):null,req.params.id);audit(req.user.id,'ADMIN_UPDATE_USER',{target:req.params.id},req.ip);res.json({ok:true}); });
app.delete('/api/admin/users/:id',auth,master,(req,res)=>{ if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'Não é possível excluir sua própria conta master.'});db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);audit(req.user.id,'ADMIN_DELETE_USER',{target:req.params.id},req.ip);res.json({ok:true}); });
app.post('/api/admin/impersonate/:id',auth,master,(req,res)=>{ const target=db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(req.params.id);if(!target)return res.status(404).json({error:'Usuário não encontrado.'});if(target.id===req.user.id)return res.status(400).json({error:'Você já está nesta conta.'});const token=crypto.randomBytes(32).toString('hex');const tokenHash=digest(token);db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash,target.id,iso(Date.now()+60*60*1000));db.prepare('INSERT INTO impersonations(session_token_hash,master_user_id) VALUES(?,?)').run(tokenHash,req.user.id);audit(req.user.id,'IMPERSONATE',{target:target.id},req.ip);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);res.json({ok:true}); });
app.post('/api/admin/restore-master',auth,(req,res)=>{const oldHash=digest(cookies(req).session);const link=db.prepare(`SELECT i.master_user_id FROM impersonations i JOIN users u ON u.id=i.master_user_id WHERE i.session_token_hash=? AND u.role='master' AND u.active=1`).get(oldHash);if(!link)return res.status(403).json({error:'Esta sessão não está acessando outro usuário.'});const token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),link.master_user_id,iso(Date.now()+12*60*60*1000));db.prepare('DELETE FROM impersonations WHERE session_token_hash=?').run(oldHash);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(oldHash);audit(link.master_user_id,'RESTORE_MASTER',{},req.ip);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);res.json({ok:true});});
app.get('/api/admin/audit',auth,master,(req,res)=>res.json(db.prepare('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all()));
app.get('/api/audit',auth,(req,res)=>res.json(db.prepare('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all()));

app.listen(PORT,'0.0.0.0',()=>{
  const ips=[]; for(const list of Object.values(os.networkInterfaces())) for(const n of list||[]) if(n.family==='IPv4'&&!n.internal) ips.push(n.address);
  console.log(`Sistema aberto neste computador: http://localhost:${PORT}`);
  console.log(`Banco de dados gravável: ${databasePath}`);
  ips.forEach(ip=>console.log(`Acesso na rede: http://${ip}:${PORT}`));
});
