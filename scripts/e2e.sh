#!/bin/bash
# 用临时数据库起一个测试实例并运行 E2E。端口：E2E_PORT（默认 3101）；
# 若已有实例在跑，可直接：BASE=http://localhost:3200 python3 test/e2e.py
cd "$(dirname "$0")/.."; T=$(mktemp -d); P0=${E2E_PORT:-3101}
PORT=$P0 HOST=127.0.0.1 DB_FILE=$T/e2e.db LOG_LEVEL=warn node src/server.js > $T/server.log 2>&1 & P=$!
for i in $(seq 1 40); do curl -sf localhost:$P0/api/health >/dev/null && break; sleep 0.25; done
BASE=http://localhost:$P0 ${PY:-python3} test/e2e.py; code=$?
kill $P; [ $code -ne 0 ] && tail -20 $T/server.log; rm -rf $T; exit $code
