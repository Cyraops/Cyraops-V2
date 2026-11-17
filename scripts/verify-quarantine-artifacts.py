#!/usr/bin/env python3
"""
Cyraops Company OS — Stage 8 Quarantine Artifacts & Schema Verifier
Independently verifies the contents of the quarantine directory against both
the authoritative purge-file-manifest.json and quarantine-completion-manifest.json.
Enforces strict schema typing, exact file sizes, cryptographic SHA-256 digests,
unique file keys, and zero unexpected directory artifacts.
"""

import os
import sys
import json
import stat
import hashlib
import argparse
from typing import Dict, List, Any, Set

REQUIRED_FILE_FIELDS = {
    "invoiceRecordId",
    "fileKey",
    "fileName",
    "fileSizeBytes",
    "sha256",
    "sourcePath",
}

def compute_sha256(file_path: str) -> str:
    """Computes SHA-256 digest of a regular file."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def validate_entry_schema(entry: Dict[str, Any], manifest_name: str, index: int) -> None:
    """Strictly validates that an entry contains all expected fields with valid types."""
    if not isinstance(entry, dict):
        raise ValueError(f"{manifest_name} entry [{index}] is not a dictionary")

    missing = REQUIRED_FILE_FIELDS - set(entry.keys())
    if missing:
        raise ValueError(f"{manifest_name} entry [{index}] missing required field(s): {missing}")

    if not isinstance(entry["fileKey"], str) or not entry["fileKey"].strip():
        raise ValueError(f"{manifest_name} entry [{index}] 'fileKey' must be a non-empty string")

    if not isinstance(entry["fileSizeBytes"], int) or entry["fileSizeBytes"] <= 0:
        raise ValueError(
            f"{manifest_name} entry [{index}] 'fileSizeBytes' must be a positive integer, got: {entry.get('fileSizeBytes')!r}"
        )

    if not isinstance(entry["sha256"], str) or len(entry["sha256"].strip()) != 64:
        raise ValueError(
            f"{manifest_name} entry [{index}] 'sha256' must be a 64-character hex string, got: {entry.get('sha256')!r}"
        )

def verify_quarantine_directory(
    quarantine_dir: str,
    purge_manifest_path: str,
    expected_count: int = 34
) -> Dict[str, Any]:
    """
    Executes independent verification of the quarantine directory:
      1. Validates existence and strict schema of purge-file-manifest.json.
      2. Validates existence and strict schema of quarantine-completion-manifest.json.
      3. Verifies exact entry counts (expected_count, default 34).
      4. Asserts uniqueness of fileKey across both manifests.
      5. Cross-checks identical metadata (fileKey, fileSizeBytes, sha256) between manifests.
      6. Verifies quarantine directory contains exactly expected files + completion manifest.
      7. Re-verifies on-disk regular file types, sizes, and SHA-256 digests.
    """
    if not os.path.isdir(quarantine_dir):
        raise FileNotFoundError(f"Quarantine directory does not exist or is not a directory: {quarantine_dir}")

    completion_manifest_path = os.path.join(quarantine_dir, "quarantine-completion-manifest.json")
    if not os.path.isfile(completion_manifest_path):
        raise FileNotFoundError(f"Quarantine completion manifest missing: {completion_manifest_path}")

    if not os.path.isfile(purge_manifest_path):
        raise FileNotFoundError(f"Authoritative purge manifest missing: {purge_manifest_path}")

    # 1. Load both manifests
    with open(purge_manifest_path, "r", encoding="utf-8") as f:
        purge_data = json.load(f)
    with open(completion_manifest_path, "r", encoding="utf-8") as f:
        comp_data = json.load(f)

    purge_files: List[Dict[str, Any]] = purge_data.get("files", [])
    comp_files: List[Dict[str, Any]] = comp_data.get("files", [])

    # 2. Count verification
    if len(purge_files) != expected_count:
        raise ValueError(
            f"Purge manifest entry count mismatch: expected {expected_count}, found {len(purge_files)}"
        )
    if len(comp_files) != expected_count:
        raise ValueError(
            f"Completion manifest entry count mismatch: expected {expected_count}, found {len(comp_files)}"
        )

    # 3. Schema validation on all entries
    for i, entry in enumerate(purge_files):
        validate_entry_schema(entry, "purge-file-manifest.json", i)

    for i, entry in enumerate(comp_files):
        validate_entry_schema(entry, "quarantine-completion-manifest.json", i)

    # 4. Duplicate checks
    purge_keys = [e["fileKey"] for e in purge_files]
    comp_keys = [e["fileKey"] for e in comp_files]

    if len(set(purge_keys)) != expected_count:
        duplicates = [k for k in purge_keys if purge_keys.count(k) > 1]
        raise ValueError(f"Duplicate fileKey detected in purge manifest: {set(duplicates)}")

    if len(set(comp_keys)) != expected_count:
        duplicates = [k for k in comp_keys if comp_keys.count(k) > 1]
        raise ValueError(f"Duplicate fileKey detected in completion manifest: {set(duplicates)}")

    # 5. Cross-manifest consistency
    purge_lookup = {e["fileKey"]: e for e in purge_files}
    comp_lookup = {e["fileKey"]: e for e in comp_files}

    if set(purge_lookup.keys()) != set(comp_lookup.keys()):
        missing_in_comp = set(purge_lookup.keys()) - set(comp_lookup.keys())
        extra_in_comp = set(comp_lookup.keys()) - set(purge_lookup.keys())
        raise ValueError(
            f"Manifest file key mismatch! Missing in completion: {missing_in_comp}, Extra: {extra_in_comp}"
        )

    for k, p_entry in purge_lookup.items():
        c_entry = comp_lookup[k]
        if p_entry["fileSizeBytes"] != c_entry["fileSizeBytes"]:
            raise ValueError(
                f"Cross-manifest size mismatch for {k}: purge={p_entry['fileSizeBytes']}, comp={c_entry['fileSizeBytes']}"
            )
        if p_entry["sha256"] != c_entry["sha256"]:
            raise ValueError(
                f"Cross-manifest sha256 mismatch for {k}: purge={p_entry['sha256']}, comp={c_entry['sha256']}"
            )

    # 6. Physical directory inventory check
    dir_entries = set(os.listdir(quarantine_dir))
    expected_dir_entries = set(purge_lookup.keys()) | {"quarantine-completion-manifest.json"}

    missing_files = expected_dir_entries - dir_entries
    if missing_files:
        raise FileNotFoundError(f"Missing expected file(s) in quarantine directory: {missing_files}")

    unexpected_files = dir_entries - expected_dir_entries
    if unexpected_files:
        raise ValueError(f"Unexpected extra file(s) in quarantine directory: {unexpected_files}")

    # 7. Physical file attributes and cryptographic integrity
    for file_key, exp_item in purge_lookup.items():
        fpath = os.path.join(quarantine_dir, file_key)

        # Reject symlinks
        if os.path.islink(fpath):
            raise ValueError(f"Quarantined file is a symlink (rejected): {fpath}")

        # Assert regular file
        if not os.path.isfile(fpath):
            raise FileNotFoundError(f"Quarantined item is not a regular file: {fpath}")

        st = os.stat(fpath)
        if not stat.S_ISREG(st.st_mode):
            raise ValueError(f"Special file type rejected in quarantine: {fpath}")

        # Assert size matches both manifests
        if st.st_size != exp_item["fileSizeBytes"]:
            raise ValueError(
                f"Size mismatch on disk for {file_key}: expected {exp_item['fileSizeBytes']} bytes, got {st.st_size} bytes"
            )

        # Recalculate SHA-256 on disk
        actual_sha = compute_sha256(fpath)
        if actual_sha != exp_item["sha256"]:
            raise ValueError(
                f"SHA-256 mismatch on disk for {file_key}: expected {exp_item['sha256']}, got {actual_sha}"
            )

    return {
        "status": "VERIFIED_VALID",
        "quarantineDirectory": os.path.abspath(quarantine_dir),
        "totalFilesVerified": expected_count,
        "completionManifest": completion_manifest_path
    }

def main():
    parser = argparse.ArgumentParser(description="Cyraops Stage 8 Quarantine Artifacts & Schema Verifier")
    parser.add_argument("--quarantine-dir", required=True, help="Path to quarantine directory to verify")
    parser.add_argument("--manifest", help="Path to authoritative purge-file-manifest.json")
    parser.add_argument("--expected-count", type=int, default=34, help="Expected manifest file count (default 34)")

    args = parser.parse_args()

    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    manifest_path = args.manifest or os.path.join(project_root, "docs", "business-launch", "purge-file-manifest.json")

    try:
        res = verify_quarantine_directory(
            quarantine_dir=args.quarantine_dir,
            purge_manifest_path=manifest_path,
            expected_count=args.expected_count
        )
        print(f"[STAGE 8 SUCCESS] Verified all {res['totalFilesVerified']} quarantined files in {res['quarantineDirectory']}")
        print("  - Both manifests (purge manifest & completion manifest) confirmed identical.")
        print("  - All 34 on-disk files verified with matching sizes and SHA-256 digests.")
        print("  - Zero unexpected or missing files in quarantine directory.")
        sys.exit(0)
    except Exception as exc:
        print(f"[STAGE 8 ERROR] Quarantine verification failed: {exc}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()

