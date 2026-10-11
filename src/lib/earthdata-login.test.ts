import test from "node:test";
import assert from "node:assert/strict";
import { earthdataLoginPowerShell, powershellSingleQuote, windowsTerminalStartArgs } from "./earthdata-login.ts";

test("PowerShell quoting preserves paths with spaces and apostrophes", () => {
  assert.equal(powershellSingleQuote("C:\\Users\\Sam's Folder\\python.exe"), "'C:\\Users\\Sam''s Folder\\python.exe'");
});

test("Earthdata login script persists authentication and keeps errors visible", () => {
  const script = earthdataLoginPowerShell("C:\\Downloads\\Geo Nex\\pipeline\\venv\\Scripts\\python.exe");
  assert.match(script, /earthaccess\.login\(persist=True\)/);
  assert.match(script, /-ForegroundColor Red/);
  assert.match(script, /try \{/);
  assert.match(script, /Remove-Item -LiteralPath \$PSCommandPath/);
  assert.match(script, /Read-Host 'Press Enter to close this window'/);
  assert.match(script, /'C:\\Downloads\\Geo Nex\\pipeline\\venv\\Scripts\\python\.exe'/);
});

test("Windows launcher opens a new PowerShell window with the generated script", () => {
  assert.deepEqual(windowsTerminalStartArgs("C:\\Downloads\\Geo Nex\\pipeline\\output\\jobs\\earthdata-login.ps1"), [
    "/d", "/c", "start", "GeoNexSAR Earthdata Login", "powershell.exe", "-NoLogo",
    "-ExecutionPolicy", "Bypass", "-File", "C:\\Downloads\\Geo Nex\\pipeline\\output\\jobs\\earthdata-login.ps1",
  ]);
});
