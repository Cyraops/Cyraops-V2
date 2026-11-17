#!/usr/bin/env python3
"""
Cyraops Company OS — Fail-Closed Database Identity Verification
Compares application environment configuration (.env) against active PostgreSQL connection.
Ensures zero credential leakage while strictly validating database name, host, and port.
"""

import os
import sys
import subprocess
from urllib.parse import urlparse

def verify_db_identity(env_path: str) -> None:
    if not os.path.isfile(env_path):
        sys.exit(f"[DB IDENTITY ERROR] .env file not found at: {env_path}")

    # 1. Parse configured DATABASE_URL from .env
    db_url_raw = None
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                db_url_raw = line.split("=", 1)[1].strip().strip("\"'")
                break

    if not db_url_raw:
        sys.exit("[DB IDENTITY ERROR] DATABASE_URL not found in environment configuration.")

    parsed = urlparse(db_url_raw)
    cfg_user = parsed.username
    cfg_host = parsed.hostname or "localhost"
    cfg_port = parsed.port or 5432
    cfg_db = parsed.path.lstrip("/").split("?")[0]

    # Redacted log
    print("[DB IDENTITY] Parsed application configuration:")
    print(f"  - Configured Host: {cfg_host}")
    print(f"  - Configured Port: {cfg_port}")
    print(f"  - Configured Database: {cfg_db}")
    print(f"  - Configured User: {cfg_user}")
    print("  - Credentials: [REDACTED]")

    # 2. Strict expectations
    EXPECTED_DB = "company_os_dev"
    EXPECTED_PORT = 5432
    ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1"}

    if cfg_db != EXPECTED_DB:
        sys.exit(f"[DB IDENTITY FATAL] Configured database '{cfg_db}' does not match expected '{EXPECTED_DB}'!")

    if cfg_host not in ALLOWED_HOSTS:
        sys.exit(f"[DB IDENTITY FATAL] Configured host '{cfg_host}' is not a permitted local host!")

    if cfg_port != EXPECTED_PORT:
        sys.exit(f"[DB IDENTITY FATAL] Configured port '{cfg_port}' does not match expected '{EXPECTED_PORT}'!")

    # 3. Live connection verification via psql
    cmd = [
        "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", EXPECTED_DB,
        "-t", "-A", "-F", "|",
        "-c", "SELECT current_database(), coalesce(inet_server_port()::text, '5432'), current_user;"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"[DB IDENTITY FATAL] Failed to connect to {EXPECTED_DB}: {res.stderr.strip()}")

    parts = res.stdout.strip().split("|")
    if len(parts) != 3:
        sys.exit(f"[DB IDENTITY FATAL] Unexpected query output: {res.stdout.strip()}")

    live_db, live_port, live_user = parts
    live_port = int(live_port)

    print("[DB IDENTITY] Verified active connection:")
    print(f"  - Live Database: {live_db}")
    print(f"  - Live Port: {live_port}")
    print(f"  - Live User: {live_user}")

    if live_db != EXPECTED_DB:
        sys.exit(f"[DB IDENTITY FATAL] Live database '{live_db}' mismatch!")

    if live_port != EXPECTED_PORT:
        sys.exit(f"[DB IDENTITY FATAL] Live port '{live_port}' mismatch!")

    if cfg_user and live_user != cfg_user:
        sys.exit(f"[DB IDENTITY FATAL] User mismatch: configured '{cfg_user}' vs live '{live_user}'!")

    print("[DB IDENTITY SUCCESS] Database identity positively confirmed as company_os_dev on local port 5432.")

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.realpath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, ".."))
    env_file = os.path.join(project_root, ".env")
    verify_db_identity(env_file)

