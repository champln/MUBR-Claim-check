# =============================================================================
#  สำรองฐานข้อมูล MUBR Claim (SQLite) — มีข้อมูลผู้ป่วยจริง ควรสำรองทุกวัน
#  ใช้ VACUUM INTO เพื่อให้ได้ไฟล์ที่สมบูรณ์แม้ระบบกำลังทำงานอยู่
#  เก็บย้อนหลัง 30 วัน (ลบไฟล์ที่เก่ากว่านั้นอัตโนมัติ)
# =============================================================================
$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path

$DbPath     = Join-Path $ROOT "backend\mubr_claims.db"
$BackupDir  = Join-Path $ROOT "backups"
$KeepDays   = 30

if (-not (Test-Path $DbPath)) { Write-Host "ไม่พบฐานข้อมูล: $DbPath" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }

$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $BackupDir "mubr_claims_$stamp.db"

# VACUUM INTO = สำรองแบบ consistent (ปลอดภัยแม้มีคนใช้งานอยู่)
$python = Join-Path $ROOT "backend\venv\Scripts\python.exe"
$code = "import sqlite3; c=sqlite3.connect(r'$DbPath'); c.execute('VACUUM INTO ?', (r'$target',)); c.close()"
& $python -c $code

if (Test-Path $target) {
    $size = [math]::Round((Get-Item $target).Length / 1KB, 1)
    Write-Host "สำรองสำเร็จ: $target ($size KB)" -ForegroundColor Green
} else {
    Write-Host "สำรองไม่สำเร็จ" -ForegroundColor Red; exit 1
}

# ลบไฟล์สำรองที่เก่ากว่า $KeepDays วัน
$cutoff = (Get-Date).AddDays(-$KeepDays)
$old = Get-ChildItem $BackupDir -Filter "mubr_claims_*.db" | Where-Object { $_.LastWriteTime -lt $cutoff }
if ($old) {
    $old | Remove-Item -Force
    Write-Host "ลบไฟล์สำรองเก่า $($old.Count) ไฟล์ (เกิน $KeepDays วัน)" -ForegroundColor DarkGray
}
