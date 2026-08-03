import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeConfig } from "../../packages/config/src/runtime-config.js";

test("runtime config defaults to a bounded loopback listener", () => {
  assert.deepEqual(loadRuntimeConfig({}), {
    host: "127.0.0.1", port: 3000,
    allowedHosts: ["127.0.0.1", "localhost"], allowedOrigins: [],
    maxBodyBytes: 65_536, shutdownTimeoutMs: 5_000,
  });
});

test("non-loopback binding requires an explicit host allowlist", () => {
  assert.throws(() => loadRuntimeConfig({ YUKH_HOST: "0.0.0.0" }), {
    name: "TypeError", message: "YUKH_ALLOWED_HOSTS is required for a non-loopback bind",
  });
});

test("invalid configuration reports fields without their values", () => {
  assert.throws(() => loadRuntimeConfig({ YUKH_PORT: "secret-value", YUKH_ALLOWED_ORIGINS: "not a url" }), {
    name: "TypeError", message: "YUKH_PORT must be an unsigned base-10 integer",
  });
  assert.throws(() => loadRuntimeConfig({ YUKH_ALLOWED_ORIGINS: "not a url" }), {
    name: "TypeError", message: "invalid runtime configuration: allowedOrigins.0",
  });
});
