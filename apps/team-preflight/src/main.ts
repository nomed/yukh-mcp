import type { AgentRuntime } from "../../../packages/team-control/src/store.js";
import type { TeamWorkProfile } from "../../team-control/src/server.js";
import { runEngagePreflight } from "./preflight.js";

interface Arguments {
  readonly workspace?: string;
  readonly goal: string;
  readonly role: string;
  readonly workProfile: TeamWorkProfile;
  readonly preferredRuntime?: AgentRuntime;
  readonly teamBudget: number;
  readonly managerBudget: number;
  readonly codexModels: readonly string[];
  readonly copilotModels: readonly string[];
  readonly codexSkills: readonly string[];
  readonly copilotSkills: readonly string[];
}

function list(value: string | undefined, fallback: readonly string[]): readonly string[] {
  return value ? value.split(",").filter(Boolean) : fallback;
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError("invalid integer argument");
  return parsed;
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--"))
      throw new TypeError("invalid team preflight arguments");
    values.set(name.slice(2), value);
  }
  const preferredRuntime = values.get("preferred-runtime");
  if (preferredRuntime !== undefined && !["codex", "copilot"].includes(preferredRuntime))
    throw new TypeError("invalid preferred runtime");
  const workProfile = values.get("work-profile") ?? "implementation";
  if (!["review", "implementation", "synthesis"].includes(workProfile))
    throw new TypeError("invalid work profile");
  const workspace = values.get("workspace");
  return {
    ...(workspace ? { workspace } : {}),
    goal: values.get("goal") ?? "Preflight one dynamic Yukh worker engagement.",
    role: values.get("role") ?? "backend-reviewer",
    workProfile: workProfile as TeamWorkProfile,
    ...(preferredRuntime ? { preferredRuntime: preferredRuntime as AgentRuntime } : {}),
    teamBudget: integer(values.get("team-budget"), 260_000),
    managerBudget: integer(values.get("manager-budget"), 180_000),
    codexModels: list(values.get("codex-models") ?? process.env.YUKH_CODEX_MODELS, ["default"]),
    copilotModels: list(values.get("copilot-models") ?? process.env.YUKH_COPILOT_MODELS, [
      "default",
    ]),
    codexSkills: list(values.get("codex-skills") ?? process.env.YUKH_CODEX_SKILLS, [
      "api-design",
      "testing",
      "product",
      "documentation",
      "security",
    ]),
    copilotSkills: list(values.get("copilot-skills") ?? process.env.YUKH_COPILOT_SKILLS, [
      "frontend",
      "testing",
    ]),
  };
}

try {
  const output = runEngagePreflight(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      schema: 1,
      status: "error",
      command: "team preflight-engage",
      code: error instanceof Error ? error.message : "team_preflight_failed",
    })}\n`,
  );
  process.exitCode = 1;
}
