param(
	[string]$SshHost = 'babel36acl'
)

$ErrorActionPreference = 'Stop'
$taskProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskLogDir = Join-Path $taskProject 'reports/visual/reference-runtime'
New-Item -ItemType Directory -Path $taskLogDir -Force | Out-Null
$taskLock = [IO.File]::Open((Join-Path $taskLogDir 'tunnel.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
$taskSsh = (Get-Command ssh.exe).Source
$taskState = Join-Path $taskLogDir 'tunnel.json'
$taskLog = Join-Path $taskLogDir 'tunnel.log'
$taskErrorLog = Join-Path $taskLogDir 'ssh.stderr.log'
$taskChild = $null
$taskRetrySeconds = 5

function Write-TunnelLog([string]$Message) {
	Add-Content -LiteralPath $taskLog -Value "$(Get-Date -Format o) $Message" -Encoding utf8
}

try {
	# Only supervise the child created here. An existing listener belongs to another session.
	if (Get-NetTCPConnection -LocalPort 18080 -State Listen -ErrorAction SilentlyContinue) {
		throw 'Port 18080 already has a listener; leave the existing process untouched.'
	}
	while ($true) {
		$taskStarted = Get-Date
		Set-Content -LiteralPath $taskErrorLog -Value '' -Encoding utf8
		$taskChild = Start-Process -FilePath $taskSsh -ArgumentList @(
			'-N', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
			'-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
			'-o', 'ServerAliveCountMax=3', '-L', '127.0.0.1:18080:127.0.0.1:8080', $SshHost
		) -WindowStyle Hidden -PassThru -RedirectStandardError $taskErrorLog
		@{ supervisorPid = $PID; sshPid = $taskChild.Id; host = $SshHost; localPort = 18080; startedAt = $taskStarted.ToString('o') } |
			ConvertTo-Json | Set-Content -LiteralPath $taskState -Encoding utf8
		Write-TunnelLog "Started SSH pid=$($taskChild.Id) host=$SshHost port=18080"
		$taskChild.WaitForExit()
		$taskChild.Refresh()
		$taskError = ''
		if (Test-Path -LiteralPath $taskErrorLog) {
			$taskErrorText = Get-Content -Raw -LiteralPath $taskErrorLog -ErrorAction SilentlyContinue
			if ($null -ne $taskErrorText) { $taskError = $taskErrorText.Trim() }
		}
		Write-TunnelLog "SSH exited code=$($taskChild.ExitCode) error=$taskError"
		if (((Get-Date) - $taskStarted).TotalSeconds -ge 60) { $taskRetrySeconds = 5 }
		Write-TunnelLog "Reconnect in $taskRetrySeconds seconds"
		Start-Sleep -Seconds $taskRetrySeconds
		$taskRetrySeconds = [Math]::Min(30, $taskRetrySeconds * 2)
	}
} finally {
	if ($taskChild -and -not $taskChild.HasExited) { $taskChild.Kill() }
	$taskLock.Dispose()
}
