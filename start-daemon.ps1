# Start Desktop Commander Daemon in completely detached background mode (breaks away from job objects)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Stop any existing instances first
& "$scriptDir\stop-daemon.ps1"

Start-Sleep -Milliseconds 500

$cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptDir\daemon.ps1`""
$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }

if ($res.ReturnValue -eq 0) {
    Write-Host "Desktop Commander Daemon started successfully (PID: $($res.ProcessId))." -ForegroundColor Green
    Write-Host "Logs: $scriptDir\daemon.log"
} else {
    Write-Host "Failed to start daemon. ReturnValue: $($res.ReturnValue)" -ForegroundColor Red
}
