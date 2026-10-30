import { cpSync } from "node:fs";

// Standalone output does not copy browser assets automatically.
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });

// The independent worker is outside Next's tracing graph. Its JS dependencies
// are bundled into Next's routes, so include their packages for the worker's
// CommonJS imports. better-sqlite3 and native dependencies are already traced.
cpSync("build/worker", ".next/standalone/build/worker", { recursive: true });
for (const name of ["drizzle-orm", "zod", "openai"]) {
  cpSync(`node_modules/${name}`, `.next/standalone/node_modules/${name}`, {
    recursive: true,
  });
}
