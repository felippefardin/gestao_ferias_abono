const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const backupScript = path.join(__dirname, 'backup-automatico.js');
const logDir = path.join(process.env.LOCALAPPDATA || __dirname, 'GestaoFeriasAbonos');
const logFile = path.join(logDir, 'agendador-backup.log');
let running = false;

fs.mkdirSync(logDir, { recursive: true });

function log(message) {
  fs.appendFileSync(logFile, `${new Date().toISOString()} | ${message}\r\n`, 'utf8');
}

function runBackup(reason, retries = 3) {
  if (running) return;
  running = true;
  log(`INICIO | ${reason}`);

  const child = spawn(process.execPath, [backupScript], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
  child.on('close', code => {
    running = false;
    const summary = output.trim().replace(/[\r\n]+/g, ' | ');
    log(`${code === 0 ? 'OK' : 'ERRO'} | codigo=${code} | ${summary}`);
    if (code !== 0 && retries > 0) {
      log(`NOVA TENTATIVA | em 5 minutos | restantes=${retries}`);
      setTimeout(() => runBackup('nova tentativa após falha', retries - 1), 5 * 60 * 1000);
    }
  });
}

function scheduleNextDailyRun() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(17, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = next.getTime() - now.getTime();
  log(`AGENDADO | ${next.toString()}`);
  setTimeout(() => {
    runBackup('execução diária das 17:30');
    scheduleNextDailyRun();
  }, delay);
}

// Aguarda o Windows concluir o mapeamento da unidade de rede.
setTimeout(() => runBackup('verificação após iniciar o Windows'), 30 * 1000);
scheduleNextDailyRun();
