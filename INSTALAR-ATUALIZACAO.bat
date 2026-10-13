@echo off
setlocal
set "DESTINO=C:\xampp\htdocs\gestao-ferias-abonos"
echo Atualizando o sistema Gestao de Ferias e Abonos...
if not exist "%DESTINO%" (
  echo Pasta do sistema nao encontrada: %DESTINO%
  pause
  exit /b 1
)
copy /Y "%~dp0server.js" "%DESTINO%\server.js" >nul
copy /Y "%~dp0public\index.html" "%DESTINO%\public\index.html" >nul
copy /Y "%~dp0public\app.js" "%DESTINO%\public\app.js" >nul
copy /Y "%~dp0public\style.css" "%DESTINO%\public\style.css" >nul
copy /Y "%~dp0public\fix.css" "%DESTINO%\public\fix.css" >nul
if errorlevel 1 (
  echo Nao foi possivel atualizar. Clique com o botao direito e escolha Executar como administrador.
  pause
  exit /b 1
)
echo Atualizacao concluida. Reinicie o sistema pelo iniciar.bat.
pause
