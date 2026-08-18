import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentRuntime } from "../../../packages/team-control/src/store.js";
import { parseArguments, startManager, type Arguments } from "./main.js";

export interface ProjectsManagerOrchestrationHandoff {
  readonly schema: "yukh-projects-manager-orchestration-handoff-v1";
  readonly handoff_id: string;
  readonly phase: "ready_for_external_orchestrator";
  readonly boundary: "external_orchestrator";
  readonly transport: "mcp" | "sdk" | "cli" | "control_plane";
  readonly adapter_id: string;
  readonly capability: string;
  readonly plan_id: string;
  readonly admission_event_id: string;
  readonly admission_event_digest: string;
  readonly admission_command_digest: string;
  readonly admission_outcome: "appended" | "replayed";
  readonly namespace_id: string;
  readonly project_id: string;
  readonly run_id: string;
  readonly work_item_id: string;
  readonly manager_subject_id: string;
  readonly worker_subject_id: string;
  readonly role: string;
  readonly model_family: "codex" | "copilot";
  readonly model_capability: string;
  readonly skill_count: number;
  readonly acceptance_count: number;
  readonly evidence_count: number;
  readonly task_digest: string;
  readonly budgets: {
    readonly max_turns: number;
    readonly max_input_tokens: number;
    readonly max_output_tokens: number;
    readonly max_wall_clock_seconds: number;
  };
  readonly activation: {
    readonly max_ticks: number;
    readonly max_acknowledgements: number;
    readonly max_idle_ticks: number;
  };
  readonly orchestration_request_digest: string;
  readonly instruction: {
    readonly kind: "start_admitted_agent_session";
    readonly policy: "external_orchestrator_must_enforce_budget_and_skill_limits";
    readonly private_task_body_included: false;
    readonly provider_call_authorized_here: false;
  };
}

export interface HandoffStartArguments {
  readonly workspace: string;
  readonly handoff: ProjectsManagerOrchestrationHandoff;
  readonly goal: string;
  readonly launcher: string;
  readonly codex: string;
  readonly copilot: string;
  readonly dryRun: boolean;
  readonly format: "json" | "text";
  readonly model?: string;
  readonly skills?: readonly string[];
  readonly allowDynamicWorkers: boolean;
  readonly codexModels?: string;
  readonly copilotModels?: string;
  readonly codexSkills?: string;
  readonly copilotSkills?: string;
  readonly copilotWorkerProvider?: "sdk" | "cli";
}

const digest = /^sha-256:[0-9a-f]{64}$/u;
const uuid7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const opaque = /^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const token = /^[a-z][a-z0-9_-]{0,63}$/u;
const modelToken = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, required: readonly string[]): void {
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !required.includes(key))
  ) {
    throw new TypeError("invalid handoff");
  }
}

function positive(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum;
}

function assertDigest(value: unknown): asserts value is `sha-256:${string}` {
  if (typeof value !== "string" || !digest.test(value)) throw new TypeError("invalid handoff");
}

