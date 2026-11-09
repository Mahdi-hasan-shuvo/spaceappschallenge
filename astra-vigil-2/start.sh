#!/usr/bin/env bash
# One-command start (Linux / macOS). Needs Python 3.10+. The built frontend is included.
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then python3 -m venv .venv; .venv/bin/pip install -q -r requirements.txt; fi
.venv/bin/python run.py --open "$@"
