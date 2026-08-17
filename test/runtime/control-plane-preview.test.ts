import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createControlPlaneServer,
  parseArguments,
} from "../../apps/control-plane-preview/src/main.js";

test("control plane preview parses bounded local server options", () => {
  assert.deepEqual(parseArguments([]), { host: "127.0.0.1", port: 7345 });
  assert.deepEqual(parseArguments(["--host", "127.0.0.1", "--port", "0"]), {
    host: "127.0.0.1",
    port: 0,
  });
  assert.throws(() => parseArguments(["--port", "70000"]), /invalid control plane port/u);
  assert.throws(() => parseArguments(["--open"]), /invalid control plane arguments/u);
});

test("control plane preview serves only fixed static assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-control-plane-preview-"));
  await writeFile(join(root, "index.html"), "<h1>Control</h1>");
  await writeFile(join(root, "styles.css"), "body{}");
  await writeFile(join(root, "mock-data.js"), "export {};");

  const server = createControlPlaneServer(root);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new TypeError("expected TCP server address");
    }
    const base = `http://127.0.0.1:${address.port}`;

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Control/u);

    const denied = await fetch(`${base}/../package.json`);
    assert.equal(denied.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
