"""Job bookkeeping for the forest worker: honest failure records, cancellation, heartbeat, sanitising.

A job file is the only channel between the Python worker and the browser. It must therefore:
  * always end in COMPLETE, FAILED or CANCELLED (never silently stay RUNNING),
  * say *where* a run stopped and *what to do next*, without leaking credentials or local paths,
  * never carry progress or results over from an earlier job that reused the same file.
"""
from __future__ import annotations

import os
import platform
import re
import sys
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path

from raster_utils import atomic_json

HEARTBEAT_SECONDS = 10.0
MAX_TRACE_FRAMES = 8
_SECRET_ENV_NAMES = ("EARTHDATA_TOKEN", "EARTHDATA_PASSWORD", "EARTHDATA_USERNAME", "EDL_TOKEN")


class WorkflowCancelled(Exception):
    """The user asked to stop this job. Not an error in the data or the code."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_text(text: object, extra_roots: tuple[Path, ...] = ()) -> str:
    """Mask credentials and absolute local paths so diagnostics are safe to show and to share."""
    value = str(text)
    for name in _SECRET_ENV_NAMES:
        secret = os.environ.get(name)
        if secret and len(secret) >= 4:
            value = value.replace(secret, "<redacted>")
    value = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._\-~+/=]{8,}", r"\1<redacted>", value)
    value = re.sub(r"(?i)((?:access_)?token|password|passwd|secret|authorization)(['\"]?\s*[:=]\s*['\"]?)[^\s'\",;&}]{4,}", r"\1\2<redacted>", value)
    value = re.sub(r"(?i)(https?://)[^/\s:@]+:[^@\s/]+@", r"\1<redacted>@", value)
    roots = [r for r in extra_roots if r]
    roots.append(Path.home())
    for root in sorted({str(r) for r in roots}, key=len, reverse=True):
        if len(root) > 3:
            value = value.replace(root, "<project>" if root in {str(r) for r in extra_roots} else "~")
            value = value.replace(root.replace("\\", "/"), "<project>" if root in {str(r) for r in extra_roots} else "~")
    # Any user directory, whether or not it is a known root: C:\\Users\\name\\..., /Users/name/..., /home/name/...
    value = re.sub(r"(?i)\b[a-z]:[\\/]+users[\\/]+[^\\/\s\"'<>|:]+", "~", value)
    value = re.sub(r"(?:/Users|/home)/[^/\s\"'<>|:]+", "~", value)
    return value


def guidance_for(error: BaseException, stage: str) -> str:
    """One actionable next step, chosen from the real exception and the stage where it happened."""
    text = f"{type(error).__name__}: {error}".lower()
    if isinstance(error, WorkflowCancelled):
        return "You cancelled this run. Earlier saved results are untouched; start a new run when ready."
    # Network first: a failed request to cmr.earthdata.nasa.gov mentions "earthdata" but is not an authentication problem.
    if any(k in text for k in ("connectionerror", "max retries", "timed out", "timeout", "name resolution", "temporary failure", "ssl", "10013", "connecttimeout")):
        return "A network request failed. Check your internet connection (and any firewall or VPN), then retry. Nothing was saved as a result."
    if any(k in text for k in ("earthdata login", "authenticat", "401", "netrc", "login is required", "no valid saved login", "unauthorized")):
        return "Earthdata is not connected. Run the login command shown in the Earthdata panel once, press 'Test connection', then start the run again."
    if "modulenotfounderror" in text or "no module named" in text or "importerror" in text:
        return "A Python package is missing from pipeline/venv. Run: pipeline\\venv\\Scripts\\python -m pip install -r pipeline\\requirements.txt (Windows) or pipeline/venv/bin/python -m pip install -r pipeline/requirements.txt."
    if "worldcover" in text or "forest mask" in text or "tree-cover" in text or "mangrove" in text:
        return "The selected area has no usable forest mask. Choose an area with tree cover or mangroves in ESA WorldCover 2021 and make sure it is covered by NISAR observations."
    if "compatible series" in text or "disappeared" in text or "mixed geometry" in text or "at least three" in text:
        return "The catalog changed or the selected dates are not compatible. Run discovery again and pick dates from the new result."
    if "memory" in text:
        return "The area may be too large for this computer. Use a smaller study box and retry."
    if "reading real gcov" in stage.lower() or "hdf5" in text or "h5py" in text or "unable to open" in text:
        return "A NISAR file could not be read. Retry once; if it persists the granule may be unavailable. The job log below names the scene."
    return "The workflow stopped unexpectedly. Copy the diagnostics below when asking for help; no partial result was published."


def environment_summary() -> dict:
    """Versions that matter when a run fails (no paths, no usernames)."""
    versions: dict[str, str | None] = {}
    for name in ("numpy", "rasterio", "h5py", "earthaccess", "shapely", "pyproj", "scipy"):
        try:
            module = __import__(name)
            versions[name] = getattr(module, "__version__", "unknown")
        except Exception:
            versions[name] = None
    return {"python": platform.python_version(), "platform": platform.system(), "packages": versions}


def build_diagnostics(error: BaseException, stage: str, roots: tuple[Path, ...] = ()) -> dict:
    frames = traceback.extract_tb(error.__traceback__)[-MAX_TRACE_FRAMES:]
    lines = [f"{Path(f.filename).name}:{f.lineno} in {f.name}" + (f" -> {f.line}" if f.line else "") for f in frames]
    return {
        "failedStage": stage,
        "errorType": type(error).__name__,
        "message": sanitize_text(error, roots),
        "traceback": [sanitize_text(line, roots) for line in lines],
        "guidance": guidance_for(error, stage),
        "environment": environment_summary(),
    }


class JobRecorder:
    """Owns one job file. Thread-safe so a heartbeat can run while the worker blocks on a long read."""

    def __init__(self, job_path: Path, job_id: str, action: str | None, roots: tuple[Path, ...] = ()):
        self.path = Path(job_path)
        self.roots = roots
        self.lock = threading.RLock()
        previous = {}
        if self.path.exists():
            try:
                import json
                previous = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                previous = {}
        # Keep identity only. Stage, result, error and progress from any earlier job are never inherited.
        self.job: dict = {"id": job_id, "action": action or previous.get("action"),
                          "createdAt": previous.get("createdAt") or utc_now(), "status": "RUNNING",
                          "stage": "Starting real-data workflow", "error": None, "pid": os.getpid()}
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # -- persistence -----------------------------------------------------------------------------------------
    def write(self) -> None:
        with self.lock:
            self.job["updatedAt"] = utc_now()
            atomic_json(self.path, self.job)

    @property
    def cancel_marker(self) -> Path:
        """Cancellation is a separate file: the worker rewrites the whole job file on every heartbeat, which would
        silently erase a flag the API wrote into it."""
        return self.path.with_name(f"{self.path.stem}.cancel")

    def cancel_requested(self) -> bool:
        if self.cancel_marker.exists():
            return True
        try:
            import json
            return bool(json.loads(self.path.read_text(encoding="utf-8")).get("cancelRequested"))  # legacy/inline flag
        except Exception:
            return False

    def progress(self, message: str) -> None:
        """Record a stage. This is also the cancellation checkpoint."""
        if self.cancel_requested():
            raise WorkflowCancelled("Cancelled by the user.")
        with self.lock:
            self.job["stage"] = message
            self.write()

    # -- heartbeat ------------------------------------------------------------------------------------------
    def start_heartbeat(self, interval: float = HEARTBEAT_SECONDS) -> None:
        def beat() -> None:
            while not self._stop.wait(interval):
                with self.lock:
                    if self.job.get("status") != "RUNNING":
                        return
                    self.job["heartbeatAt"] = utc_now()
                    self.write()
        self._thread = threading.Thread(target=beat, name="forest-job-heartbeat", daemon=True)
        self._thread.start()

    def stop_heartbeat(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    # -- terminal states ------------------------------------------------------------------------------------
    def complete(self, stage: str, result: dict) -> None:
        with self.lock:
            self.job.update(status="COMPLETE", stage=stage, result=result, error=None, completedAt=utc_now())
            self.write()

    def cancelled(self, stage: str) -> None:
        with self.lock:
            self.job.update(status="CANCELLED", stage="Cancelled", failedStage=stage, error=None,
                            diagnostics={"failedStage": stage, "guidance": guidance_for(WorkflowCancelled(), stage)},
                            completedAt=utc_now())
            self.job.pop("result", None)
            self.write()

    def failed(self, error: BaseException) -> dict:
        with self.lock:
            stage = str(self.job.get("stage") or "Starting real-data workflow")
            diagnostics = build_diagnostics(error, stage, self.roots)
            self.job.update(status="FAILED", failedStage=stage, stage=f"Failed during: {stage}",
                            error=diagnostics["message"], errorType=diagnostics["errorType"],
                            diagnostics=diagnostics, completedAt=utc_now())
            self.job.pop("result", None)
            self.write()
            return diagnostics


def print_exception_to_stderr(error: BaseException, roots: tuple[Path, ...] = ()) -> None:
    """Last-resort reporting that cannot itself raise."""
    try:
        sys.stderr.write(sanitize_text(f"{type(error).__name__}: {error}", roots) + "\n")
    except Exception:
        pass
