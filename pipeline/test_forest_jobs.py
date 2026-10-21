"""Tests for the job recorder, sanitiser and Earthdata check. No network, no credentials, no real downloads."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import forest_workflow as fw
from forest_jobs import JobRecorder, WorkflowCancelled, build_diagnostics, guidance_for, sanitize_text


class SanitiseTests(unittest.TestCase):
    def test_masks_tokens_bearer_urls_and_env_secrets(self):
        with patch.dict(os.environ, {"EARTHDATA_TOKEN": "supersecrettoken123"}):
            text = ("Bearer abcdefghijklmnop failed; access_token=abcd1234efgh; password: hunter22 "
                    "https://user:pw123@urs.earthdata.nasa.gov/x and supersecrettoken123")
            clean = sanitize_text(text)
        for secret in ("abcdefghijklmnop", "abcd1234efgh", "hunter22", "pw123", "supersecrettoken123"):
            self.assertNotIn(secret, clean)
        self.assertIn("<redacted>", clean)

    def test_masks_project_and_home_paths(self):
        root = Path(tempfile.gettempdir()) / "my_secret_project"
        clean = sanitize_text(f"cannot open {root}/pipeline/output/x.tif and {Path.home()}/.netrc", (root,))
        self.assertNotIn("my_secret_project", clean)
        self.assertNotIn(str(Path.home()), clean)

    def test_masks_user_directories_even_outside_known_roots(self):
        raw = ('File "C:\\Users\\Rubai\\AppData\\Local\\Programs\\Python\\Python314\\Lib\\x.py" and /home/claude/forest/venv/lib/python3.12/site-packages/y.py '
               'and /Users/someone/Library/z.py and c:/users/Other/q.py')
        clean = sanitize_text(raw)
        for name in ("Rubai", "claude", "someone", "Other"):
            self.assertNotIn(name, clean)
        self.assertIn("site-packages/y.py", clean)   # the useful, non-identifying part of the path survives

    def test_diagnostics_never_contain_the_secret(self):
        with patch.dict(os.environ, {"EARTHDATA_PASSWORD": "pa55w0rd-secret"}):
            try:
                raise RuntimeError("login rejected for pa55w0rd-secret")
            except RuntimeError as exc:
                diag = build_diagnostics(exc, "Authenticating")
        self.assertNotIn("pa55w0rd-secret", json.dumps(diag))
        self.assertEqual(diag["failedStage"], "Authenticating")


class OutputRootTests(unittest.TestCase):
    """The default output location must stay exactly pipeline/output/forest; the env override is for tests only."""

    def run_py(self, env_extra):
        import subprocess
        env = {**os.environ, **env_extra}
        env.pop("FOREST_OUTPUT_DIR", None) if "FOREST_OUTPUT_DIR" not in env_extra else None
        code = "import forest_workflow as f; print(f.OUTPUT_ROOT)"
        return subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).parent, env=env, capture_output=True, text=True).stdout.strip()

    def test_default_location_is_unchanged(self):
        self.assertEqual(Path(self.run_py({})), Path(__file__).resolve().parent / "output" / "forest")

    def test_absolute_override_is_honoured_and_relative_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(Path(self.run_py({"FOREST_OUTPUT_DIR": tmp})), Path(tmp))
        self.assertEqual(Path(self.run_py({"FOREST_OUTPUT_DIR": "relative/dir"})), Path(__file__).resolve().parent / "output" / "forest")


class GuidanceTests(unittest.TestCase):
    def test_guidance_is_specific_to_the_failure(self):
        self.assertIn("Earthdata", guidance_for(fw.WorkflowError("NASA Earthdata Login is required"), "x"))
        self.assertIn("network", guidance_for(ConnectionError("Max retries exceeded"), "x").lower())
        self.assertIn("pip install", guidance_for(ModuleNotFoundError("No module named 'rasterio'"), "x"))
        self.assertIn("cancel", guidance_for(WorkflowCancelled(), "x").lower())
        # Regression: the live test showed a CMR connection failure being blamed on Earthdata login.
        cmr = ConnectionError("HTTPSConnectionPool(host='cmr.earthdata.nasa.gov', port=443): Max retries exceeded")
        self.assertIn("network", guidance_for(cmr, "Searching NASA's live CMR catalog").lower())
        self.assertNotIn("login command", guidance_for(cmr, "Searching").lower())
        self.assertIn("forest mask", guidance_for(fw.WorkflowError("no class-10 tree-cover pixels"), "x").lower())


class RecorderTests(unittest.TestCase):
    def test_a_new_job_never_inherits_progress_or_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"{'c' * 32}.json"
            path.write_text(json.dumps({"id": "c" * 32, "action": "run", "status": "COMPLETE", "stage": "old", "result": {"runId": "old"}, "error": "old"}))
            rec = JobRecorder(path, "c" * 32, "run")
            self.assertNotIn("result", rec.job)
            self.assertEqual(rec.job["status"], "RUNNING")
            self.assertIsNone(rec.job["error"])

    def test_cancel_flag_is_honoured_at_the_next_progress_checkpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"{'d' * 32}.json"
            rec = JobRecorder(path, "d" * 32, "run")
            rec.write()
            rec.progress("fine")
            doc = json.loads(path.read_text()); doc["cancelRequested"] = True; path.write_text(json.dumps(doc))
            with self.assertRaises(WorkflowCancelled):
                rec.progress("next")

    def test_cancel_marker_file_survives_heartbeat_rewrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"{'9' * 32}.json"
            rec = JobRecorder(path, "9" * 32, "run")
            rec.write()
            rec.cancel_marker.write_text("1")          # what the API does
            rec.start_heartbeat(interval=0.03)
            time.sleep(0.2)                              # heartbeat rewrites the job file several times
            rec.stop_heartbeat()
            with self.assertRaises(WorkflowCancelled):
                rec.progress("next stage")

    def test_heartbeat_updates_while_running_and_stops(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"{'e' * 32}.json"
            rec = JobRecorder(path, "e" * 32, "run")
            rec.write()
            rec.start_heartbeat(interval=0.05)
            time.sleep(0.3)
            rec.stop_heartbeat()
            self.assertIn("heartbeatAt", json.loads(path.read_text()))

    def test_failed_record_has_stage_diagnostics_and_no_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"{'f' * 32}.json"
            rec = JobRecorder(path, "f" * 32, "run")
            rec.progress("Downloading authentic ESA WorldCover tiles and building the forest mask")
            rec.failed(ValueError("boom"))
            job = json.loads(path.read_text())
            self.assertEqual(job["status"], "FAILED")
            self.assertEqual(job["failedStage"], "Downloading authentic ESA WorldCover tiles and building the forest mask")
            self.assertTrue(job["diagnostics"]["guidance"])


class EarthdataCheckTests(unittest.TestCase):
    def run_check(self, fake):
        with patch.dict(sys.modules, {"earthaccess": fake}):
            return fw.check_authentication()

    def test_connected_requires_earthdata_to_accept_the_login(self):
        out = self.run_check(SimpleNamespace(login=lambda strategy: SimpleNamespace(authenticated=True, token={"expiration_date": "2027-01-01"})))
        self.assertEqual(out["state"], "connected")
        self.assertEqual(out["tokenExpires"], "2027-01-01")

    def test_unauthenticated_result_is_not_reported_connected(self):
        out = self.run_check(SimpleNamespace(login=lambda strategy: SimpleNamespace(authenticated=False)))
        self.assertEqual(out["state"], "not_connected")

    def test_missing_credentials_means_not_connected(self):
        def login(strategy): raise Exception("No .netrc file found")
        self.assertEqual(self.run_check(SimpleNamespace(login=login))["state"], "not_connected")

    def test_network_problem_is_check_failed_not_not_connected(self):
        def login(strategy): raise ConnectionError("Max retries exceeded with url")
        out = self.run_check(SimpleNamespace(login=login))
        self.assertEqual(out["state"], "check_failed")
        self.assertIn("internet", out["guidance"].lower())

    def test_result_never_contains_credentials(self):
        def login(strategy): raise Exception("bad password: hunter2xx token=abcd1234efgh")
        out = json.dumps(self.run_check(SimpleNamespace(login=login)))
        self.assertNotIn("hunter2xx", out)
        self.assertNotIn("abcd1234efgh", out)

    def test_message_is_plain_text_not_an_exception_tuple(self):
        def login(strategy): raise Exception("No .netrc found at ~/.netrc")
        out = self.run_check(SimpleNamespace(login=login))
        self.assertEqual(out["message"], "No .netrc found at ~/.netrc")

    def test_missing_dependency_is_reported(self):
        with patch.dict(sys.modules, {"earthaccess": None}):
            self.assertEqual(fw.check_authentication()["state"], "dependency_missing")


if __name__ == "__main__":
    unittest.main()
