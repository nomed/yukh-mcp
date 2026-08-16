import { writeFileSync } from "node:fs";
import { parsePreflightArguments } from "./arguments.js";
import { formatEngagePreflight } from "./format.js";
import { runEngagePreflight } from "./preflight.js";

try {
  const args = parsePreflightArguments(process.argv.slice(2));
  const output = runEngagePreflight(args);
  if (args.outputPath)
    writeFileSync(args.outputPath, `${JSON.stringify(output)}\n`, { mode: 0o600 });
  process.stdout.write(
    `${args.format === "json" ? JSON.stringify(output) : formatEngagePreflight(output)}\n`,
  );
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
