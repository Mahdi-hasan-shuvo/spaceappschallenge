#!/usr/bin/env python3
"""Generate (or verify) every committed fixture in demo_fixtures/.

  python3 tools/make_fixtures.py            # (re)write the fixtures
  python3 tools/make_fixtures.py --check    # exit 1 if a committed file differs from a rebuild

All fixtures are SIMULATED, seeded and reproducible. Nothing here is astronaut data.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from compute.fixture import build_all                        # noqa: E402
from compute.schema import validate_rehearsal, validate_vitals  # noqa: E402

OUT = ROOT / "demo_fixtures"


def _validate(name: str, payload: dict) -> None:
    (validate_rehearsal if name.startswith("rehearsal") else validate_vitals)(payload)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="compare committed files with a rebuild")
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args(argv)
    bad = 0
    for name, payload in build_all().items():
        _validate(name, payload)
        path = a.out / name
        if a.check:
            same = path.exists() and json.loads(path.read_text(encoding="utf-8")) == json.loads(json.dumps(payload))
            print(("ok      " if same else "DIFFERS ") + name)
            bad += 0 if same else 1
        else:
            a.out.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
            print(f"wrote {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path} ({path.stat().st_size // 1024} KB)")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
