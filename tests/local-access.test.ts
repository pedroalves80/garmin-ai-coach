import test from "node:test";
import assert from "node:assert/strict";
import { authorizeMutation } from "../src/server/security/authorize";
import { isLocalAppHost } from "../src/server/security/local-host";
import { proxy } from "../src/proxy";
import { NextRequest } from "next/server";

test("normal local browser requests save without a passphrase", () => {
  const original = process.env.SYNC_SECRET;
  delete process.env.SYNC_SECRET;
  try {
    for (const host of [
      "localhost:3100",
      "127.0.0.1:3100",
      "raspberrypi.local:3000",
      "192.168.1.40:3000",
      "[fd12::1]:3000",
    ]) {
      const origin = `http://${host}`;
      assert.equal(
        authorizeMutation(
          new Request(`${origin}/api/training/check-in`, {
            method: "POST",
            headers: {
              host,
              origin,
              "x-coach-request": "local",
              "sec-fetch-site": "same-origin",
            },
          }),
        ),
        null,
      );
    }
  } finally {
    if (original !== undefined) process.env.SYNC_SECRET = original;
  }
});

test("local browser mutations reject foreign origins, cross-site metadata and missing app headers", () => {
  const create = (headers: Record<string, string>) =>
    new Request("http://localhost:3100/api/training/plan", {
      method: "POST",
      headers,
    });
  assert.equal(
    authorizeMutation(
      create({ origin: "https://evil.example", "x-coach-request": "local" }),
    )?.status,
    403,
  );
  assert.equal(
    authorizeMutation(create({ origin: "null", "x-coach-request": "local" }))
      ?.status,
    403,
  );
  assert.equal(
    authorizeMutation(
      create({
        origin: "http://localhost:3100",
        "x-coach-request": "local",
        "sec-fetch-site": "cross-site",
      }),
    )?.status,
    403,
  );
  assert.equal(
    authorizeMutation(create({ origin: "http://localhost:3100" }))?.status,
    401,
  );
  assert.equal(
    authorizeMutation(create({ "x-coach-request": "local" }))?.status,
    401,
  );
});

test("host protection blocks public and rebound hostnames for reads as well as writes", () => {
  for (const host of [
    "evil.example",
    "8.8.8.8:3000",
    "172.32.0.1",
    "192.169.1.1",
    "user@localhost",
    "localhost/path",
    "localhost?bad=1",
  ])
    assert.equal(isLocalAppHost(host), false, host);
  for (const host of [
    "127.0.0.2",
    "10.10.0.1",
    "172.16.1.2",
    "172.31.0.1",
    "192.168.1.1",
    "100.70.1.1",
    "raspberrypi",
    "coach.home.arpa",
    "[::1]:3000",
    "[fe80::1]:3000",
  ])
    assert.equal(isLocalAppHost(host), true, host);
  const rejected = proxy(
    new NextRequest("http://evil.example/", {
      headers: { host: "evil.example" },
    }),
  );
  assert.equal(rejected.status, 403);
  const accepted = proxy(
    new NextRequest("http://raspberrypi.local:3000/", {
      headers: { host: "raspberrypi.local:3000" },
    }),
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("x-frame-options"), "DENY");
});

test("custom private origin can be explicitly allowed", () => {
  const original = process.env.APP_ALLOWED_ORIGINS;
  process.env.APP_ALLOWED_ORIGINS = "https://coach.private.example";
  try {
    assert.equal(isLocalAppHost("coach.private.example"), true);
    assert.equal(isLocalAppHost("other.private.example"), false);
  } finally {
    if (original === undefined) delete process.env.APP_ALLOWED_ORIGINS;
    else process.env.APP_ALLOWED_ORIGINS = original;
  }
});
