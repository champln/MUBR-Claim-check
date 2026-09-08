# =============================================================================
#  MUBR Claim Pre-screen — ตัวรันสำหรับใช้งานจริง (production)
#  ต่างจาก start.ps1 (โหมดพัฒนา) ตรงที่:
#    - ใช้หน้าเว็บที่ build แล้ว (frontend/dist) ไม่ใช้ Vite dev server
#    - เหลือ process เดียว / พอร์ตเดียว  ->  http://<ip เครื่องนี้>:8090
#    - ไม่มี --reload (เสถียรกว่า, กินทรัพยากรน้อยกว่า)
# =============================================================================
$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$PORT = 8090

Write-Host "=== MUBR Claim Pre-screen (production) ===" -ForegroundColor Cyan

# 1) ต้องมีหน้าเว็บที่ build แล้ว — ถ้ายังไม่มี/เก่ากว่าโค้ด ให้ build ใหม่
$dist = Join-Path $ROOT "frontend\dist\index.html"
if (-not (Test-Path $dist)) {
    Write-Host "[build] ยังไม่มี frontend/dist — กำลัง build..." -ForegroundColor Yellow
    Push-Location (Join-Path $ROOT "frontend")
    npm run build
    Pop-Location
}

# 2) หยุด process เดิมของโปรเจกต์นี้ที่ค้างอยู่ (ถ้ามี)
Get-NetTCPConnection -State Listen -LocalPort $PORT -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "[stop] หยุด process เดิมบนพอร์ต $PORT (PID $($_.OwningProcess))" -ForegroundColor DarkYellow
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

# 3) รัน backend (เสิร์ฟทั้ง API และหน้าเว็บ)
$python = Join-Path $ROOT "backend\venv\Scripts\python.exe"
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback' } |
    Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host ""
Write-Host "URL สำหรับผู้ใช้:  http://$(if ($lanIp) { $lanIp } else { '127.0.0.1' }):$PORT" -ForegroundColor Green
Write-Host "API Docs:          http://127.0.0.1:$PORT/docs" -ForegroundColor DarkGray
Write-Host ""

& $python -m uvicorn main:app --host 0.0.0.0 --port $PORT --app-dir "$ROOT\backend" --log-level info
