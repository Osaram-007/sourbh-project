@echo off
title Full Charge EV Platform Launcher
echo ====================================================
echo   Starting Full Charge EV Discovery Platform Setup   
echo ====================================================

if not exist .env (
    echo [Error] .env file not found!
    echo Please configure your environment variables in a .env file first.
    pause
    exit /b 1
)

echo.
echo [1/3] Pushing database schema via Prisma...
call npx prisma db push
if %errorlevel% neq 0 (
    echo [Error] Failed to push database schema. Please verify DATABASE_URL.
    pause
    exit /b 1
)

echo.
echo [2/3] Initializing PostGIS extensions ^& spatial triggers...
call npx tsx scripts/db-init.ts
if %errorlevel% neq 0 (
    echo [Error] Failed to initialize PostGIS spatial settings.
    pause
    exit /b 1
)

echo.
echo [3/3] Launching Next.js development server...
echo Local URL: http://localhost:3000
echo Admin Controls: http://localhost:3000/admin/sessions
echo.

call npm run dev
