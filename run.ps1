# Full Charge EV Discovery Platform Run Script
# Operating System: Windows PowerShell

Write-Host "====================================================" -ForegroundColor Emerald
Write-Host "  Starting Full Charge EV Discovery Platform Setup   " -ForegroundColor Emerald
Write-Host "====================================================" -ForegroundColor Emerald

# 1. Environment File Check
if (-not (Test-Path ".env")) {
    Write-Host "[Error] .env file not found!" -ForegroundColor Red
    Write-Host "Please configure your environment variables in a .env file first." -ForegroundColor Yellow
    Exit 1
}

# 2. Database Sync & Migrations
Write-Host "`n[1/3] Pushing database schema via Prisma..." -ForegroundColor Cyan
npx prisma db push
if ($LASTEXITCODE -ne 0) {
    Write-Host "[Error] Failed to push database schema. Please verify DATABASE_URL in your .env file." -ForegroundColor Red
    Exit 1
}

# 3. PostGIS & Spatial Trigger Setup
Write-Host "`n[2/3] Initializing PostGIS extensions & spatial triggers..." -ForegroundColor Cyan
npx tsx scripts/db-init.ts
if ($LASTEXITCODE -ne 0) {
    Write-Host "[Error] Failed to initialize PostGIS spatial settings." -ForegroundColor Red
    Exit 1
}

# 4. Starting Web Server
Write-Host "`n[3/3] Launching Next.js development server..." -ForegroundColor Cyan
Write-Host "Local URL: http://localhost:3000" -ForegroundColor Green
Write-Host "Admin Controls: http://localhost:3000/admin/sessions`n" -ForegroundColor Green

npm run dev
