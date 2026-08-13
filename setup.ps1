# ==============================================================================
# Full Charge EV Discovery Platform - Automated Setup Script (PowerShell)
# ==============================================================================

$ErrorActionPreference = "Stop"

function Write-Step ($message) {
    Write-Host "`n[+] $message" -ForegroundColor Cyan
}

function Write-Success ($message) {
    Write-Host "[SUCCESS] $message" -ForegroundColor Green
}

function Write-Warn ($message) {
    Write-Host "[WARNING] $message" -ForegroundColor Yellow
}

function Write-Err ($message) {
    Write-Host "[ERROR] $message" -ForegroundColor Red
}

Write-Host "==================================================================" -ForegroundColor DarkCyan
Write-Host "         Full Charge EV Platform - Environment Setup              " -ForegroundColor DarkCyan
Write-Host "==================================================================" -ForegroundColor DarkCyan

# 1. Prerequisite Checks
Write-Step "Checking prerequisites (Node.js & npm)..."
try {
    $nodeVersion = node -v
    $npmVersion = npm -v
    Write-Success "Node.js $nodeVersion and npm $npmVersion found."
} catch {
    Write-Err "Node.js or npm is not installed or not in PATH. Please install Node.js (v18+) before continuing."
    Exit 1
}

# 2. Environment Variables (.env) Setup
Write-Step "Checking environment file (.env)..."
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Success "Created '.env' from '.env.example'."
        Write-Warn "Please review and update your credentials in '.env' if needed."
    } else {
        Write-Err "Neither '.env' nor '.env.example' was found."
        Exit 1
    }
} else {
    Write-Success "Existing '.env' file detected."
}

# 3. Install Dependencies
Write-Step "Installing NPM dependencies..."
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    Write-Success "NPM dependencies installed successfully."
} catch {
    Write-Err "Failed to install dependencies."
    Exit 1
}

# 4. Generate Prisma Client
Write-Step "Generating Prisma Client..."
try {
    npx prisma generate
    if ($LASTEXITCODE -ne 0) { throw "Prisma generate failed" }
    Write-Success "Prisma Client generated."
} catch {
    Write-Warn "Prisma Client generation encountered an issue."
}

# 5. Database Migration & PostGIS Setup
Write-Step "Pushing database schema & PostGIS triggers..."
try {
    npx prisma db push
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Database schema pushed."
        
        Write-Step "Initializing PostGIS extensions & spatial triggers..."
        npx tsx scripts/db-init.ts
        if ($LASTEXITCODE -eq 0) {
            Write-Success "PostGIS spatial triggers initialized successfully."
        } else {
            Write-Warn "PostGIS setup script completed with warnings. Ensure PostgreSQL has the PostGIS extension enabled."
        }
    } else {
        Write-Warn "Could not connect to PostgreSQL database to push schema. Check your DATABASE_URL in .env."
    }
} catch {
    Write-Warn "Database push skipped or failed. Ensure your PostgreSQL server is running and DATABASE_URL in .env is correct."
}

# 6. Complete
Write-Host "`n==================================================================" -ForegroundColor DarkCyan
Write-Host "                    Setup Complete!                               " -ForegroundColor DarkCyan
Write-Host "==================================================================" -ForegroundColor DarkCyan
Write-Host "To start the development server, run:" -ForegroundColor White
Write-Host "   npm run dev" -ForegroundColor Green
Write-Host "   OR" -ForegroundColor White
Write-Host "   .\run.ps1`n" -ForegroundColor Green
