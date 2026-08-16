import { realpathSync } from "node:fs";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { formatTeamStatus } from "./format.js";

interface Arguments {
  readonly teamId: string;
  readonly workspace: string;
  readonly format: "json" | "text";
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new TypeError(`missing ${name}`);
  return value;
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--"))
      throw new TypeError("invalid team stop arguments");
    values.set(name.slice(2), value);
  }
  const format = values.get("format") ?? "text";
  if (!["json", "text"].includes(format)) throw new TypeError("invalid output format");
  return {
    teamId: required(values.get("team"), "--team"),
    workspace: realpathSync(values.get("workspace") ?? process.cwd()),
    format: format as "json" | "text",
  };
}

try {
  const args = parseArguments(process.argv.slice(2));
  const store = new TeamStore(args.workspace);
  store.stop(args.teamId);
  const output = store.status(args.teamId);
  process.stdout.write(
    `${args.format === "json" ? JSON.stringify(output) : formatTeamStatus(output)}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      schema: 1,
      status: "error",
      command: "team stop",
      code: error instanceof Error ? error.message : "team_stop_failed",
    })}\n`,
  );
  process.exitCode = 1;
}
