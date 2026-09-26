# Rollback script for Desktop Commander
# Restores the original launcher scripts and npx execution without touching auth credentials.
param(
    [string]$BackupDir = "C:\Users\pavlo\desktop-commander-backup\20260926_172857\desktop-commander-device"
)

$ErrorActionPreference = "Stop"
$targetDir = "C:\Users\pavlo\.desktop-commander-device"

Write-Host "==================================================" -ForegroundColor Yellow
Write-Host "🔄 Initiating Desktop Commander Rollback..." -ForegroundColor Yellow
Write-Host "Target Directory: $targetDir"
Write-Host "Backup Source:    $BackupDir"
Write-Host "=================================================="

# 1. Stop active daemon
if (Test-Path "$targetDir\stop-daemon.ps1") {
    Write-Host "`n[1/4] Stopping active daemon..." -ForegroundColor Cyan
    & "$targetDir\stop-daemon.ps1"
}

# 2. Verify backup source exists
if (-not (Test-Path $BackupDir)) {
    Write-Error "Backup directory not found: $BackupDir"
    exit 1
}

# 3. Restore scripts (EXCLUDING device.json)
Write-Host "`n[2/4] Restoring original scripts (preserving auth credentials)..." -ForegroundColor Cyan
$filesToRestore = @("daemon.ps1", "start-daemon.ps1", "status-daemon.ps1", "stop-daemon.ps1", "start.cmd", "stop.cmd")

foreach ($file in $filesToRestore) {
    $src = Join-Path $BackupDir $file
    $dest = Join-Path $targetDir $file
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dest -Force
        Write-Host "  ✓ Restored $file" -ForegroundColor Green
    }
}

# Verify device.json is intact
if (Test-Path "$targetDir\device.json") {
    Write-Host "  ✓ Verified device.json credentials preserved" -ForegroundColor Green
} else {
    Write-Warning "device.json was not found in $targetDir!"
}

# 4. Restart daemon
Write-Host "`n[3/4] Starting original daemon..." -ForegroundColor Cyan
& "$targetDir\start-daemon.ps1"

# 5. Check status
Write-Host "`n[4/4] Verifying daemon status..." -ForegroundColor Cyan
Start-Sleep -Seconds 2
& "$targetDir\status-daemon.ps1"

Write-Host "`n✅ Rollback completed successfully." -ForegroundColor Green
