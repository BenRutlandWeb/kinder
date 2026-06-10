#!/usr/bin/env python3
"""Generate a self-signed TLS certificate for local / LAN HTTPS (PWA, Share API)."""

from __future__ import annotations

import ipaddress
import os
import subprocess
import sys
from pathlib import Path


def _san_entry(host: str) -> str:
    host = host.strip()
    if not host:
        return ""
    try:
        ipaddress.ip_address(host)
        return f"IP:{host}"
    except ValueError:
        return f"DNS:{host}"


def main() -> int:
    cert_dir = Path(os.environ.get("CERT_DIR", "certs"))
    cert_dir.mkdir(parents=True, exist_ok=True)
    key = cert_dir / "key.pem"
    cert = cert_dir / "cert.pem"

    if key.exists() and cert.exists():
        print(f"Certificates already exist in {cert_dir}", file=sys.stderr)
        return 0

    raw_hosts = os.environ.get("TLS_SAN_HOSTS", "localhost,127.0.0.1")
    san_parts = [_san_entry(h) for h in raw_hosts.split(",")]
    san_parts = [part for part in san_parts if part]
    if not san_parts:
        print("TLS_SAN_HOSTS must include at least one hostname or IP", file=sys.stderr)
        return 1

    san = ",".join(san_parts)
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-days",
            "825",
            "-nodes",
            "-subj",
            "/CN=Kinder Dev",
            "-addext",
            f"subjectAltName={san}",
        ],
        check=True,
    )
    print(f"Wrote {key} and {cert} (SAN: {san})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
