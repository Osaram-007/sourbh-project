#!/usr/bin/env bash

# ==============================================================================
# Full Charge EV Discovery Platform - Automated Setup Script (Bash)
# ==============================================================================

set -e

echo "=================================================================="
echo "         Full Charge EV Platform - Environment Setup              "
echo "=================================================================="

# 1. Prerequisite Checks
echo -e "\n[+] Checking prerequisites (Node.js & npm)..."
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "[ERROR] Node.js or npm is not installed. Please install Node.js (v18+) before continuing."
    exit 1
fi
echo "[SUCCESS] Node.js $(node -v) and npm $(npm -v) found."

# 2. Environment Variables (.env) Setup
echo -e "\n[+] Checking environment file (.env)..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "[SUCCESS] Created '.env' from '.env.example'."
        echo "[WARNING] Please review and update your credentials in '.env' if needed."
    else
        echo "[ERROR] Neither '.env' nor '.env.example' was found."
        exit 1
    fi
else
    echo "[SUCCESS] Existing '.env' file detected."
fi

# 3. Install Dependencies
echo -e "\n[+] Installing NPM dependencies..."
npm install
echo "[SUCCESS] NPM dependencies installed successfully."

# 4. Generate Prisma Client
echo -e "\n[+] Generating Prisma Client..."
npx prisma generate
echo "[SUCCESS] Prisma Client generated."

# 5. Database Migration & PostGIS Setup
echo -e "\n[+] Pushing database schema & PostGIS triggers..."
if npx prisma db push; then
    echo "[SUCCESS] Database schema pushed."
    echo -e "\n[+] Initializing PostGIS extensions & spatial triggers..."
    if npx tsx scripts/db-init.ts; then
        echo "[SUCCESS] PostGIS spatial triggers initialized successfully."
    else
        echo "[WARNING] PostGIS setup script completed with warnings."
    fi
else
    echo "[WARNING] Database push failed. Verify PostgreSQL is running and check DATABASE_URL in .env."
fi

echo -e "\n=================================================================="
echo "                    Setup Complete!                               "
echo "=================================================================="
echo "To start the development server, run:"
echo "   npm run dev"
echo ""
