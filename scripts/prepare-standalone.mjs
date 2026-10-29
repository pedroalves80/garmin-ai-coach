import { cpSync } from "node:fs";

// Standalone output does not copy browser assets automatically.
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
