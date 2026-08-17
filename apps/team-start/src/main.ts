import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverCodexModels,
  runtimeModelCatalog,
} from "../../../packages/team-control/src/model-discovery.js";
import type {
  AgentRuntime,
  ManagerOutputContract,
  TeamAction,
} from "../../../packages/team-control/src/store.js";
import { teamRuntimeEntrypoints } from "../../../packages/team-control/src/entrypoints.js";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { TeamSupervisor } from "../../../packages/team-control/src/supervisor.js";
import { formatTeamStatus } from "../../team-preflight/src/format.js";

export interface Arguments {
  readonly workspace: string;
  readonly goal: string;
  readonly runtime: AgentRuntime;
  readonly role: string;
  readonly mission: string;
  readonly model: string;
  readonly skills: readonly string[];
  readonly instructions: string;
  readonly task: string;
  readonly mode: "plan-first" | "delegate";
  readonly outputContract: ManagerOutputContract;
  readonly requiredActions: readonly TeamAction[];
  readonly teamBudget: number;
  readonly managerBudget: number;
  readonly maxAgents: number;
  readonly maxDepth: number;
  readonly maxCommands: number;
  readonly timeoutMs: number;
  readonly launcher: string;
  readonly codex: string;
  readonly copilot: string;
  readonly allowDynamicWorkers: boolean;
  readonly codexModels?: string;
  readonly copilotModels?: string;
  readonly codexSkills?: string;
  readonly copilotSkills?: string;
  readonly copilotWorkerProvider?: "sdk" | "cli";
  readonly format: "json" | "text";
}

const modelToken = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
const roleToken = /^[a-z][a-z0-9-]{0,31}$/u;

function required(value: string | undefined, name: string): string {
  if (!value) throw new TypeError(`missing ${name}`);
  return value;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError(`invalid ${name}`);
  return parsed;
}

function boolean(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function list(value: string | undefined, fallback: readonly string[]): readonly string[] {
  return value ? value.split(",").filter(Boolean) : fallback;
}

function executablePath(value: string): string {
  return realpathSync(value);
}

export function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--"))
      throw new TypeError("invalid team start arguments");
    values.set(name.slice(2), value);
  }
  const mode = values.get("mode") ?? "plan-first";
  if (mode !== "plan-first" && mode !== "delegate") throw new TypeError("invalid mode");
  const runtime = values.get("runtime") ?? "codex";
  if (runtime !== "codex" && runtime !== "copilot") throw new TypeError("invalid runtime");
  const role = values.get("role") ?? "delivery-manager";
  if (!roleToken.test(role)) throw new TypeError("invalid role");
  const model = values.get("model") ?? "default";
  if (!modelToken.test(model)) throw new TypeError("invalid model");
  const format = values.get("format") ?? "text";
  if (format !== "json" && format !== "text") throw new TypeError("invalid output format");
  const copilotWorkerProvider = values.get("copilot-worker-provider");
  if (
    copilotWorkerProvider !== undefined &&
    copilotWorkerProvider !== "sdk" &&
    copilotWorkerProvider !== "cli"
  )
    throw new TypeError("invalid copilot worker provider");
  const goal = required(values.get("goal"), "--goal");
  const mission = values.get("mission") ?? goal;
  const codexModels = values.get("codex-models") ?? process.env.YUKH_CODEX_MODELS;
  const copilotModels = values.get("copilot-models") ?? process.env.YUKH_COPILOT_MODELS;
  const codexSkills = values.get("codex-skills") ?? process.env.YUKH_CODEX_SKILLS;
  const copilotSkills = values.get("copilot-skills") ?? process.env.YUKH_COPILOT_SKILLS;
  const defaultInstructions =
    mode === "delegate"
      ? "Act as the accountable Yukh manager. Create only the minimum useful worker set, prefer SDK-capable providers when available, keep prompts short, respect token budgets, await workers, and finish with a concise status, changed files, tests, blockers and next step."
      : "Act as the accountable Yukh manager. Produce one compact team-plan-v1 only: roles, runtimes, models, skills, budgets, evidence, gates and stop conditions. Do not modify files or launch child workers.";
  const outputContract: ManagerOutputContract = mode === "delegate" ? "summary" : "team-plan-v1";
  return {
    workspace: realpathSync(resolve(values.get("workspace") ?? process.cwd())),
    goal,
    runtime,
    role,
    mission,
    model,
    skills: list(values.get("skills"), ["product", "testing"]),
    instructions: values.get("instructions") ?? defaultInstructions,
    task:
      values.get("task") ??
      (mode === "delegate"
        ? `Manage this Yukh team goal to completion within budget: ${goal}`
        : `Plan the smallest safe Yukh team to achieve this goal within budget: ${goal}`),
    mode,
    outputContract,
    requiredActions: mode === "delegate" ? ["agent.engage", "agent.await"] : [],
    teamBudget: integer(values.get("team-budget"), 120_000, "team budget"),
    managerBudget: integer(
      values.get("manager-budget"),
      mode === "delegate" ? 80_000 : 40_000,
      "manager budget",
    ),
    maxAgents: integer(values.get("max-agents"), mode === "delegate" ? 4 : 3, "max agents"),
    maxDepth: integer(values.get("max-depth"), 2, "max depth"),
    maxCommands: integer(values.get("max-commands"), mode === "delegate" ? 8 : 0, "max commands"),
    timeoutMs: integer(values.get("timeout-ms"), 300_000, "timeout ms"),
    launcher: executablePath(
      required(
        values.get("launcher") ?? process.env.YUKH_COORDINATION_LAUNCHER,
        "--launcher or YUKH_COORDINATION_LAUNCHER",
      ),
    ),
    codex: executablePath(
      required(
        values.get("codex") ?? process.env.YUKH_CODEX_EXECUTABLE,
        "--codex or YUKH_CODEX_EXECUTABLE",
      ),
    ),
    copilot: executablePath(
      required(
        values.get("copilot") ?? process.env.YUKH_COPILOT_EXECUTABLE,
        "--copilot or YUKH_COPILOT_EXECUTABLE",
      ),
    ),
    allowDynamicWorkers:
      boolean(values.get("allow-dynamic-workers")) ||
      process.env.YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS === "1",
    ...(codexModels ? { codexModels } : {}),
    ...(copilotModels ? { copilotModels } : {}),
    ...(codexSkills ? { codexSkills } : {}),
    ...(copilotSkills ? { copilotSkills } : {}),
    ...(copilotWorkerProvider ? { copilotWorkerProvider } : {}),
    format,
  };
}

