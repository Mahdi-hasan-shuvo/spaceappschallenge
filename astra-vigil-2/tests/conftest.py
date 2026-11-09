import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "src"))


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    from astra.server import create_app
    app = create_app(":memory:", autostart=False)
    with TestClient(app) as c:
        yield c
