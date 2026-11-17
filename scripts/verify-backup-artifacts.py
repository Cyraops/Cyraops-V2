#!/usr/bin/env python3
"""
Cyraops Company OS — Fail-Closed Backup Artifact Verifier
Safely parses backup output without eval, preserving paths with spaces,
and strictly validating artifact existence, sizes, permissions, and checksums.
"""

import os
import sys
import stat
import json
import shutil
import hashlib
import argparse
import subprocess
from typing import Dict, Any, Optional

def compute_sha256(file_path: str) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def parse_backup_output(raw_output: str) -> Dict[str, str]:
    """
    Parses structured BACKUP_* output lines safely without eval.
    Preserves spaces and rejects duplicate or unexpected keys.
    """
    required_keys = {"BACKUP_TIMESTAMP", "BACKUP_DUMP", "BACKUP_UPLOADS", "BACKUP_MANIFEST"}
    parsed: Dict[str, str] = {}

    for line in raw_output.splitlines():
        line = line.strip()
        if not line or not line.startswith("BACKUP_"):
            continue
        if "=" not in line:
            raise ValueError(f"Malformed backup output line: '{line}'")
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip()

        if key in required_keys:
            if key in parsed:
                raise ValueError(f"Duplicate field detected in backup output: '{key}'")
            if not val:
                raise ValueError(f"Empty value for required backup field: '{key}'")
            parsed[key] = val

    missing = required_keys - set(parsed.keys())
    if missing:
        raise ValueError(f"Missing required backup field(s) in output: {missing}")

    return parsed

def verify_backup_artifacts(
    parsed: Dict[str, str],
    expected_backup_dir: str,
    skip_pg_restore: bool = False
) -> Dict[str, Any]:
    """
    Verifies that all three artifacts exist, have matching timestamps,
    reside in expected directory, have mode 0600, non-zero size, and match checksums.
    """
    ts = parsed["BACKUP_TIMESTAMP"]
    dump_path = parsed["BACKUP_DUMP"]
    uploads_path = parsed["BACKUP_UPLOADS"]
    manifest_path = parsed["BACKUP_MANIFEST"]

    canonical_backup_dir = os.path.realpath(expected_backup_dir)

    # 1. Directory mode check
    if os.path.isdir(canonical_backup_dir):
        dir_mode = stat.S_IMODE(os.stat(canonical_backup_dir).st_mode)
        if dir_mode != 0o700:
            raise ValueError(f"Backup directory permissions not restricted (expected 0700, got {oct(dir_mode)})")

    # 2. Path resolution and containment
    for label, p in [("DUMP", dump_path), ("UPLOADS", uploads_path), ("MANIFEST", manifest_path)]:
        if os.path.islink(p):
            raise ValueError(f"Symlink rejected for {label} artifact: {p}")
        canonical_p = os.path.realpath(p)
        if os.path.dirname(canonical_p) != canonical_backup_dir:
            raise ValueError(f"Artifact {label} ({canonical_p}) does not reside in expected backup dir ({canonical_backup_dir})")

        # Verify filename shares the exact timestamp
        expected_prefix = f"company_os_dev_{ts}"
        if not os.path.basename(canonical_p).startswith(expected_prefix):
            raise ValueError(f"Timestamp mismatch on {label}: expected prefix '{expected_prefix}', got '{os.path.basename(canonical_p)}'")

        # Verify regular file, non-zero size
        if not os.path.isfile(canonical_p):
            raise FileNotFoundError(f"Artifact {label} does not exist: {canonical_p}")
        st = os.stat(canonical_p)
        if not stat.S_ISREG(st.st_mode):
            raise ValueError(f"Artifact {label} is not a regular file: {canonical_p}")
        if st.st_size == 0:
            raise ValueError(f"Artifact {label} has zero size: {canonical_p}")

        # Verify permissions: mode 0600
        mode = stat.S_IMODE(st.st_mode)
        if mode != 0o600:
            raise ValueError(f"Artifact {label} has insecure permissions (expected 0600, got {oct(mode)}): {canonical_p}")

    # 3. Dump archive validation (pg_restore --list)
    if not skip_pg_restore:
        cmd = ["pg_restore", "--list", dump_path]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"pg_restore --list failed on dump file ({dump_path}): {res.stderr.strip()}")

    # 4. Checksum manifest validation
    manifest_checksums: Dict[str, str] = {}
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) == 2:
                digest, filename = parts
                # filename can be preceded by * in binary mode
                filename = filename.lstrip("*")
                manifest_checksums[filename] = digest

    dump_filename = os.path.basename(dump_path)
    uploads_filename = os.path.basename(uploads_path)

    if dump_filename not in manifest_checksums:
        raise ValueError(f"Dump file '{dump_filename}' not found in checksum manifest: {manifest_path}")
    if uploads_filename not in manifest_checksums:
        raise ValueError(f"Uploads file '{uploads_filename}' not found in checksum manifest: {manifest_path}")

    actual_dump_sha = compute_sha256(dump_path)
    if actual_dump_sha != manifest_checksums[dump_filename]:
        raise ValueError(f"SHA-256 mismatch for dump: expected {manifest_checksums[dump_filename]}, got {actual_dump_sha}")

    actual_uploads_sha = compute_sha256(uploads_path)
    if actual_uploads_sha != manifest_checksums[uploads_filename]:
        raise ValueError(f"SHA-256 mismatch for uploads: expected {manifest_checksums[uploads_filename]}, got {actual_uploads_sha}")

    return {
        "status": "VERIFIED_VALID",
        "timestamp": ts,
        "dump": dump_path,
        "uploads": uploads_path,
        "manifest": manifest_path
    }

def main():
    parser = argparse.ArgumentParser(description="Cyraops Fail-Closed Backup Artifact Verifier")
    parser.add_argument("--backup-output", help="Raw output string from backup-db.sh")
    parser.add_argument("--backup-output-file", help="File containing backup-db.sh output")
    parser.add_argument("--expected-backup-dir", help="Expected backup directory path")
    parser.add_argument("--skip-pg-restore", action="store_true", help="Skip pg_restore --list (for test fixtures)")

    args = parser.parse_args()

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    expected_dir = args.expected_backup_dir or os.path.join(project_root, "backups")

    raw_text = ""
    if args.backup_output:
        raw_text = args.backup_output
    elif args.backup_output_file:
        with open(args.backup_output_file, "r", encoding="utf-8") as f:
            raw_text = f.read()
    else:
        # Read from stdin
        raw_text = sys.stdin.read()

    try:
        parsed = parse_backup_output(raw_text)
        result = verify_backup_artifacts(parsed, expected_dir, skip_pg_restore=args.skip_pg_restore)
        print(f"[BACKUP VERIFICATION SUCCESS] Artifacts for timestamp {result['timestamp']} verified.")
        print(f"  - Dump: {result['dump']}")
        print(f"  - Uploads: {result['uploads']}")
        print(f"  - Manifest: {result['manifest']}")
        sys.exit(0)
    except Exception as exc:
        print(f"[BACKUP VERIFICATION ERROR] {str(exc)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

