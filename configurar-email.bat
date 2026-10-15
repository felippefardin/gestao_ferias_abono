@echo off
setlocal
title Configurar e-mail do Gestao de Ferias e Abonos
echo.
echo CONFIGURACAO SEGURA DO E-MAIL
echo A senha digitada nao sera exibida na tela.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$secure=Read-Host 'Digite a senha de aplicativo do Gmail' -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try{$pass=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}; $lines=@('MASTER_USERNAME=felippe.andreata','MASTER_EMAIL=contatotech.tecnologia@gmail.com','SMTP_USER=contatotech.tecnologia@gmail.com',('SMTP_APP_PASSWORD='+$pass),'BACKUP_DIR=S:\ATUACAO MEIO\Divisao de Apoio Administrativo\Felippe.andreata\Backup_gerenciador_ferias'); [IO.File]::WriteAllLines((Join-Path '%~dp0' '.env'),$lines,[Text.UTF8Encoding]::new($false)); Write-Host 'E-mail configurado. Reinicie o sistema.' -ForegroundColor Green"
echo.
pause
