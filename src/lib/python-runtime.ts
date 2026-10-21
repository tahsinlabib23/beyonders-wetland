import fs from "node:fs";
import path from "node:path";

export function pythonRuntime() {
  const configured = process.env.PYTHON_EXECUTABLE;
  if (configured) return configured;
  const bundled = path.join(process.cwd(), "pipeline", "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return fs.existsSync(bundled) ? bundled : process.platform === "win32" ? "python" : "python3";
}
