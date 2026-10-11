/** Pure helpers for launching the local Earthdata Login prompt safely. */
export function powershellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Script is written to a local, ignored output folder and contains no credentials. */
export function earthdataLoginPowerShell(pythonExe: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Write-Host 'GeoNexSAR: starting NASA Earthdata Login…' -ForegroundColor Cyan",
    "try {",
    `  & ${powershellSingleQuote(pythonExe)} -c 'import earthaccess; earthaccess.login(persist=True)'`,
    "  if ($LASTEXITCODE -eq 0) {",
    "    Write-Host 'Earthdata login command finished successfully.' -ForegroundColor Green",
    "  } else {",
    "    Write-Host ('Earthdata login failed (exit code ' + $LASTEXITCODE + '). Check the message above and try the manual command from the app.') -ForegroundColor Red",
    "  }",
    "} catch {",
    "  Write-Host $_ -ForegroundColor Red",
    "}",
    "Read-Host 'Press Enter to close this window'",
    "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
    "",
  ].join("\r\n");
}

/** Arguments for `cmd.exe /d /c start ...`, which creates a separate PowerShell window. */
export function windowsTerminalStartArgs(scriptPath: string): string[] {
  return [
    "/d", "/c", "start", "GeoNexSAR Earthdata Login", "powershell.exe",
    "-NoLogo", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
  ];
}
