"""Extract the app's inline <script> blocks from ../index.html for the Node tests.

    python extract.py

Writes script0.js (the writer) and script1.js (the app) into the system temp
folder, which is where the tests read them from (/tmp on Linux and macOS, and
Git Bash on Windows maps /tmp to the same place).
"""
import os
import re
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
html = open(os.path.join(HERE, "..", "index.html"), encoding="utf-8").read()
scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
dirs = {tempfile.gettempdir(), "/tmp"}
for d in dirs:
    try:
        os.makedirs(d, exist_ok=True)
        for i, s in enumerate(scripts):
            with open(os.path.join(d, f"script{i}.js"), "w", encoding="utf-8") as f:
                f.write(s)
    except OSError:
        pass
print(f"extracted {len(scripts)} scripts to {', '.join(sorted(dirs))}")
