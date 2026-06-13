#!/usr/bin/env python3
"""Build index.html by inlining rm_writer.js into app_shell.html."""
import os

here = os.path.dirname(os.path.abspath(__file__))
shell = open(os.path.join(here, "app_shell.html")).read()
writer = open(os.path.join(here, "rm_writer.js")).read()

marker = "//__INLINE_RM_WRITER__"
assert marker in shell, "marker missing from app_shell.html"

out_path = os.path.join(here, "..", "index.html")
with open(out_path, "w") as f:
    f.write(shell.replace(marker, writer))
print("wrote", os.path.normpath(out_path))
