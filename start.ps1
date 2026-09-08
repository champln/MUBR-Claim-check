# Start MUBR Claim Pre-screen System

Write-Host "=== MUBR Claim Pre-screen System ===" -ForegroundColor Cyan
Write-Host "Mahidol Bamrungrak Medical Center, Nakhon Sawan" -ForegroundColor Cyan
Write-Host ""

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
# NOTE: 8000 = ระบบตรวจสุขภาพ (production), 8001 = ระบบตรวจสุขภาพ (test) — ห้ามใช้ MUBR ใช้ 8090
$PreferredBackendPort = 8090
$PreferredFrontendPort = 5174

function Test-PortInUse {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Get-FreePort {
    param(
        [int]$StartPort,
        [int]$MaxAttempts = 50
    )

    for ($i = 0; $i -lt $MaxAttempts; $i++) {
        $candidate = $StartPort + $i
        if (-not (Test-PortInUse -Port $candidate)) {
            return $candidate
        }
    }

    throw "No free port found starting at $StartPort"
}

function Stop-ExistingProjectProcesses {
    param([string]$ProjectRoot)

    $backendRoot = "$ProjectRoot\backend"
    $frontendRoot = "$ProjectRoot\frontend"
    $stopped = 0

    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    foreach ($p in $processes) {
        $cmd = $p.CommandLine
        if (-not $cmd) { continue }

        $isProjectBackend = ($cmd -match [regex]::Escape($backendRoot)) -and ($cmd -match 'uvicorn') -and ($cmd -match 'main:app')
        $isProjectFrontend = ($cmd -match [regex]::Escape($frontendRoot)) -and ($cmd -match 'vite')

        if ($isProjectBackend -or $isProjectFrontend) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                $stopped++
            } catch {
                # Ignore processes that already exited.
            }
        }
    }

    return $stopped
}

$stoppedCount = Stop-ExistingProjectProcesses -ProjectRoot $ROOT
if ($stoppedCount -gt 0) {
    Write-Host "Stopped $stoppedCount existing project process(es)." -ForegroundColor DarkYellow
}

$BackendPort = Get-FreePort -StartPort $PreferredBackendPort
$FrontendPort = Get-FreePort -StartPort $PreferredFrontendPort
$ApiTarget = "http://127.0.0.1:$BackendPort"

if ($BackendPort -ne $PreferredBackendPort) {
    Write-Host "Backend preferred port $PreferredBackendPort is busy. Using $BackendPort." -ForegroundColor DarkYellow
}
if ($FrontendPort -ne $PreferredFrontendPort) {
    Write-Host "Frontend preferred port $PreferredFrontendPort is busy. Using $FrontendPort." -ForegroundColor DarkYellow
}

# Start Backend
Write-Host "[1/2] Starting Backend (FastAPI) on port $BackendPort..." -ForegroundColor Yellow
$backend = Start-Process -FilePath "$ROOT\backend\venv\Scripts\python.exe" `
    -ArgumentList "-m", "uvicorn", "main:app", "--reload", "--host", "127.0.0.1", "--port", "$BackendPort", "--app-dir", "$ROOT\backend" `
    -WorkingDirectory "$ROOT\backend" `
    -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 2

if ($backend.HasExited) {
    Write-Host "Backend process exited unexpectedly. Check backend dependencies/logs." -ForegroundColor Red
    exit 1
}

# Start Frontend with API target for this backend instance.
Write-Host "[2/2] Starting Frontend (Vite) on port $FrontendPort..." -ForegroundColor Yellow
# --host 0.0.0.0 : ให้เครื่องอื่นใน intranet เข้าถึงได้ (ไม่ใช่แค่ localhost)
$frontendCmd = "`$env:VITE_API_PROXY_TARGET='$ApiTarget'; npm run dev -- --host 0.0.0.0 --port $FrontendPort"
$frontend = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-Command", $frontendCmd `
    -WorkingDirectory "$ROOT\frontend" `
    -PassThru -WindowStyle Normal

if ($frontend.HasExited) {
    Write-Host "Frontend process exited unexpectedly. Check Node.js/npm setup." -ForegroundColor Red
    Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""
# หา IPv4 ของ LAN (10.x / 192.x / 172.x) เพื่อบอก URL ที่เพื่อนใน intranet ใช้เข้า
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback' } |
    Select-Object -First 1 -ExpandProperty IPAddress)
Write-Host "System URL (เครื่องนี้):     http://127.0.0.1:$FrontendPort" -ForegroundColor Green
if ($lanIp) {
    Write-Host "System URL (เพื่อนใน intranet): http://$($lanIp):$FrontendPort" -ForegroundColor Cyan
    Write-Host "  ^ แชร์ลิงก์นี้ให้เพื่อนในวงแลนเข้าทดสอบ" -ForegroundColor DarkCyan
}
Write-Host "Backend API: $ApiTarget" -ForegroundColor Green
Write-Host "API Docs:    $ApiTarget/docs" -ForegroundColor Green
Write-Host ""
Write-Host "หมายเหตุ: ครั้งแรกอาจต้องอนุญาต Windows Firewall ให้ Node.js เข้าถึงเครือข่าย" -ForegroundColor DarkYellow
Write-Host "Press Ctrl+C or close the window to stop this launcher." -ForegroundColor Gray

try {
    Wait-Process -Id $frontend.Id
} finally {
    Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
}
