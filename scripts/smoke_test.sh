#!/usr/bin/env bash
set -euo pipefail

echo "Running basic smoke tests (requires docker-compose up -d already run)"

echo "1) Wait for core-service to be healthy (timeout 120s)"
timeout=120
until curl -fsS http://localhost:3000/health >/dev/null 2>&1 || [ $timeout -le 0 ]; do
  sleep 2; timeout=$((timeout-2)); echo -n '.';
done
echo
if [ $timeout -le 0 ]; then
  echo "core-service health check failed"; exit 1
fi

echo "2) Post sample market_data to Kafka (using node script)"
node ./scripts/send_sample_market_data.js || { echo "Failed to send sample message"; exit 1; }

echo "3) Wait a bit for consumer to write to DB"
sleep 5

echo "4) Query /api/klines for BTCUSDT"
curl -sS "http://localhost:3000/api/klines?symbol=BTCUSDT&limit=5" | jq || echo "No output or jq not installed"

echo "Smoke tests finished"
