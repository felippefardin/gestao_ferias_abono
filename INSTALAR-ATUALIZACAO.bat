@echo off
setlocal
set "DESTINO=C:\xampp\htdocs\gestao-ferias-abonos"
echo Atualizando o sistema Gestao de Ferias e Abonos...
if not exist "%DESTINO%" (
  echo Pasta do sistema nao encontrada: %DESTINO%
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $src='%~dp0'; $dst='%DESTINO%'; @('server.js','index.php','public\index.html','public\app.js','public\style.css','public\fix.css') | ForEach-Object { $from=Join-Path $src $_; $to=Join-Path $dst $_; New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null; Copy-Item -LiteralPath $from -Destination $to -Force }"
if errorlevel 1 (
  echo Nao foi possivel atualizar. Clique com o botao direito e escolha Executar como administrador.
  pause
  exit /b 1
)
echo Atualizacao concluida. Reinicie o sistema pelo iniciar.bat.
pause
