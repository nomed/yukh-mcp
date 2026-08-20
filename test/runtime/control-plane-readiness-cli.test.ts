import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createReadinessReport,
  parseArguments,
  renderReadinessText,
} from "../../apps/control-plane-readiness/src/main.js";

const okRuntime = () =>
  ({
    schema: "yukh-control-plane-preview-runtime-status-v1",
    source: "preview-runtime-check",
    checked_at: "2026-08-20T00:00:00.000Z",
    side_effects: "none",
    status: "ok",
    runtime: "/tmp/yukh-preview",
    launcher: ".github/scripts/yukh-local-agent.py",
    checks: { docker: "ok", tls: "ok", coordination_replay: "ok" },
    warnings: [],
    problems: [],
  }) as const;

test("control readiness CLI parses bounded arguments", () => {
  assert.equal(parseArguments(["--format", "json"]).format, "json");
  assert.deepEqual(parseArguments(["--workspace", "/tmp/work", "--repo-root", "/tmp/repo"]), {
    workspace: "/tmp/work",
    repoRoot: "/tmp/repo",
    format: "text",
  });
  assert.throws(() => parseArguments(["--format", "yaml"]), /invalid --format value/u);
  assert.throws(() => parseArguments(["--workspace"]), /missing --workspace value/u);
  assert.throws(() => parseArguments(["--unknown"]), /invalid readiness argument/u);
});

test("control readiness CLI reads workspace state without creating preview files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yukh-readiness-empty-workspace-"));
  const report = await createReadinessReport(
    { repoRoot: process.cwd(), workspace, format: "text" },
    okRuntime,
  );

  assert.equal(report.outcome, "blocked");
  assert.equal(report.gates.find((gate) => gate.gate === "provider_adapter")?.status, "blocked");
  assert.equal(existsSync(join(workspace, ".yukh")), false);
});

test("control readiness CLI reports ready when provider adapter exists", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yukh-readiness-ready-workspace-"));
  await mkdir(join(workspace, ".yukh", "control-plane"), { recursive: true });
  await writeFile(
    join(workspace, ".yukh", "control-plane", "plan-previews.json"),
    JSON.stringify({
      schema: 1,
      previews: [],
      provider_adapters: [
        {
          schema: 1,
          provider_adapter_id: "provider-adapter-preview",
          provider: "Codex SDK, planned",
          adapter_kind: "sdk",
          models: ["codex-sdk-default"],
          max_run_token_budget: 120000,
          command_policy: "bounded_control_plane_only",
          configured_at: "2026-08-20T00:00:00.000Z",
        },
      ],
    }),
  );

  const report = await createReadinessReport(
    { repoRoot: process.cwd(), workspace, format: "text" },
    okRuntime,
  );

  assert.equal(report.outcome, "ready-for-micro-task");
  assert.equal(report.gates.find((gate) => gate.gate === "provider_adapter")?.status, "pass");
  assert.equal(report.gates.find((gate) => gate.gate === "worker_activity")?.status, "warning");
  assert.match(renderReadinessText(report), /Yukh real project readiness: ready-for-micro-task/u);
  assert.doesNotMatch(JSON.stringify(report), /GH_TOKEN|secret|credential|private/iu);
});
