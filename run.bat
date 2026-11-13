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
echo [1/2] Applying database migrations via Prisma...
call npx prisma migrate deploy
if %errorlevel% neq 0 (
    echo [Error] Failed to apply database migrations. Please verify DATABASE_URL.
    echo If this database was created earlier by 'prisma db push', run 'npx prisma migrate reset' - this destroys local data.
    echo Or, if its schema already matches, run 'npx prisma migrate resolve --applied 0_init'.
    pause
    exit /b 1
)

echo.
echo [2/2] Launching Next.js development server...
echo Local URL: http://localhost:3000
echo Admin Controls: http://localhost:3000/admin/sessions
echo.

call npm run dev
