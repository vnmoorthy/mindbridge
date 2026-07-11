#!/usr/bin/env bash
# Start MindBridge. The app reads .env automatically (safely, in Python), so just:
#   1. cp .env.example .env
#   2. paste your DigitalOcean model access key after MINDBRIDGE_INFERENCE_KEY=
#   3. ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

# Prefer the project virtualenv if it exists.
PY="python3"
[ -x ".venv/bin/python" ] && PY=".venv/bin/python"

exec "$PY" app.py
