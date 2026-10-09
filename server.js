require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
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
`);

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
function audit(userId, action, details, ip) {
  db.prepare('INSERT INTO audit(user_id,action,details,ip) VALUES(?,?,?,?)').run(userId || null, action, JSON.stringify(details || {}), ip || '');
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

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
app.get('/api/me',auth,(req,res)=>res.json(req.user));
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

app.get('/api/servidores',auth,(req,res)=>res.json(db.prepare('SELECT * FROM servidores ORDER BY nome').all()));
app.post('/api/servidores',auth,(req,res)=>{ const {nome,funcao,cpf,matricula}=req.body;if(!nome?.trim())return res.status(400).json({error:'Nome é obrigatório.'}); const x=db.prepare('INSERT INTO servidores(nome,funcao,cpf,matricula) VALUES(?,?,?,?)').run(nome.trim(),funcao||null,cpf||null,matricula||null);audit(req.user.id,'CREATE_SERVIDOR',{id:Number(x.lastInsertRowid),nome},req.ip);res.json({id:Number(x.lastInsertRowid)}); });
app.patch('/api/servidores/:id',auth,(req,res)=>{ const {nome,funcao,cpf,matricula}=req.body;if(!nome?.trim())return res.status(400).json({error:'Nome é obrigatório.'});db.prepare('UPDATE servidores SET nome=?,funcao=?,cpf=?,matricula=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nome.trim(),funcao||null,cpf||null,matricula||null,req.params.id);audit(req.user.id,'UPDATE_SERVIDOR',{id:req.params.id},req.ip);res.json({ok:true}); });
app.delete('/api/servidores/:id',auth,(req,res)=>{ try{db.prepare('DELETE FROM servidores WHERE id=?').run(req.params.id);audit(req.user.id,'DELETE_SERVIDOR',{id:req.params.id},req.ip);res.json({ok:true});}catch{res.status(409).json({error:'Este servidor possui registros. Mantenha-o para preservar o histórico.'});} });

app.get('/api/eventos',auth,(req,res)=>{ const archived=req.query.archived==='1'; const op=archived?'<':'>='; res.json(db.prepare(`SELECT e.*,s.nome servidor_nome, CAST(julianday('now')-julianday(e.fim) AS INTEGER) dias_arquivado FROM eventos e JOIN servidores s ON s.id=e.servidor_id WHERE date(e.fim) ${op} date('now') ORDER BY e.inicio`).all()); });
app.get('/api/alertas',auth,(req,res)=>res.json(db.prepare(`SELECT e.*,s.nome servidor_nome, CAST(julianday(e.inicio)-julianday('now') AS INTEGER) dias FROM eventos e JOIN servidores s ON s.id=e.servidor_id WHERE date(e.fim)>=date('now') AND ((date(e.inicio) BETWEEN date('now') AND date('now','+20 day')) OR date(e.alerta_extra)=date('now')) ORDER BY e.inicio`).all()));
app.post('/api/eventos/check',auth,(req,res)=>{ const {inicio,fim}=req.body; const rows=db.prepare(`SELECT e.*,s.nome servidor_nome FROM eventos e JOIN servidores s ON s.id=e.servidor_id WHERE date(e.inicio)<=date(?) AND date(e.fim)>=date(?)`).all(fim,inicio);res.json(rows); });
app.post('/api/eventos',auth,(req,res)=>{ const {servidor_id,tipo,inicio,fim,alerta_extra,observacoes,confirmConflict}=req.body;if(!servidor_id||!['ferias','abono'].includes(tipo)||!inicio||!fim||fim<inicio)return res.status(400).json({error:'Dados ou período inválidos.'});const conflicts=db.prepare(`SELECT e.id,s.nome servidor_nome,e.tipo,e.inicio,e.fim FROM eventos e JOIN servidores s ON s.id=e.servidor_id WHERE date(e.inicio)<=date(?) AND date(e.fim)>=date(?)`).all(fim,inicio);if(conflicts.length&&!confirmConflict)return res.status(409).json({error:'CONFLICT',conflicts});const x=db.prepare('INSERT INTO eventos(servidor_id,tipo,inicio,fim,alerta_extra,observacoes,created_by) VALUES(?,?,?,?,?,?,?)').run(servidor_id,tipo,inicio,fim,alerta_extra||null,observacoes||null,req.user.id);audit(req.user.id,'CREATE_EVENTO',{id:Number(x.lastInsertRowid),tipo,servidor_id,conflicts:conflicts.map(c=>c.id)},req.ip);res.json({id:Number(x.lastInsertRowid)}); });
app.delete('/api/eventos/:id',auth,(req,res)=>{db.prepare('DELETE FROM eventos WHERE id=?').run(req.params.id);audit(req.user.id,'DELETE_EVENTO',{id:req.params.id},req.ip);res.json({ok:true});});

app.get('/api/admin/users',auth,master,(req,res)=>res.json(db.prepare('SELECT id,username,email,cpf,matricula,role,active,created_at FROM users ORDER BY username').all()));
app.patch('/api/admin/users/:id',auth,master,(req,res)=>{ const {username,email,cpf,matricula,role,active,password}=req.body; const old=db.prepare('SELECT role FROM users WHERE id=?').get(req.params.id); if(old?.role==='master'&&Number(active)===0)return res.status(400).json({error:'Não desative a conta master.'});db.prepare('UPDATE users SET username=?,email=?,cpf=?,matricula=?,role=?,active=?,password_hash=COALESCE(?,password_hash) WHERE id=?').run(username,email||null,cpf||null,matricula||null,role,active?1:0,password?hashPassword(password):null,req.params.id);audit(req.user.id,'ADMIN_UPDATE_USER',{target:req.params.id},req.ip);res.json({ok:true}); });
app.delete('/api/admin/users/:id',auth,master,(req,res)=>{ if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'Não é possível excluir sua própria conta master.'});db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);audit(req.user.id,'ADMIN_DELETE_USER',{target:req.params.id},req.ip);res.json({ok:true}); });
app.post('/api/admin/impersonate/:id',auth,master,(req,res)=>{ const target=db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(req.params.id);if(!target)return res.status(404).json({error:'Usuário não encontrado.'});const token=crypto.randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token),target.id,iso(Date.now()+60*60*1000));audit(req.user.id,'IMPERSONATE',{target:target.id},req.ip);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);res.json({ok:true}); });
app.get('/api/admin/audit',auth,master,(req,res)=>res.json(db.prepare('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500').all()));

app.listen(PORT,'0.0.0.0',()=>{
  const ips=[]; for(const list of Object.values(os.networkInterfaces())) for(const n of list||[]) if(n.family==='IPv4'&&!n.internal) ips.push(n.address);
  console.log(`Sistema aberto neste computador: http://localhost:${PORT}`);
  console.log(`Banco de dados gravável: ${databasePath}`);
  ips.forEach(ip=>console.log(`Acesso na rede: http://${ip}:${PORT}`));
});
