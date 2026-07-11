#!/usr/bin/env bash
# Load .env (if present) and start MindBridge.
#   1. cp .env.example .env
#   2. paste your DigitalOcean model access key into .env
#   3. ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

if [ -z "${MINDBRIDGE_INFERENCE_KEY:-}" ]; then
  echo "→ No MINDBRIDGE_INFERENCE_KEY set — starting in self-contained DEMO mode."
  echo "  (Add your key to .env to run live DigitalOcean inference.)"
else
  echo "→ Live mode: DigitalOcean serverless inference, model=${MINDBRIDGE_MODEL:-llama3.3-70b-instruct}"
fi

exec python app.py
