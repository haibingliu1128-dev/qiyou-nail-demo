#!/bin/bash
# 简易守护：进程异常退出后 2 秒自动重启（生产建议用 systemd 或 pm2，见 README）
cd "$(dirname "$0")/.."
trap 'kill $CHILD 2>/dev/null; exit 0' TERM INT
while true; do
  node src/server.js & CHILD=$!; wait $CHILD; code=$?
  echo "[$(date '+%F %T')] server exited with $code, restarting in 2s" >&2; sleep 2
done
