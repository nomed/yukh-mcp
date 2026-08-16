import { runApprovedPreflight } from "./approved-run.js";
import { formatApprovedRun } from "./format.js";

interface Arguments {
  readonly preflightPath: string;
  readonly approvedDigest: string;
  readonly launcher: string;
  readonly codex: string;
  readonly copilot: string;
  readonly waitMs: number;
  readonly codexModels?: string;
  readonly copilotModels?: string;
  readonly codexSkills?: string;
  readonly copilotSkills?: string;
  readonly format: "json" | "text";
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new TypeError(`missing ${name}`);
  return value;
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new TypeError("invalid integer argument");
  return parsed;
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--"))
      throw new TypeError("invalid approved run arguments");
    values.set(name.slice(2), value);
  }
  const codexModels = values.get("codex-models") ?? process.env.YUKH_CODEX_MODELS;
  const copilotModels = values.get("copilot-models") ?? process.env.YUKH_COPILOT_MODELS;
  const codexSkills = values.get("codex-skills") ?? process.env.YUKH_CODEX_SKILLS;
  const copilotSkills = values.get("copilot-skills") ?? process.env.YUKH_COPILOT_SKILLS;
  const format = values.get("format") ?? "json";
  if (!["json", "text"].includes(format)) throw new TypeError("invalid output format");
  return {
    preflightPath: required(values.get("preflight"), "--preflight"),
    approvedDigest: required(values.get("approved-digest"), "--approved-digest"),
    launcher: required(
      values.get("launcher") ?? process.env.YUKH_COORDINATION_LAUNCHER,
      "--launcher or YUKH_COORDINATION_LAUNCHER",
    ),
    codex: required(
      values.get("codex") ?? process.env.YUKH_CODEX_EXECUTABLE,
      "--codex or YUKH_CODEX_EXECUTABLE",
    ),
    copilot: required(
      values.get("copilot") ?? process.env.YUKH_COPILOT_EXECUTABLE,
      "--copilot or YUKH_COPILOT_EXECUTABLE",
    ),
    waitMs: integer(values.get("wait-ms"), 0),
    ...(codexModels ? { codexModels } : {}),
    ...(copilotModels ? { copilotModels } : {}),
    ...(codexSkills ? { codexSkills } : {}),
    ...(copilotSkills ? { copilotSkills } : {}),
    format: format as "json" | "text",
  };
}

try {
  const args = parseArguments(process.argv.slice(2));
  const output = await runApprovedPreflight(args);
  process.stdout.write(
    `${args.format === "json" ? JSON.stringify(output) : formatApprovedRun(output)}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      schema: 1,
      status: "error",
      command: "team run-approved",
      code: error instanceof Error ? error.message : "team_run_approved_failed",
    })}\n`,
  );
  process.exitCode = 1;
}
