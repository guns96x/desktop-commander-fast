# Desktop Commander Persistent Daemon with Windows No-Sleep Support
# Pinned Build: C:\Users\pavlo\desktop-commander-fast\dist\index.js
$ErrorActionPreference = "Continue"

$c = @"
using System;
using System.Runtime.InteropServices;
public class Win32PowerKeepAlive {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);

    public static uint KeepAlive() {
        // ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001) | ES_AWAYMODE_REQUIRED (0x00000040)
        return SetThreadExecutionState(0x80000041);
    }

    public static uint ResetState() {
        return SetThreadExecutionState(0x80000000);
    }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'Win32PowerKeepAlive').Type) {
    Add-Type -TypeDefinition $c -Language CSharp
}

[Win32PowerKeepAlive]::KeepAlive() | Out-Null

$nodeExe = "D:\Program Files\nodejs\node.exe"
if (-not (Test-Path $nodeExe)) {
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
}

# Pinned local build path
$entryJs = "C:\Users\pavlo\desktop-commander-fast\dist\index.js"
if (-not (Test-Path $entryJs)) {
    # Fallback to npx cache only if local build is missing
    $entryJs = "C:\Users\pavlo\AppData\Local\npm-cache\_npx\4b4c857f6efdfb61\node_modules\@wonderwhy-er\desktop-commander\dist\index.js"
}

$logFile = "$PSScriptRoot\daemon.log"
$pidFile = "$PSScriptRoot\daemon.pid"

# Rolling log if log exceeds 5MB
if (Test-Path $logFile) {
    $item = Get-Item $logFile -ErrorAction SilentlyContinue
    if ($item -and $item.Length -gt 5MB) {
        Move-Item -Path $logFile -Destination "$logFile.1" -Force -ErrorAction SilentlyContinue
    }
}

# Single instance lock check
if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId = $existingPid" -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessId -ne $PID -and $p.CommandLine -match '[\\]daemon\.ps1') {
            "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Daemon already running with PID $($p.ProcessId). Exiting." | Out-File -Append -FilePath $logFile -Encoding utf8
            exit 0
        }
    }
}

$PID | Out-File -FilePath $pidFile -Encoding ascii -Force

"[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] === Desktop Commander Fast Daemon Started (PID: $PID) ===" | Out-File -Append -FilePath $logFile -Encoding utf8
"[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Target Build: $entryJs" | Out-File -Append -FilePath $logFile -Encoding utf8
"[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Windows No-Sleep active (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)" | Out-File -Append -FilePath $logFile -Encoding utf8

# Performance & Unicode Environment
$env:UV_THREADPOOL_SIZE = "16"
$env:PYTHONIOENCODING = "utf-8"
$env:NODE_DEFAULT_ENCODING = "utf-8"
$env:DESKTOP_COMMANDER_WAIT_CAP_MS = "2000"

try {
    while ($true) {
        [Win32PowerKeepAlive]::KeepAlive() | Out-Null
        
        $startMsg = "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Starting Desktop Commander Remote process..."
        $startMsg | Out-File -Append -FilePath $logFile -Encoding utf8
        
        & $nodeExe $entryJs "remote" *>> $logFile
        
        $exitCode = $LASTEXITCODE
        $exitMsg = "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Desktop Commander exited with code $exitCode. Reconnecting in 3 seconds..."
        $exitMsg | Out-File -Append -FilePath $logFile -Encoding utf8
        
        Start-Sleep -Seconds 3
    }
}
finally {
    if (Test-Path $pidFile) {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    [Win32PowerKeepAlive]::ResetState() | Out-Null
    "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] === Desktop Commander Daemon Stopped ===" | Out-File -Append -FilePath $logFile -Encoding utf8
}
