#!/bin/sh
set -e

if [ "$ENABLE_TLS" = "1" ]; then
  CERT_DIR="${CERT_DIR:-/certs}"
  export CERT_DIR
  python /app/scripts/generate_cert.py
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000 \
    --ssl-keyfile="$CERT_DIR/key.pem" \
    --ssl-certfile="$CERT_DIR/cert.pem" \
    "$@"
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
