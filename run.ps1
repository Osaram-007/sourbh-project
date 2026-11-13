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

# 2. Database Migrations
Write-Host "`n[1/2] Applying database migrations via Prisma..." -ForegroundColor Cyan
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
    Write-Host "[Error] Failed to apply database migrations. Please verify DATABASE_URL in your .env file." -ForegroundColor Red
    Write-Host "If this database was created earlier by 'prisma db push', run 'npx prisma migrate reset' (destroys local data), or 'npx prisma migrate resolve --applied 0_init' if its schema already matches." -ForegroundColor Yellow
    Exit 1
}

# 3. Starting Web Server
Write-Host "`n[2/2] Launching Next.js development server..." -ForegroundColor Cyan
Write-Host "Local URL: http://localhost:3000" -ForegroundColor Green
Write-Host "Admin Controls: http://localhost:3000/admin/sessions`n" -ForegroundColor Green

npm run dev
