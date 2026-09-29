$ErrorActionPreference = 'Stop'

$taskName = 'ShogiReviewAnalysisWorker'
$launcher = Join-Path $PSScriptRoot 'start-analysis-worker.bat'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if ($currentUser -match '(?i)CodexSandboxOffline') {
    throw 'Register this task from the normal interactive Windows account, not the isolated sandbox account.'
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'worker-config.bat'))) {
    throw 'Create worker-config.bat before registering the task.'
}

$action = New-ScheduledTaskAction `
    -Execute "$env:SystemRoot\System32\cmd.exe" `
    -Argument "/d /c `"`"$launcher`"`"" `
    -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
Write-Output "Registered $taskName for interactive user $currentUser."
