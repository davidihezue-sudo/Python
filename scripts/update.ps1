# One-click update for the home server. Right-click, "Run with PowerShell", or run:  .\scripts\update.ps1
# It makes a database backup first, pulls the newest code, rebuilds, restarts and checks the app came up.
$ErrorActionPreference = "Stop"
$proj   = Split-Path -Parent $PSScriptRoot
$branch = "claude/clever-edison-281ogi"
$backup = "C:\ff-backup"
Set-Location $proj

Write-Host "1/4 Backing up the database..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force $backup | Out-Null
$day = Get-Date -Format "yyyy-MM-dd-HHmm"
docker compose exec -T db sh -c "pg_dump -U familyfinance -Fc familyfinance -f /tmp/b.dump"
docker compose cp db:/tmp/b.dump "$backup\db-$day.dump"
$size = (Get-Item "$backup\db-$day.dump").Length
if ($size -lt 10000) { throw "The backup looks too small ($size bytes). Stopping before changing anything." }
Write-Host "   Backup saved ($size bytes)." -ForegroundColor Green

Write-Host "2/4 Getting the newest code..." -ForegroundColor Cyan
git pull origin $branch

Write-Host "3/4 Rebuilding and restarting (this can take a few minutes)..." -ForegroundColor Cyan
docker compose up -d --build

Write-Host "4/4 Checking the app..." -ForegroundColor Cyan
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 3
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000/login" -TimeoutSec 5; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { }
}
docker compose ps
if ($ok) { Write-Host "Updated and running." -ForegroundColor Green }
else { Write-Host "The app did not answer. Last log lines:" -ForegroundColor Red; docker compose logs web --tail 40 }
Read-Host "Press Enter to close"
