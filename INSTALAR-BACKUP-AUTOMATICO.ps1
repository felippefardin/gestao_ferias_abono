$ErrorActionPreference = 'Stop'
$taskName = 'Gestao de Ferias - Backup Automatico'
$node = 'C:\Program Files\nodejs\node.exe'
$script = Join-Path $PSScriptRoot 'backup-automatico.js'

if (-not (Test-Path -LiteralPath $node)) { throw "Node.js não encontrado em $node" }
if (-not (Test-Path -LiteralPath $script)) { throw "Rotina de backup não encontrada em $script" }

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`""
$daily = New-ScheduledTaskTrigger -Daily -At '17:30'
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($daily, $atLogon) -Settings $settings -Description 'Backup diário do Gerenciador de Férias às 17:30 e recuperação no próximo logon quando o computador estiver desligado.' -Force | Out-Null

Write-Host 'Tarefa automática instalada. Executando o primeiro backup...'
& $node $script
if ($LASTEXITCODE -ne 0) { throw 'A tarefa foi instalada, mas o primeiro backup não pôde ser concluído.' }
Write-Host 'Backup automático configurado e validado com sucesso.'
Read-Host 'Pressione Enter para fechar'
