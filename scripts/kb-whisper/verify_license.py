#!/usr/bin/env python3
"""Stoppar konverteringen om modellkortet inte anger en tillåtande licens."""
import re, sys
from pathlib import Path
readme = Path(sys.argv[1]) / "README.md"
text = readme.read_text(encoding="utf-8") if readme.is_file() else ""
m = re.search(r"^license:\s*([\w.\-]+)", text, re.M)
lic = (m.group(1) if m else "").lower()
ok = {"apache-2.0", "mit", "cc-by-4.0", "bsd-3-clause"}
print("licens:", lic or "saknas")
if lic not in ok:
    sys.exit(f"Licensen '{lic}' är inte i listan över tillåtna ({', '.join(sorted(ok))}). Avbryter.")
