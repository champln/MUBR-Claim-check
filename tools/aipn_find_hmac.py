"""
ทดสอบหาสูตร HMAC ของไฟล์ AIPN (ผู้ป่วยใน) — รันในเครื่องตัวเอง

ใช้เมื่อได้ "คีย์ HMAC ของโรงพยาบาล" จากระบบ AIPN ของ สกส. มาแล้ว
สคริปต์จะลองทุกสูตรที่เป็นไปได้ กับไฟล์ AIPN จริงที่ลายเซ็นถูกต้องอยู่แล้ว
ถ้าสูตรไหนคำนวณได้ตรงกับลายเซ็นในไฟล์ = เจอสูตรที่ถูก

วิธีใช้:
    python tools\\aipn_find_hmac.py "C:\\path\\to\\40922-AIPN-xxxx.xml" "คีย์ที่ได้จาก สกส."

หมายเหตุความปลอดภัย: คีย์ที่พิมพ์ไปกับคำสั่งอาจค้างใน history ของ shell
ถ้ากังวล ให้ตั้ง environment variable แทน:
    set AIPN_HMAC_KEY=xxxx        (แล้วเรียกโดยไม่ต้องใส่คีย์)
"""
import binascii
import hashlib
import hmac
import os
import re
import sys

ENDNOTE_RE = re.compile(rb'<\?EndNote\s+HMAC="([0-9A-Fa-f]+)"\s*\?>')
HASHES = {"md5": hashlib.md5, "sha1": hashlib.sha1, "sha256": hashlib.sha256}


def load(path):
    raw = open(path, "rb").read()
    m = ENDNOTE_RE.search(raw)
    if not m:
        sys.exit("ไม่พบ <?EndNote HMAC=\"...\"?> ในไฟล์นี้ — ใช่ไฟล์ AIPN หรือเปล่า")
    return raw, m.group(1).decode("ascii").upper(), m.start()


def key_forms(key: str):
    """คีย์อาจต้องใช้เป็นข้อความตรงๆ, ตัวพิมพ์ใหญ่/เล็ก, หรือถอดจาก hex"""
    forms = {
        "ข้อความตรงๆ": key.encode("utf-8"),
        "ตัวพิมพ์ใหญ่": key.upper().encode("utf-8"),
        "ตัวพิมพ์เล็ก": key.lower().encode("utf-8"),
        "ตัดช่องว่าง": key.strip().encode("utf-8"),
    }
    try:
        forms["ถอดจาก hex"] = binascii.unhexlify(key.strip())
    except Exception:
        pass
    return forms


def body_forms(raw: bytes, cut: int):
    """ช่วงไบต์ที่เอาไปเซ็น — ลองทุกแบบที่ไฟล์รูปแบบนี้มักใช้"""
    head = raw[:cut]
    forms = {
        "ทุกไบต์ก่อน <?EndNote": head,
        "ตัดขึ้นบรรทัดท้ายออก": head.rstrip(b"\r\n"),
        "ตัดช่องว่างท้ายออก": head.rstrip(),
    }
    # บางสเปกเซ็นเฉพาะเนื้อใน <CIPN>...</CIPN>
    m = re.search(rb"<CIPN>.*</CIPN>", head, re.S)
    if m:
        forms["เฉพาะ <CIPN>...</CIPN>"] = m.group(0)
    return forms


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    key = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("AIPN_HMAC_KEY", "")
    if not key:
        sys.exit("ยังไม่ได้ใส่คีย์ — ใส่ต่อท้ายคำสั่ง หรือตั้ง AIPN_HMAC_KEY")

    raw, stored, cut = load(path)
    print(f"ไฟล์      : {os.path.basename(path)}")
    print(f"ลายเซ็นในไฟล์ : {stored}  ({len(stored)} ตัวอักษร)")
    print(f"ความยาวนี้ตรงกับ: {', '.join(n for n, h in HASHES.items() if h().digest_size * 2 == len(stored)) or 'ไม่ตรงกับ md5/sha1/sha256'}")
    print("\nกำลังลองทุกสูตร...\n")

    tried = 0
    for kname, kbytes in key_forms(key).items():
        for bname, body in body_forms(raw, cut).items():
            for hname, hfunc in HASHES.items():
                tried += 1
                got = hmac.new(kbytes, body, hfunc).hexdigest().upper()
                if got[: len(stored)] == stored:
                    print("*** เจอแล้ว ***")
                    print(f"  คีย์แบบ    : {kname}")
                    print(f"  ช่วงไบต์   : {bname}")
                    print(f"  อัลกอริทึม : HMAC-{hname.upper()}")
                    print(f"  ได้ค่า     : {got}")
                    print("\nส่งผลลัพธ์ 3 บรรทัดนี้ให้ผู้พัฒนา (ไม่ต้องส่งคีย์) เพื่อเปิดให้แก้ไฟล์ AIPN ได้")
                    return
                # เผื่อเป็น hash ธรรมดาที่เอาคีย์ต่อหัว/ท้าย (ไม่ใช่ HMAC จริง)
                for label, data in (("คีย์นำหน้า", kbytes + body), ("คีย์ต่อท้าย", body + kbytes)):
                    tried += 1
                    if hfunc(data).hexdigest().upper()[: len(stored)] == stored:
                        print("*** เจอแล้ว (ไม่ใช่ HMAC มาตรฐาน) ***")
                        print(f"  สูตร      : {hname.upper()}({label} + เนื้อไฟล์)")
                        print(f"  คีย์แบบ    : {kname}")
                        print(f"  ช่วงไบต์   : {bname}")
                        return

    print(f"ลองครบ {tried} สูตรแล้ว ไม่มีอันไหนตรง")
    print("แปลว่าคีย์อาจไม่ใช่ตัวนี้ หรือสเปกใส่อย่างอื่นลงไปด้วย (เช่น รหัส รพ. + วันที่ + เลขงวด)")
    print("ถ้ามีสเปก/ภาพหน้าจอขั้นตอนจากวิดีโอ ส่งมาเพิ่มได้")


if __name__ == "__main__":
    main()
