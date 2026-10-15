$ErrorActionPreference = 'Stop'
$taskName = 'Gestao de Ferias - Backup Automatico'
$node = 'C:\Program Files\nodejs\node.exe'
$script = Join-Path $PSScriptRoot 'backup-automatico.js'

if (-not (Test-Path -LiteralPath $node)) { throw "Node.js não encontrado em $node" }
if (-not (Test-Path -LiteralPath $script)) { throw "Rotina de backup não encontrada em $script" }

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`""
$daily = New-ScheduledTaskTrigger -Daily -At '17:30'
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($daily, $atLogon) -Settings $settings -Principal $principal -Description 'Backup diário do Gerenciador de Férias às 17:30 e recuperação no próximo logon quando o computador estiver desligado. Não cria cópia se o banco não mudou.' -Force | Out-Null

Write-Host 'Backup automático configurado com sucesso.' -ForegroundColor Green
Write-Host 'Horário diário: 17:30.'
Write-Host 'Se o computador estiver desligado, a tarefa será recuperada no próximo logon.'
Write-Host 'Sem registros novos ou alterados, nenhum novo arquivo será criado.'
Read-Host 'Pressione Enter para fechar'
