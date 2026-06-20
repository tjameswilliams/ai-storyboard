#!/bin/bash
PORT=3084

PID=$(lsof -ti:$PORT 2>/dev/null)

if [ -n "$PID" ]; then
  PROC_INFO=$(ps -p $PID -o command= 2>/dev/null)
  echo ""
  echo "  Port $PORT is already in use!"
  echo "  PID: $PID"
  echo "  Process: $PROC_INFO"
  echo ""
  read -p "  Kill it and continue? [Y/n] " answer
  answer=${answer:-Y}
  if [[ "$answer" =~ ^[Yy]$ ]]; then
    kill $PID 2>/dev/null
    sleep 1
    # Force kill if still running
    if lsof -ti:$PORT >/dev/null 2>&1; then
      kill -9 $PID 2>/dev/null
      sleep 0.5
    fi
    echo "  Stopped process $PID."
    echo ""
  else
    echo "  Aborting."
    exit 1
  fi
fi
