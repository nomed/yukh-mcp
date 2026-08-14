import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  validateAgent,
  validateLauncher,
} from "../../packages/coordination-preview/src/launcher.js";

const server = fileURLToPath(
  new URL("../../apps/coordination-preview/src/main.ts", import.meta.url),
);

test("local Coordination preview exposes only fixed bounded tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-coordination-mcp-"));
  const launcher = join(root, "launcher");
  const log = join(root, "invocations.jsonl");
  await writeFile(
    launcher,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks).toString("utf8").trim();
const command = process.argv.slice(3).join(" ");
appendFileSync(${JSON.stringify(log)}, JSON.stringify({args:process.argv.slice(2),input:input ? JSON.parse(input) : null})+"\\n");
const result = command === "events replay" ? {records:[]} : {event_id:"019fff89-853d-7d5d-9f15-7f968eee7965"};
process.stdout.write(JSON.stringify({schema:1,status:"ok",command,result})+"\\n");
`,
    { mode: 0o700 },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", server],
    env: {
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      YUKH_COORDINATION_AGENT: "agent-a",
      YUKH_COORDINATION_LAUNCHER: launcher,
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "coordination-preview-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(({ name }) => name).sort(), [
      "coordination.answer",
      "coordination.ask",
      "coordination.bootstrap",
      "coordination.join",
      "coordination.leave",
      "coordination.replay",
    ]);
    assert.equal(
      (await client.callTool({ name: "coordination.bootstrap", arguments: {} })).isError,
      false,
    );
    assert.equal(
      (await client.callTool({ name: "coordination.join", arguments: {} })).isError,
      false,
    );
    assert.equal(
      (
        await client.callTool({
          name: "coordination.ask",
          arguments: { work_uri: "https://preview.local/work/first-contact", body: "hello" },
        })
      ).isError,
      false,
    );
    assert.equal(
      (await client.callTool({ name: "coordination.replay", arguments: {} })).isError,
      false,
    );
    assert.equal(
      (
        await client.callTool({
          name: "coordination.ask",
          arguments: {
            work_uri: "https://preview.local/work/first-contact",
            body: "hello",
            command: "arbitrary",
          },
        })
      ).isError,
      true,
    );
    assert.equal(
      (
        await client.callTool({
          name: "coordination.bootstrap",
          arguments: { profile: "agent-b", credential: "substituted" },
        })
      ).isError,
      true,
    );
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[]; input: Record<string, unknown> | null });
    assert.deepEqual(
      calls.map(({ args }) => args),
      [
        ["agent-a", "session", "bootstrap"],
        ["agent-a", "session", "join"],
        ["agent-a", "question", "ask"],
        ["agent-a", "events", "replay"],
      ],
    );
    assert.equal(calls[0]?.input, null);
    assert.deepEqual(calls[2]?.input?.requested_from, ["agent:b"]);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("preview configuration rejects substituted identities and launchers", async () => {
  assert.throws(() => validateAgent("agent-c"));
  assert.throws(() => validateLauncher("relative-launcher"));
});
