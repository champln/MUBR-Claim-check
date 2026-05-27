# เริ่มต้น MUBR Claim Pre-screen System

Write-Host "=== MUBR Claim Pre-screen System ===" -ForegroundColor Cyan
Write-Host "ศูนย์การแพทย์มหิดลบำรุงรักษ์ จังหวัดนครสวรรค์" -ForegroundColor Cyan
Write-Host ""

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

# Start Backend
Write-Host "[1/2] เริ่มต้น Backend (FastAPI)..." -ForegroundColor Yellow
$backend = Start-Process -FilePath "$ROOT\backend\venv\Scripts\uvicorn.exe" `
    -ArgumentList "main:app", "--reload", "--host", "0.0.0.0", "--port", "8000" `
    -WorkingDirectory "$ROOT\backend" `
    -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 3

# Start Frontend
Write-Host "[2/2] เริ่มต้น Frontend (Vite)..." -ForegroundColor Yellow
$frontend = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "npm run dev" `
    -WorkingDirectory "$ROOT\frontend" `
    -PassThru -WindowStyle Normal

Write-Host ""
Write-Host "✓ ระบบพร้อมใช้งานที่: http://localhost:5173" -ForegroundColor Green
Write-Host "✓ API Docs:            http://localhost:8000/docs" -ForegroundColor Green
Write-Host ""
Write-Host "กด Ctrl+C หรือปิดหน้าต่างเพื่อหยุดระบบ" -ForegroundColor Gray

try {
    Wait-Process -Id $frontend.Id
} finally {
    Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $frontend.Id -ErrorAction SilentlyContinue
}
