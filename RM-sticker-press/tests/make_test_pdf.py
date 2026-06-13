#!/usr/bin/env python3
"""Generate a minimal multi-page PDF (no fonts) for hybrid testing/calibration."""
def make_pdf(pages):
    # pages: list of (w, h, content_stream_str)
    objs = []  # (num, bytes)
    n_pages = len(pages)
    kids = " ".join(f"{3+2*i} 0 R" for i in range(n_pages))
    objs.append((1, f"<< /Type /Catalog /Pages 2 0 R >>".encode()))
    objs.append((2, f"<< /Type /Pages /Kids [{kids}] /Count {n_pages} >>".encode()))
    for i,(w,h,cs) in enumerate(pages):
        objs.append((3+2*i, f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Contents {4+2*i} 0 R >>".encode()))
        csb = cs.encode()
        objs.append((4+2*i, b"<< /Length " + str(len(csb)).encode() + b" >>\nstream\n" + csb + b"\nendstream"))
    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for num, body in objs:
        offsets[num] = len(out)
        out += f"{num} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_pos = len(out)
    count = len(objs)+1
    out += f"xref\n0 {count}\n".encode()
    out += b"0000000000 65535 f \n"
    for num,_ in objs:
        out += f"{offsets[num]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode()
    return bytes(out)

# page 1: letter (612x792). Printed: page border + TARGET rectangle (150,500)-(450,650) pdf coords (y up)
p1 = "4 w 6 6 600 780 re S 8 w 150 500 300 150 re S 2 w 150 500 m 450 650 l S 150 650 m 450 500 l S"
# page 2: Paper-Pro-sized points (1620x2160). Printed: border + centred target (510,930)-(1110,1230)
p2 = "10 w 15 15 1590 2130 re S 20 w 510 930 600 300 re S 5 w 510 930 m 1110 1230 l S 510 1230 m 1110 930 l S"
pdf = make_pdf([(612,792,p1),(1620,2160,p2)])
open("test2page.pdf","wb").write(pdf)
print("test2page.pdf", len(pdf), "bytes")
