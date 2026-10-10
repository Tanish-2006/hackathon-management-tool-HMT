#!/usr/bin/env bash
set -u
out="${1:-$HOME/hmt/loadtest/results/monitor.log}"
cd "$HOME/hmt/src/infra/deploy"
compose="docker compose -f docker-compose.prod.yml --env-file $HOME/hmt/.env"
while true; do
  ts=$(date +%T)
  docker stats --no-stream --format "$ts {{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}" | grep hmt- >> "$out"
  conns=$($compose exec -T postgres psql -U hmt -d hmt -tAc "select count(*) from pg_stat_activity where datname='hmt'" 2>/dev/null)
  rows=$($compose exec -T postgres psql -U hmt -d hmt -tAc "select count(*), pg_size_pretty(pg_total_relation_size('hmt_state')) from hmt_state" 2>/dev/null)
  echo "$ts pg_conns=$conns hmt_state=$rows load=$(cut -d' ' -f1-3 /proc/loadavg)" >> "$out"
  sleep 5
done
