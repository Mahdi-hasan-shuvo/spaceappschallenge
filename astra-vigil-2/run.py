"""Launcher:  python run.py [--host 127.0.0.1] [--port 8000] [--open]

Astra Vigil 2.0 (Team MANTA). All telemetry is SIMULATED. Works fully offline.
"""
import argparse
import sys
import threading
import webbrowser
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_ROOT / "backend"))
sys.path.insert(0, str(_ROOT / "src"))   # src/compute = the science boundary

import uvicorn  # noqa: E402

from astra import config  # noqa: E402
from astra.server import create_app  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Astra Vigil 2.0 - crew health console (simulated data)")
    ap.add_argument("--host", default=config.HOST)
    ap.add_argument("--port", type=int, default=config.PORT)
    ap.add_argument("--open", action="store_true", help="open the browser")
    a = ap.parse_args()
    url = f"http://{a.host}:{a.port}"
    print(f"\n  Astra Vigil 2.0  ->  {url}\n  SIMULATED DATA. Ctrl+C to stop.\n")
    if a.open:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(), host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
