"""
พิสูจน์ความถูกต้องของ csop_file_editor กับเคสจริง (ลำดับ 12 เบิกเครื่อง CPAP)
รัน:  ./venv/Scripts/python.exe test_csop_editor.py
"""
import os
from services.csop_file_editor import (
    apply_cpap_fix, compute_checksum, split_endnote, verify_checksum, CsopFile,
)

DOC = os.path.join(os.path.dirname(__file__), "..", "document", "เบิกเครื่องCPAP", "case12")
BEFORE = os.path.join(DOC, "before")
AFTER = os.path.join(DOC, "after")


def load(d, name):
    with open(os.path.join(d, name), "rb") as f:
        return f.read()


def main():
    before = {
        "BILLTRAN20260527.txt": load(BEFORE, "BILLTRAN20260527.txt"),
        "OPServices20260527.txt": load(BEFORE, "OPServices20260527.txt"),
        "BILLDISP20260527.txt": load(BEFORE, "BILLDISP20260527.txt"),
    }
    after_billtran = load(AFTER, "BILLTRAN20260527 correct.txt")
    after_opsvc = load(AFTER, "OPServices20260527 correct.txt")

    # 0) ยืนยันสูตร checksum กับไฟล์ต้นฉบับทุกไฟล์
    print("─── checksum verify (original files) ───")
    for name, raw in {**before, "BILLTRAN correct": after_billtran, "OPServices correct": after_opsvc}.items():
        print(f"  {name:28} -> {verify_checksum(raw)}")

    # 1) apply fix — เคสนี้เป็น CPAP -> เลข ว ตามชนิด = ว47988 (ตรงกับไฟล์อ้างอิง)
    res = apply_cpap_fix(before, auth_by_visit={"257056": "B4GFQJ"})
    print("\n─── changes ───")
    for c in res.changes:
        print("  " + c)

    # 2) เทียบ byte-for-byte กับไฟล์ที่ IT แก้แล้ว
    print("\n─── byte-exact match vs IT-corrected ───")
    got_bt = res.files["BILLTRAN20260527.txt"]
    got_op = res.files["OPServices20260527.txt"]
    bt_ok = got_bt == after_billtran
    op_ok = got_op == after_opsvc
    print(f"  BILLTRAN   byte-exact: {bt_ok}")
    print(f"  OPServices byte-exact: {op_ok}")

    if not bt_ok:
        _diff("BILLTRAN", got_bt, after_billtran)
    if not op_ok:
        _diff("OPServices", got_op, after_opsvc)

    # 3) checksum ของผลลัพธ์ถูกต้อง
    print("\n─── output checksum self-consistent ───")
    print(f"  BILLTRAN   -> {verify_checksum(got_bt)}")
    print(f"  OPServices -> {verify_checksum(got_op)}")

    print("\nRESULT:", "PASS ✅" if (bt_ok and op_ok) else "FAIL ❌")


def _diff(label, got, exp):
    print(f"\n  [{label}] DIFF")
    g = got.decode("cp874").splitlines()
    e = exp.decode("cp874").splitlines()
    for i in range(max(len(g), len(e))):
        gl = g[i] if i < len(g) else "<none>"
        el = e[i] if i < len(e) else "<none>"
        if gl != el:
            print(f"    line {i}:\n      got: {gl}\n      exp: {el}")


if __name__ == "__main__":
    main()
