#!/usr/bin/env python3
"""macOS shim for Ben's ops/bench/fleet_usb_bringup.py — zero edits to his file.

His tool uppercases serial port paths (fine for Windows COM75, fatal on
case-sensitive /dev/cu.usbmodem*): `port=port.device.upper()` in discover()
and `wanted = {value.upper() for value in ports}` in the selector. This shim
loads his source, patches EXACTLY those two expressions in memory, and execs
the result with the same argv. If either pattern is missing or ambiguous it
aborts loudly instead of guessing (a lift that can't find its anchor must
never fall back to a blind cut).

Also prepends Arduino's bundled native esptool to PATH — find_esptool() only
globs for esptool.exe on the Windows side.

Usage: exactly like the real tool, from the rescue worktree root:
  python3 <controller>/tools/usb-bringup-mac.py commission --ports /dev/cu.usbmodemX ...
"""

import os
import sys
from pathlib import Path

REAL = Path(__file__).resolve().parent.parent.parent  # ~/code
CANDIDATES = [
    REAL / "resonance-usb-rescue" / "ops" / "bench" / "fleet_usb_bringup.py",
    Path.cwd() / "ops" / "bench" / "fleet_usb_bringup.py",
]

PATCHES = [
    ("port=port.device.upper(),", "port=port.device,"),
    ("wanted = {value.upper() for value in ports}", "wanted = set(ports)"),
]


def main() -> None:
    src_path = next((p for p in CANDIDATES if p.exists()), None)
    if not src_path:
        sys.exit(f"fleet_usb_bringup.py not found in: {[str(p) for p in CANDIDATES]}")
    source = src_path.read_text(encoding="utf-8")

    for old, new in PATCHES:
        n = source.count(old)
        if n != 1:
            sys.exit(f"ABORT: expected exactly 1 occurrence of {old!r} in {src_path}, "
                     f"found {n} — Ben's tool changed; re-verify the shim before flashing.")
        source = source.replace(old, new)

    esptool_dirs = sorted((Path.home() / "Library" / "Arduino15" / "packages" / "esp32"
                           / "tools" / "esptool_py").glob("*"))
    if esptool_dirs:
        os.environ["PATH"] = f"{esptool_dirs[-1]}:{os.environ.get('PATH', '')}"

    print(f"[shim] {src_path} + 2 case-preserving patches (macOS)", file=sys.stderr)
    code = compile(source, str(src_path), "exec")
    globs = {"__name__": "__main__", "__file__": str(src_path)}
    exec(code, globs)


if __name__ == "__main__":
    main()
