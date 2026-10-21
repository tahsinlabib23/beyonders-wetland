# Forest repair package: start here

This is a **source overlay**: it contains only the files that differ from GitHub `Rubai-dev` (58 new, 8 changed, 0 deleted), already with LF line endings
like the repository. It contains no `.git`, `node_modules`, `.next`, `pipeline/venv`, `pipeline/output`, satellite data, caches or secrets.
Nothing was committed or pushed. You review and commit.

Documents here: `CHANGE_REPORT.md` (what and why) · `TEST_REPORT.md` (what ran, what did not) · `KNOWN_LIMITATIONS.md` ·
`RESEARCH_AND_ROADMAP.md` · `BASELINE_INVENTORY.md` · `FILE_MANIFEST.txt` (status and SHA-256 of every file) · `evidence/` (raw outputs).

## 1. Verify the archive
PowerShell: `Get-FileHash -Algorithm SHA256 .\forest-repair-overlay.zip` and compare with `forest-repair-overlay.zip.sha256`.

## 2. Review it against a fresh Rubai-dev checkout (recommended; keeps your current folder untouched)
```powershell
git clone --branch Rubai-dev https://github.com/tahsinlabib23/beyonders-wetland.git review
cd review
Expand-Archive -Force ..\forest-repair-overlay.zip .        # extracts into the repository root
git status                                                   # expect 8 modified + 58 new files (see FILE_MANIFEST.txt)
git diff                                                     # the 8 modified files
git diff --stat
```
If Git warns "LF will be replaced by CRLF", that is your `core.autocrlf` setting and is harmless.

To compare with your own working folder instead, extract into a *copy* of it and run `git diff`; your folder has Windows line endings (139 files appear
modified only because of that), so compare with `git diff --ignore-cr-at-eol`.

## 3. Run the tests on Windows
```powershell
python -m venv pipeline\venv                                 # or reuse your existing venv
.\pipeline\venv\Scripts\python.exe -m pip install -r pipeline\requirements.txt
.\pipeline\venv\Scripts\python.exe -m unittest discover -s pipeline -p "test_*.py"   # expect 104 tests, 2 skipped
npm install                                                  # use `npm ci` if you prefer; do not commit a changed package-lock.json
npm test; npx tsc --noEmit; npx eslint; npm run build
```
Browser suites (need `pip install playwright` and `python -m playwright install chromium`):
```powershell
$env:PYTHON = "$PWD\pipeline\venv\Scripts\python.exe"
npx next start -p 3140                                      # in one terminal, after npm run build
python tests\e2e\forest_smoke.py http://localhost:3140       # in another; expect 54/54 offline too
```
For the saved-run suite see section 6 of `TEST_REPORT.md` (it needs a throwaway fixture folder; never use your real `pipeline\output`).

## 4. First real-world checks (these could not be done for you)
1. Open `/forest`. The Earthdata panel should show a readable command; run it once in PowerShell **from the repository root**, press **Test connection**, expect **Connected**.
2. Search a place, press **Search NASA's catalog here**, and confirm no console window opens (this was the empty-PowerShell symptom).
3. Run Discover on a small box, then a full analysis. If anything fails, the job panel shows the stage and next step; "Copy diagnostics" gives you text safe to share.

## 5. Commit (yours to do)
```powershell
git status
git add -A
git commit -m "Forest: fix run failures, add Earthdata panel and coverage search, harden jobs and tests"
```
Check `git status` first: nothing under `pipeline\output`, `pipeline\venv` or `.next` should be staged (they are in `.gitignore`).

## 6. If something looks wrong
Your original ZIP was not modified and the pristine `Rubai-dev` is on GitHub, so you can always return to either.
