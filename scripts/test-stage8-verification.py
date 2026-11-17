#!/usr/bin/env python3
"""
Unit and Integration Tests for Stage 8 Quarantine Artifact Verification
Tests all 8 required edge cases against isolated temporary directories and mock fixtures.
Zero destructive actions.
"""

import os
import sys
import json
import shutil
import hashlib
import tempfile
import unittest
import importlib.util

# Dynamically import verify-quarantine-artifacts.py
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VERIFIER_PATH = os.path.join(SCRIPT_DIR, "verify-quarantine-artifacts.py")
spec = importlib.util.spec_from_file_location("verify_quarantine_artifacts", VERIFIER_PATH)
verifier = importlib.util.module_from_spec(spec)
sys.modules["verify_quarantine_artifacts"] = verifier
spec.loader.exec_module(verifier)

compute_sha256 = verifier.compute_sha256
verify_quarantine_directory = verifier.verify_quarantine_directory

class TestStage8QuarantineVerification(unittest.TestCase):
    def setUp(self):
        self.test_root = tempfile.mkdtemp(prefix="cyraops_stage8_test_")
        self.quarantine_dir = os.path.join(self.test_root, "quarantine_target")
        os.makedirs(self.quarantine_dir, mode=0o700)

        # Generate exactly 34 mock files and their manifests
        self.mock_files = []
        for i in range(1, 35):
            file_key = f"mock_inv_{i:03d}_{hashlib.md5(str(i).encode()).hexdigest()[:8]}.pdf"
            content = f"Mock invoice content for file {i:03d} - random padding {i * 12345}".encode("utf-8")
            file_path = os.path.join(self.quarantine_dir, file_key)
            with open(file_path, "wb") as f:
                f.write(content)

            sha256_digest = hashlib.sha256(content).hexdigest()
            self.mock_files.append({
                "invoiceRecordId": f"cmvzw_mock_id_{i:04d}",
                "fileKey": file_key,
                "fileName": f"test_invoice_{i:03d}.pdf",
                "fileSizeBytes": len(content),
                "sha256": sha256_digest,
                "sourcePath": f"/fake/uploads/{file_key}"
            })

        # Write authoritative purge-file-manifest.json
        self.purge_manifest_path = os.path.join(self.test_root, "purge-file-manifest.json")
        with open(self.purge_manifest_path, "w", encoding="utf-8") as f:
            json.dump({
                "manifestMetadata": {"totalFiles": 34},
                "files": self.mock_files
            }, f, indent=2)

        # Write quarantine-completion-manifest.json in quarantine_dir
        self.completion_manifest_path = os.path.join(self.quarantine_dir, "quarantine-completion-manifest.json")
        with open(self.completion_manifest_path, "w", encoding="utf-8") as f:
            json.dump({
                "status": "VERIFIED_COMPLETE",
                "totalFilesQuarantined": 34,
                "files": self.mock_files
            }, f, indent=2)

    def tearDown(self):
        shutil.rmtree(self.test_root, ignore_errors=True)

    def test_01_valid_34_file_fixture_passes(self):
        """Test 1: Valid 34-file fixture passes with matching manifests, sizes, and SHA-256."""
        res = verify_quarantine_directory(
            quarantine_dir=self.quarantine_dir,
            purge_manifest_path=self.purge_manifest_path,
            expected_count=34
        )
        self.assertEqual(res["status"], "VERIFIED_VALID")
        self.assertEqual(res["totalFilesVerified"], 34)

    def test_02_wrong_file_size_fails(self):
        """Test 2: Wrong file size on disk fails validation."""
        target_file = os.path.join(self.quarantine_dir, self.mock_files[0]["fileKey"])
        # Append extra byte to change size
        with open(target_file, "ab") as f:
            f.write(b"X")

        with self.assertRaises(ValueError) as ctx:
            verify_quarantine_directory(
                quarantine_dir=self.quarantine_dir,
                purge_manifest_path=self.purge_manifest_path,
                expected_count=34
            )
        self.assertIn("Size mismatch", str(ctx.exception))

    def test_03_wrong_sha256_fails(self):
        """Test 3: Wrong SHA-256 digest fails validation."""
        target_file = os.path.join(self.quarantine_dir, self.mock_files[0]["fileKey"])
        # Modify file content while keeping identical length
        with open(target_file, "r+b") as f:
            b = f.read(1)
            new_b = b"B" if b == b"A" else b"A"
            f.seek(0)
            f.write(new_b)

        with self.assertRaises(ValueError) as ctx:
            verify_quarantine_directory(
                quarantine_dir=self.quarantine_dir,
                purge_manifest_path=self.purge_manifest_path,
                expected_count=34
            )
        self.assertIn("SHA-256 mismatch", str(ctx.exception))

    def test_04_missing_file_fails(self):
        """Test 4: Missing file from quarantine directory fails validation."""
        target_file = os.path.join(self.quarantine_dir, self.mock_files[5]["fileKey"])
        os.remove(target_file)

        with self.assertRaises(FileNotFoundError) as ctx:
            verify_quarantine_directory(
                quarantine_dir=self.quarantine_dir,
                purge_manifest_path=self.purge_manifest_path,
                expected_count=34
            )
        self.assertIn("Missing expected file", str(ctx.exception))

    def test_05_duplicate_file_key_fails(self):
        """Test 5: Duplicate fileKey in manifest fails validation."""
        # Inject duplicate fileKey into purge manifest
        corrupt_files = list(self.mock_files)
        corrupt_files[1] = dict(corrupt_files[0]) # duplicate key
        with open(self.purge_manifest_path, "w", encoding="utf-8") as f:
            json.dump({"files": corrupt_files}, f)

        with self.assertRaises(ValueError) as ctx:
            verify_quarantine_directory(
                quarantine_dir=self.quarantine_dir,
                purge_manifest_path=self.purge_manifest_path,
                expected_count=34
            )
        self.assertIn("Duplicate fileKey", str(ctx.exception))

    def test_06_unexpected_extra_destination_file_fails(self):
        """Test 6: Unexpected extra file in quarantine directory fails validation."""
        extra_file = os.path.join(self.quarantine_dir, "unexpected_extra_intruder.txt")
        with open(extra_file, "w") as f:
            f.write("I am an unexpected extra file")

        with self.assertRaises(ValueError) as ctx:
            verify_quarantine_directory(
                quarantine_dir=self.quarantine_dir,
                purge_manifest_path=self.purge_manifest_path,
                expected_count=34
            )
        self.assertIn("Unexpected extra file", str(ctx.exception))

    def test_07_missing_size_field_fails(self):
        """Test 7: Missing fileSizeBytes field in manifest fails validation."""
        corrupt_files = []
        for i, f in enumerate(self.mock_files):
            entry = dict(f)
            if i == 0:
                del entry["fileSizeBytes"] # omit size field
            corrupt_files.append(entry)

        with open(self.purge_manifest_path, "w", encoding="utf-8") as f:
            json.dump({"files": corrupt_files}, f)

        with self.assertRaises(ValueError) as ctx:
            verify_quarantine_directory(
                quarantine_dir=self.quarantine_dir,
                purge_manifest_path=self.purge_manifest_path,
                expected_count=34
            )
        self.assertIn("missing required field", str(ctx.exception))

    def test_08_missing_sha256_field_fails(self):
        """Test 8: Missing sha256 field in manifest fails validation."""
        corrupt_files = []
        for i, f in enumerate(self.mock_files):
            entry = dict(f)
            if i == 0:
                del entry["sha256"] # omit sha256 field
            corrupt_files.append(entry)

        with open(self.purge_manifest_path, "w", encoding="utf-8") as f:
            json.dump({"files": corrupt_files}, f)

        with self.assertRaises(ValueError) as ctx:
            verify_quarantine_directory(
                quarantine_dir=self.quarantine_dir,
                purge_manifest_path=self.purge_manifest_path,
                expected_count=34
            )
        self.assertIn("missing required field", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()

