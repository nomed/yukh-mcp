import {
  formatSuiteBaseline,
  suiteBaseline,
} from "../../../packages/suite-baseline/src/baseline.js";

interface Arguments {
  readonly workspace?: string;
  readonly format: "json" | "text";
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--"))
      throw new TypeError("invalid suite baseline arguments");
    values.set(name.slice(2), value);
  }
  const format = values.get("format") ?? "text";
  if (!["json", "text"].includes(format)) throw new TypeError("invalid output format");
  const workspace = values.get("workspace");
  return {
    ...(workspace ? { workspace } : {}),
    format: format as "json" | "text",
  };
}

try {
  const args = parseArguments(process.argv.slice(2));
  const output = suiteBaseline(args.workspace);
  process.stdout.write(
    `${args.format === "json" ? JSON.stringify(output) : formatSuiteBaseline(output)}\n`,
  );
  if (output.state === "error") process.exitCode = 1;
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      schema: 1,
      status: "error",
      command: "suite baseline",
      code: error instanceof Error ? error.message : "suite_baseline_failed",
    })}\n`,
  );
  process.exitCode = 1;
}
