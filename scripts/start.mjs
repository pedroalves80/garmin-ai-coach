import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

// Next's standalone server changes cwd. Resolve persistent storage first.
process.env.DATABASE_PATH = resolve(
  process.env.DATABASE_PATH || "data/coach.db",
);
const entries = [
  resolve(".next/standalone/server.js"),
  resolve(".next/standalone/build/worker/server/garmin/worker.js"),
];
if (entries.some((path) => !existsSync(path)))
  throw new Error(
    "Production output missing. Run npm run build before npm start.",
  );
let stopping = false,
  exitCode = 0,
  timer;
const children = entries.map((entry) =>
  spawn(process.execPath, [entry], { stdio: "inherit", env: process.env }),
);
const closed = new Set();
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children)
    if (child.pid && child.exitCode === null && !child.signalCode)
      child.kill("SIGTERM");
  timer = setTimeout(() => {
    for (const child of children)
      if (child.pid && child.exitCode === null && !child.signalCode)
        child.kill("SIGKILL");
    process.exitCode = 1;
  }, 40_000);
  timer.unref();
}
for (const child of children) {
  child.on("error", () => {
    console.error("Could not launch app or Garmin worker.");
    stop(1);
  });
  child.on("close", () => {
    closed.add(child);
    if (!stopping) stop(1);
    if (closed.size === children.length) {
      clearTimeout(timer);
      process.exitCode = exitCode;
    }
  });
}
process.once("SIGTERM", () => stop());
process.once("SIGINT", () => stop());
