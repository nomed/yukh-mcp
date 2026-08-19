import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createControlPlaneServer,
  parseArguments,
} from "../../apps/control-plane-preview/src/main.js";
import { ControlPlanePlanPreviewStore } from "../../apps/control-plane-preview/src/plan-preview-store.js";
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
    const manager = body.teams[0].agents.find((item: { kind: string }) => item.kind === "manager");
    const worker = body.teams[0].agents.find(
      (item: { role: string }) => item.role === "frontend-worker",
    );
    assert.ok(manager);
    assert.ok(worker);
    assert.deepEqual(manager.required_actions, ["team.status", "agent.engage", "agent.await"]);
    assert.deepEqual(manager.missing_required_actions, ["agent.engage", "agent.await"]);
    assert.equal(worker.state, "running");
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

test("control plane preview persists local manager plan previews without leaking goal text", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-control-plane-preview-plan-api-"));
  await writeFile(join(root, "index.html"), "<h1>Control</h1>");
  await writeFile(join(root, "styles.css"), "body{}");
  await writeFile(join(root, "mock-data.js"), "export {};");

  const workspace = await mkdtemp(join(tmpdir(), "yukh-control-plane-plan-workspace-"));
  const planPreviewStore = new ControlPlanePlanPreviewStore(workspace);
  const server = createControlPlaneServer(root, { planPreviewStore });
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

    const initial = await fetch(`${base}/api/manager-plan/previews`);
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get("cache-control"), "no-store");
    assert.deepEqual((await initial.json()).previews, []);

    const initialReadiness = await fetch(`${base}/api/manager-plan/launch-readiness`);
    assert.equal(initialReadiness.status, 200);
    const initialReadinessBody = await initialReadiness.json();
    assert.equal(initialReadinessBody.schema, "yukh-control-plane-launch-readiness-v1");
    assert.equal(initialReadinessBody.outcome, "blocked");
    assert.equal(initialReadinessBody.reasons[0].code, "missing_plan_preview");

    const blockedIntent = await fetch(`${base}/api/manager-plan/launch-intents`, {
      method: "POST",
    });
    assert.equal(blockedIntent.status, 409);
    assert.equal((await blockedIntent.json()).code, "launch_readiness_blocked");

    const blockedRun = await fetch(`${base}/api/manager-plan/manager-runs`, {
      method: "POST",
    });
    assert.equal(blockedRun.status, 409);
    assert.equal((await blockedRun.json()).code, "launch_intent_required");

    const blockedConnection = await fetch(`${base}/api/manager-plan/runtime-connections`, {
      method: "POST",
    });
    assert.equal(blockedConnection.status, 409);
    assert.equal((await blockedConnection.json()).code, "manager_run_required");

    const blockedProcess = await fetch(`${base}/api/manager-plan/manager-processes`, {
      method: "POST",
    });
    assert.equal(blockedProcess.status, 409);
    assert.equal((await blockedProcess.json()).code, "runtime_connection_required");

    const blockedReady = await fetch(`${base}/api/manager-plan/manager-ready-receipts`, {
      method: "POST",
    });
    assert.equal(blockedReady.status, 409);
    assert.equal((await blockedReady.json()).code, "manager_process_required");

    const blockedWorkerPlan = await fetch(`${base}/api/manager-plan/worker-delegation-plans`, {
      method: "POST",
    });
    assert.equal(blockedWorkerPlan.status, 409);
    assert.equal((await blockedWorkerPlan.json()).code, "manager_ready_receipt_required");

    const blockedWorkerApproval = await fetch(
      `${base}/api/manager-plan/worker-delegation-approvals`,
      {
        method: "POST",
      },
    );
    assert.equal(blockedWorkerApproval.status, 409);
    assert.equal((await blockedWorkerApproval.json()).code, "worker_delegation_plan_required");

    const blockedWorkerPreflight = await fetch(
      `${base}/api/manager-plan/worker-launch-preflights`,
      {
        method: "POST",
      },
    );
    assert.equal(blockedWorkerPreflight.status, 409);
    assert.equal((await blockedWorkerPreflight.json()).code, "worker_delegation_approval_required");

    const blockedProviderProbe = await fetch(`${base}/api/manager-plan/provider-runtime-probes`, {
      method: "POST",
    });
    assert.equal(blockedProviderProbe.status, 409);
    assert.equal((await blockedProviderProbe.json()).code, "worker_launch_preflight_required");

    const blockedProviderInventory = await fetch(
      `${base}/api/manager-plan/provider-capability-inventories`,
      { method: "POST" },
    );
    assert.equal(blockedProviderInventory.status, 409);
    assert.equal((await blockedProviderInventory.json()).code, "provider_adapter_required");

    const invalidProviderAdapter = await fetch(`${base}/api/manager-plan/provider-adapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "Copilot SDK workers",
        adapter_kind: "cli",
        executable_path: "copilot",
        models: ["copilot-sdk-default"],
        max_run_token_budget: 120_000,
      }),
    });
    assert.equal(invalidProviderAdapter.status, 400);
    assert.equal((await invalidProviderAdapter.json()).code, "invalid_provider_adapter");

    const goal = "Persist this sensitive manager plan preview locally";
    const proposed = await fetch(`${base}/api/manager-plan/previews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal,
        mode: "plan-first",
        provider: "Copilot SDK workers",
        token_budget: 120_000,
      }),
    });
    assert.equal(proposed.status, 201);
    const proposedBody = await proposed.json();
    assert.equal(proposedBody.preview.state, "proposed");
    assert.equal(proposedBody.preview.manager_reserve, 30_000);
    assert.equal(proposedBody.preview.proposed_workers.length, 2);
    assert.match(proposedBody.preview.goal_digest, /^sha-256:[a-f0-9]{64}$/u);

    const proposedReadiness = await fetch(`${base}/api/manager-plan/launch-readiness`);
    const proposedReadinessBody = await proposedReadiness.json();
    assert.equal(proposedReadinessBody.outcome, "blocked");
    assert.equal(proposedReadinessBody.reasons[0].code, "plan_not_approved");

    const approved = await fetch(`${base}/api/manager-plan/previews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal,
        mode: "plan-first",
        provider: "Copilot SDK workers",
        token_budget: 120_000,
        state: "approved-preview",
      }),
    });
    assert.equal(approved.status, 201);
    const approvedBody = await approved.json();
    assert.equal(approvedBody.preview.state, "approved-preview");
    assert.match(approvedBody.preview.receipt_id, /^preview-receipt-/u);

    const approvedReadiness = await fetch(`${base}/api/manager-plan/launch-readiness`);
    const approvedReadinessBody = await approvedReadiness.json();
    assert.equal(approvedReadinessBody.outcome, "ready");
    assert.deepEqual(approvedReadinessBody.reasons, []);
    assert.doesNotMatch(JSON.stringify(approvedReadinessBody), /sensitive manager plan preview/iu);

    const intent = await fetch(`${base}/api/manager-plan/launch-intents`, { method: "POST" });
    assert.equal(intent.status, 201);
    const intentBody = await intent.json();
    assert.equal(intentBody.launch_intent.readiness_outcome, "ready");
    assert.equal(intentBody.launch_intent.preview_id, approvedBody.preview.preview_id);
    assert.equal(intentBody.launch_intent.preview_receipt_id, approvedBody.preview.receipt_id);
    assert.equal(intentBody.launch_intent.token_budget, 120_000);
    assert.match(intentBody.launch_intent.launch_intent_id, /^launch-intent-/u);
    assert.doesNotMatch(JSON.stringify(intentBody), /sensitive manager plan preview/iu);

    const intents = await fetch(`${base}/api/manager-plan/launch-intents`);
    assert.equal(intents.status, 200);
    const intentsBody = await intents.json();
    assert.equal(intentsBody.schema, "yukh-control-plane-launch-intents-v1");
    assert.equal(intentsBody.intents.length, 1);
    assert.equal(
      intentsBody.intents[0].launch_intent_id,
      intentBody.launch_intent.launch_intent_id,
    );

    const run = await fetch(`${base}/api/manager-plan/manager-runs`, { method: "POST" });
    assert.equal(run.status, 201);
    const runBody = await run.json();
    assert.equal(runBody.manager_run.state, "planned");
    assert.equal(runBody.manager_run.launch_intent_id, intentBody.launch_intent.launch_intent_id);
    assert.equal(runBody.manager_run.preview_id, approvedBody.preview.preview_id);
    assert.equal(runBody.manager_run.provider, "Copilot SDK workers");
    assert.equal(runBody.manager_run.manager_token_budget, 30_000);
    assert.equal(runBody.manager_run.team_token_budget, 120_000);
    assert.equal(runBody.manager_run.worker_count, 2);
    assert.equal(runBody.manager_run.next_required_action, "connect_manager_runtime");
    assert.match(runBody.manager_run.receipt_id, /^manager-run-receipt-/u);
    assert.doesNotMatch(JSON.stringify(runBody), /sensitive manager plan preview/iu);

    const repeatedRun = await fetch(`${base}/api/manager-plan/manager-runs`, { method: "POST" });
    assert.equal(repeatedRun.status, 201);
    assert.equal(
      (await repeatedRun.json()).manager_run.manager_run_id,
      runBody.manager_run.manager_run_id,
    );

    const runs = await fetch(`${base}/api/manager-plan/manager-runs`);
    assert.equal(runs.status, 200);
    const runsBody = await runs.json();
    assert.equal(runsBody.schema, "yukh-control-plane-manager-runs-v1");
    assert.equal(runsBody.runs.length, 1);
    assert.equal(runsBody.runs[0].manager_run_id, runBody.manager_run.manager_run_id);

    const connection = await fetch(`${base}/api/manager-plan/runtime-connections`, {
      method: "POST",
    });
    assert.equal(connection.status, 201);
    const connectionBody = await connection.json();
    assert.equal(connectionBody.runtime_connection.state, "connected");
    assert.equal(
      connectionBody.runtime_connection.manager_run_id,
      runBody.manager_run.manager_run_id,
    );
    assert.equal(
      connectionBody.runtime_connection.launch_intent_id,
      intentBody.launch_intent.launch_intent_id,
    );
    assert.equal(connectionBody.runtime_connection.provider, "Copilot SDK workers");
    assert.equal(connectionBody.runtime_connection.manager_token_budget, 30_000);
    assert.equal(connectionBody.runtime_connection.command_policy, "not_started");
    assert.equal(connectionBody.runtime_connection.next_required_action, "start_manager_process");
    assert.match(connectionBody.runtime_connection.receipt_id, /^manager-runtime-receipt-/u);
    assert.doesNotMatch(JSON.stringify(connectionBody), /sensitive manager plan preview/iu);

    const repeatedConnection = await fetch(`${base}/api/manager-plan/runtime-connections`, {
      method: "POST",
    });
    assert.equal(repeatedConnection.status, 201);
    assert.equal(
      (await repeatedConnection.json()).runtime_connection.runtime_connection_id,
      connectionBody.runtime_connection.runtime_connection_id,
    );

    const connections = await fetch(`${base}/api/manager-plan/runtime-connections`);
    assert.equal(connections.status, 200);
    const connectionsBody = await connections.json();
    assert.equal(connectionsBody.schema, "yukh-control-plane-manager-runtime-connections-v1");
    assert.equal(connectionsBody.connections.length, 1);
    assert.equal(
      connectionsBody.connections[0].runtime_connection_id,
      connectionBody.runtime_connection.runtime_connection_id,
    );

    const process = await fetch(`${base}/api/manager-plan/manager-processes`, {
      method: "POST",
    });
    assert.equal(process.status, 201);
    const processBody = await process.json();
    assert.equal(processBody.manager_process.state, "starting");
    assert.equal(
      processBody.manager_process.runtime_connection_id,
      connectionBody.runtime_connection.runtime_connection_id,
    );
    assert.equal(processBody.manager_process.manager_run_id, runBody.manager_run.manager_run_id);
    assert.equal(processBody.manager_process.provider, "Copilot SDK workers");
    assert.equal(processBody.manager_process.hard_token_cap, 30_000);
    assert.equal(processBody.manager_process.provider_process, "pending_provider_runner");
    assert.equal(processBody.manager_process.worker_delegation, "disabled_until_manager_receipt");
    assert.equal(processBody.manager_process.next_required_action, "record_manager_ready_receipt");
    assert.match(processBody.manager_process.receipt_id, /^manager-process-receipt-/u);
    assert.doesNotMatch(JSON.stringify(processBody), /sensitive manager plan preview/iu);

    const repeatedProcess = await fetch(`${base}/api/manager-plan/manager-processes`, {
      method: "POST",
    });
    assert.equal(repeatedProcess.status, 201);
    assert.equal(
      (await repeatedProcess.json()).manager_process.manager_process_id,
      processBody.manager_process.manager_process_id,
    );

    const processes = await fetch(`${base}/api/manager-plan/manager-processes`);
    assert.equal(processes.status, 200);
    const processesBody = await processes.json();
    assert.equal(processesBody.schema, "yukh-control-plane-manager-processes-v1");
    assert.equal(processesBody.processes.length, 1);
    assert.equal(
      processesBody.processes[0].manager_process_id,
      processBody.manager_process.manager_process_id,
    );

    const ready = await fetch(`${base}/api/manager-plan/manager-ready-receipts`, {
      method: "POST",
    });
    assert.equal(ready.status, 201);
    const readyBody = await ready.json();
    assert.equal(
      readyBody.manager_ready_receipt.manager_process_id,
      processBody.manager_process.manager_process_id,
    );
    assert.equal(
      readyBody.manager_ready_receipt.manager_run_id,
      runBody.manager_run.manager_run_id,
    );
    assert.equal(readyBody.manager_ready_receipt.provider, "Copilot SDK workers");
    assert.equal(readyBody.manager_ready_receipt.hard_token_cap, 30_000);
    assert.equal(readyBody.manager_ready_receipt.readiness, "ready_for_worker_delegation");
    assert.equal(readyBody.manager_ready_receipt.coordination_write, "not_performed");
    assert.equal(readyBody.manager_ready_receipt.projects_write, "not_performed");
    assert.equal(
      readyBody.manager_ready_receipt.next_required_action,
      "prepare_worker_delegation_plan",
    );
    assert.match(
      readyBody.manager_ready_receipt.manager_ready_receipt_id,
      /^manager-ready-receipt-/u,
    );
    assert.doesNotMatch(JSON.stringify(readyBody), /sensitive manager plan preview/iu);

    const repeatedReady = await fetch(`${base}/api/manager-plan/manager-ready-receipts`, {
      method: "POST",
    });
    assert.equal(repeatedReady.status, 201);
    assert.equal(
      (await repeatedReady.json()).manager_ready_receipt.manager_ready_receipt_id,
      readyBody.manager_ready_receipt.manager_ready_receipt_id,
    );

    const readyReceipts = await fetch(`${base}/api/manager-plan/manager-ready-receipts`);
    assert.equal(readyReceipts.status, 200);
    const readyReceiptsBody = await readyReceipts.json();
    assert.equal(readyReceiptsBody.schema, "yukh-control-plane-manager-ready-receipts-v1");
    assert.equal(readyReceiptsBody.receipts.length, 1);

    const workerPlan = await fetch(`${base}/api/manager-plan/worker-delegation-plans`, {
      method: "POST",
    });
    assert.equal(workerPlan.status, 201);
    const workerPlanBody = await workerPlan.json();
    assert.equal(
      workerPlanBody.worker_delegation_plan.manager_ready_receipt_id,
      readyBody.manager_ready_receipt.manager_ready_receipt_id,
    );
    assert.equal(
      workerPlanBody.worker_delegation_plan.manager_process_id,
      processBody.manager_process.manager_process_id,
    );
    assert.equal(
      workerPlanBody.worker_delegation_plan.manager_run_id,
      runBody.manager_run.manager_run_id,
    );
    assert.equal(
      workerPlanBody.worker_delegation_plan.launch_intent_id,
      intentBody.launch_intent.launch_intent_id,
    );
    assert.equal(workerPlanBody.worker_delegation_plan.provider, "Copilot SDK workers");
    assert.equal(
      workerPlanBody.worker_delegation_plan.total_worker_token_budget,
      intentBody.launch_intent.worker_reserve,
    );
    assert.equal(workerPlanBody.worker_delegation_plan.worker_launch, "not_performed");
    assert.equal(workerPlanBody.worker_delegation_plan.coordination_write, "not_performed");
    assert.equal(workerPlanBody.worker_delegation_plan.projects_write, "not_performed");
    assert.equal(
      workerPlanBody.worker_delegation_plan.next_required_action,
      "approve_worker_delegation_plan",
    );
    assert.match(
      workerPlanBody.worker_delegation_plan.worker_delegation_plan_id,
      /^worker-delegation-plan-/u,
    );
    assert.equal(
      workerPlanBody.worker_delegation_plan.workers.length,
      intentBody.launch_intent.proposed_workers.length,
    );
    assert.equal(workerPlanBody.worker_delegation_plan.workers[0].provider, "Copilot SDK workers");
    assert.equal(workerPlanBody.worker_delegation_plan.workers[0].model, "copilot-sdk-default");
    assert.equal(
      workerPlanBody.worker_delegation_plan.workers[0].model_source,
      "deferred_to_provider_inventory",
    );
    assert.equal(workerPlanBody.worker_delegation_plan.workers[0].command_policy, "not_started");
    assert.equal(workerPlanBody.worker_delegation_plan.workers[0].status, "planned");
    assert.match(
      workerPlanBody.worker_delegation_plan.workers[0].input_digest,
      /^sha-256:[a-f0-9]{64}$/u,
    );
    assert.doesNotMatch(JSON.stringify(workerPlanBody), /sensitive manager plan preview/iu);

    const repeatedWorkerPlan = await fetch(`${base}/api/manager-plan/worker-delegation-plans`, {
      method: "POST",
    });
    assert.equal(repeatedWorkerPlan.status, 201);
    assert.equal(
      (await repeatedWorkerPlan.json()).worker_delegation_plan.worker_delegation_plan_id,
      workerPlanBody.worker_delegation_plan.worker_delegation_plan_id,
    );

    const workerPlans = await fetch(`${base}/api/manager-plan/worker-delegation-plans`);
    assert.equal(workerPlans.status, 200);
    const workerPlansBody = await workerPlans.json();
    assert.equal(workerPlansBody.schema, "yukh-control-plane-worker-delegation-plans-v1");
    assert.equal(workerPlansBody.plans.length, 1);

    const workerApproval = await fetch(`${base}/api/manager-plan/worker-delegation-approvals`, {
      method: "POST",
    });
    assert.equal(workerApproval.status, 201);
    const workerApprovalBody = await workerApproval.json();
    assert.equal(
      workerApprovalBody.worker_delegation_approval.worker_delegation_plan_id,
      workerPlanBody.worker_delegation_plan.worker_delegation_plan_id,
    );
    assert.equal(
      workerApprovalBody.worker_delegation_approval.manager_ready_receipt_id,
      readyBody.manager_ready_receipt.manager_ready_receipt_id,
    );
    assert.equal(
      workerApprovalBody.worker_delegation_approval.manager_process_id,
      processBody.manager_process.manager_process_id,
    );
    assert.equal(
      workerApprovalBody.worker_delegation_approval.manager_run_id,
      runBody.manager_run.manager_run_id,
    );
    assert.equal(workerApprovalBody.worker_delegation_approval.approved_worker_count, 2);
    assert.equal(
      workerApprovalBody.worker_delegation_approval.approved_worker_token_budget,
      workerPlanBody.worker_delegation_plan.total_worker_token_budget,
    );
    assert.equal(
      workerApprovalBody.worker_delegation_approval.approval_scope,
      "local_control_plane_only",
    );
    assert.equal(workerApprovalBody.worker_delegation_approval.worker_launch, "not_performed");
    assert.equal(workerApprovalBody.worker_delegation_approval.coordination_write, "not_performed");
    assert.equal(workerApprovalBody.worker_delegation_approval.projects_write, "not_performed");
    assert.equal(
      workerApprovalBody.worker_delegation_approval.next_required_action,
      "launch_approved_workers",
    );
    assert.match(
      workerApprovalBody.worker_delegation_approval.worker_delegation_approval_id,
      /^worker-delegation-approval-/u,
    );
    assert.doesNotMatch(JSON.stringify(workerApprovalBody), /sensitive manager plan preview/iu);

    const repeatedWorkerApproval = await fetch(
      `${base}/api/manager-plan/worker-delegation-approvals`,
      { method: "POST" },
    );
    assert.equal(repeatedWorkerApproval.status, 201);
    assert.equal(
      (await repeatedWorkerApproval.json()).worker_delegation_approval
        .worker_delegation_approval_id,
      workerApprovalBody.worker_delegation_approval.worker_delegation_approval_id,
    );

    const workerApprovals = await fetch(`${base}/api/manager-plan/worker-delegation-approvals`);
    assert.equal(workerApprovals.status, 200);
    const workerApprovalsBody = await workerApprovals.json();
    assert.equal(workerApprovalsBody.schema, "yukh-control-plane-worker-delegation-approvals-v1");
    assert.equal(workerApprovalsBody.approvals.length, 1);

    const workerPreflight = await fetch(`${base}/api/manager-plan/worker-launch-preflights`, {
      method: "POST",
    });
    assert.equal(workerPreflight.status, 201);
    const workerPreflightBody = await workerPreflight.json();
    assert.equal(
      workerPreflightBody.worker_launch_preflight.worker_delegation_approval_id,
      workerApprovalBody.worker_delegation_approval.worker_delegation_approval_id,
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.worker_delegation_plan_id,
      workerPlanBody.worker_delegation_plan.worker_delegation_plan_id,
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.manager_ready_receipt_id,
      readyBody.manager_ready_receipt.manager_ready_receipt_id,
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.manager_process_id,
      processBody.manager_process.manager_process_id,
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.manager_run_id,
      runBody.manager_run.manager_run_id,
    );
    assert.equal(workerPreflightBody.worker_launch_preflight.approved_worker_count, 2);
    assert.equal(
      workerPreflightBody.worker_launch_preflight.approved_worker_token_budget,
      workerApprovalBody.worker_delegation_approval.approved_worker_token_budget,
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.outcome,
      "blocked_until_provider_runtime_probe",
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.provider_runtime_check,
      "requires_provider_runtime_probe",
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.policy_check,
      "local_approval_present",
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.budget_check,
      "within_approved_worker_budget",
    );
    assert.equal(
      workerPreflightBody.worker_launch_preflight.capability_check,
      "requires_provider_capability_inventory",
    );
    assert.equal(workerPreflightBody.worker_launch_preflight.worker_launch, "not_performed");
    assert.equal(workerPreflightBody.worker_launch_preflight.coordination_write, "not_performed");
    assert.equal(workerPreflightBody.worker_launch_preflight.projects_write, "not_performed");
    assert.equal(
      workerPreflightBody.worker_launch_preflight.next_required_action,
      "probe_provider_runtime",
    );
    assert.match(
      workerPreflightBody.worker_launch_preflight.worker_launch_preflight_id,
      /^worker-launch-preflight-/u,
    );
    assert.doesNotMatch(JSON.stringify(workerPreflightBody), /sensitive manager plan preview/iu);

    const repeatedWorkerPreflight = await fetch(
      `${base}/api/manager-plan/worker-launch-preflights`,
      { method: "POST" },
    );
    assert.equal(repeatedWorkerPreflight.status, 201);
    assert.equal(
      (await repeatedWorkerPreflight.json()).worker_launch_preflight.worker_launch_preflight_id,
      workerPreflightBody.worker_launch_preflight.worker_launch_preflight_id,
    );

    const workerPreflights = await fetch(`${base}/api/manager-plan/worker-launch-preflights`);
    assert.equal(workerPreflights.status, 200);
    const workerPreflightsBody = await workerPreflights.json();
    assert.equal(workerPreflightsBody.schema, "yukh-control-plane-worker-launch-preflights-v1");
    assert.equal(workerPreflightsBody.preflights.length, 1);

    const providerAdapter = await fetch(`${base}/api/manager-plan/provider-adapters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "Copilot SDK workers",
        adapter_kind: "sdk",
        models: ["copilot-sdk-default", "copilot-sdk-small"],
        max_run_token_budget: 120_000,
      }),
    });
    assert.equal(providerAdapter.status, 201);
    const providerAdapterBody = await providerAdapter.json();
    assert.equal(providerAdapterBody.provider_adapter.provider, "Copilot SDK workers");
    assert.equal(providerAdapterBody.provider_adapter.adapter_kind, "sdk");
    assert.equal(providerAdapterBody.provider_adapter.command_policy, "bounded_control_plane_only");

    const providerAdapters = await fetch(`${base}/api/manager-plan/provider-adapters`);
    assert.equal(providerAdapters.status, 200);
    const providerAdaptersBody = await providerAdapters.json();
    assert.equal(providerAdaptersBody.schema, "yukh-control-plane-provider-adapters-v1");
    assert.equal(providerAdaptersBody.adapters.length, 1);

    const providerInventory = await fetch(
      `${base}/api/manager-plan/provider-capability-inventories`,
      { method: "POST" },
    );
    assert.equal(providerInventory.status, 201);
    const providerInventoryBody = await providerInventory.json();
    assert.equal(
      providerInventoryBody.provider_capability_inventory.provider_adapter_id,
      providerAdapterBody.provider_adapter.provider_adapter_id,
    );
    assert.equal(
      providerInventoryBody.provider_capability_inventory.provider,
      "Copilot SDK workers",
    );
    assert.equal(providerInventoryBody.provider_capability_inventory.adapter_kind, "sdk");
    assert.equal(
      providerInventoryBody.provider_capability_inventory.inventory_source,
      "local_provider_adapter_config",
    );
    assert.equal(
      providerInventoryBody.provider_capability_inventory.provider_call,
      "not_performed",
    );
    assert.deepEqual(
      providerInventoryBody.provider_capability_inventory.models.map(
        (model: { readonly model: string }) => model.model,
      ),
      ["copilot-sdk-default", "copilot-sdk-small"],
    );

    const repeatedProviderInventory = await fetch(
      `${base}/api/manager-plan/provider-capability-inventories`,
      { method: "POST" },
    );
    assert.equal(repeatedProviderInventory.status, 201);
    assert.equal(
      (await repeatedProviderInventory.json()).provider_capability_inventory
        .provider_capability_inventory_id,
      providerInventoryBody.provider_capability_inventory.provider_capability_inventory_id,
    );

    const providerInventories = await fetch(
      `${base}/api/manager-plan/provider-capability-inventories`,
    );
    assert.equal(providerInventories.status, 200);
    const providerInventoriesBody = await providerInventories.json();
    assert.equal(
      providerInventoriesBody.schema,
      "yukh-control-plane-provider-capability-inventories-v1",
    );
    assert.equal(providerInventoriesBody.inventories.length, 1);

    const providerProbe = await fetch(`${base}/api/manager-plan/provider-runtime-probes`, {
      method: "POST",
    });
    assert.equal(providerProbe.status, 201);
    const providerProbeBody = await providerProbe.json();
    assert.equal(
      providerProbeBody.provider_runtime_probe.worker_launch_preflight_id,
      workerPreflightBody.worker_launch_preflight.worker_launch_preflight_id,
    );
    assert.equal(
      providerProbeBody.provider_runtime_probe.worker_delegation_approval_id,
      workerApprovalBody.worker_delegation_approval.worker_delegation_approval_id,
    );
    assert.equal(
      providerProbeBody.provider_runtime_probe.worker_delegation_plan_id,
      workerPlanBody.worker_delegation_plan.worker_delegation_plan_id,
    );
    assert.equal(
      providerProbeBody.provider_runtime_probe.manager_process_id,
      processBody.manager_process.manager_process_id,
    );
    assert.equal(
      providerProbeBody.provider_runtime_probe.manager_run_id,
      runBody.manager_run.manager_run_id,
    );
    assert.equal(providerProbeBody.provider_runtime_probe.provider, "Copilot SDK workers");
    assert.equal(
      providerProbeBody.provider_runtime_probe.probe_scope,
      "local_control_plane_configuration",
    );
    assert.equal(providerProbeBody.provider_runtime_probe.provider_adapter, "configured");
    assert.equal(providerProbeBody.provider_runtime_probe.executable_check, "not_required");
    assert.equal(
      providerProbeBody.provider_runtime_probe.capability_inventory,
      "local_inventory_available",
    );
    assert.equal(providerProbeBody.provider_runtime_probe.outcome, "ready_for_worker_launch");
    assert.equal(providerProbeBody.provider_runtime_probe.worker_launch, "not_performed");
    assert.equal(providerProbeBody.provider_runtime_probe.coordination_write, "not_performed");
    assert.equal(providerProbeBody.provider_runtime_probe.projects_write, "not_performed");
    assert.equal(providerProbeBody.provider_runtime_probe.next_required_action, "launch_workers");
    assert.match(
      providerProbeBody.provider_runtime_probe.provider_runtime_probe_id,
      /^provider-runtime-probe-/u,
    );
    assert.doesNotMatch(JSON.stringify(providerProbeBody), /sensitive manager plan preview/iu);

    const repeatedProviderProbe = await fetch(`${base}/api/manager-plan/provider-runtime-probes`, {
      method: "POST",
    });
    assert.equal(repeatedProviderProbe.status, 201);
    assert.equal(
      (await repeatedProviderProbe.json()).provider_runtime_probe.provider_runtime_probe_id,
      providerProbeBody.provider_runtime_probe.provider_runtime_probe_id,
    );

    const providerProbes = await fetch(`${base}/api/manager-plan/provider-runtime-probes`);
    assert.equal(providerProbes.status, 200);
    const providerProbesBody = await providerProbes.json();
    assert.equal(providerProbesBody.schema, "yukh-control-plane-provider-runtime-probes-v1");
    assert.equal(providerProbesBody.probes.length, 1);

    const persisted = await fetch(`${base}/api/manager-plan/previews`);
    const persistedBody = await persisted.json();
    assert.equal(persistedBody.previews.length, 2);
    assert.equal(persistedBody.previews[0].state, "approved-preview");
    assert.doesNotMatch(JSON.stringify(persistedBody), /sensitive manager plan preview/iu);

    const denied = await fetch(`${base}/api/manager-plan/previews`, { method: "DELETE" });
    assert.equal(denied.status, 405);
    assert.equal(denied.headers.get("allow"), "GET, POST");

    const readinessDenied = await fetch(`${base}/api/manager-plan/launch-readiness`, {
      method: "POST",
    });
    assert.equal(readinessDenied.status, 405);
    assert.equal(readinessDenied.headers.get("allow"), "GET");

    const intentDenied = await fetch(`${base}/api/manager-plan/launch-intents`, {
      method: "DELETE",
    });
    assert.equal(intentDenied.status, 405);
    assert.equal(intentDenied.headers.get("allow"), "GET, POST");

    const runDenied = await fetch(`${base}/api/manager-plan/manager-runs`, {
      method: "DELETE",
    });
    assert.equal(runDenied.status, 405);
    assert.equal(runDenied.headers.get("allow"), "GET, POST");

    const connectionDenied = await fetch(`${base}/api/manager-plan/runtime-connections`, {
      method: "DELETE",
    });
    assert.equal(connectionDenied.status, 405);
    assert.equal(connectionDenied.headers.get("allow"), "GET, POST");

    const processDenied = await fetch(`${base}/api/manager-plan/manager-processes`, {
      method: "DELETE",
    });
    assert.equal(processDenied.status, 405);
    assert.equal(processDenied.headers.get("allow"), "GET, POST");

    const readyDenied = await fetch(`${base}/api/manager-plan/manager-ready-receipts`, {
      method: "DELETE",
    });
    assert.equal(readyDenied.status, 405);
    assert.equal(readyDenied.headers.get("allow"), "GET, POST");

    const workerPlanDenied = await fetch(`${base}/api/manager-plan/worker-delegation-plans`, {
      method: "DELETE",
    });
    assert.equal(workerPlanDenied.status, 405);
    assert.equal(workerPlanDenied.headers.get("allow"), "GET, POST");

    const workerApprovalDenied = await fetch(
      `${base}/api/manager-plan/worker-delegation-approvals`,
      { method: "DELETE" },
    );
    assert.equal(workerApprovalDenied.status, 405);
    assert.equal(workerApprovalDenied.headers.get("allow"), "GET, POST");

    const workerPreflightDenied = await fetch(`${base}/api/manager-plan/worker-launch-preflights`, {
      method: "DELETE",
    });
    assert.equal(workerPreflightDenied.status, 405);
    assert.equal(workerPreflightDenied.headers.get("allow"), "GET, POST");

    const providerProbeDenied = await fetch(`${base}/api/manager-plan/provider-runtime-probes`, {
      method: "DELETE",
    });
    assert.equal(providerProbeDenied.status, 405);
    assert.equal(providerProbeDenied.headers.get("allow"), "GET, POST");

    const providerAdapterDenied = await fetch(`${base}/api/manager-plan/provider-adapters`, {
      method: "DELETE",
    });
    assert.equal(providerAdapterDenied.status, 405);
    assert.equal(providerAdapterDenied.headers.get("allow"), "GET, POST");

    const providerInventoryDenied = await fetch(
      `${base}/api/manager-plan/provider-capability-inventories`,
      { method: "DELETE" },
    );
    assert.equal(providerInventoryDenied.status, 405);
    assert.equal(providerInventoryDenied.headers.get("allow"), "GET, POST");
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
  assert.match(html, /Command center/u);
  assert.match(html, /Managers, teams and work in motion/u);
  assert.match(html, /Active managers/u);
  assert.match(html, /Task flow/u);
  assert.match(html, /Communication/u);
  assert.match(html, /Team detail/u);
  assert.match(html, /Plan, workers, tokens and next action/u);
  assert.match(html, /manager-plan-form/u);
  assert.match(html, /provider-adapter-form/u);
  assert.match(html, /plan-preview/u);
  assert.match(html, /Yukh Projects/u);
  assert.match(html, /Yukh MCP/u);
  assert.match(html, /Coordination/u);
  assert.match(html, /NATS JetStream runtime/u);
  assert.match(html, /Manager detail/u);
  assert.match(html, /Current orchestration/u);
  assert.match(data, /api\/topology\/status/u);
  assert.match(data, /api\/teams\/status/u);
  assert.match(data, /missing_required_actions/u);
  assert.match(data, /task-board/u);
  assert.match(data, /conversation-feed/u);
  assert.match(data, /team-detail-panel/u);
  assert.match(data, /renderTeamDetail/u);
  assert.match(data, /renderPlanPreview/u);
  assert.match(data, /api\/manager-plan\/previews/u);
  assert.match(data, /api\/manager-plan\/launch-readiness/u);
  assert.match(data, /api\/manager-plan\/launch-intents/u);
  assert.match(data, /api\/manager-plan\/manager-runs/u);
  assert.match(data, /api\/manager-plan\/runtime-connections/u);
  assert.match(data, /api\/manager-plan\/manager-processes/u);
  assert.match(data, /api\/manager-plan\/manager-ready-receipts/u);
  assert.match(data, /api\/manager-plan\/worker-delegation-plans/u);
  assert.match(data, /api\/manager-plan\/worker-delegation-approvals/u);
  assert.match(data, /api\/manager-plan\/worker-launch-preflights/u);
  assert.match(data, /api\/manager-plan\/provider-runtime-probes/u);
  assert.match(data, /api\/manager-plan\/provider-adapters/u);
  assert.match(data, /api\/manager-plan\/provider-capability-inventories/u);
  assert.match(data, /Launch readiness/u);
  assert.match(data, /Launch intent recorded/u);
  assert.match(data, /Manager run planned/u);
  assert.match(data, /Manager runtime connected/u);
  assert.match(data, /Manager process starting/u);
  assert.match(data, /Manager ready receipt/u);
  assert.match(data, /Worker delegation plan/u);
  assert.match(data, /Worker delegation approved/u);
  assert.match(data, /Worker launch preflight/u);
  assert.match(data, /Provider runtime probe/u);
  assert.match(data, /Provider adapter configured/u);
  assert.match(data, /Provider capability inventory/u);
  assert.match(data, /provider_process/u);
  assert.match(data, /worker_delegation/u);
  assert.match(data, /worker_launch/u);
  assert.match(data, /approval_scope/u);
  assert.match(data, /provider_runtime_check/u);
  assert.match(data, /provider_adapter/u);
  assert.match(data, /capability_inventory/u);
  assert.match(data, /capability_check/u);
  assert.match(data, /model_source/u);
  assert.match(data, /coordination_write/u);
  assert.match(data, /projects_write/u);
  assert.match(data, /command_policy/u);
  assert.match(data, /next_required_action/u);
  assert.match(data, /Persisted manager plan/u);
  assert.match(data, /Dry-run manager plan/u);
  assert.match(data, /no workers launched/u);
  assert.match(data, /Approve plan preview/u);
  assert.match(data, /approved preview/u);
  assert.match(data, /Local preview receipt/u);
  assert.match(data, /no provider call, no worker launch, no external write/u);
  assert.match(data, /data-team-id/u);
  assert.match(data, /aria-current/u);
  assert.match(data, /Next required action/u);
  assert.match(data, /Worker tokens/u);
  assert.match(data, /Timeline/u);
  assert.match(data, /YKP_WORK_EVENTS_V1/u);
  assert.match(data, /message is evidence, not work authority/u);
  assert.doesNotMatch(`${html}\n${data}`, /mermaid/iu);
});

