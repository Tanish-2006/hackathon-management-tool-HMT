#!/usr/bin/env bash
set -euo pipefail
dir="$HOME/hmt/loadtest"
mkdir -p "$dir/results"
docker run --rm --network host -e LT_STEADY -e LT_USERS -e LT_TEAMS -e LT_JOINERS -e LT_REG_WINDOW -e LT_RESTART_AT -e LT_ROUND_AT -e LT_SPIKE_USERS -e LT_OUT \
  -v "$dir:/lt" -v /var/run/docker.sock:/var/run/docker.sock python:3.12-slim \
  sh -c "pip install -q --root-user-action=ignore aiohttp==3.10.10 && python -u /lt/load.py"
