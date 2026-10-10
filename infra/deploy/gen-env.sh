#!/usr/bin/env bash
set -euo pipefail
target="$(realpath -m "${1:-$HOME/hmt/.env}")"
example="$(dirname "$(realpath "$0")")/.env.prod.example"
if [ -e "$target" ]; then
  echo "$target already exists, leaving it untouched"
  exit 0
fi
mkdir -p "$(dirname "$target")"
umask 077
access="$(openssl rand -hex 32)"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    HMT_ENV_FILE=*) echo "HMT_ENV_FILE=$target" ;;
    JWT_ACCESS_SECRET=*|JWT_SECRET=*) echo "${line%%=*}=$access" ;;
    *=CHANGE_ME) echo "${line%%=*}=$(openssl rand -hex 32)" ;;
    *) echo "$line" ;;
  esac
done < "$example" > "$target"
echo "wrote $target"
