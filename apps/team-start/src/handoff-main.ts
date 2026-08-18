import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProjectsManagerOrchestrationHandoff, startManagerFromHandoff } from "./handoff.js";

interface CliArguments {
  readonly handoffPath: string;
  readonly workspace: string;
  readonly goal?: string;
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

function required(value: string | undefined, name: string): string {
  if (!value) throw new TypeError(`missing ${name}`);
  return value;
}

function boolean(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function list(value: string | undefined): readonly string[] | undefined {
  return value ? value.split(",").filter(Boolean) : undefined;
}

function executable(value: string): string {
  return realpathSync(value);
}

export function parseHandoffArguments(argv: readonly string[]): CliArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--"))
      throw new TypeError("invalid team handoff arguments");
    values.set(name.slice(2), value);
  }
  const format = values.get("format") ?? "text";
  if (format !== "json" && format !== "text") throw new TypeError("invalid output format");
  const copilotWorkerProvider = values.get("copilot-worker-provider");
  if (
    copilotWorkerProvider !== undefined &&
    copilotWorkerProvider !== "sdk" &&
    copilotWorkerProvider !== "cli"
  )
    throw new TypeError("invalid copilot worker provider");
  const goal = values.get("goal");
  const model = values.get("model");
  const skills = list(values.get("skills"));
  const codexModels = values.get("codex-models") ?? process.env.YUKH_CODEX_MODELS;
  const copilotModels = values.get("copilot-models") ?? process.env.YUKH_COPILOT_MODELS;
  const codexSkills = values.get("codex-skills") ?? process.env.YUKH_CODEX_SKILLS;
  const copilotSkills = values.get("copilot-skills") ?? process.env.YUKH_COPILOT_SKILLS;
  return {
    handoffPath: realpathSync(resolve(required(values.get("handoff"), "--handoff"))),
    workspace: realpathSync(resolve(values.get("workspace") ?? process.cwd())),
    ...(goal ? { goal } : {}),
    launcher: executable(
      required(
        values.get("launcher") ?? process.env.YUKH_COORDINATION_LAUNCHER,
        "--launcher or YUKH_COORDINATION_LAUNCHER",
      ),
    ),
    codex: executable(
      required(
        values.get("codex") ?? process.env.YUKH_CODEX_EXECUTABLE,
        "--codex or YUKH_CODEX_EXECUTABLE",
      ),
    ),
    copilot: executable(
      required(
        values.get("copilot") ?? process.env.YUKH_COPILOT_EXECUTABLE,
        "--copilot or YUKH_COPILOT_EXECUTABLE",
      ),
    ),
    dryRun: boolean(values.get("dry-run")),
    format,
    ...(model ? { model } : {}),
    ...(skills ? { skills } : {}),
    allowDynamicWorkers:
      boolean(values.get("allow-dynamic-workers")) ||
      process.env.YUKH_ENABLE_UNSAFE_DYNAMIC_WORKERS === "1",
    ...(codexModels ? { codexModels } : {}),
    ...(copilotModels ? { copilotModels } : {}),
    ...(codexSkills ? { codexSkills } : {}),
    ...(copilotSkills ? { copilotSkills } : {}),
    ...(copilotWorkerProvider ? { copilotWorkerProvider } : {}),
  };
}

function text(output: ReturnType<typeof startManagerFromHandoff>): string {
  if (output.dry_run) {
    return [
      "Yukh handoff accepted",
      `Handoff: ${output.handoff_id}`,
      `Runtime: ${output.mapped_start.runtime}`,
      `Role: ${output.mapped_start.role}`,
      `Model: ${output.mapped_start.model}`,
      `Skills: ${output.mapped_start.skills.join(",") || "(none)"}`,
      `Budget: manager=${output.mapped_start.manager_budget} team=${output.mapped_start.team_budget}`,
      "Dry run: no manager process started",
    ].join("\n");
  }
  return [
    "Yukh manager started from Projects handoff",
    `Handoff: ${output.handoff_id}`,
    `Team: ${output.team.team_id}`,
    `Manager: ${output.manager.agent_id} (${output.manager.runtime}/${output.manager.role})`,
    `Runtime pid: ${output.runtime.pid}`,
    `Runtime log: ${output.runtime.log}`,
    "",
    "Commands",
    `- watch: ${output.watch_command}`,
    `- status: ${output.status_command}`,
  ].join("\n");
}

function isMain(): boolean {
  return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  try {
    const cli = parseHandoffArguments(argv);
    const handoff = parseProjectsManagerOrchestrationHandoff(readFileSync(cli.handoffPath, "utf8"));
    const output = startManagerFromHandoff({
      ...cli,
      handoff,
      goal:
        cli.goal ??
        `Start admitted Yukh work ${handoff.work_item_id} from Projects handoff ${handoff.handoff_id}`,
    });
    process.stdout.write(`${cli.format === "json" ? JSON.stringify(output) : text(output)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schema: 1,
        status: "error",
        command: "team start-from-handoff",
        code: error instanceof Error ? error.message : "team_start_from_handoff_failed",
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (isMain()) main();
