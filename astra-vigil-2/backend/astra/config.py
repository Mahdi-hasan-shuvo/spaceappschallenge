"""Runtime settings. Everything has a safe local default; nothing needs a network."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
STATIC = ROOT / "static"
# demo_fixtures/ at the repo root: the simulated vitals the console replays (see demo_fixtures/README.md)
FIXTURES = Path(os.environ.get("ASTRA_FIXTURES", str(ROOT.parent.parent / "demo_fixtures")))
# Which committed fixture to replay. Swap in vitals_clean.json / rehearsal_1hz_clean.json to rehearse
# a run in which nothing should fire.
# Crew portraits: crew_photos/<crew id>.jpg|jpeg|png|webp at the repo root. Drop a file in and reload the page:
# no rebuild needed. A crew member without a file gets a generated avatar in the console.
CREW_PHOTOS = Path(os.environ.get("ASTRA_CREW_PHOTOS", str(ROOT.parent.parent / "crew_photos")))
PHOTO_EXTS = (".jpg", ".jpeg", ".png", ".webp")

VITALS_FILE = os.environ.get("ASTRA_VITALS", "vitals.json")
REHEARSAL_FILE = os.environ.get("ASTRA_REHEARSAL", "rehearsal_1hz.json")

HOST = os.environ.get("ASTRA_HOST", "127.0.0.1")
PORT = int(os.environ.get("ASTRA_PORT", "8000"))
DB_PATH = os.environ.get("ASTRA_DB", str(Path.home() / ".astra-vigil" / "astra.db"))

# One modeled minute of light-time = this many real seconds in the demo.
SECONDS_PER_MIN = float(os.environ.get("ASTRA_SECONDS_PER_MIN", "1.0"))

# One-way light-time presets (minutes). Mars range is the real minimum / mean / maximum.
DELAY_PRESETS = {"moon": 0.02, "mars_close": 3.04, "mars_mean": 12.51, "mars_far": 22.29}
DEFAULT_DELAY = "mars_mean"

SPEEDS = (1, 2, 5, 10, 20)
