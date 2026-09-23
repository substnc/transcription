#!/usr/bin/env python3
"""Avbryter om modellkortets licens inte är en av de tillåtna."""
import sys
from huggingface_hub import HfApi

ALLOWED = {"cc-by-4.0", "apache-2.0", "mit"}
info = HfApi().model_info("KlangAI/pianissimo-sv")
lic = (info.card_data or {}).get("license") if info.card_data else None
print("licens:", lic)
if str(lic).lower() not in ALLOWED:
    sys.exit(f"Oväntad licens: {lic}")
