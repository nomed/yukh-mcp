import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePreflightArguments } from "./arguments.js";
import { formatEngagePreflight } from "./format.js";
import { runEngagePreflight } from "./preflight.js";

function slug(value: string): string {
  return value
    .replace(/[^a-z0-9-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function approvalPath(workspace: string, role: string): string {
  const directory = join(workspace, ".yukh", "approvals");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return join(directory, `${timestamp()}-${slug(role) || "worker"}.json`);
}

try {
  const workspace = realpathSync(process.cwd());
  const args = parsePreflightArguments(process.argv.slice(2), {
    defaultFormat: "text",
    defaultWorkspace: workspace,
  });
  const output = runEngagePreflight(args);
  const path = args.outputPath ?? approvalPath(output.workspace, output.planned_worker.role);
  writeFileSync(path, `${JSON.stringify(output)}\n`, { mode: 0o600 });
  const rendered =
    args.format === "json"
      ? JSON.stringify({ ...output, approval_file: path })
      : [
          formatEngagePreflight(output, {
            runCommand: output.provider_launchable
              ? `yukh team run-approved --preflight ${path} --approved-digest ${output.approval_digest} --format text`
              : false,
          }),
          "",
          `Approval file: ${path}`,
        ].join("\n");
  process.stdout.write(`${rendered}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      schema: 1,
      status: "error",
      command: "team propose",
      code: error instanceof Error ? error.message : "team_propose_failed",
    })}\n`,
  );
  process.exitCode = 1;
}
