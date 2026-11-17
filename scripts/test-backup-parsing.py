#!/usr/bin/env python3
"""
Unit Test Suite for Backup Output Parsing & Artifact Verification
Uses temporary fixture directories with spaces.
Tests all failure and success edge cases.
"""

import os
import sys
import stat
import shutil
import hashlib
import tempfile
import unittest

import importlib.util

script_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "verify-backup-artifacts.py"))
spec = importlib.util.spec_from_file_location("verify_backup_artifacts", script_file)
backup_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_mod)

compute_sha256 = backup_mod.compute_sha256
parse_backup_output = backup_mod.parse_backup_output
verify_backup_artifacts = backup_mod.verify_backup_artifacts

class TestBackupParsing(unittest.TestCase):
    def setUp(self):
        # Create directory path with SPACES to test space preservation
        self.test_root = tempfile.mkdtemp(prefix="cyraops test backup dir with spaces ")
        self.mock_backups = os.path.join(self.test_root, "backups with spaces")
        os.makedirs(self.mock_backups, mode=0o700)

        self.timestamp = "20261107_120000"
        self.dump_file = os.path.join(self.mock_backups, f"company_os_dev_{self.timestamp}.dump")
        self.uploads_file = os.path.join(self.mock_backups, f"company_os_dev_{self.timestamp}_uploads.tar.gz")
        self.manifest_file = os.path.join(self.mock_backups, f"company_os_dev_{self.timestamp}.manifest")

        # Create mock dump
        with open(self.dump_file, "wb") as f:
            f.write(b"MOCK PG DUMP BYTES")
        os.chmod(self.dump_file, 0o600)
        dump_sha = hashlib.sha256(b"MOCK PG DUMP BYTES").hexdigest()

        # Create mock uploads
        with open(self.uploads_file, "wb") as f:
            f.write(b"MOCK UPLOADS TAR BYTES")
        os.chmod(self.uploads_file, 0o600)
        uploads_sha = hashlib.sha256(b"MOCK UPLOADS TAR BYTES").hexdigest()

        # Create mock manifest
        manifest_content = f"{dump_sha}  {os.path.basename(self.dump_file)}\n{uploads_sha}  {os.path.basename(self.uploads_file)}\n"
        with open(self.manifest_file, "w", encoding="utf-8") as f:
            f.write(manifest_content)
        os.chmod(self.manifest_file, 0o600)

        # Standard simulated output from backup-db.sh
        self.valid_output = f"""
[2026-11-07 12:00:00] Starting Cyraops backup routine...
[2026-11-07 12:00:05] Backup routine completed successfully.
BACKUP_TIMESTAMP={self.timestamp}
BACKUP_DUMP={self.dump_file}
BACKUP_UPLOADS={self.uploads_file}
BACKUP_MANIFEST={self.manifest_file}
"""

    def tearDown(self):
        shutil.rmtree(self.test_root)

    def test_01_successful_parsing_and_verification_with_spaces(self):
        parsed = parse_backup_output(self.valid_output)
        self.assertEqual(parsed["BACKUP_TIMESTAMP"], self.timestamp)
        self.assertEqual(parsed["BACKUP_DUMP"], self.dump_file)
        self.assertTrue(" " in parsed["BACKUP_DUMP"])
        self.assertEqual(parsed["BACKUP_UPLOADS"], self.uploads_file)
        self.assertEqual(parsed["BACKUP_MANIFEST"], self.manifest_file)

        res = verify_backup_artifacts(parsed, self.mock_backups, skip_pg_restore=True)
        self.assertEqual(res["status"], "VERIFIED_VALID")
        self.assertEqual(res["timestamp"], self.timestamp)

    def test_02_duplicate_field_rejection(self):
        dup_output = self.valid_output + f"\nBACKUP_DUMP={self.dump_file}\n"
        with self.assertRaises(ValueError) as ctx:
            parse_backup_output(dup_output)
        self.assertIn("Duplicate field detected", str(ctx.exception))

    def test_03_missing_field_rejection(self):
        incomplete_output = f"""
BACKUP_TIMESTAMP={self.timestamp}
BACKUP_DUMP={self.dump_file}
BACKUP_UPLOADS={self.uploads_file}
"""
        with self.assertRaises(ValueError) as ctx:
            parse_backup_output(incomplete_output)
        self.assertIn("Missing required backup field", str(ctx.exception))

    def test_04_timestamp_mismatch_rejection(self):
        parsed = parse_backup_output(self.valid_output)
        parsed["BACKUP_TIMESTAMP"] = "20261107_999999"
        with self.assertRaises(ValueError) as ctx:
            verify_backup_artifacts(parsed, self.mock_backups, skip_pg_restore=True)
        self.assertIn("Timestamp mismatch", str(ctx.exception))

    def test_05_path_escape_rejection(self):
        parsed = parse_backup_output(self.valid_output)
        parsed["BACKUP_DUMP"] = "/etc/passwd"
        with self.assertRaises(ValueError) as ctx:
            verify_backup_artifacts(parsed, self.mock_backups, skip_pg_restore=True)
        self.assertIn("does not reside in expected backup dir", str(ctx.exception))

    def test_06_insecure_permissions_rejection(self):
        os.chmod(self.dump_file, 0o644)  # World readable
        parsed = parse_backup_output(self.valid_output)
        with self.assertRaises(ValueError) as ctx:
            verify_backup_artifacts(parsed, self.mock_backups, skip_pg_restore=True)
        self.assertIn("insecure permissions", str(ctx.exception))

    def test_07_checksum_tamper_rejection(self):
        with open(self.dump_file, "wb") as f:
            f.write(b"TAMPERED DUMP CONTENT")
        parsed = parse_backup_output(self.valid_output)
        with self.assertRaises(ValueError) as ctx:
            verify_backup_artifacts(parsed, self.mock_backups, skip_pg_restore=True)
        self.assertIn("SHA-256 mismatch", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
