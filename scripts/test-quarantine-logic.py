#!/usr/bin/env python3
"""
Unit and Integration Test Suite for Quarantine and Guarded Recovery Logic
Uses isolated temporary directories and mock fixtures only.
Zero impact on actual project files.
"""

import os
import sys
import json
import shutil
import hashlib
import tempfile
import unittest

import importlib.util

script_file = os.path.abspath(os.path.join(os.path.dirname(__file__), "quarantine-synthetic-files.py"))
spec = importlib.util.spec_from_file_location("quarantine_synthetic_files", script_file)
quarantine_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quarantine_mod)

compute_sha256 = quarantine_mod.compute_sha256
validate_manifest = quarantine_mod.validate_manifest
run_quarantine = quarantine_mod.run_quarantine
run_recovery = quarantine_mod.run_recovery
guarded_rollback = quarantine_mod.guarded_rollback

class TestQuarantineLogic(unittest.TestCase):
    def setUp(self):
        self.test_root = tempfile.mkdtemp(prefix="cyraops_quarantine_test_")
        self.mock_uploads = os.path.join(self.test_root, "uploads")
        self.mock_backups = os.path.join(self.test_root, "backups")
        os.makedirs(self.mock_uploads)
        os.makedirs(self.mock_backups)

        # Create 3 mock fixture files
        self.fixtures = []
        for i in range(1, 4):
            key = f"00000000-0000-0000-0000-00000000000{i}.pdf"
            path = os.path.join(self.mock_uploads, key)
            content = f"Mock invoice content {i} - {datetime_token}".encode("utf-8")
            with open(path, "wb") as f:
                f.write(content)
            sha256 = hashlib.sha256(content).hexdigest()
            self.fixtures.append({
                "invoiceRecordId": f"rec_{i}",
                "fileKey": key,
                "fileName": f"mock_inv_{i}.pdf",
                "fileSizeBytes": len(content),
                "sha256": sha256,
                "sourcePath": path
            })

        self.manifest_path = os.path.join(self.test_root, "manifest.json")
        with open(self.manifest_path, "w", encoding="utf-8") as f:
            json.dump({"files": self.fixtures}, f)

    def tearDown(self):
        shutil.rmtree(self.test_root)

    def test_01_successful_quarantine_and_recovery(self):
        dest_dir = os.path.join(self.mock_backups, "quarantine_target")
        res = run_quarantine(
            manifest_path=self.manifest_path,
            uploads_dir=self.mock_uploads,
            quarantine_dir=dest_dir,
            expected_count=3
        )
        self.assertEqual(res["status"], "COMPLETED")
        self.assertEqual(res["quarantinedCount"], 3)
        self.assertEqual(len(os.listdir(self.mock_uploads)), 0)
        self.assertTrue(os.path.isfile(os.path.join(dest_dir, "quarantine-completion-manifest.json")))

        # Test recovery
        rec_res = run_recovery(quarantine_dir=dest_dir, uploads_dir=self.mock_uploads)
        self.assertEqual(rec_res["status"], "RESTORED")
        self.assertEqual(rec_res["restoredCount"], 3)
        self.assertEqual(len(os.listdir(self.mock_uploads)), 3)

        # Verify checksums after restore
        for fix in self.fixtures:
            path = os.path.join(self.mock_uploads, fix["fileKey"])
            self.assertTrue(os.path.isfile(path))
            self.assertEqual(compute_sha256(path), fix["sha256"])

    def test_02_symlink_rejection(self):
        # Create a symlink
        symlink_path = os.path.join(self.mock_uploads, "symlink.pdf")
        os.symlink(self.fixtures[0]["sourcePath"], symlink_path)
        bad_fixtures = list(self.fixtures)
        bad_fixtures.append({
            "invoiceRecordId": "rec_sym",
            "fileKey": "symlink.pdf",
            "fileName": "symlink.pdf",
            "fileSizeBytes": self.fixtures[0]["fileSizeBytes"],
            "sha256": self.fixtures[0]["sha256"],
            "sourcePath": symlink_path
        })
        bad_manifest = os.path.join(self.test_root, "bad_manifest.json")
        with open(bad_manifest, "w") as f:
            json.dump({"files": bad_fixtures}, f)

        dest_dir = os.path.join(self.mock_backups, "quarantine_target")
        with self.assertRaises(ValueError) as ctx:
            run_quarantine(bad_manifest, self.mock_uploads, dest_dir, expected_count=4)
        self.assertIn("Symlink rejected", str(ctx.exception))

    def test_03_path_escape_rejection(self):
        outside_path = os.path.join(self.test_root, "outside.pdf")
        with open(outside_path, "wb") as f:
            f.write(b"outside")
        bad_fixtures = list(self.fixtures)
        bad_fixtures.append({
            "invoiceRecordId": "rec_out",
            "fileKey": "outside.pdf",
            "fileName": "outside.pdf",
            "fileSizeBytes": 7,
            "sha256": hashlib.sha256(b"outside").hexdigest(),
            "sourcePath": outside_path
        })
        bad_manifest = os.path.join(self.test_root, "escape_manifest.json")
        with open(bad_manifest, "w") as f:
            json.dump({"files": bad_fixtures}, f)

        dest_dir = os.path.join(self.mock_backups, "quarantine_target")
        with self.assertRaises(ValueError) as ctx:
            run_quarantine(bad_manifest, self.mock_uploads, dest_dir, expected_count=4)
        self.assertIn("File path escape detected", str(ctx.exception))

    def test_04_checksum_tamper_rejection(self):
        bad_fixtures = [dict(f) for f in self.fixtures]
        bad_fixtures[1]["sha256"] = "0000000000000000000000000000000000000000000000000000000000000000"
        bad_manifest = os.path.join(self.test_root, "tamper_manifest.json")
        with open(bad_manifest, "w") as f:
            json.dump({"files": bad_fixtures}, f)

        dest_dir = os.path.join(self.mock_backups, "quarantine_target")
        with self.assertRaises(ValueError) as ctx:
            run_quarantine(bad_manifest, self.mock_uploads, dest_dir, expected_count=3)
        self.assertIn("SHA-256 mismatch", str(ctx.exception))

    def test_05_guarded_rollback_on_partial_failure(self):
        dest_dir = os.path.join(self.mock_backups, "partial_target")
        os.makedirs(dest_dir)

        # Manually move file 1 and 2 to quarantine
        shutil.move(self.fixtures[0]["sourcePath"], os.path.join(dest_dir, self.fixtures[0]["fileKey"]))
        shutil.move(self.fixtures[1]["sourcePath"], os.path.join(dest_dir, self.fixtures[1]["fileKey"]))
        moved = [self.fixtures[0], self.fixtures[1]]

        # Execute rollback
        rb_res = guarded_rollback(moved, dest_dir, self.mock_uploads)
        self.assertEqual(rb_res["restoredCount"], 2)
        self.assertEqual(rb_res["failedRestoreCount"], 0)

        # Confirm all 3 files are back in uploads
        self.assertEqual(len(os.listdir(self.mock_uploads)), 3)

    def test_06_recovery_refuses_to_overwrite_occupied_source(self):
        dest_dir = os.path.join(self.mock_backups, "occupied_target")
        run_quarantine(self.manifest_path, self.mock_uploads, dest_dir, expected_count=3)

        # Create an obstacle file at source 1
        with open(self.fixtures[0]["sourcePath"], "wb") as f:
            f.write(b"new obstacle file")

        # Recovery must refuse to overwrite
        with self.assertRaises(FileExistsError) as ctx:
            run_recovery(quarantine_dir=dest_dir, uploads_dir=self.mock_uploads)
        self.assertIn("already occupied (cannot overwrite)", str(ctx.exception))


if __name__ == "__main__":
    import time
    datetime_token = str(time.time())
    unittest.main()
