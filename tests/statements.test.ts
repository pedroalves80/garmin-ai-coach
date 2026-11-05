import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { prepare } from "../src/server/db/statements";

test("cached queries read fresh values with changing bindings and stay isolated per connection", () => {
  const databases = [new Database(":memory:"), new Database(":memory:")];
  try {
    for (const [i, db] of databases.entries()) {
      db.exec(
        "CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
      );
      prepare(db, "INSERT INTO sample(id,value) VALUES(?,?)").run(
        1,
        `first-${i}`,
      );
      assert.deepEqual(
        prepare(db, "SELECT value FROM sample WHERE id=?").get(1),
        { value: `first-${i}` },
      );
      prepare(db, "UPDATE sample SET value=? WHERE id=?").run(
        `updated-${i}`,
        1,
      );
      assert.deepEqual(
        prepare(db, "SELECT value FROM sample WHERE id=?").get(1),
        { value: `updated-${i}` },
      );
      assert.equal(
        prepare(db, "SELECT value FROM sample WHERE id=?").get(2),
        undefined,
      );
    }
    assert.deepEqual(
      prepare(databases[0], "SELECT value FROM sample WHERE id=?").get(1),
      { value: "updated-0" },
    );
  } finally {
    for (const db of databases) db.close();
  }
});

test("cached writes preserve transaction rollback and remain usable after a rejected write", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY)");
    prepare(db, "INSERT INTO sample VALUES(?)").run(1);
    assert.throws(() =>
      db.transaction(() => {
        prepare(db, "INSERT INTO sample VALUES(?)").run(2);
        prepare(db, "INSERT INTO sample VALUES(?)").run(1);
      })(),
    );
    assert.deepEqual(prepare(db, "SELECT id FROM sample ORDER BY id").all(), [
      { id: 1 },
    ]);
    prepare(db, "INSERT INTO sample VALUES(?)").run(3);
    assert.deepEqual(prepare(db, "SELECT id FROM sample ORDER BY id").all(), [
      { id: 1 },
      { id: 3 },
    ]);
  } finally {
    db.close();
  }
});

test("cached queries respect schema updates and reject a closed connection", () => {
  const db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE sample(id INTEGER PRIMARY KEY); INSERT INTO sample VALUES(1)",
    );
    assert.deepEqual(prepare(db, "SELECT * FROM sample").get(), { id: 1 });
    db.exec("ALTER TABLE sample ADD COLUMN label TEXT DEFAULT 'new'");
    assert.deepEqual(prepare(db, "SELECT * FROM sample").get(), {
      id: 1,
      label: "new",
    });
  } finally {
    db.close();
  }
  assert.throws(() => prepare(db, "SELECT * FROM sample"), /not open/);
});
