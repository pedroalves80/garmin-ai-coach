import type Database from "better-sqlite3";

// Prepared statements own native SQLite memory. Repeatedly preparing queries in
// long-lived web/worker processes can hit container limits before V8 runs GC.
const connections = new WeakMap<
  Database.Database,
  Map<string, Database.Statement>
>();
const MAX_STATEMENTS = 128;

// Callers use complete, synchronous run/get/all operations. Do not permanently
// bind arguments, change statement modes or retain an iterator on cached queries.
export function prepare(
  db: Database.Database,
  query: string,
): Database.Statement {
  if (!db.open) throw new TypeError("The database connection is not open");
  let cache = connections.get(db);
  if (!cache) {
    cache = new Map();
    connections.set(db, cache);
  }
  const existing = cache.get(query);
  if (existing) {
    cache.delete(query);
    cache.set(query, existing);
    return existing;
  }
  const statement = db.prepare(query);
  if (cache.size >= MAX_STATEMENTS) cache.delete(cache.keys().next().value!);
  cache.set(query, statement);
  return statement;
}