test("control plane preview has bounded text containers for operator UI", async () => {
  const css = await readFile("apps/control-plane-preview/static/styles.css", "utf8");

  assert.match(css, /overflow-wrap: anywhere/u);
  assert.match(css, /\.clamp-2/u);
  assert.match(css, /max-width: 100%/u);
  assert.match(css, /white-space: normal/u);
  assert.match(css, /\.task-board/u);
  assert.match(css, /\.manager-card/u);
  assert.match(css, /\.selectable/u);
  assert.match(css, /\.selectable\.selected/u);
  assert.match(css, /focus-visible/u);
  assert.match(css, /\.conversation-event/u);
  assert.match(css, /\.team-detail/u);
  assert.match(css, /\.detail-grid/u);
  assert.match(css, /\.timeline/u);
  assert.match(css, /\.plan-preview/u);
  assert.match(css, /\.preview-grid/u);
  assert.match(css, /\.preview-actions/u);
  assert.match(css, /\.approval-receipt/u);
  assert.match(css, /\.approved-preview/u);
  assert.match(css, /\.readiness-panel/u);
  assert.match(css, /\.launch-intent/u);
  assert.match(css, /\.manager-run/u);
  assert.match(css, /\.runtime-connection/u);
  assert.match(css, /\.manager-process/u);
  assert.match(css, /\.manager-ready-receipt/u);
  assert.match(css, /\.worker-delegation-plan/u);
  assert.match(css, /\.worker-plan-grid/u);
  assert.match(css, /\.worker-delegation-approval/u);
  assert.match(css, /\.worker-launch-preflight/u);
  assert.match(css, /\.provider-runtime-probe/u);
  assert.match(css, /\.preflight-grid/u);
  assert.match(css, /@media \(max-width: 640px\)/u);
});
