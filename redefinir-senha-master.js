const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const appDataRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'GestaoFeriasAbonos')
  : path.join(__dirname, '.runtime');
const databasePath = path.join(process.env.DATA_DIR || path.join(appDataRoot, 'data'), 'gestao.db');
if (!fs.existsSync(databasePath)) {
  console.error('Banco de dados ainda não existe. Inicie o sistema uma vez e tente novamente.');
  process.exit(1);
}
const db = new DatabaseSync(databasePath);
const password = 'TroqueAgora!2026';
const salt = crypto.randomBytes(16).toString('hex');
const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const result = db.prepare("UPDATE users SET password_hash=?, active=1, role='master' WHERE username=? COLLATE NOCASE")
  .run(passwordHash, 'felippe.andreata');
if (!result.changes) {
  console.error('Usuário master não encontrado.');
  process.exit(1);
}
db.prepare('DELETE FROM sessions').run();
console.log('Senha master redefinida para: TroqueAgora!2026');
