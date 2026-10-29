import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Next's standalone server changes cwd. Resolve persistent storage first.
process.env.DATABASE_PATH = resolve(
  process.env.DATABASE_PATH || "data/coach.db",
);
await import(pathToFileURL(resolve(".next/standalone/server.js")).href);
