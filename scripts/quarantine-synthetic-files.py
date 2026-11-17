#!/usr/bin/env python3
"""
Cyraops Company OS — Fail-Safe Synthetic Uploads Quarantine & Recovery Engine
Manages verified quarantine and guarded restoration of synthetic invoice uploads.
"""

import os
import sys
import json
import stat
import shutil
import hashlib
import argparse
from datetime import datetime
from typing import Dict, List, Any, Optional

def compute_sha256(file_path: str) -> str:
    """Computes SHA-256 digest of a regular file."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def validate_manifest(
    manifest_data: Dict[str, Any],
    uploads_dir: str,
    expected_count: Optional[int] = 34
) -> List[Dict[str, Any]]:
    """Validates manifest integrity, canonical paths, types, sizes and digests."""
    files = manifest_data.get("files", [])
    if expected_count is not None and len(files) != expected_count:
        raise ValueError(f"Manifest entry count mismatch: expected {expected_count}, found {len(files)}")

    # Uniqueness checks
    record_ids = [f["invoiceRecordId"] for f in files]
    file_keys = [f["fileKey"] for f in files]
    source_paths = [f["sourcePath"] for f in files]

    if len(set(record_ids)) != len(files):
        raise ValueError("Duplicate invoiceRecordId detected in manifest")
    if len(set(file_keys)) != len(files):
        raise ValueError("Duplicate fileKey detected in manifest")
    if len(set(source_paths)) != len(files):
        raise ValueError("Duplicate sourcePath detected in manifest")

    canonical_uploads = os.path.realpath(uploads_dir)
    if not os.path.isdir(canonical_uploads):
        raise ValueError(f"Uploads directory does not exist or is not a directory: {canonical_uploads}")

    # Inspect every entry
    for entry in files:
        raw_path = entry["sourcePath"]
        file_key = entry["fileKey"]

        # 1. Symlink rejection on raw path
        if os.path.islink(raw_path):
            raise ValueError(f"Symlink rejected: {raw_path}")

        # 2. Canonical path resolution
        canonical_src = os.path.realpath(raw_path)
        if os.path.islink(canonical_src):
            raise ValueError(f"Symlink rejected after resolution: {canonical_src}")

        # 3. Boundary check: must be directly inside canonical uploads
        if os.path.dirname(canonical_src) != canonical_uploads:
            raise ValueError(f"File path escape detected: {canonical_src} is outside {canonical_uploads}")

        # 4. Filename matches fileKey
        if os.path.basename(canonical_src) != file_key:
            raise ValueError(f"Filename mismatch: {os.path.basename(canonical_src)} != manifest fileKey {file_key}")

        # 5. Regular file check
        if not os.path.isfile(canonical_src):
            raise ValueError(f"Target is not a regular file: {canonical_src}")
        st = os.stat(canonical_src)
        if not stat.S_ISREG(st.st_mode):
            raise ValueError(f"Special file type rejected: {canonical_src} (mode {oct(st.st_mode)})")

        # 6. File size verification
        actual_size = st.st_size
        if actual_size != entry["fileSizeBytes"]:
            raise ValueError(f"Size mismatch for {file_key}: expected {entry['fileSizeBytes']}B, got {actual_size}B")

        # 7. Checksum verification
        actual_sha = compute_sha256(canonical_src)
        if actual_sha != entry["sha256"]:
            raise ValueError(f"SHA-256 mismatch for {file_key}: expected {entry['sha256']}, got {actual_sha}")

    return files

def guarded_rollback(
    moved_records: List[Dict[str, Any]],
    quarantine_dir: str,
    uploads_dir: str
) -> Dict[str, Any]:
    """Carefully guarded recovery procedure for partial moves."""
    canonical_uploads = os.path.realpath(uploads_dir)
    restored = []
    failed_restore = []

    print("[RECOVERY] Initiating guarded rollback for partially moved files...")
    for item in moved_records:
        file_key = item["fileKey"]
        src_path = os.path.realpath(item["sourcePath"])
        dst_path = os.path.join(quarantine_dir, file_key)

        # Safety checks before restoring
        if not os.path.isfile(dst_path) or os.path.islink(dst_path):
            failed_restore.append({
                "fileKey": file_key,
                "reason": f"Quarantine destination file missing or invalid: {dst_path}"
            })
            continue

        # Verify destination checksum matches manifest
        dst_sha = compute_sha256(dst_path)
        if dst_sha != item["sha256"]:
            failed_restore.append({
                "fileKey": file_key,
                "reason": f"Destination checksum mismatch: expected {item['sha256']}, found {dst_sha}"
            })
            continue

        # Verify original source path is clear (never overwrite)
        if os.path.exists(src_path):
            failed_restore.append({
                "fileKey": file_key,
                "reason": f"Source path already occupied (cannot overwrite): {src_path}"
            })
            continue

        # Perform move back
        try:
            shutil.move(dst_path, src_path)
            # Verify restored file
            if compute_sha256(src_path) == item["sha256"]:
                restored.append(file_key)
            else:
                failed_restore.append({
                    "fileKey": file_key,
                    "reason": "Checksum corrupted during move back to source"
                })
        except Exception as e:
            failed_restore.append({
                "fileKey": file_key,
                "reason": f"Exception during move back: {str(e)}"
            })

    return {
        "restoredCount": len(restored),
        "restoredFiles": restored,
        "failedRestoreCount": len(failed_restore),
        "failedRestoreDetails": failed_restore
    }

def run_quarantine(
    manifest_path: str,
    uploads_dir: str,
    quarantine_dir: Optional[str] = None,
    expected_count: Optional[int] = 34,
    dry_run: bool = False
) -> Dict[str, Any]:
    """Executes the full 12-point fail-safe quarantine protocol."""
    # 1. Load manifest
    if not os.path.isfile(manifest_path):
        raise FileNotFoundError(f"Manifest file not found: {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest_data = json.load(f)

    # 2. Validate all 34 files before any modification
    print(f"[QUARANTINE] Pre-flight validation of {len(manifest_data.get('files', []))} files...")
    files = validate_manifest(manifest_data, uploads_dir, expected_count=expected_count)
    print(f"[QUARANTINE] All {len(files)} files passed strict pre-flight checks (sizes and SHA-256 verified).")

    if dry_run:
        print("[QUARANTINE] DRY RUN MODE: No files moved.")
        return {"status": "DRY_RUN_PASSED", "totalFiles": len(files)}

    # 3. Setup quarantine destination
    if quarantine_dir is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        quarantine_dir = os.path.join(project_root, "backups", f"quarantine_uploads_{ts}")

    if os.path.exists(quarantine_dir):
        raise FileExistsError(f"Quarantine destination already exists: {quarantine_dir}")

    os.makedirs(quarantine_dir, mode=0o700)
    print(f"[QUARANTINE] Created secure quarantine directory: {quarantine_dir} (mode 0700)")

    moved_records: List[Dict[str, Any]] = []
    all_keys = [f["fileKey"] for f in files]

    try:
        # Move files one by one with strict tracking
        for item in files:
            src = os.path.realpath(item["sourcePath"])
            dst = os.path.join(quarantine_dir, item["fileKey"])
            if os.path.exists(dst):
                raise FileExistsError(f"Destination already exists: {dst}")
            shutil.move(src, dst)
            moved_records.append(item)

        # Post-move validation
        quarantined_entries = set(os.listdir(quarantine_dir))
        expected_set = set(all_keys)
        if quarantined_entries != expected_set:
            diff_missing = expected_set - quarantined_entries
            diff_extra = quarantined_entries - expected_set
            raise RuntimeError(f"Post-move directory contents mismatch! Missing: {diff_missing}, Extra: {diff_extra}")

        # Post-move checksum recalculation
        for item in files:
            dst = os.path.join(quarantine_dir, item["fileKey"])
            st = os.stat(dst)
            if st.st_size != item["fileSizeBytes"]:
                raise RuntimeError(f"Post-move size mismatch for {item['fileKey']}")
            actual_sha = compute_sha256(dst)
            if actual_sha != item["sha256"]:
                raise RuntimeError(f"Post-move SHA-256 mismatch for {item['fileKey']}")

        # Write completion manifest only after all post-move checks pass
        completion_manifest = {
            "quarantineTimestamp": datetime.now().isoformat(),
            "quarantineDirectory": os.path.realpath(quarantine_dir),
            "totalFilesQuarantined": len(moved_records),
            "status": "VERIFIED_COMPLETE",
            "files": files
        }
        manifest_out = os.path.join(quarantine_dir, "quarantine-completion-manifest.json")
        with open(manifest_out, "w", encoding="utf-8") as f:
            json.dump(completion_manifest, f, indent=2)
        os.chmod(manifest_out, 0o600)

        print(f"[QUARANTINE] SUCCESS: Exactly {len(moved_records)} files quarantined and verified in {quarantine_dir}")
        return {
            "status": "COMPLETED",
            "quarantineDirectory": quarantine_dir,
            "quarantinedCount": len(moved_records)
        }

    except Exception as exc:
        print(f"[QUARANTINE ERROR] Halting quarantine: {exc}", file=sys.stderr)
        rollback_res = guarded_rollback(moved_records, quarantine_dir, uploads_dir)
        report = {
            "status": "HALTED_WITH_ERROR",
            "error": str(exc),
            "movedBeforeFailure": len(moved_records),
            "remainingInSource": len(files) - len(moved_records),
            "rollbackResult": rollback_res
        }
        print(f"[QUARANTINE ERROR REPORT]\n{json.dumps(report, indent=2)}", file=sys.stderr)
        raise RuntimeError(f"Quarantine failed: {exc}. Rollback report: {rollback_res}")

def run_recovery(
    quarantine_dir: str,
    uploads_dir: str
) -> Dict[str, Any]:
    """Restores quarantined files back to uploads using completion manifest."""
    manifest_path = os.path.join(quarantine_dir, "quarantine-completion-manifest.json")
    if not os.path.isfile(manifest_path):
        raise FileNotFoundError(f"Quarantine completion manifest missing: {manifest_path}")

    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    files = data.get("files", [])
    print(f"[RECOVERY] Validating recovery preconditions for {len(files)} files...")

    # Pre-flight check before any file is restored
    for item in files:
        file_key = item["fileKey"]
        dst_path = os.path.join(quarantine_dir, file_key)
        src_path = os.path.realpath(item["sourcePath"])

        if not os.path.isfile(dst_path):
            raise FileNotFoundError(f"Quarantined file missing: {dst_path}")
        if compute_sha256(dst_path) != item["sha256"]:
            raise ValueError(f"Checksum mismatch for quarantined file: {dst_path}")
        if os.path.exists(src_path):
            raise FileExistsError(f"Target upload path already occupied (cannot overwrite): {src_path}")

    # Perform restore
    restored = []
    for item in files:
        dst_path = os.path.join(quarantine_dir, item["fileKey"])
        src_path = os.path.realpath(item["sourcePath"])
        shutil.move(dst_path, src_path)
        restored.append(item["fileKey"])

    print(f"[RECOVERY] Successfully restored {len(restored)} files back to uploads directory.")
    return {"status": "RESTORED", "restoredCount": len(restored)}

def main():
    parser = argparse.ArgumentParser(description="Cyraops Fail-Safe Synthetic Uploads Quarantine Engine")
    parser.add_argument("--action", choices=["quarantine", "restore", "verify"], default="verify")
    parser.add_argument("--manifest", help="Path to purge-file-manifest.json")
    parser.add_argument("--uploads-dir", help="Path to uploads directory")
    parser.add_argument("--dest-dir", help="Explicit destination directory for quarantine")
    parser.add_argument("--expected-count", type=int, default=34, help="Expected manifest entries")
    parser.add_argument("--dry-run", action="store_true", help="Perform verification without file moves")

    args = parser.parse_args()

    # Determine default paths
    script_dir = os.path.dirname(os.path.realpath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, ".."))

    manifest_path = args.manifest or os.path.join(project_root, "docs", "business-launch", "purge-file-manifest.json")
    uploads_dir = args.uploads_dir or os.path.join(project_root, "uploads")

    if args.action == "verify":
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest_data = json.load(f)
        files = validate_manifest(manifest_data, uploads_dir, expected_count=args.expected_count)
        print(f"VERIFY SUCCESS: All {len(files)} manifest files exist and match sizes/checksums.")

    elif args.action == "quarantine":
        run_quarantine(
            manifest_path=manifest_path,
            uploads_dir=uploads_dir,
            quarantine_dir=args.dest_dir,
            expected_count=args.expected_count,
            dry_run=args.dry_run
        )

    elif args.action == "restore":
        if not args.dest_dir:
            sys.exit("ERROR: --dest-dir is required for restore action")
        run_recovery(quarantine_dir=args.dest_dir, uploads_dir=uploads_dir)

if __name__ == "__main__":
    main()