export function parseProjectsManagerOrchestrationHandoff(
  source: string | ProjectsManagerOrchestrationHandoff,
): ProjectsManagerOrchestrationHandoff {
  const value = typeof source === "string" ? JSON.parse(source) : source;
  if (!record(value)) throw new TypeError("invalid handoff");
  exact(value, [
    "schema",
    "handoff_id",
    "issued_at",
    "phase",
    "boundary",
    "transport",
    "adapter_id",
    "capability",
    "plan_id",
    "plan_digest",
    "admission_event_id",
    "admission_event_digest",
    "admission_command_digest",
    "admission_outcome",
    "namespace_id",
    "project_id",
    "run_id",
    "work_item_id",
    "manager_subject_id",
    "worker_subject_id",
    "role",
    "model_family",
    "model_capability",
    "skill_count",
    "acceptance_count",
    "evidence_count",
    "task_digest",
    "budgets",
    "activation",
    "orchestration_request_digest",
    "instruction",
  ]);
  if (
    value.schema !== "yukh-projects-manager-orchestration-handoff-v1" ||
    value.phase !== "ready_for_external_orchestrator" ||
    value.boundary !== "external_orchestrator" ||
    !["mcp", "sdk", "cli", "control_plane"].includes(String(value.transport)) ||
    !token.test(String(value.adapter_id)) ||
    value.capability !== "agent_session_start" ||
    typeof value.handoff_id !== "string" ||
    !uuid7.test(value.handoff_id) ||
    typeof value.plan_id !== "string" ||
    !uuid7.test(value.plan_id) ||
    (value.admission_outcome !== "appended" && value.admission_outcome !== "replayed") ||
    typeof value.model_family !== "string" ||
    !["codex", "copilot"].includes(value.model_family) ||
    typeof value.role !== "string" ||
    !token.test(value.role.replaceAll("_", "-")) ||
    typeof value.model_capability !== "string" ||
    !token.test(value.model_capability)
  ) {
    throw new TypeError("invalid handoff");
  }
  for (const key of [
    "plan_digest",
    "admission_event_digest",
    "admission_command_digest",
    "task_digest",
    "orchestration_request_digest",
  ])
    assertDigest(value[key]);
  for (const key of [
    "namespace_id",
    "project_id",
    "run_id",
    "work_item_id",
    "manager_subject_id",
    "worker_subject_id",
  ])
    if (typeof value[key] !== "string" || !opaque.test(value[key]))
      throw new TypeError("invalid handoff");
  if (!record(value.budgets)) throw new TypeError("invalid handoff");
  exact(value.budgets, [
    "max_turns",
    "max_input_tokens",
    "max_output_tokens",
    "max_wall_clock_seconds",
  ]);
  if (
    !positive(value.budgets.max_turns, 32) ||
    !positive(value.budgets.max_input_tokens, 250_000) ||
    !positive(value.budgets.max_output_tokens, 250_000) ||
    !positive(value.budgets.max_wall_clock_seconds, 14_400)
  ) {
    throw new TypeError("invalid handoff");
  }
  if (!record(value.activation)) throw new TypeError("invalid handoff");
  exact(value.activation, ["max_ticks", "max_acknowledgements", "max_idle_ticks"]);
  if (
    !positive(value.activation.max_ticks, 64) ||
    !positive(value.activation.max_acknowledgements, 256) ||
    !positive(value.activation.max_idle_ticks, value.activation.max_ticks)
  ) {
    throw new TypeError("invalid handoff");
  }
  if (
    !positive(value.skill_count, 16) ||
    !positive(value.acceptance_count, 16) ||
    !positive(value.evidence_count, 16) ||
    !record(value.instruction) ||
    value.instruction.kind !== "start_admitted_agent_session" ||
    value.instruction.policy !== "external_orchestrator_must_enforce_budget_and_skill_limits" ||
    value.instruction.private_task_body_included !== false ||
    value.instruction.provider_call_authorized_here !== false
  ) {
    throw new TypeError("invalid handoff");
  }
  return value as unknown as ProjectsManagerOrchestrationHandoff;
}

export function defaultSkillsForHandoff(
  handoff: ProjectsManagerOrchestrationHandoff,
): readonly string[] {
  if (handoff.skill_count === 0) return [];
  if (handoff.role.includes("frontend")) return ["frontend"];
  if (handoff.role.includes("backend"))
    return ["api-design", "testing"].slice(0, handoff.skill_count);
  if (handoff.role.includes("qa")) return ["testing"];
  if (handoff.role.includes("documentation")) return ["documentation"];
  if (handoff.role.includes("product")) return ["product", "testing"].slice(0, handoff.skill_count);
  return ["testing"].slice(0, handoff.skill_count);
}

