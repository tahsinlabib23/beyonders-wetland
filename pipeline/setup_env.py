"""One-click local pipeline setup, driven from the website's processing panel.

Creates pipeline/venv (if missing) and installs pipeline/requirements.txt,
reporting progress through the same job file the web panel polls.
Only ever installs this project's own requirements.txt. Safe to re-run:
an existing healthy venv is verified, not rebuilt.

Usage: python pipeline/setup_env.py <32-hex-job-id>
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / "pipeline" / "venv"


def venv_python() -> Path:
    if sys.platform == "win32":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def write_job(job_id: str, **fields) -> None:
    path = ROOT / "pipeline" / "output" / "jobs" / f"{job_id}.json"
    try:
        job = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        job = {"id": job_id, "action": "setup"}
    job.update(fields)
    path.write_text(json.dumps(job), encoding="utf-8")


def stage(job_id: str, text: str) -> None:
    write_job(job_id, status="RUNNING", stage=text)


def find_system_python() -> list[str] | None:
    candidates = [["py", "-3"]] if sys.platform == "win32" else []
    candidates += [["python3"], ["python"]]
    for cmd in candidates:
        try:
            proc = subprocess.run(cmd + ["--version"], capture_output=True, text=True, timeout=15)
            out = (proc.stdout + proc.stderr).lower()
            match = re.search(r"python 3\.(\d+)", out)
            if proc.returncode == 0 and match and int(match.group(1)) >= 10:
                return cmd
        except (OSError, subprocess.SubprocessError):
            continue
    return None


def main() -> int:
    job_id = sys.argv[1]
    req = ROOT / "pipeline" / "requirements.txt"
    try:
        exe = venv_python()
        if exe.exists():
            stage(job_id, "Checking the existing pipeline environment…")
            check = subprocess.run(
                [str(exe), "-c", "import earthaccess, numpy, rasterio"],
                capture_output=True, timeout=180)
            if check.returncode == 0:
                write_job(job_id, status="COMPLETE", stage="Pipeline environment is ready.",
                          result={"venv_ready": True})
                return 0
            stage(job_id, "Repairing the pipeline environment…")
        else:
            stage(job_id, "Finding Python on this computer…")
            cmd = find_system_python()
            if not cmd:
                raise RuntimeError(
                    "No Python 3.10 or newer was found. Install it from python.org, "
                    "restart this app, then try again.")
            stage(job_id, "Creating the pipeline virtual environment…")
            subprocess.run(cmd + ["-m", "venv", str(VENV)], check=True, timeout=600)
        stage(job_id, "Installing the pipeline's science libraries — a few minutes…")
        subprocess.run([str(venv_python()), "-m", "pip", "install", "--upgrade", "pip"],
                       capture_output=True, timeout=600)
        subprocess.run([str(venv_python()), "-m", "pip", "install", "-r", str(req)],
                       check=True, timeout=3600)
        stage(job_id, "Verifying the installation…")
        subprocess.run([str(venv_python()), "-c", "import earthaccess, numpy, rasterio, geopandas"],
                       check=True, timeout=180)
        write_job(job_id, status="COMPLETE", stage="Pipeline environment is ready.",
                  result={"venv_ready": True})
        return 0
    except subprocess.CalledProcessError:
        write_job(job_id, status="FAILED", stage="Setup failed.",
                  error="Setup failed while installing packages. Check the connection, then try again "
                        "or install manually: python -m pip install -r pipeline/requirements.txt")
        return 1
    except Exception as exc:  # noqa: BLE001 — surfaced to the UI, never raised
        write_job(job_id, status="FAILED", stage="Setup failed.", error=str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
