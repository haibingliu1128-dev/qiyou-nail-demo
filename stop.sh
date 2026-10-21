#!/bin/bash
cd "$(dirname "$0")"
if [ -f logs/server.pid ]; then P=$(cat logs/server.pid); pkill -TERM -P $P 2>/dev/null; kill $P 2>/dev/null; echo "stopped $P"; rm -f logs/server.pid; fi
