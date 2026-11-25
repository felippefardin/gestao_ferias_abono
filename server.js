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
const restorePendingPath = path.join(dataDir, 'restore-pending.db');
const restoreSafetyDir = path.join(dataDir, 'restore-safety');
const backupDestination = process.env.BACKUP_DIR||'S:\\ATUACAO MEIO\\Divisao de Apoio Administrativo\\Felippe.andreata\\Backup_gerenciador_ferias';
const legacyDatabasePath = path.join(__dirname, 'data', 'gestao.db');
if (!fs.existsSync(databasePath) && databasePath !== legacyDatabasePath && fs.existsSync(legacyDatabasePath)) {
  fs.copyFileSync(legacyDatabasePath, databasePath);
  console.log(`Banco anterior transferido para: ${databasePath}`);
}
if(fs.existsSync(restorePendingPath)){
  let candidate;
  try{
    candidate=new DatabaseSync(restorePendingPath,{readOnly:true});
    const integrity=candidate.prepare('PRAGMA integrity_check').get();
    candidate.close();candidate=null;
    if(String(integrity.integrity_check).toLowerCase()!=='ok')throw new Error('Falha na verificação de integridade.');
    fs.mkdirSync(restoreSafetyDir,{recursive:true});
    if(fs.existsSync(databasePath))fs.copyFileSync(databasePath,path.join(restoreSafetyDir,`antes-restauracao-${new Date().toISOString().replace(/[:.]/g,'-')}.db`));
    fs.copyFileSync(restorePendingPath,databasePath);
    fs.rmSync(restorePendingPath,{force:true});
    console.log('Restauração pendente aplicada com sucesso.');
  }catch(error){try{candidate?.close();}catch{}console.error('Restauração pendente não aplicada:',error.message);}
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
db.exec(`
CREATE TABLE IF NOT EXISTS lembretes (
 id INTEGER PRIMARY KEY, servidor_id INTEGER NOT NULL REFERENCES servidores(id),
 titulo TEXT NOT NULL, data TEXT NOT NULL, observacoes TEXT, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 parado_em TEXT, exibido_no_dia TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS servidor_movimentos (
 id INTEGER PRIMARY KEY, servidor_id INTEGER NOT NULL REFERENCES servidores(id),
 acao TEXT NOT NULL, detalhes TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lembrete_sessoes (
 token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
 processado INTEGER NOT NULL DEFAULT 0
);
`);
function movimento(servidorId,acao,detalhes,userId=null){
 db.prepare('INSERT INTO servidor_movimentos(servidor_id,acao,detalhes,user_id) VALUES(?,?,?,?)').run(servidorId,acao,JSON.stringify(detalhes),userId);
}
// Migrações leves para instalações existentes.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('audit_access')) db.exec('ALTER TABLE users ADD COLUMN audit_access INTEGER NOT NULL DEFAULT 0');
const servidorColumns = db.prepare('PRAGMA table_info(servidores)').all().map(column => column.name);
if (!servidorColumns.includes('email')) db.exec('ALTER TABLE servidores ADD COLUMN email TEXT');
if (!servidorColumns.includes('setor_id')) db.exec('ALTER TABLE servidores ADD COLUMN setor_id INTEGER REFERENCES setores(id)');
if (!servidorColumns.includes('equipe_id')) db.exec('ALTER TABLE servidores ADD COLUMN equipe_id INTEGER REFERENCES equipes(id)');
if (!servidorColumns.includes('ferias_total')) db.exec('ALTER TABLE servidores ADD COLUMN ferias_total INTEGER NOT NULL DEFAULT 30');
if (!servidorColumns.includes('abono_total')) db.exec('ALTER TABLE servidores ADD COLUMN abono_total INTEGER NOT NULL DEFAULT 6');
if (!servidorColumns.includes('archived_at')) db.exec('ALTER TABLE servidores ADD COLUMN archived_at TEXT');
const eventoColumns = db.prepare('PRAGMA table_info(eventos)').all().map(column => column.name);
if (!eventoColumns.includes('periodo_aquisitivo')) db.exec('ALTER TABLE eventos ADD COLUMN periodo_aquisitivo TEXT');
// Registros antigos sem autoria verificável ficam sob administração do master.
for (const table of ['servidores','setores']) {
 const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
 if(!columns.includes('created_by')) db.exec(`ALTER TABLE ${table} ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
}
// Recupera autoria apenas quando a auditoria identifica inequivocamente o cadastro.
for (const [table,action] of [['servidores','CREATE_SERVIDOR'],['setores','CREATE_SETOR']]) {
 db.prepare(`UPDATE ${table} SET created_by=(SELECT a.user_id FROM audit a JOIN users u ON u.id=a.user_id WHERE a.action=? AND json_valid(a.details) AND CAST(json_extract(a.details,'$.id') AS INTEGER)=${table}.id ORDER BY a.id LIMIT 1) WHERE created_by IS NULL`).run(action);
}
const preferenceColumns = db.prepare('PRAGMA table_info(alert_preferences)').all().map(column => column.name);
if (!preferenceColumns.includes('read_at')) db.exec('ALTER TABLE alert_preferences ADD COLUMN read_at TEXT');

// Triggers preservam o histórico inclusive em importações e exclusões de períodos.
db.exec(`
CREATE TRIGGER IF NOT EXISTS movimento_servidor_criado AFTER INSERT ON servidores BEGIN
 INSERT INTO servidor_movimentos(servidor_id,acao,detalhes) VALUES(NEW.id,'Cadastro criado',json_object('nome',NEW.nome)); END;
CREATE TRIGGER IF NOT EXISTS movimento_servidor_editado AFTER UPDATE ON servidores BEGIN
 INSERT INTO servidor_movimentos(servidor_id,acao,detalhes) VALUES(NEW.id,'Cadastro atualizado',json_object('antes',json_object('nome',OLD.nome,'funcao',OLD.funcao,'email',OLD.email,'cpf',OLD.cpf,'matricula',OLD.matricula,'setor_id',OLD.setor_id,'ferias_total',OLD.ferias_total,'abono_total',OLD.abono_total),'depois',json_object('nome',NEW.nome,'funcao',NEW.funcao,'email',NEW.email,'cpf',NEW.cpf,'matricula',NEW.matricula,'setor_id',NEW.setor_id,'ferias_total',NEW.ferias_total,'abono_total',NEW.abono_total))); END;
CREATE TRIGGER IF NOT EXISTS movimento_evento_criado AFTER INSERT ON eventos BEGIN
 INSERT INTO servidor_movimentos(servidor_id,acao,detalhes,user_id) VALUES(NEW.servidor_id,'Período criado',json_object('tipo',NEW.tipo,'inicio',NEW.inicio,'fim',NEW.fim,'observacoes',NEW.observacoes),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS movimento_evento_editado AFTER UPDATE ON eventos BEGIN
 INSERT INTO servidor_movimentos(servidor_id,acao,detalhes,user_id) VALUES(NEW.servidor_id,'Período atualizado',json_object('antes',json_object('tipo',OLD.tipo,'inicio',OLD.inicio,'fim',OLD.fim,'observacoes',OLD.observacoes),'depois',json_object('tipo',NEW.tipo,'inicio',NEW.inicio,'fim',NEW.fim,'observacoes',NEW.observacoes)),NEW.created_by); END;
CREATE TRIGGER IF NOT EXISTS movimento_evento_excluido AFTER DELETE ON eventos BEGIN
 INSERT INTO servidor_movimentos(servidor_id,acao,detalhes,user_id) VALUES(OLD.servidor_id,'Período excluído',json_object('tipo',OLD.tipo,'inicio',OLD.inicio,'fim',OLD.fim,'observacoes',OLD.observacoes),OLD.created_by); END;
`);

db.exec('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
if(!db.prepare('SELECT name FROM app_migrations WHERE name=?').get('abono-padrao-seis-20261020')){
 db.exec('BEGIN');try{
 db.prepare('UPDATE servidores SET abono_total=6,updated_at=CURRENT_TIMESTAMP WHERE abono_total=5').run();
 db.prepare('INSERT INTO app_migrations(name) VALUES(?)').run('abono-padrao-seis-20261020');
 db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
}
function abonoLimit(value,fallback=6){
 if(value===undefined||value===null||value==='')return fallback;
 const days=Number(value);return Number.isInteger(days)&&days>=0?days:null;
}
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
function isPrimaryMaster(user){return user?.role==='master' && String(user.email||'').trim().toLowerCase()==='contatotech.tecnologia@gmail.com';}
function canChange(user,owner){return isPrimaryMaster(user) || (owner != null && Number(owner)===Number(user.id));}
// Proteção no servidor: não depende de ocultar botões no navegador.
app.use('/api', (req,res,next)=>{ if(['/register','/login','/forgot','/reset','/logout'].includes(req.path))return next(); return auth(req,res,next); }, (req,res,next)=>{
 const rules=[
  {re:/^\/servidores\/(\d+)(?:\/arquivar)?$/, methods:['PATCH','DELETE','POST'], table:'servidores'},
  {re:/^\/eventos\/(\d+)$/, methods:['PATCH','DELETE'], table:'eventos'},
  {re:/^\/setores\/(\d+)$/, methods:['PATCH','DELETE'], table:'setores'},
  {re:/^\/anexos\/(\d+)$/, methods:['DELETE'], table:'anexos', owner:'uploaded_by'}
 ];
 for(const rule of rules){
  const match=req.path.match(rule.re); if(!match||!rule.methods.includes(req.method))continue;
  const row=db.prepare(`SELECT * FROM ${rule.table} WHERE id=?`).get(match[1]);
  if(!row)return res.status(404).json({error:'Registro não encontrado.'});
  if(!canChange(req.user,row[rule.owner||'created_by']))return res.status(403).json({error:'Somente quem criou este cadastro ou o usuário master pode alterá-lo ou removê-lo.'});
  if(!isPrimaryMaster(req.user)){
   if(rule.table==='servidores' && (req.method==='DELETE'||req.path.endsWith('/arquivar'))){
    const foreign=db.prepare('SELECT 1 FROM eventos WHERE servidor_id=? AND (created_by IS NULL OR created_by<>?) UNION ALL SELECT 1 FROM lembretes WHERE servidor_id=? AND (created_by IS NULL OR created_by<>?) LIMIT 1').get(row.id,req.user.id,row.id,req.user.id);
    const foreignAttachment=db.prepare('SELECT 1 FROM anexos a JOIN eventos e ON e.id=a.evento_id WHERE e.servidor_id=? AND (a.uploaded_by IS NULL OR a.uploaded_by<>?) LIMIT 1').get(row.id,req.user.id);
    if(foreign||foreignAttachment)return res.status(403).json({error:'Esta ação afeta registros de outros usuários. Solicite ao master.'});
   }
   if(rule.table==='eventos' && req.method==='DELETE' && db.prepare('SELECT 1 FROM anexos WHERE evento_id=? AND (uploaded_by IS NULL OR uploaded_by<>?) LIMIT 1').get(row.id,req.user.id))return res.status(403).json({error:'Este período possui anexos de outros usuários. Solicite ao master.'});
   if(rule.table==='setores' && req.method==='DELETE' && db.prepare('SELECT 1 FROM servidores WHERE setor_id=? AND (created_by IS NULL OR created_by<>?) LIMIT 1').get(row.id,req.user.id))return res.status(403).json({error:'Este setor está vinculado a cadastros de outros usuários. Solicite ao master.'});
  }
  break;
 }
 next();
});
function primaryMaster(req,res,next){if(!isPrimaryMaster(req.user))return res.status(403).json({error:'Acesso exclusivo do master principal.'});next();}
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
  db.prepare('INSERT INTO lembrete_sessoes(token_hash) VALUES(?)').run(digest(token));
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
  res.json({...req.user,is_impersonated:!!db.prepare('SELECT 1 FROM impersonations WHERE session_token_hash=?').get(tokenHash),can_manage_system:isPrimaryMaster(req.user),can_view_audit:canViewAudit(req.user),can_manage_audit_access:isAuditOwner(req.user)});
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
function reminderToday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
app.get('/api/lembretes',auth,(req,res)=>res.json(db.prepare(`SELECT l.*,s.nome servidor_nome FROM lembretes l JOIN servidores s ON s.id=l.servidor_id WHERE s.archived_at IS NULL ORDER BY l.data,l.id`).all()));
app.post('/api/lembretes',auth,(req,res)=>{
 const {servidor_id,titulo,data,observacoes}=req.body;
 if(!db.prepare('SELECT id FROM servidores WHERE id=? AND archived_at IS NULL').get(Number(servidor_id)||0))return res.status(400).json({error:'Servidor inválido.'});
 if(typeof titulo!=='string'||!titulo.trim()||titulo.length>200||typeof data!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data)||!Number.isFinite(Date.parse(data))||new Date(data).toISOString().slice(0,10)!==data||data<reminderToday())return res.status(400).json({error:'Informe título e uma data válida a partir de hoje.'});
 if(observacoes!=null&&(typeof observacoes!=='string'||observacoes.length>4000))return res.status(400).json({error:'Observações inválidas (máximo 4000 caracteres).'});
 db.exec('BEGIN');try{
 const result=db.prepare('INSERT INTO lembretes(servidor_id,titulo,data,observacoes,created_by) VALUES(?,?,?,?,?)').run(servidor_id,titulo.trim(),data,observacoes||null,req.user.id);
 movimento(servidor_id,'Lembrete criado',{id:Number(result.lastInsertRowid),titulo:titulo.trim(),data,observacoes},req.user.id);
 db.exec('COMMIT');res.json({id:Number(result.lastInsertRowid)});
 }catch(error){db.exec('ROLLBACK');throw error;}
});
app.post('/api/lembretes/login',auth,(req,res)=>{
 const tokenHash=digest(cookies(req).session),today=reminderToday();
 db.exec('BEGIN IMMEDIATE');try{
 const session=db.prepare('SELECT processado FROM lembrete_sessoes WHERE token_hash=?').get(tokenHash);
 if(!session||session.processado){db.exec('COMMIT');return res.json([]);}
 const rows=db.prepare(`SELECT l.*,s.nome servidor_nome FROM lembretes l JOIN servidores s ON s.id=l.servidor_id WHERE s.archived_at IS NULL AND l.created_by=? AND ((l.data=date(?,'+1 day') AND COALESCE(l.parado_em,'')<>?) OR (l.data=? AND l.exibido_no_dia IS NULL)) ORDER BY l.data,l.id`).all(req.user.id,today,today,today);
 for(const row of rows)if(row.data===today){db.prepare('UPDATE lembretes SET exibido_no_dia=? WHERE id=?').run(today,row.id);movimento(row.servidor_id,'Lembrete do dia apresentado',{titulo:row.titulo,data:row.data},req.user.id);}
 db.prepare('UPDATE lembrete_sessoes SET processado=1 WHERE token_hash=?').run(tokenHash);
 db.exec('COMMIT');res.json(rows);
 }catch(error){db.exec('ROLLBACK');throw error;}
});
app.post('/api/lembretes/:id/responder',auth,(req,res)=>{
 const {acao}=req.body,today=reminderToday();
 if(!['parar','depois'].includes(acao))return res.status(400).json({error:'Resposta inválida.'});
 const row=db.prepare('SELECT * FROM lembretes WHERE id=? AND created_by=?').get(req.params.id,req.user.id);
 if(!row)return res.status(404).json({error:'Lembrete não encontrado.'});
 db.exec('BEGIN');try{
 db.prepare('UPDATE lembretes SET parado_em=? WHERE id=?').run(acao==='parar'?today:null,row.id);
 movimento(row.servidor_id,acao==='parar'?'Lembrete suspenso no dia':'Lembrar no próximo login',{titulo:row.titulo,data:row.data},req.user.id);
 db.exec('COMMIT');res.json({ok:true});
 }catch(error){db.exec('ROLLBACK');throw error;}
});
app.get('/api/servidores',auth,(req,res)=>res.json(db.prepare(`SELECT s.*,st.nome setor_nome,
  COALESCE((SELECT SUM(julianday(e.fim)-julianday(e.inicio)+1) FROM eventos e WHERE e.servidor_id=s.id AND e.tipo='ferias' AND date(e.fim)<date('now','-3 hours')),0) ferias_usadas,
  COALESCE((SELECT SUM(julianday(e.fim)-julianday(e.inicio)+1) FROM eventos e WHERE e.servidor_id=s.id AND e.tipo='abono' AND strftime('%Y',e.inicio)=strftime('%Y','now','localtime')),0) abonos_usados
  FROM servidores s LEFT JOIN setores st ON st.id=s.setor_id WHERE (s.archived_at IS NOT NULL)=? ORDER BY s.nome`).all(req.query.archived==='1'?1:0)));
function resolveServidorSetor(value) { const setor=String(value??'').trim(); if(!setor)return {id:null}; if(setor==='sem_setor')return {id:null}; if(!/^[1-9]\d*$/.test(setor)||!db.prepare('SELECT id FROM setores WHERE id=?').get(Number(setor)))return {error:'Setor inválido.'}; return {id:Number(setor)}; }
app.post('/api/servidores',auth,(req,res)=>{ const {nome,funcao,email,cpf,matricula,setor_id,ferias_total,abono_total,confirmDuplicate}=req.body;if(abonoLimit(abono_total)===null)return res.status(400).json({error:'O direito anual de abono deve ser um número inteiro a partir de zero.'});if(!nome?.trim())return res.status(400).json({error:'Nome é obrigatório.'});const setorEscolhido=resolveServidorSetor(setor_id);if(setorEscolhido.error)return res.status(400).json({error:setorEscolhido.error});const duplicates=servidorDuplicates(req.body);if(duplicates.length&&!confirmDuplicate)return res.status(409).json({error:'DUPLICATE',duplicates}); const x=db.prepare('INSERT INTO servidores(nome,funcao,email,cpf,matricula,setor_id,equipe_id,ferias_total,abono_total,created_by) VALUES(?,?,?,?,?,?,NULL,?,?,?)').run(nome.trim(),funcao||null,email?.trim()||null,cpf||null,matricula||null,setorEscolhido.id,Number(ferias_total)||30,abonoLimit(abono_total),req.user.id);audit(req.user.id,'CREATE_SERVIDOR',{id:Number(x.lastInsertRowid),nome,duplicates:duplicates.map(d=>d.servidor_id)},req.ip);res.json({id:Number(x.lastInsertRowid)}); });
app.patch('/api/servidores/:id',auth,(req,res)=>{ const {nome,funcao,email,cpf,matricula,setor_id,ferias_total,abono_total,confirmDuplicate}=req.body;if(abonoLimit(abono_total)===null)return res.status(400).json({error:'O direito anual de abono deve ser um número inteiro a partir de zero.'});if(!nome?.trim())return res.status(400).json({error:'Nome é obrigatório.'});const before=db.prepare('SELECT nome,funcao,email,cpf,matricula,setor_id,ferias_total,abono_total FROM servidores WHERE id=?').get(req.params.id);if(!before)return res.status(404).json({error:'Servidor não encontrado.'});const setorEscolhido=resolveServidorSetor(setor_id);if(setorEscolhido.error)return res.status(400).json({error:setorEscolhido.error});const duplicates=servidorDuplicates(req.body,Number(req.params.id));if(duplicates.length&&!confirmDuplicate)return res.status(409).json({error:'DUPLICATE',duplicates});db.prepare('UPDATE servidores SET nome=?,funcao=?,email=?,cpf=?,matricula=?,setor_id=?,equipe_id=NULL,ferias_total=?,abono_total=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nome.trim(),funcao||null,email?.trim()||null,cpf||null,matricula||null,setorEscolhido.id,Number(ferias_total)||30,abonoLimit(abono_total,before.abono_total),req.params.id);const after=db.prepare('SELECT nome,funcao,email,cpf,matricula,setor_id,ferias_total,abono_total FROM servidores WHERE id=?').get(req.params.id);audit(req.user.id,'UPDATE_SERVIDOR',{id:req.params.id,before,after},req.ip);res.json({ok:true}); });
app.post('/api/servidores/:id/arquivar',auth,(req,res)=>{
 if(typeof req.body.arquivar!=='boolean')return res.status(400).json({error:'Informe a movimentação desejada.'});
 db.exec('BEGIN IMMEDIATE');try{
 const servidor=db.prepare('SELECT * FROM servidores WHERE id=?').get(req.params.id);
 if(!servidor){db.exec('ROLLBACK');return res.status(404).json({error:'Servidor não encontrado.'});}
 const archived=req.body.arquivar;
 if(Boolean(servidor.archived_at)!==archived){
 db.prepare('UPDATE servidores SET archived_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(archived?new Date().toISOString():null,servidor.id);
 movimento(servidor.id,archived?'Servidor arquivado':'Servidor reativado',{nome:servidor.nome},req.user.id);
 audit(req.user.id,archived?'ARCHIVE_SERVIDOR':'RESTORE_SERVIDOR',{id:servidor.id,nome:servidor.nome},req.ip);
 }
 db.exec('COMMIT');res.json({ok:true});
 }catch(error){db.exec('ROLLBACK');throw error;}
});
app.delete('/api/servidores/:id',auth,(req,res)=>{
 if(req.body.confirmPermanent!==true)return res.status(400).json({error:'Confirme a exclusão definitiva do servidor e de todos os registros.'});
 let arquivos=[];
 db.exec('BEGIN IMMEDIATE');try{
 const servidor=db.prepare('SELECT id,nome FROM servidores WHERE id=?').get(req.params.id);
 if(!servidor){db.exec('ROLLBACK');return res.status(404).json({error:'Servidor não encontrado.'});}
 arquivos=db.prepare('SELECT a.nome_arquivo FROM anexos a JOIN eventos e ON e.id=a.evento_id WHERE e.servidor_id=?').all(servidor.id);
 db.prepare('DELETE FROM eventos WHERE servidor_id=?').run(servidor.id);
 db.prepare('DELETE FROM lembretes WHERE servidor_id=?').run(servidor.id);
 db.prepare('DELETE FROM servidor_movimentos WHERE servidor_id=?').run(servidor.id);
 db.prepare('DELETE FROM servidores WHERE id=?').run(servidor.id);
 audit(req.user.id,'DELETE_SERVIDOR',{id:servidor.id,nome:servidor.nome,definitivo:true},req.ip);
 db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');console.error('Erro ao excluir servidor:',error);return res.status(500).json({error:'Não foi possível excluir o servidor.'});}
 let pendentes=0;
 for(const arquivo of arquivos){try{const filePath=path.resolve(uploadsDir,arquivo.nome_arquivo);if(path.dirname(filePath)!==path.resolve(uploadsDir))throw new Error('Caminho de anexo inválido');fs.rmSync(filePath,{force:true});}catch(error){pendentes++;console.error('Falha ao remover anexo:',error.message);}}
 res.json({ok:true,warning:pendentes?'Cadastro e registros excluídos, mas houve falha ao remover arquivos de anexos do disco. Avise o responsável pelo sistema.':null});
});

app.get('/api/eventos',auth,(req,res)=>{ const archived=req.query.archived==='1'; const op=archived?'<':'>='; res.json(db.prepare(`SELECT e.*,s.nome servidor_nome,s.matricula servidor_matricula,u.username criado_por, CASE WHEN e.created_by=? OR ?=1 THEN 1 ELSE 0 END pode_editar, CAST(julianday('now')-julianday(e.fim) AS INTEGER) dias_arquivado FROM eventos e JOIN servidores s ON s.id=e.servidor_id LEFT JOIN users u ON u.id=e.created_by WHERE s.archived_at IS NULL AND date(e.fim) ${op} date('now') ORDER BY e.inicio`).all(req.user.id,isPrimaryMaster(req.user)?1:0)); });
app.get('/api/alertas',auth,(req,res)=>res.json(db.prepare(`SELECT e.*,s.nome servidor_nome,CASE WHEN p.read_at IS NULL THEN 0 ELSE 1 END lido,CAST(julianday(e.inicio)-julianday('now') AS INTEGER) dias FROM eventos e JOIN servidores s ON s.id=e.servidor_id LEFT JOIN alert_preferences p ON p.evento_id=e.id AND p.user_id=? WHERE s.archived_at IS NULL AND e.created_by=? AND COALESCE(p.stopped,0)=0 AND date(e.fim)>=date('now') AND ((date(e.inicio) BETWEEN date('now') AND date('now','+20 day')) OR date(e.alerta_extra)>=date('now')) ORDER BY lido,COALESCE(e.alerta_extra,e.inicio),e.inicio`).all(req.user.id,req.user.id)));
app.post('/api/alertas/:id/responder',auth,(req,res)=>{const acao=req.body.acao;if(!['manter','parar'].includes(acao))return res.status(400).json({error:'Resposta de alerta inválida.'});const evento=db.prepare('SELECT id FROM eventos WHERE id=?').get(req.params.id);if(!evento)return res.status(404).json({error:'Registro não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET stopped=excluded.stopped,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id,acao==='parar'?1:0);audit(req.user.id,acao==='parar'?'STOP_ALERT':'KEEP_ALERT',{evento_id:evento.id},req.ip);res.json({ok:true});});
app.post('/api/alertas/:id/lido',auth,(req,res)=>{const evento=db.prepare('SELECT id FROM eventos WHERE id=? AND created_by=?').get(req.params.id,req.user.id);if(!evento)return res.status(404).json({error:'Alerta não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,read_at,updated_at) VALUES(?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id);res.json({ok:true});});
app.post('/api/alertas/ler-todos',auth,(req,res)=>{const ids=db.prepare(`SELECT e.id FROM eventos e WHERE e.created_by=? AND date(e.fim)>=date('now') AND ((date(e.inicio) BETWEEN date('now') AND date('now','+20 day')) OR date(e.alerta_extra)>=date('now'))`).all(req.user.id);const save=db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,read_at,updated_at) VALUES(?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`);db.exec('BEGIN');try{ids.forEach(({id})=>save.run(id,req.user.id));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}res.json({ok:true});});
app.delete('/api/alertas/:id',auth,(req,res)=>{const evento=db.prepare('SELECT id FROM eventos WHERE id=? AND created_by=?').get(req.params.id,req.user.id);if(!evento)return res.status(404).json({error:'Alerta não encontrado.'});db.prepare(`INSERT INTO alert_preferences(evento_id,user_id,stopped,updated_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(evento_id,user_id) DO UPDATE SET stopped=1,updated_at=CURRENT_TIMESTAMP`).run(evento.id,req.user.id);audit(req.user.id,'DELETE_ALERT',{evento_id:evento.id},req.ip);res.json({ok:true});});
function eventConflicts(inicio,fim,excludeId=null){return db.prepare(`SELECT e.id,s.nome servidor_nome,e.tipo,e.inicio,e.fim FROM eventos e JOIN servidores s ON s.id=e.servidor_id WHERE s.archived_at IS NULL AND date(e.inicio)<=date(?) AND date(e.fim)>=date(?) AND (? IS NULL OR e.id<>?) ORDER BY e.inicio`).all(fim,inicio,excludeId,excludeId);}
function validateEventBalance(servidorId,tipo,inicio,fim,excludeId=null){
  const servidor=db.prepare('SELECT nome,ferias_total,abono_total FROM servidores WHERE id=? AND archived_at IS NULL').get(servidorId);
  if(!servidor)return 'Servidor não encontrado.';
  const limit=servidor.abono_total;
  if(tipo==='abono'){
    if(inicio.slice(0,4)!==fim.slice(0,4))return 'O abono deve começar e terminar dentro do mesmo ano civil.';
    const year=inicio.slice(0,4);
    const requested=Math.floor((new Date(`${fim}T12:00:00`)-new Date(`${inicio}T12:00:00`))/86400000)+1;
    const used=db.prepare(`SELECT COALESCE(SUM(julianday(fim)-julianday(inicio)+1),0) total FROM eventos WHERE servidor_id=? AND tipo='abono' AND substr(inicio,1,4)=? AND (? IS NULL OR id<>?)`).get(servidorId,year,excludeId,excludeId).total;
    if(Number(used)+requested>Number(limit))return `Saldo de abono insuficiente em ${year}. ${servidor.nome} possui ${Math.max(0,Number(limit)-Number(used))} dia(s) disponíveis nesse ano.`;
  }
  return null;
}
app.post('/api/eventos/check',auth,(req,res)=>res.json(eventConflicts(req.body.inicio,req.body.fim,req.body.id||null)));
app.post('/api/eventos',auth,(req,res)=>{ const {servidor_id,tipo,inicio,fim,periodo_aquisitivo,alerta_extra,observacoes,confirmConflict}=req.body;if(!servidor_id||!['ferias','abono'].includes(tipo)||!inicio||!fim||fim<inicio)return res.status(400).json({error:'Dados ou período inválidos.'});const balanceError=validateEventBalance(servidor_id,tipo,inicio,fim);if(balanceError)return res.status(409).json({error:balanceError});const conflicts=eventConflicts(inicio,fim);if(conflicts.length&&!confirmConflict)return res.status(409).json({error:'CONFLICT',conflicts});const x=db.prepare('INSERT INTO eventos(servidor_id,tipo,inicio,fim,periodo_aquisitivo,alerta_extra,observacoes,created_by) VALUES(?,?,?,?,?,?,?,?)').run(servidor_id,tipo,inicio,fim,String(periodo_aquisitivo||'').trim()||null,alerta_extra||null,observacoes||null,req.user.id);audit(req.user.id,'CREATE_EVENTO',{id:Number(x.lastInsertRowid),tipo,servidor_id,conflicts:conflicts.map(c=>c.id)},req.ip);res.json({id:Number(x.lastInsertRowid)}); });
app.patch('/api/eventos/:id',auth,(req,res)=>{const {servidor_id,tipo,inicio,fim,periodo_aquisitivo,alerta_extra,observacoes,confirmConflict}=req.body;if(!servidor_id||!['ferias','abono'].includes(tipo)||!inicio||!fim||fim<inicio)return res.status(400).json({error:'Dados ou período inválidos.'});const current=db.prepare('SELECT id,servidor_id,tipo,inicio,fim,periodo_aquisitivo,alerta_extra,observacoes,created_by FROM eventos WHERE id=?').get(req.params.id);if(!current)return res.status(404).json({error:'Registro não encontrado.'});if(!canChange(req.user,current.created_by))return res.status(403).json({error:'Somente o usuário que criou este registro pode editá-lo.'});const balanceError=validateEventBalance(servidor_id,tipo,inicio,fim,Number(req.params.id));if(balanceError)return res.status(409).json({error:balanceError});const conflicts=eventConflicts(inicio,fim,Number(req.params.id));if(conflicts.length&&!confirmConflict)return res.status(409).json({error:'CONFLICT',conflicts});const periodoAquisitivo=periodo_aquisitivo===undefined?current.periodo_aquisitivo:String(periodo_aquisitivo||'').trim()||null;db.prepare('UPDATE eventos SET servidor_id=?,tipo=?,inicio=?,fim=?,periodo_aquisitivo=?,alerta_extra=?,observacoes=? WHERE id=?').run(servidor_id,tipo,inicio,fim,periodoAquisitivo,alerta_extra||null,observacoes||null,req.params.id);db.prepare('DELETE FROM alert_preferences WHERE evento_id=?').run(req.params.id);const after=db.prepare('SELECT servidor_id,tipo,inicio,fim,periodo_aquisitivo,alerta_extra,observacoes FROM eventos WHERE id=?').get(req.params.id);const {created_by,...before}=current;audit(req.user.id,'UPDATE_EVENTO',{id:Number(req.params.id),before,after},req.ip);res.json({ok:true});});
app.delete('/api/eventos/:id',auth,(req,res)=>{const current=db.prepare('SELECT id,created_by FROM eventos WHERE id=?').get(req.params.id);if(!current)return res.status(404).json({error:'Registro não encontrado.'});if(!canChange(req.user,current.created_by))return res.status(403).json({error:'Somente o usuário que criou este registro pode excluí-lo.'});db.prepare('DELETE FROM eventos WHERE id=?').run(req.params.id);audit(req.user.id,'DELETE_EVENTO',{id:req.params.id},req.ip);res.json({ok:true});});

// Estrutura organizacional por setores.
app.get('/api/estrutura',auth,(req,res)=>res.json({setores:db.prepare('SELECT * FROM setores ORDER BY nome').all()}));
app.post('/api/setores',auth,(req,res)=>{const nome=String(req.body.nome||'').trim();if(!nome)return res.status(400).json({error:'Informe o nome do setor.'});try{const x=db.prepare('INSERT INTO setores(nome,created_by) VALUES(?,?)').run(nome,req.user.id);audit(req.user.id,'CREATE_SETOR',{id:Number(x.lastInsertRowid),nome},req.ip);res.json({id:Number(x.lastInsertRowid)});}catch{return res.status(409).json({error:'Setor já cadastrado.'});}});
app.patch('/api/setores/:id',auth,(req,res)=>{const nome=String(req.body.nome||'').trim();if(!nome)return res.status(400).json({error:'Informe o nome do setor.'});db.prepare('UPDATE setores SET nome=? WHERE id=?').run(nome,req.params.id);audit(req.user.id,'UPDATE_SETOR',{id:req.params.id,nome},req.ip);res.json({ok:true});});
app.delete('/api/setores/:id',auth,(req,res)=>{db.prepare('UPDATE servidores SET setor_id=NULL,equipe_id=NULL WHERE setor_id=?').run(req.params.id);db.prepare('DELETE FROM equipes WHERE setor_id=?').run(req.params.id);db.prepare('DELETE FROM setores WHERE id=?').run(req.params.id);audit(req.user.id,'DELETE_SETOR',{id:req.params.id},req.ip);res.json({ok:true});});

// Importação em lote de servidores.
app.post('/api/servidores/importar',auth,(req,res)=>{const rows=Array.isArray(req.body.rows)?req.body.rows:[];if(!rows.length)return res.status(400).json({error:'Nenhuma linha válida para importar.'});const insert=db.prepare('INSERT INTO servidores(nome,funcao,email,cpf,matricula,setor_id,equipe_id,ferias_total,abono_total,created_by) VALUES(?,?,?,?,?,?,NULL,?,?,?)');let imported=0,skipped=0;db.exec('BEGIN');try{for(const row of rows.slice(0,1000)){const nome=String(row.nome||'').trim();if(!nome||abonoLimit(row.abono_total)===null||servidorDuplicates(row).length){skipped++;continue;}insert.run(nome,row.funcao||null,row.email||null,row.cpf||null,row.matricula||null,row.setor_id||null,Number(row.ferias_total)||30,abonoLimit(row.abono_total),req.user.id);imported++;}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}audit(req.user.id,'IMPORT_SERVIDORES',{imported,skipped},req.ip);res.json({ok:true,imported,skipped});});

// Histórico individual completo.
app.get('/api/servidores/:id/historico',auth,(req,res)=>{const servidor=db.prepare(`SELECT s.*,st.nome setor_nome FROM servidores s LEFT JOIN setores st ON st.id=s.setor_id WHERE s.id=?`).get(req.params.id);if(!servidor)return res.status(404).json({error:'Servidor não encontrado.'});const eventos=db.prepare(`SELECT e.*,u.username criado_por,(SELECT COUNT(*) FROM anexos a WHERE a.evento_id=e.id) anexos FROM eventos e LEFT JOIN users u ON u.id=e.created_by WHERE e.servidor_id=? ORDER BY e.inicio DESC`).all(req.params.id);const lembretes=db.prepare('SELECT * FROM lembretes WHERE servidor_id=? ORDER BY data DESC').all(req.params.id);const movimentos=db.prepare('SELECT m.*,u.username usuario FROM servidor_movimentos m LEFT JOIN users u ON u.id=m.user_id WHERE servidor_id=? ORDER BY m.id DESC').all(req.params.id);res.json({servidor,eventos,lembretes,movimentos});});

// Anexos de férias e abonos (até 5 MB por arquivo).
app.get('/api/eventos/:id/anexos',auth,(req,res)=>res.json(db.prepare('SELECT id,evento_id,nome_original,mime_type,tamanho,created_at,uploaded_by FROM anexos WHERE evento_id=? ORDER BY id DESC').all(req.params.id)));
app.post('/api/eventos/:id/anexos',auth,(req,res)=>{const evento=db.prepare('SELECT id FROM eventos WHERE id=?').get(req.params.id);if(!evento)return res.status(404).json({error:'Registro não encontrado.'});const match=String(req.body.data||'').match(/^data:([^;]+);base64,(.+)$/);if(!match)return res.status(400).json({error:'Arquivo inválido.'});const buffer=Buffer.from(match[2],'base64');if(buffer.length>5*1024*1024)return res.status(413).json({error:'O arquivo deve ter no máximo 5 MB.'});const safeName=String(req.body.nome||'arquivo').replace(/[^a-zA-Z0-9._-]/g,'_');const stored=`${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName}`;fs.writeFileSync(path.join(uploadsDir,stored),buffer);const x=db.prepare('INSERT INTO anexos(evento_id,nome_original,nome_arquivo,mime_type,tamanho,uploaded_by) VALUES(?,?,?,?,?,?)').run(evento.id,String(req.body.nome||'arquivo'),stored,match[1],buffer.length,req.user.id);audit(req.user.id,'UPLOAD_ANEXO',{evento_id:evento.id,anexo_id:Number(x.lastInsertRowid)},req.ip);res.json({id:Number(x.lastInsertRowid)});});
app.get('/api/anexos/:id/download',auth,(req,res)=>{const a=db.prepare('SELECT * FROM anexos WHERE id=?').get(req.params.id);if(!a)return res.status(404).send('Arquivo não encontrado.');res.download(path.join(uploadsDir,a.nome_arquivo),a.nome_original);});
app.delete('/api/anexos/:id',auth,(req,res)=>{const a=db.prepare('SELECT * FROM anexos WHERE id=?').get(req.params.id);if(!a)return res.status(404).json({error:'Anexo não encontrado.'});try{fs.rmSync(path.join(uploadsDir,a.nome_arquivo),{force:true});}catch{}db.prepare('DELETE FROM anexos WHERE id=?').run(a.id);audit(req.user.id,'DELETE_ANEXO',{anexo_id:a.id,evento_id:a.evento_id},req.ip);res.json({ok:true});});

// Indicadores gerenciais, integridade e recuperação de backup.
function backupFiles(){return fs.readdirSync(backupDestination).filter(n=>/^gestao-ferias-abonos_\d{4}-\d{2}-\d{2}(?:[_-].*)?\.db$/i.test(n)).map(n=>{const fullPath=path.join(backupDestination,n),stat=fs.statSync(fullPath);return{name:n,path:fullPath,size:stat.size,modified:stat.mtime};}).sort((a,b)=>new Date(b.modified)-new Date(a.modified));}
function validateBackupFile(filePath){let checkDb;try{checkDb=new DatabaseSync(filePath,{readOnly:true});const integrity=checkDb.prepare('PRAGMA integrity_check').get();const tables=checkDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','servidores','eventos')").all().map(x=>x.name);if(String(integrity.integrity_check).toLowerCase()!=='ok'||tables.length<3)throw new Error('O arquivo não contém um banco válido do sistema.');return{ok:true,integrity:'ok',tables};}finally{try{checkDb?.close();}catch{}}}
app.get('/api/relatorios/resumo',auth,primaryMaster,(req,res)=>{const params=[];const where=[];if(req.query.inicio){where.push('date(e.fim)>=date(?)');params.push(req.query.inicio);}if(req.query.fim){where.push('date(e.inicio)<=date(?)');params.push(req.query.fim);}if(['ferias','abono'].includes(req.query.tipo)){where.push('e.tipo=?');params.push(req.query.tipo);}if(Number(req.query.servidor_id)){where.push('e.servidor_id=?');params.push(Number(req.query.servidor_id));}if(Number(req.query.setor_id)){where.push('s.setor_id=?');params.push(Number(req.query.setor_id));}const condition=where.length?'WHERE '+where.join(' AND '):'';const base=`FROM eventos e JOIN servidores s ON s.id=e.servidor_id LEFT JOIN setores st ON st.id=s.setor_id ${condition}`;const porMes=db.prepare(`SELECT substr(e.inicio,1,7) mes,e.tipo,COUNT(*) quantidade,SUM(julianday(e.fim)-julianday(e.inicio)+1) dias ${base} GROUP BY mes,e.tipo ORDER BY mes DESC LIMIT 120`).all(...params);const porSetor=db.prepare(`SELECT COALESCE(st.nome,'Sem setor') setor,COUNT(DISTINCT s.id) servidores,COUNT(e.id) registros ${base} GROUP BY st.id ORDER BY setor`).all(...params);const ativos=db.prepare(`SELECT e.tipo,COUNT(*) quantidade ${base}${where.length?' AND':' WHERE'} date(e.fim)>=date('now') GROUP BY e.tipo`).all(...params);res.json({porMes,porSetor,ativos,totalServidores:db.prepare('SELECT COUNT(*) total FROM servidores').get().total,registros:porMes.reduce((sum,x)=>sum+Number(x.quantidade),0)});});
app.get('/api/backup/status',auth,primaryMaster,(req,res)=>{try{const files=backupFiles();const latest=files[0];res.json({ok:!!latest,destination:backupDestination,latest:latest?{name:latest.name,size:latest.size,modified:latest.modified}:null,message:latest?'Backup localizado.':'Nenhum backup localizado.'});}catch(error){res.json({ok:false,destination:backupDestination,latest:null,message:'Destino indisponível: '+error.message});}});
app.get('/api/integridade',auth,primaryMaster,async(req,res)=>{const checks={server:{ok:true,message:`Servidor ativo há ${Math.floor(process.uptime()/60)} minuto(s).`},database:{ok:false,message:''},email:{ok:false,message:''},network:{ok:false,message:''},backup:{ok:false,message:''}};try{const result=db.prepare('PRAGMA quick_check').get();checks.database={ok:String(result.quick_check).toLowerCase()==='ok',message:String(result.quick_check).toLowerCase()==='ok'?'Banco de dados íntegro.':'Falha de integridade: '+result.quick_check};}catch(error){checks.database.message=error.message;}try{fs.accessSync(backupDestination,fs.constants.R_OK|fs.constants.W_OK);checks.network={ok:true,message:'Pasta de rede acessível para leitura e gravação.'};}catch(error){checks.network.message='Rede ou pasta de backup indisponível.';}try{const files=backupFiles();if(files.length){const valid=validateBackupFile(files[0].path);checks.backup={ok:valid.ok,message:`Último backup válido: ${files[0].name}`,latest:files[0]};}else checks.backup.message='Nenhum backup encontrado.';}catch(error){checks.backup.message='Backup indisponível ou inválido: '+error.message;}if(process.env.SMTP_APP_PASSWORD){try{const tx=nodemailer.createTransport({service:'gmail',connectionTimeout:7000,greetingTimeout:7000,auth:{user:process.env.SMTP_USER||masterEmail,pass:process.env.SMTP_APP_PASSWORD}});await tx.verify();checks.email={ok:true,message:'Conexão com o serviço de e-mail validada.'};}catch(error){checks.email.message='Falha na conexão de e-mail: '+error.message;}}else checks.email.message='Envio de e-mail não configurado.';res.json({checked_at:new Date().toISOString(),checks});});
app.get('/api/backups',auth,primaryMaster,(req,res)=>{try{res.json({destination:backupDestination,files:backupFiles().map(({path,...file})=>file)});}catch(error){res.status(503).json({error:'Destino de backup indisponível: '+error.message});}});
app.post('/api/backups/:name/validate',auth,primaryMaster,(req,res)=>{try{const file=backupFiles().find(x=>x.name===req.params.name);if(!file)return res.status(404).json({error:'Backup não encontrado.'});const result=validateBackupFile(file.path);audit(req.user.id,'VALIDATE_BACKUP',{name:file.name},req.ip);res.json({...result,file:{name:file.name,size:file.size,modified:file.modified}});}catch(error){res.status(422).json({error:'Backup inválido: '+error.message});}});
app.post('/api/backups/:name/restore',auth,primaryMaster,(req,res)=>{try{const file=backupFiles().find(x=>x.name===req.params.name);if(!file)return res.status(404).json({error:'Backup não encontrado.'});validateBackupFile(file.path);fs.copyFileSync(file.path,restorePendingPath);audit(req.user.id,'SCHEDULE_BACKUP_RESTORE',{name:file.name},req.ip);res.json({ok:true,message:'Restauração preparada. Feche e abra novamente o sistema para aplicá-la.'});}catch(error){res.status(422).json({error:'Não foi possível preparar a restauração: '+error.message});}});

app.get('/api/admin/users',auth,primaryMaster,(req,res)=>res.json(db.prepare('SELECT id,username,email,cpf,matricula,role,active,created_at FROM users ORDER BY username').all()));
app.post('/api/admin/users',auth,primaryMaster,(req,res)=>{const {username,email,cpf,matricula,password}=req.body;if(!username?.trim()||!password||password.length<8)return res.status(400).json({error:'Informe usuário e senha com ao menos 8 caracteres.'});try{const role='admin';const x=db.prepare('INSERT INTO users(username,email,cpf,matricula,password_hash,role,active) VALUES(?,?,?,?,?,?,1)').run(username.trim(),email?.trim()||null,cpf?.trim()||null,matricula?.trim()||null,hashPassword(password),role);audit(req.user.id,'ADMIN_CREATE_USER',{target:Number(x.lastInsertRowid),username:username.trim(),role},req.ip);res.json({id:Number(x.lastInsertRowid)});}catch{res.status(409).json({error:'Usuário, e-mail, CPF ou matrícula já cadastrado.'});}});
app.patch('/api/admin/users/:id',auth,primaryMaster,(req,res)=>{const {username,email,cpf,matricula,role,active,password}=req.body;const old=db.prepare('SELECT username,email,cpf,matricula,role,active FROM users WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'Usuário não encontrado.'});if(!String(username||'').trim())return res.status(400).json({error:'Informe o nome do usuário.'});if(!['master','admin'].includes(role))return res.status(400).json({error:'Perfil inválido. Use apenas Master ou Administrador.'});const isActive=active===true||active===1||active==='1';if(old.role==='master'&&!isActive)return res.status(400).json({error:'Não desative a conta master.'});try{db.prepare('UPDATE users SET username=?,email=?,cpf=?,matricula=?,role=?,active=?,password_hash=COALESCE(?,password_hash) WHERE id=?').run(String(username).trim(),String(email||'').trim()||null,String(cpf||'').trim()||null,String(matricula||'').trim()||null,role,isActive?1:0,password?hashPassword(password):null,req.params.id);const after=db.prepare('SELECT username,email,cpf,matricula,role,active FROM users WHERE id=?').get(req.params.id);audit(req.user.id,'ADMIN_UPDATE_USER',{target:req.params.id,before:old,after,password_changed:!!password},req.ip);res.json({ok:true});}catch(error){if(String(error.message).includes('UNIQUE'))return res.status(409).json({error:'Usuário, e-mail, CPF ou matrícula já está em uso.'});console.error('Erro ao editar usuário:',error);res.status(500).json({error:'Não foi possível atualizar o usuário.'});}});
app.delete('/api/admin/users/:id',auth,primaryMaster,(req,res)=>{ if(Number(req.params.id)===req.user.id)return res.status(400).json({error:'Não é possível excluir sua própria conta master.'});db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);audit(req.user.id,'ADMIN_DELETE_USER',{target:req.params.id},req.ip);res.json({ok:true}); });
app.post('/api/admin/impersonate/:id',auth,primaryMaster,(req,res)=>{ const target=db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(req.params.id);if(!target)return res.status(404).json({error:'Usuário não encontrado.'});if(target.id===req.user.id)return res.status(400).json({error:'Você já está nesta conta.'});const token=crypto.randomBytes(32).toString('hex');const tokenHash=digest(token);db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash,target.id,iso(Date.now()+60*60*1000));db.prepare('INSERT INTO impersonations(session_token_hash,master_user_id) VALUES(?,?)').run(tokenHash,req.user.id);audit(req.user.id,'IMPERSONATE',{target:target.id},req.ip);res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);res.json({ok:true}); });
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
    WHERE s.archived_at IS NULL AND date(e.inicio) BETWEEN date('now') AND date('now','+7 day')`).all();
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
