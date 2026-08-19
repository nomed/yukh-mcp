#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd -- "$script_dir/../.." && pwd -P)"
coordination_repo="$(cd -- "$repo/../yukh-coordination" 2>/dev/null && pwd -P || true)"
launcher="${YUKH_COORDINATION_LAUNCHER:-$coordination_repo/.github/scripts/yukh-local-agent.py}"
nats_url="${YUKH_NATS_URL:-nats://127.0.0.1:14222}"
artifact_dir="${YUKH_QUALIFICATION_ARTIFACT_DIR:-$repo/.yukh/qualification/control-plane-live-activity}"
tmp="$(mktemp -d /tmp/yukh-control-plane-live-activity.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT

command_name="qualify control-plane live activity"

if [[ ! -x "$launcher" ]]; then
  printf '%s\n' "{\"schema\":1,\"status\":\"error\",\"command\":\"$command_name\",\"code\":\"YUKH-COORDINATION-LAUNCHER-UNAVAILABLE\"}"
  exit 1
fi

mkdir -p "$artifact_dir"

cd "$repo"
npm run build >/dev/null

fake_codex="$tmp/fake-codex.mjs"
cat >"$fake_codex" <<'JS'
#!/usr/bin/env node
if (process.argv.includes("--version") || process.argv.includes("version")) {
  console.log("fake-codex 0.0.0");
  process.exit(0);
}
console.log(
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: "Control Plane live activity qualification worker completed.",
    },
  }),
);
console.log(
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 50,
      reasoning_output_tokens: 0,
    },
  }),
);
JS
chmod 700 "$fake_codex"

node --input-type=module - "$repo" "$launcher" "$nats_url" "$artifact_dir" "$fake_codex" <<'JS'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ControlPlanePlanPreviewStore } from "./dist/apps/control-plane-preview/src/plan-preview-store.js";
import { createControlPlaneServer } from "./dist/apps/control-plane-preview/src/main.js";
import { TeamStore } from "./dist/packages/team-control/src/store.js";
import { TeamSupervisor } from "./dist/packages/team-control/src/supervisor.js";
import { teamRuntimeEntrypoints } from "./dist/packages/team-control/src/entrypoints.js";
import { WorkerActivityJetStreamBus } from "./dist/packages/runtime-events/src/worker-activity.js";

const [, , repo, launcher, natsUrl, artifactDir, fakeCodex] = process.argv;
const workspace = realpathSync(await mkdtemp(join(tmpdir(), "yukh-live-activity-")));
mkdirSync(artifactDir, { recursive: true, mode: 0o700 });

const bootstrap = spawnSync(launcher, ["agent-a", "session", "bootstrap"], {
  cwd: repo,
  encoding: "utf8",
});
if (bootstrap.status !== 0) {
  throw new Error("coordination_preview_unavailable");
}

const teamStore = new TeamStore(workspace);
const entrypoints = teamRuntimeEntrypoints();
const supervisor = new TeamSupervisor({
  node: process.execPath,
  worker: entrypoints.worker,
  coordinationMcp: entrypoints.coordinationMcp,
  teamControlMcp: entrypoints.teamControlMcp,
  launcher,
  codex: fakeCodex,
  copilot: fakeCodex,
  workspace,
  profileEnvironment: {
    YUKH_WORKER_ACTIVITY_JETSTREAM: "1",
    YUKH_NATS_URL: natsUrl,
    YUKH_WORKER_ACTIVITY_CREATE_STREAM: "1",
    YUKH_CODEX_MODELS: "default",
    YUKH_COPILOT_MODELS: "default",
  },
});
const bus = await WorkerActivityJetStreamBus.connect({ servers: natsUrl, createStream: true });
const planStore = new ControlPlanePlanPreviewStore(workspace, {
  workerActivityBus: bus,
  providerRunner: async ({ process }) => {
    const team = teamStore.create(
      "Control Plane live activity qualification",
      "codex",
      2,
      1,
      process.approved_worker_token_budget + 1_000,
    );
    const agent = teamStore.spawn(team.team_id, {
      runtime: "codex",
      role: "qualification-worker",
      task: "Complete the Control Plane live activity qualification without modifying files.",
      token_budget: process.approved_worker_token_budget,
      model_tool_mode: "none",
      max_commands: 0,
      timeout_ms: 30_000,
    });
    const launched = supervisor.launch(agent);
    return {
      runtime: "codex",
      team_id: team.team_id,
      agent_id: agent.agent_id,
      pid: launched.pid,
      log_path: launched.log,
    };
  },
});

