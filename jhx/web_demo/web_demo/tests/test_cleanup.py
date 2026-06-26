from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


WEB_DEMO = Path(__file__).resolve().parents[1]
if str(WEB_DEMO) not in sys.path:
    sys.path.insert(0, str(WEB_DEMO))

import server  # noqa: E402


class SnapshotCleanupTest(unittest.TestCase):
    def test_cleanup_snapshot_files_deletes_only_snapshot_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            keep = root / "keep.txt"
            keep.write_text("keep", encoding="utf-8")
            targets = [root / name for name in server.PIXELFREE_SNAPSHOT_INPUT_NAMES]
            for path in targets:
                path.write_bytes(b"snapshot")

            deleted = server.cleanup_snapshot_files(root)

            self.assertEqual({str(path) for path in targets}, set(deleted))
            self.assertTrue(keep.exists())
            self.assertFalse(any(path.exists() for path in targets))

    def test_delete_snapshot_file_tolerates_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "IMG_2406.png"

            self.assertTrue(server.delete_snapshot_file(missing))


if __name__ == "__main__":
    unittest.main()
