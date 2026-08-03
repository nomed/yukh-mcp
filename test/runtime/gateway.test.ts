import assert from "node:assert/strict";
import test from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createGatewayRuntime } from "../../apps/gateway/src/server.js";
import type { RuntimeConfig } from "../../packages/config/src/runtime-config.js";
import { createLogger } from "../../packages/logging/src/logger.js";

const config: RuntimeConfig = {
  host: "127.0.0.1", port: 0,
  allowedHosts: ["127.0.0.1"], allowedOrigins: [],
  maxBodyBytes: 1_024, shutdownTimeoutMs: 1_000,
};

async function runtimeTest(run: (base: URL, lines: string[]) => Promise<void>): Promise<void> {
  const lines: string[] = [];
  const runtime = createGatewayRuntime(config, createLogger({ sink: (line) => lines.push(line) }));
  const { port } = await runtime.listen();
  try {
    await run(new URL(`http://127.0.0.1:${port}`), lines);
  } finally {
    await runtime.close();
  }
}

test("health, readiness, and unknown routes are bounded", async () => {
  await runtimeTest(async (base) => {
    const health = await fetch(new URL("/healthz", base));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.match(health.headers.get("x-request-id") ?? "", /^request_[a-f0-9]{32}$/);

    const ready = await fetch(new URL("/readyz", base));
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ready" });

    const missing = await fetch(new URL("/unknown", base));
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });

    const streamingGet = await fetch(new URL("/mcp", base));
    assert.equal(streamingGet.status, 405);
    assert.equal(streamingGet.headers.get("allow"), "POST");
  });
});

test("host, origin, and body bounds reject before MCP handling", async () => {
  await runtimeTest(async (base) => {
    const badHost = await fetch(new URL("/mcp", base), { method: "POST", headers: { host: "attacker.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(badHost.status, 400);

    const badOrigin = await fetch(new URL("/mcp", base), { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(badOrigin.status, 403);

    const oversized = await fetch(new URL("/mcp", base), { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(1_025) });
    assert.equal(oversized.status, 413);
  });
});

test("MCP initializes and discovers no operational surface", async () => {
  await runtimeTest(async (base) => {
    const client = new Client({ name: "yukh-test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", base));
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools, []);
      assert.deepEqual((await client.listResources()).resources, []);
      assert.deepEqual((await client.listPrompts()).prompts, []);
    } finally {
      await client.close();
    }
  });
});

test("logs contain bounded metadata but no request body", async () => {
  await runtimeTest(async (base, lines) => {
    const marker = "do-not-retain-this-body";
    await fetch(new URL("/mcp", base), { method: "POST", headers: { "content-type": "application/json" }, body: marker });
    assert.equal(lines.join("\n").includes(marker), false);
  });
});
