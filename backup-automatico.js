const fs = require('fs');
const path = require('path');
const { DatabaseSync, backup } = require('node:sqlite');

const candidates = [
  path.join(process.env.LOCALAPPDATA || '', 'GestaoFeriasAbonos', 'data', 'gestao.db'),
  'C:\\xampp\\htdocs\\gestao-ferias-abonos\\data\\gestao.db',
  'C:\\Users\\felippe.andreata\\Documents\\Codex\\2026-10-13\\adicionar-modal-de-conflito-com-a\\work\\runtime-sistema\\data\\gestao.db'
].filter(file => file && fs.existsSync(file));

if (!candidates.length) throw new Error('Nenhum banco de dados do sistema foi encontrado.');
const source = candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const destinationDir = 'S:\\ATUACAO MEIO\\Divisao de Apoio Administrativo\\Felippe.andreata\\Backup_gerenciador_ferias';
fs.mkdirSync(destinationDir, { recursive: true });

const now = new Date();
const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const destination = path.join(destinationDir, `gestao-ferias-abonos_${date}.db`);
const sourceModified = fs.statSync(source).mtimeMs;

if (fs.existsSync(destination) && fs.statSync(destination).mtimeMs >= sourceModified) {
  console.log(`Backup do dia já está atualizado: ${destination}`);
  process.exit(0);
}

const temporary = `${destination}.tmp`;
if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
const db = new DatabaseSync(source, { readOnly: true });
backup(db, temporary).then(() => {
  db.close();
  fs.renameSync(temporary, destination);
  const log = `${new Date().toISOString()} | OK | ${source} | ${destination}\r\n`;
  fs.appendFileSync(path.join(destinationDir, 'historico-backups.log'), log, 'utf8');
  console.log(`Backup concluído: ${destination}`);
}).catch(error => {
  try { db.close(); } catch {}
  try { fs.rmSync(temporary, { force: true }); } catch {}
  throw error;
});
