// Test-only ESM loader: resolves extensionless relative imports (./mock-data -> ./mock-data.ts)
// so node --experimental-strip-types can run source files written for the bundler.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const parentPath = fileURLToPath(context.parentURL);
      const candidate = path.resolve(path.dirname(parentPath), specifier);
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(candidate + ext)) {
          return { url: pathToFileURL(candidate + ext).href, shortCircuit: true };
        }
      }
    }
    throw err;
  }
}