planStore.create({
  goal: "verify control plane live activity with test worker",
  mode: "delegate, explicit workers",
  provider: "Codex manager CLI",
  token_budget: 60_000,
  state: "approved-preview",
});
planStore.createLaunchIntent();
planStore.createManagerRun();
planStore.connectManagerRuntime();
planStore.startManagerProcess();
planStore.recordManagerReadyReceipt();
planStore.prepareWorkerDelegationPlan();
planStore.approveWorkerDelegationPlan();
planStore.preflightApprovedWorkerLaunch();
planStore.configureProviderAdapter({
  provider: "Codex manager CLI",
  adapter_kind: "cli",
  executable_path: fakeCodex,
  models: ["default"],
  max_run_token_budget: 60_000,
});
planStore.probeProviderRuntime();
await planStore.inventoryProviderCapabilities();
planStore.createWorkerLaunchCandidate();
planStore.createWorkerLaunchReceipt();
planStore.createProviderWorkerProcess();
const attachment = await planStore.attachProviderRunner();

const server = createControlPlaneServer(fileURLToPath(new URL("./dist/apps/control-plane-preview/static/", import.meta.url)), {
  teamStore,
  planPreviewStore: planStore,
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    server.off("error", reject);
    resolve();
  });
});
const address = server.address();
if (!address || typeof address !== "object") throw new Error("control_plane_not_listening");
const base = `http://127.0.0.1:${address.port}`;

const deadline = Date.now() + 15_000;
let activities;
let teamStatus;
for (;;) {
  activities = await (await fetch(`${base}/api/manager-plan/worker-activities`)).json();
  teamStatus = await (await fetch(`${base}/api/teams/status`)).json();
  const workerActivities = activities.activities.filter(
    (event) => event?.data?.aggregate_id === attachment.agent_id,
  );
  const worker = teamStatus.teams
    .flatMap((team) => team.agents)
    .find((agent) => agent.agent_id === attachment.agent_id);
  if (
    activities.source === "worker.activity.v1-jetstream" &&
    workerActivities.length >= 3 &&
    worker?.state === "completed" &&
    worker?.observed_tokens === 150
  ) {
    activities = { ...activities, activities: workerActivities };
    break;
  }
  if (Date.now() > deadline) throw new Error("live_activity_timeout");
  await new Promise((resolve) => setTimeout(resolve, 250));
}

await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
await bus.close();

const workerLog = join(
  workspace,
  ".yukh",
  "teams",
  attachment.team_id,
  "agents",
  `${attachment.agent_id}.log`,
);
const result = {
  schema: 1,
  status: "ok",
  command: "qualify control-plane live activity",
  workspace,
  nats_url: natsUrl,
  activity_source: activities.source,
  activity_count: activities.activities.length,
  team_id: attachment.team_id,
  agent_id: attachment.agent_id,
  worker_state: teamStatus.teams
    .flatMap((team) => team.agents)
    .find((agent) => agent.agent_id === attachment.agent_id).state,
  observed_tokens: 150,
  artifacts: {
    result: join(artifactDir, "result.json"),
    worker_log: join(artifactDir, "worker.log"),
  },
  activities,
  team_status: teamStatus,
};
writeFileSync(result.artifacts.result, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
writeFileSync(result.artifacts.worker_log, readFileSync(workerLog, "utf8"), { mode: 0o600 });
console.log(
  JSON.stringify({
    schema: 1,
    status: "ok",
    command: result.command,
    activity_source: result.activity_source,
    activity_count: result.activity_count,
    worker_state: result.worker_state,
    observed_tokens: result.observed_tokens,
    artifacts: result.artifacts,
  }),
);
JS
