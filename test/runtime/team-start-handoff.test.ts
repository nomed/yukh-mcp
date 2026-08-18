import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseHandoffArguments } from "../../apps/team-start/src/handoff-main.js";
import {
  parseProjectsManagerOrchestrationHandoff,
  startManagerFromHandoff,
  teamStartArgumentsFromHandoff,
} from "../../apps/team-start/src/handoff.js";

const digest = `sha-256:${"c".repeat(64)}`;

function handoff(overrides = {}) {
  return {
    schema: "yukh-projects-manager-orchestration-handoff-v1",
    handoff_id: "01900000-0000-7000-8000-000000000300",
    issued_at: "2026-08-18T05:00:00.000Z",
    phase: "ready_for_external_orchestrator",
    boundary: "external_orchestrator",
    transport: "mcp",
    adapter_id: "yukh_mcp",
    capability: "agent_session_start",
    plan_id: "01900000-0000-7000-8000-000000000301",
    plan_digest: digest,
    admission_event_id: "01900000-0000-7000-8000-000000000302",
    admission_event_digest: digest,
    admission_command_digest: digest,
    admission_outcome: "appended",
    namespace_id: "namespace:example",
    project_id: "project:example",
    run_id: "run:example",
    work_item_id: "work-item:example",
    manager_subject_id: "subject:manager",
    worker_subject_id: "subject:worker",
    role: "backend_developer",
    model_family: "codex",
    model_capability: "coding-agent",
    skill_count: 2,
    acceptance_count: 2,
    evidence_count: 1,
    task_digest: digest,
    budgets: {
      max_turns: 4,
      max_input_tokens: 12_000,
      max_output_tokens: 4_000,
      max_wall_clock_seconds: 600,
    },
    activation: {
      max_ticks: 8,
      max_acknowledgements: 12,
      max_idle_ticks: 1,
    },
    orchestration_request_digest: digest,
    instruction: {
      kind: "start_admitted_agent_session",
      policy: "external_orchestrator_must_enforce_budget_and_skill_limits",
      private_task_body_included: false,
      provider_call_authorized_here: false,
    },
    ...overrides,
  };
}

test("parses a Projects handoff and maps it to bounded team start arguments", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yukh-team-handoff-map-"));
  try {
    const parsed = parseProjectsManagerOrchestrationHandoff(JSON.stringify(handoff()));
    const args = teamStartArgumentsFromHandoff({
      workspace,
      handoff: parsed,
      goal: "Use admitted backend developer",
      launcher: "/usr/bin/true",
      codex: "/usr/bin/true",
      copilot: "/usr/bin/true",
      dryRun: true,
      format: "json",
      allowDynamicWorkers: true,
      codexModels: "default",
      copilotModels: "default",
      codexSkills: "api-design,testing",
    });
    assert.equal(args.mode, "delegate");
    assert.equal(args.runtime, "codex");
    assert.equal(args.role, "backend-developer");
    assert.deepEqual(args.skills, ["api-design", "testing"]);
    assert.equal(args.managerBudget, 16_000);
    assert.equal(args.teamBudget, 32_000);
    assert.equal(args.maxCommands, 12);
    assert.equal(args.timeoutMs, 600_000);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("dry-run accepts handoff without launching a manager", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yukh-team-handoff-dry-"));
  try {
    const parsed = parseProjectsManagerOrchestrationHandoff(JSON.stringify(handoff()));
    const output = startManagerFromHandoff({
      workspace,
      handoff: parsed,
      goal: "Use admitted backend developer",
      launcher: "/usr/bin/true",
      codex: "/usr/bin/true",
      copilot: "/usr/bin/true",
      dryRun: true,
      format: "json",
      allowDynamicWorkers: true,
      codexModels: "default",
      copilotModels: "default",
      codexSkills: "api-design,testing",
    });
    assert.equal(output.status, "ok");
    assert.equal(output.command, "team start-from-handoff");
    assert.equal(output.dry_run, true);
    assert.equal(output.handoff_id, "01900000-0000-7000-8000-000000000300");
    assert.equal(output.mapped_start.runtime, "codex");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rejects unsupported handoff route and provider-call authorization", () => {
  assert.throws(
    () =>
      teamStartArgumentsFromHandoff({
        workspace: process.cwd(),
        handoff: parseProjectsManagerOrchestrationHandoff(
          JSON.stringify(handoff({ transport: "sdk", adapter_id: "codex_sdk" })),
        ),
        goal: "Rejected",
        launcher: "/usr/bin/true",
        codex: "/usr/bin/true",
        copilot: "/usr/bin/true",
        dryRun: true,
        format: "json",
        allowDynamicWorkers: true,
      }),
    /handoff transport not supported/u,
  );
  assert.throws(
    () =>
      parseProjectsManagerOrchestrationHandoff(
        JSON.stringify(
          handoff({
            instruction: {
              kind: "start_admitted_agent_session",
              policy: "external_orchestrator_must_enforce_budget_and_skill_limits",
              private_task_body_included: false,
              provider_call_authorized_here: true,
            },
          }),
        ),
      ),
    /invalid handoff/u,
  );
});

test("CLI parser loads paths and keeps dry-run explicit", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "yukh-team-handoff-cli-"));
  const handoffPath = join(workspace, "handoff.json");
  await writeFile(handoffPath, JSON.stringify(handoff()));
  try {
    const args = parseHandoffArguments([
      "--workspace",
      workspace,
      "--handoff",
      handoffPath,
      "--launcher",
      "/usr/bin/true",
      "--codex",
      "/usr/bin/true",
      "--copilot",
      "/usr/bin/true",
      "--dry-run",
      "true",
      "--format",
      "json",
    ]);
    assert.equal(args.workspace, workspace);
    assert.equal(args.handoffPath, handoffPath);
    assert.equal(args.dryRun, true);
    assert.equal(args.format, "json");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
