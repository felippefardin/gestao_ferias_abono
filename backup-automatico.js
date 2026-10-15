const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync, backup } = require('node:sqlite');

const candidates = [
  process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'gestao.db') : '',
  path.join(process.env.LOCALAPPDATA || '', 'GestaoFeriasAbonos', 'data', 'gestao.db'),
  'C:\\xampp\\htdocs\\gestao-ferias-abonos\\data\\gestao.db',
  'C:\\Users\\felippe.andreata\\Documents\\Codex\\2026-10-13\\adicionar-modal-de-conflito-com-a\\work\\runtime-sistema\\data\\gestao.db'
].filter(file => file && fs.existsSync(file));

if (!candidates.length) throw new Error('Nenhum banco de dados do sistema foi encontrado.');
const source = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const destinationDir = process.env.BACKUP_DIR || 'S:\\ATUACAO MEIO\\Divisao de Apoio Administrativo\\Felippe.andreata\\Backup_gerenciador_ferias';
fs.mkdirSync(destinationDir, { recursive: true });

const now = new Date();
const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const destination = path.join(destinationDir, `gestao-ferias-abonos_${date}.db`);
const temporary = path.join(destinationDir, `.gestao-ferias-abonos_${process.pid}.tmp`);
if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
const db = new DatabaseSync(source, { readOnly: true });

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

backup(db, temporary).then(() => {
  db.close();

  const previous = fs.readdirSync(destinationDir)
    .filter(name => /^gestao-ferias-abonos_\d{4}-\d{2}-\d{2}\.db$/i.test(name))
    .map(name => path.join(destinationDir, name))
    .filter(file => path.resolve(file) !== path.resolve(destination))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  const comparison = fs.existsSync(destination) ? destination : previous;
  if (comparison && fileHash(comparison) === fileHash(temporary)) {
    fs.rmSync(temporary, { force: true });
    const log = `${new Date().toISOString()} | SEM ALTERACOES | ${source}\r\n`;
    fs.appendFileSync(path.join(destinationDir, 'historico-backups.log'), log, 'utf8');
    console.log('Nenhum registro novo ou alterado. Backup não criado.');
    return;
  }

  if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
  fs.renameSync(temporary, destination);
  const log = `${new Date().toISOString()} | OK | ${source} | ${destination}\r\n`;
  fs.appendFileSync(path.join(destinationDir, 'historico-backups.log'), log, 'utf8');
  console.log(`Backup concluído: ${destination}`);
}).catch(error => {
  try { db.close(); } catch {}
  try { fs.rmSync(temporary, { force: true }); } catch {}
  throw error;
});
