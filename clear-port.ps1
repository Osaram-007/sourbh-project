# PowerShell Script to Clear a Port (Defaults to 3000)
param(
    [int]$Port = 3000
)

Write-Host "Searching for processes using port $Port..." -ForegroundColor Cyan

# Find the connection details
$connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue

if ($connections) {
    # Get unique process IDs owning the connections
    $processIds = $connections.OwningProcess | Select-Object -Unique
    
    foreach ($processId in $processIds) {
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process) {
            Write-Host "Found process '$($process.Name)' (PID: $processId) using port $Port." -ForegroundColor Yellow
            Write-Host "Killing process..." -ForegroundColor Yellow
            Stop-Process -Id $processId -Force
            Write-Host "Process terminated successfully." -ForegroundColor Green
        }
    }
    Write-Host "Port $Port is now cleared!" -ForegroundColor Green
} else {
    Write-Host "No active processes found using port $Port." -ForegroundColor Green
}
