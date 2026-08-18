import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createControlPlaneServer,
  parseArguments,
} from "../../apps/control-plane-preview/src/main.js";
import { TeamStore } from "../../packages/team-control/src/store.js";

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

test("control plane preview exposes closed read-only topology status", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-control-plane-preview-api-"));
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

    const status = await fetch(`${base}/api/topology/status`);
    assert.equal(status.status, 200);
    assert.equal(status.headers.get("cache-control"), "no-store");
    const body = await status.json();
    assert.equal(body.schema, "yukh-control-plane-topology-status-v1");
    assert.equal(body.source, "static-preview");
    assert.equal(body.runtimes.length, 4);
    assert.deepEqual(
      body.runtimes.map((runtime: { id: string }) => runtime.id),
      ["projects", "orchestration", "coordination", "jetstream"],
    );
    assert.match(JSON.stringify(body), /YKP_WORK_EVENTS_V1/u);
    assert.doesNotMatch(JSON.stringify(body), /token|secret|private|credential/iu);

    const mutation = await fetch(`${base}/api/topology/status`, { method: "POST" });
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get("allow"), "GET");

    const unknownApi = await fetch(`${base}/api/topology/secrets`);
    assert.equal(unknownApi.status, 404);

    const teams = await fetch(`${base}/api/teams/status`);
    assert.equal(teams.status, 200);
    const empty = await teams.json();
    assert.equal(empty.schema, "yukh-control-plane-team-status-v1");
    assert.equal(empty.source, "unconfigured");
    assert.deepEqual(empty.teams, []);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("control plane preview exposes redacted live team status", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-control-plane-preview-team-"));
  await writeFile(join(root, "index.html"), "<h1>Control</h1>");
  await writeFile(join(root, "styles.css"), "body{}");
  await writeFile(join(root, "mock-data.js"), "export {};");

  const workspace = await mkdtemp(join(tmpdir(), "yukh-control-plane-workspace-"));
  const store = new TeamStore(workspace);
  const managed = store.createManaged(
    "Deliver sensitive-but-redacted control-plane work",
    "codex",
    4,
    2,
    90_000,
    {
      role: "delivery-manager",
      profile: {
        schema: 1,
        mission: "Coordinate a bounded increment",
        model: "gpt-5.6-sol",
        skills: ["testing"],
        instructions: "Keep output bounded and evidence-oriented.",
      },
      task: "Manage sensitive UI task text",
      token_budget: 15_000,
      required_actions: ["team.status", "agent.engage", "agent.await"],
      max_commands: 0,
      timeout_ms: 60_000,
    },
  );
  store.receipt(
    managed.team.team_id,
    "team.status",
    managed.manager.agent_id,
    managed.manager.agent_id,
  );
  const agent = store.spawn(managed.team.team_id, {
    parent_agent_id: managed.manager.agent_id,
    runtime: "copilot",
    role: "frontend-worker",
    task: "Implement sensitive UI task text",
    token_budget: 20_000,
    max_commands: 0,
    timeout_ms: 60_000,
  });
  store.transition(managed.team.team_id, agent.agent_id, "running");

  const server = createControlPlaneServer(root, { teamStore: store });
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

    const response = await fetch(`${base}/api/teams/status`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.schema, "yukh-control-plane-team-status-v1");
    assert.equal(body.source, "local-team-store");
    assert.equal(body.teams.length, 1);
    assert.equal(body.teams[0].team_id, managed.team.team_id);
    assert.equal(body.teams[0].manager_role, "delivery-manager");
    assert.match(body.teams[0].goal_digest, /^sha-256:[a-f0-9]{64}$/u);
    assert.equal(body.teams[0].receipts_count, 1);
    assert.equal(body.teams[0].agents.length, 2);
    assert.equal(body.teams[0].agents[0].kind, "manager");
    assert.deepEqual(body.teams[0].agents[0].required_actions, [
      "team.status",
      "agent.engage",
      "agent.await",
    ]);
    assert.deepEqual(body.teams[0].agents[0].missing_required_actions, [
      "agent.engage",
      "agent.await",
    ]);
    assert.equal(body.teams[0].agents[1].role, "frontend-worker");
    assert.equal(body.teams[0].agents[1].state, "running");
    assert.equal(body.teams[0].tokens.budget, 90_000);
    assert.equal(body.teams[0].tokens.allocated, 35_000);

    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /sensitive-but-redacted|sensitive UI task|Manage sensitive/iu);
    assert.doesNotMatch(serialized, /secret|credential|private/iu);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("control plane preview explains runtime topology without Mermaid", async () => {
  const html = await readFile("apps/control-plane-preview/static/index.html", "utf8");
  const data = await readFile("apps/control-plane-preview/static/mock-data.js", "utf8");

  assert.match(html, /Runtime topology/u);
  assert.match(html, /Who owns what/u);
  assert.match(html, /Yukh Projects/u);
  assert.match(html, /Yukh MCP/u);
  assert.match(html, /Coordination/u);
  assert.match(html, /NATS JetStream runtime/u);
  assert.match(html, /Manager detail/u);
  assert.match(html, /Current orchestration/u);
  assert.match(data, /api\/topology\/status/u);
  assert.match(data, /api\/teams\/status/u);
  assert.match(data, /missing_required_actions/u);
  assert.match(data, /YKP_WORK_EVENTS_V1/u);
  assert.match(data, /message is evidence, not work authority/u);
  assert.doesNotMatch(`${html}\n${data}`, /mermaid/iu);
});
