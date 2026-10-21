#!/bin/bash
# 后台启动（setsid+nohup，脱离当前 shell）；日志 logs/server.log；PID logs/server.pid
cd "$(dirname "$0")"; mkdir -p logs data
[ -f logs/server.pid ] && kill $(cat logs/server.pid) 2>/dev/null && sleep 1
setsid nohup scripts/run-forever.sh >> logs/server.log 2>&1 < /dev/null & echo $! > logs/server.pid
PORT=${PORT:-$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)}; PORT=${PORT:-3100}
for i in $(seq 1 30); do curl -sf localhost:$PORT/api/health >/dev/null && break; sleep 0.3; done
echo "pid $(cat logs/server.pid) · http://localhost:$PORT/ （顾客端）· http://localhost:$PORT/#merchant （商家端）"
curl -s localhost:$PORT/api/health; echo
