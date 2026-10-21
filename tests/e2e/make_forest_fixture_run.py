"""Create a SYNTHETIC completed forest run in a throwaway folder, for browser tests of the saved-run UI.

    python tests/e2e/make_forest_fixture_run.py /absolute/path/to/folder

The real worker code runs end to end (grid alignment, ESA-mask handling, manifest, detector, previews, run history, failure
handling); only NASA/Earthdata/HLS access is replaced by fakes (see pipeline/test_forest_run_integration.py). Everything produced
is a TEST FIXTURE: it is not satellite data and must never be copied into pipeline/output.
"""
import json
import sys
import unittest
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[2] / "pipeline"
sys.path.insert(0, str(PIPELINE))
import forest_workflow as fw  # noqa: E402
from test_forest_run_integration import Fixture  # noqa: E402


class Make(unittest.TestCase):
    def runTest(self):
        out = Path(sys.argv[1])
        assert out.is_absolute(), "pass an absolute path"
        fx = Fixture(self, output_dir=out)
        good = fx.submit(job_id="1" * 32)
        assert fw.run_worker(good) == 0
        pointer = (out / "current_run.json").read_bytes()
        fx.fail_extraction_on = "scene_03"            # a later run that fails must not disturb the good one
        assert fw.run_worker(fx.submit(job_id="2" * 32)) == 1
        assert (out / "current_run.json").read_bytes() == pointer
        summary = json.loads((out / "jobs" / f"{'1' * 32}.json").read_text())["result"]
        print(json.dumps({"runId": summary["runId"], "candidates": summary["candidateCount"], "status": summary["analysisStatus"]}))


if __name__ == "__main__":
    suite = unittest.TestSuite([Make()])
    result = unittest.TextTestRunner(stream=sys.stderr, verbosity=0).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