export function teamStartArgumentsFromHandoff(input: HandoffStartArguments): Arguments {
  const handoff = parseProjectsManagerOrchestrationHandoff(input.handoff);
  if (handoff.transport !== "mcp" && handoff.transport !== "control_plane")
    throw new TypeError("handoff transport not supported by local team start");
  if (handoff.adapter_id !== "yukh_mcp" && handoff.adapter_id !== "yukh_control_plane")
    throw new TypeError("handoff adapter not supported by local team start");
  const role = handoff.role.replaceAll("_", "-");
  const runtime = handoff.model_family as AgentRuntime;
  const model = input.model ?? "default";
  if (!modelToken.test(model)) throw new TypeError("invalid model");
  const skills = input.skills ?? defaultSkillsForHandoff(handoff);
  const managerBudget = Math.max(
    1_000,
    handoff.budgets.max_input_tokens + handoff.budgets.max_output_tokens,
  );
  const teamBudget = Math.max(managerBudget, managerBudget * 2);
  return parseArguments([
    "--workspace",
    realpathSync(resolve(input.workspace)),
    "--goal",
    input.goal,
    "--mode",
    "delegate",
    "--runtime",
    runtime,
    "--role",
    role,
    "--mission",
    `Start admitted ${role} session from handoff ${handoff.handoff_id}`,
    "--model",
    model,
    "--skills",
    skills.join(","),
    "--instructions",
    [
      "Act as the admitted Yukh manager for this handoff.",
      "Use only bounded Yukh team tools.",
      "Respect the admitted budgets and activation limits.",
      "Do not widen provider, filesystem, shell or credential authority.",
      `Handoff: ${handoff.handoff_id}`,
      `Admission event: ${handoff.admission_event_id}`,
      `Task digest: ${handoff.task_digest}`,
    ].join(" "),
    "--task",
    `Start and coordinate the admitted work item ${handoff.work_item_id} for ${role}. Keep output concise and evidence-oriented. The private task body is intentionally not included in this handoff.`,
    "--team-budget",
    String(teamBudget),
    "--manager-budget",
    String(managerBudget),
    "--max-agents",
    String(Math.max(2, Math.min(8, handoff.activation.max_acknowledgements))),
    "--max-depth",
    "2",
    "--max-commands",
    String(Math.min(32, handoff.activation.max_acknowledgements)),
    "--timeout-ms",
    String(Math.min(900_000, handoff.budgets.max_wall_clock_seconds * 1_000)),
    "--allow-dynamic-workers",
    String(input.allowDynamicWorkers),
    "--launcher",
    input.launcher,
    "--codex",
    input.codex,
    "--copilot",
    input.copilot,
    ...(input.codexModels ? ["--codex-models", input.codexModels] : []),
    ...(input.copilotModels ? ["--copilot-models", input.copilotModels] : []),
    ...(input.codexSkills ? ["--codex-skills", input.codexSkills] : []),
    ...(input.copilotSkills ? ["--copilot-skills", input.copilotSkills] : []),
    ...(input.copilotWorkerProvider
      ? ["--copilot-worker-provider", input.copilotWorkerProvider]
      : []),
    "--format",
    input.format,
  ]);
}

export function startManagerFromHandoff(input: HandoffStartArguments) {
  const args = teamStartArgumentsFromHandoff(input);
  if (input.dryRun) {
    return {
      schema: 1 as const,
      status: "ok" as const,
      command: "team start-from-handoff",
      dry_run: true as const,
      handoff_id: input.handoff.handoff_id,
      mapped_start: {
        runtime: args.runtime,
        role: args.role,
        model: args.model,
        skills: args.skills,
        mode: args.mode,
        team_budget: args.teamBudget,
        manager_budget: args.managerBudget,
        max_agents: args.maxAgents,
        max_commands: args.maxCommands,
        timeout_ms: args.timeoutMs,
      },
    };
  }
  const output = startManager(args);
  return {
    ...output,
    command: "team start-from-handoff" as const,
    handoff_id: input.handoff.handoff_id,
  };
}
