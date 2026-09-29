# CIPN/AIPN Claim File — Validate & Auto-fix Feature (MUBR Claim)

> Handoff spec for Claude Code. Source: CSMBS In-patient Claim Data File Specification v2.0 (191129, สกส.),
> BMS HOSxP CIPN Claim Export manual, and a year of real rejection cases at ศูนย์การแพทย์มหิดลบำรุงรักษ์ (HCode 40922).
> Every rule marked **[verified]** was tested against a real file in the analysis session.

## 1. Problem

HOSxP's CIPN Claim Export produces files that สกส. rejects, and staff fix them by hand-editing XML.
Hand edits keep failing because 5 things must change together (ClaimCat, ClaimUP, ClaimAmt, DRGCharge/XDRGClaim, HMAC).

Recurring rejection codes seen in practice:

| Code | Meaning | Typical cause |
|---|---|---|
| 35 | ผลรวม DRGCharge ไม่ถูกต้อง | Room charge (หมวด 01) exported as ClaimCat `D` instead of `T`, or totals not recomputed after edit |
| 36 | ผลรวม XDRGClaim ไม่ถูกต้อง | **HOSxP bug**: sums `ChargeAmt` of T items instead of `Min(ClaimAmt, ChargeAmt-Discount)` |
| 30 | รูปแบบไม่ถูกต้อง (well-formed) | Broken XML after manual edit (e.g. `?` of `<?EndNote` deleted, encoding changed to UTF-8) |
| HMAC | checksum mismatch | Content edited without recomputing HMAC |
| 22 | (meaning not in spec v2.0 — ask user for สกส. rejection code list) | |

## 2. Feature scope

Input: one or more `.xml` claim files (or a `.zip`). Output: report + corrected files.

1. **Parse** (windows-874, CRLF) — never re-encode as UTF-8.
   Note: Python's stdlib expat raises `unknown encoding: windows-874`; for the well-formed check decode with
   `cp874`, strip the `<?xml …?>` declaration, then parse. Keep edits on raw bytes.
2. **Validate** (report every finding with line number + field name):
   - well-formed XML; root `<CIPN>`; `<?EndNote HMAC="..." ?>` present
   - `Reccount` of IPDx / IPOp / BillItems == actual line count
   - BillItems: exactly 20 fields per line; `ChargeAmt == QTY × UnitPrice` (2-dp tolerance)
   - ClaimCat ∈ {T, D, X}
   - ClaimCat rules (§4) — flag, do not silently change unless user confirms
   - D items: ClaimUP must be `0.00`
   - T items: ClaimUP/ClaimAmt present; `ClaimAmt == QTY × ClaimUP`
   - recomputed DRGCharge / XDRGClaim == file values
   - HMAC matches (§5)
   - ST fields must not contain `< > " ' &`
   - IPDx has ≥1 row with DxType=1 and DR filled (format `ว12345`)
3. **Auto-fix** (user reviews a diff and confirms per change):
   - change ClaimCat of a line (T↔D) and set ClaimUP/ClaimAmt accordingly
   - recompute DRGCharge, XDRGClaim
   - update `<effectiveTime>`
   - recompute HMAC
   - rename file with new SubmDT: `HCode-CIPN-AN-YYYYMMDDHHMMSS.xml` (status C → same AN, new SubmDT, **no** SubmType)
   - optional: build zip `HCodeCIPNSessionNo.ZIP` (session 10000–99999, never reused)
4. **Audit log**: who changed what line, old → new, timestamp, original file kept.

**Never allowed** (compliance): inventing a ClaimUP for an item that has no official rate. Example: setting
ClaimUP=1.75 on a non-claimable syringe makes the totals pass but claims money the hospital is not entitled to.
The tool must only take ClaimUP from the official CSMBS rate list / HOSxP master, never from ChargeAmt.

## 3. Formulas (spec Table 12) **[verified — สกส. checker uses these]**

```
net_i       = ChargeAmt_i - Discount_i
DRGCharge   = Σ net_i                      over lines where ClaimCat = 'D'
XDRGClaim   = Σ min(ClaimAmt_i, net_i)     over lines where ClaimCat = 'T'
```
Money format: 2+ decimals, no thousand separators, `.` decimal. HOSxP writes 4 decimals (`1600.0000`) and it is accepted.

## 4. ClaimCat rules (BMS manual + spec)

| Source | Condition | ClaimCat |
|---|---|---|
| nondrugitems | BillGrCS 01 (ห้อง/อาหาร), 02 (อวัยวะเทียม/อุปกรณ์บำบัด) | `T` (claim unit price) |
| nondrugitems | BillGrCS 05–16 | `D` |
| drugitems | ยามะเร็ง / ยาที่กำหนดให้เบิกนอก DRG | `T` |
| drugitems | other drugs | `D` |
| any | donated / research-funded | `X` |

Heuristic warnings:
- T line with ClaimUP = 0 and BillGrCS not 01/02 → "should probably be D" (this is exactly case 690000137).
- BillGrCS 01 line with ClaimCat D → "room charge should be T" (the most frequent historical issue).
- ClaimUP > 0 does **not** by itself imply T.

