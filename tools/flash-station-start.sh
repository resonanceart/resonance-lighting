#!/bin/bash
# Start (or restart) the Flash Station — Elliot's one-command bench boot.
# Usage:  ./tools/flash-station-start.sh
# Page:   http://127.0.0.1:8940  ·  LAN/phone: http://<mac-ip>:8940
set -e
cd "$(dirname "$0")/.."
pkill -f flash-station.py 2>/dev/null || true
sleep 1
JSONL="$HOME/code/resonance-usb-rescue/ops/bench/data/usb/2026-08-16-elliot-rescue-01.jsonl"
# /usr/bin/python3 on purpose: it is firewall-allowed for LAN serving; brew python is not
nohup /usr/bin/python3 tools/flash-station.py \
  --expect 12 --bind 0.0.0.0 --jsonl "$JSONL" \
  > /tmp/flash-station.log 2>&1 &
sleep 2
if curl -sf http://127.0.0.1:8940/state > /dev/null; then
  echo "Flash Station up: http://127.0.0.1:8940 (log: /tmp/flash-station.log)"
else
  echo "FAILED to start — see /tmp/flash-station.log"; exit 1
fi
