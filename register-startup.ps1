# Register Desktop Commander Daemon in Windows Startup (Run key)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$name = "DesktopCommanderDaemon"
$value = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptDir\start-daemon.ps1`""

Set-ItemProperty -Path $regPath -Name $name -Value $value -Force
Write-Host "✅ Desktop Commander Daemon registered for automatic startup at Windows login." -ForegroundColor Green