## 5. HMAC — BMS convention **[verified on real HOSxP output]**

Spec says MD5 over `<CIPN>` … `</CIPN>` + EOL. HOSxP files have a blank line before `<?EndNote`, and the
checksum that matches real accepted files is:

```
md5( bytes_windows874[ index("<CIPN>") : index("</CIPN>")+7 ] + b"\r\n\r\n" ).hexdigest().upper()
```
Write back as: `</CIPN>\r\n\r\n<?EndNote HMAC="<32 HEX>" ?>\r\n`. Work on raw bytes, not decoded strings.

## 6. BillItems field index (0-based)

```
0 sequence | 1 ServDate | 2 BillGr | 3 LCCode | 4 Descript | 5 QTY | 6 UnitPrice | 7 ChargeAmt
8 Discount | 9 ProcedureSeq | 10 DiagnosisSeq | 11 ClaimSys | 12 BillGrCS | 13 CSCode
14 CodeSys | 15 STDCode | 16 ClaimCat | 17 DateRev | 18 ClaimUP | 19 ClaimAmt
```
Other sections: IPADT 22 fields, IPDx 7, IPOp 8 (see spec PDF `โครงสร้างCIPN.pdf`).

## 7. Reference implementation (Python, verified)

```python
import hashlib, re
from decimal import Decimal as D

def load(path): return open(path, 'rb').read()

def bill_lines(raw):
    t = raw.decode('cp874')
    body = re.search(r'<BillItems[^>]*>\r?\n(.*?)</BillItems>', t, re.S).group(1)
    return [l.split('|') for l in body.strip().splitlines()]

def totals(lines):
    drg = xdrg = D(0)
    for f in lines:
        net = D(f[7]) - D(f[8])
        if f[16] == 'D': drg += net
        elif f[16] == 'T': xdrg += min(D(f[19] or 0), net)
    return drg, xdrg

def hmac(raw):
    s = raw.index(b'<CIPN>'); e = raw.index(b'</CIPN>') + 7
    return hashlib.md5(raw[s:e] + b'\r\n\r\n').hexdigest().upper()

def set_claimcat(raw, seq, cat, claim_up=None):
    """Change ClaimCat of BillItems line `seq`. For D, ClaimUP/ClaimAmt -> 0."""
    t = raw.decode('cp874').split('\r\n')
    for i, l in enumerate(t):
        f = l.split('|')
        if len(f) == 20 and f[0] == str(seq):
            f[16] = cat
            if cat == 'D': f[18], f[19] = '0.00', '0.0000'
            elif claim_up is not None:
                f[18] = f'{D(claim_up):.4f}'; f[19] = f'{D(claim_up) * D(f[5]):.4f}'
            t[i] = '|'.join(f)
    return '\r\n'.join(t).encode('cp874')

def finalize(raw, effective_time):
    drg, x = totals(bill_lines(raw))
    raw = re.sub(rb'<DRGCharge>[^<]*</DRGCharge>', b'<DRGCharge>%.4f</DRGCharge>' % drg, raw)
    raw = re.sub(rb'<XDRGClaim>[^<]*</XDRGClaim>', b'<XDRGClaim>%.4f</XDRGClaim>' % x, raw)
    raw = re.sub(rb'<effectiveTime>[^<]*</effectiveTime>',
                 b'<effectiveTime>' + effective_time.encode() + b'</effectiveTime>', raw)
    k = raw.index(b'<?EndNote')
    return raw[:k] + b'<?EndNote HMAC="' + hmac(raw).encode() + b'" ?>\r\n'
```

## 8. Test fixture & expected results

`fixture_690000137_rejected36.xml` — real rejected file (code 36), patient identifiers replaced with dummies,
HMAC recomputed. Commit it under `tests/fixtures/`.

| Check | Expected |
|---|---|
| BillItems count / Reccount | 88 / 88 |
| T lines | seq 1 (room 3004317, 1600/1600), seq 47 (3007240 syringe [เบิกไม่ได้], charge 1.75, ClaimUP 0) |
| File XDRGClaim | 1601.7500 → validator must flag mismatch |
| Recomputed XDRGClaim | 1600.0000 |
| Recomputed DRGCharge (as-is) | 14903.3000 (matches file) |
| Warning | seq 47: T with ClaimUP 0 in BillGrCS 05 → suggest D |
| After `set_claimcat(47,'D')` + finalize | DRGCharge 14905.0500, XDRGClaim 1600.0000, HMAC valid |
| HMAC of fixture as delivered | `BA2AF8062362B5882F70136E7F6596DE` |

## 9. Also report upstream

The XDRGClaim bug is in HOSxP's CIPN export (BMS). The tool is a safety net; the master-data fix is
`nondrugitems.csmbs_claim_cat='D'` for icode 3007240, and BMS should correct the XDRGClaim formula.

## 10. PDPA

Claim files contain patient PID, name, DOB. Keep processing on the hospital server, do not log full lines
containing IPADT, and restrict the feature to claim-centre/IT roles.
