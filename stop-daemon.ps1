# Stop Desktop Commander Daemon and all its processes
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$pidFile = "$scriptDir\daemon.pid"
if (Test-Path $pidFile) {
    $daemonPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($daemonPid) {
        $p = Get-Process -Id $daemonPid -ErrorAction SilentlyContinue
        if ($p -and $p.Id -ne $PID) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# Kill any dangling node or powershell instances specifically running daemon.ps1 (NOT start-daemon or stop-daemon)
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { 
    $_.ProcessId -ne $PID -and (
        $_.CommandLine -like "*desktop-commander*remote*" -or 
        ($_.Name -eq "powershell.exe" -and 
         $_.CommandLine -match '[\\]daemon\.ps1' -and 
         $_.CommandLine -notmatch 'start-daemon' -and 
         $_.CommandLine -notmatch 'stop-daemon' -and 
         $_.CommandLine -notmatch 'status-daemon')
    )
} | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Desktop Commander Daemon stopped."