export function startText(output: ReturnType<typeof startManager>): string {
  return [
    "Yukh manager started",
    `Team: ${output.team.team_id}`,
    `Manager: ${output.manager.agent_id} (${output.manager.runtime}/${output.manager.role})`,
    `Mode: ${output.mode}`,
    `Runtime pid: ${output.runtime.pid}`,
    `Runtime log: ${output.runtime.log}`,
    "",
    "Commands",
    `- watch: ${output.watch_command}`,
    `- status: ${output.status_command}`,
    "",
    formatTeamStatus(output.team_status),
  ].join("\n");
}

export function startManager(args: Arguments) {
  if (args.mode === "delegate" && !args.allowDynamicWorkers)
    throw new TypeError("dynamic workers require --allow-dynamic-workers true");
  const codexCatalog = runtimeModelCatalog(args.codexModels, ["default"], () =>
    discoverCodexModels(args.codex),
  );
  const store = new TeamStore(args.workspace);
  const entrypoints = teamRuntimeEntrypoints();
  const profileEnvironment = {
    YUKH_CODEX_MODELS: codexCatalog.models.join(","),
    YUKH_CODEX_MODEL_SOURCE: codexCatalog.source,
    YUKH_COPILOT_MODELS: args.copilotModels ?? "default",
    YUKH_COPILOT_MODEL_SOURCE: args.copilotModels ? "env" : "fallback",
    ...(args.codexSkills ? { YUKH_CODEX_SKILLS: args.codexSkills } : {}),
    ...(args.copilotSkills ? { YUKH_COPILOT_SKILLS: args.copilotSkills } : {}),
    ...(args.copilotWorkerProvider === "sdk"
      ? { YUKH_COPILOT_WORKER_PROVIDER: "sdk" }
      : args.copilotWorkerProvider === "cli"
        ? { YUKH_COPILOT_WORKER_PROVIDER: "cli" }
        : {}),
    ...(args.allowDynamicWorkers ? { YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS: "1" } : {}),
    ...(process.env.YUKH_PREVIEW_RUNTIME
      ? { YUKH_PREVIEW_RUNTIME: process.env.YUKH_PREVIEW_RUNTIME }
      : {}),
  };
  const supervisor = new TeamSupervisor({
    node: process.execPath,
    worker: entrypoints.worker,
    coordinationMcp: entrypoints.coordinationMcp,
    teamControlMcp: entrypoints.teamControlMcp,
    launcher: args.launcher,
    codex: args.codex,
    copilot: args.copilot,
    workspace: args.workspace,
    profileEnvironment,
  });
  const managed = store.createManaged(
    args.goal,
    args.runtime,
    args.maxAgents,
    args.maxDepth,
    args.teamBudget,
    {
      role: args.role,
      profile: {
        schema: 1,
        mission: args.mission,
        model: args.model,
        skills: args.skills,
        instructions: args.instructions,
      },
      task: args.task,
      token_budget: args.managerBudget,
      required_actions: args.requiredActions,
      output_contract: args.outputContract,
      max_commands: args.maxCommands,
      timeout_ms: args.timeoutMs,
    },
  );
  const runtime = supervisor.launch(managed.manager);
  const receipt = store.receipt(
    managed.team.team_id,
    "manager.start",
    undefined,
    managed.manager.agent_id,
  );
  const watchCommand = `YUKH_COORDINATION_LAUNCHER=${args.launcher} YUKH_CONVERSATION_WORKSPACE=${args.workspace} yukh conversation watch --full`;
  const statusCommand = `yukh team status --team ${managed.team.team_id} --workspace ${args.workspace}`;
  return {
    schema: 1 as const,
    status: "ok" as const,
    command: "team start",
    mode: args.mode,
    ...managed,
    receipt,
    runtime,
    watch_command: watchCommand,
    status_command: statusCommand,
    team_status: store.status(managed.team.team_id),
  };
}

function isMain(): boolean {
  return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  try {
    const args = parseArguments(argv);
    const output = startManager(args);
    process.stdout.write(
      `${args.format === "json" ? JSON.stringify(output) : startText(output)}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schema: 1,
        status: "error",
        command: "team start",
        code: error instanceof Error ? error.message : "team_start_failed",
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (isMain()) main();
