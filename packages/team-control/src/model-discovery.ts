import { execFileSync } from "node:child_process";

const token = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;

export function parseCodexModelCatalog(output: string): readonly string[] {
  const line = output
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .findLast((value) => value.startsWith("{"));
  if (!line) return [];
  const parsed = JSON.parse(line) as { readonly models?: readonly { readonly slug?: unknown }[] };
  return unique(
    (parsed.models ?? [])
      .map((model) => model.slug)
      .filter((slug): slug is string => typeof slug === "string" && token.test(slug)),
  );
}

export function parseCopilotConfigModels(output: string): readonly string[] {
  const lines = output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes("`model`: AI model"));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.includes("`contextTier`:"));
  return unique(
    lines
      .slice(start, end < 0 ? undefined : end)
      .map((line) => line.match(/^\s+-\s+"([^"]+)"/u)?.[1])
      .filter((model): model is string => typeof model === "string" && token.test(model)),
  );
}

export function runtimeModels(
  explicit: string | undefined,
  fallback: readonly string[],
  discover: () => readonly string[],
): readonly string[] {
  if (explicit !== undefined) return unique(explicit.split(",").filter(Boolean));
  let discovered: readonly string[] = [];
  try {
    discovered = discover();
  } catch {
    discovered = [];
  }
  return unique(["default", ...(discovered.length > 0 ? discovered : fallback)]);
}

export function discoverCodexModels(executable: string): readonly string[] {
  return parseCodexModelCatalog(
    execFileSync(executable, ["debug", "models"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

export function discoverCopilotModels(executable: string): readonly string[] {
  return parseCopilotConfigModels(
    execFileSync(executable, ["help", "config"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => token.test(value)))];
}
