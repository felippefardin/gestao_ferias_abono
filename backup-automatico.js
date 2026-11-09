// Mantem o ponto de entrada usado pelo agendador de ferias.
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const python = path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python311', 'python.exe');
const result = spawnSync(python, ['C:\\xampp\\backup-tools\\backup_completo.py', '--profile', 'ferias'], {
  windowsHide: true, stdio: 'inherit', env: process.env
});
if (result.error) console.error('Nao foi possivel iniciar o backup completo: ' + result.error.message);
process.exit(result.error ? 1 : (result.status ?? 1));
