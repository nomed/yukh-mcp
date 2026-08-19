import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type PreviewRuntimeStatus = "ok" | "ok-with-warnings" | "attention-required";

export type PreviewRuntimeCheck = () => PreviewRuntimeStatusResponse;

export type PreviewRuntimeStatusResponse = {
  readonly schema: "yukh-control-plane-preview-runtime-status-v1";
  readonly source: "preview-runtime-check";
  readonly checked_at: string;
  readonly side_effects: "none";
  readonly status: PreviewRuntimeStatus;
  readonly runtime?: string;
  readonly launcher?: string;
  readonly checks: Record<string, string>;
  readonly warnings: readonly string[];
  readonly problems: readonly string[];
};

const STATUS_VALUES = new Set(["ok", "ok-with-warnings", "attention-required"]);

function emptyStatus(
  status: PreviewRuntimeStatus,
  checkedAt: string,
): PreviewRuntimeStatusResponse {
  return {
    schema: "yukh-control-plane-preview-runtime-status-v1",
    source: "preview-runtime-check",
    checked_at: checkedAt,
    side_effects: "none",
    status,
    checks: {},
    warnings: [],
    problems: [],
  };
}

export function parsePreviewRuntimeCheckOutput(
  output: string,
  checkedAt = new Date().toISOString(),
): PreviewRuntimeStatusResponse {
  const checks: Record<string, string> = {};
  const warnings: string[] = [];
  const problems: string[] = [];
  let status: PreviewRuntimeStatus = "attention-required";
  let runtime: string | undefined;
  let launcher: string | undefined;

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "status" && STATUS_VALUES.has(value)) {
      status = value as PreviewRuntimeStatus;
    } else if (key === "warning") {
      warnings.push(value);
    } else if (key === "problem") {
      problems.push(value);
    } else if (key === "runtime") {
      runtime = value;
    } else if (key === "launcher") {
      launcher = value;
    } else {
      checks[key] = value;
    }
  }

  return {
    ...emptyStatus(status, checkedAt),
    ...(runtime ? { runtime } : {}),
    ...(launcher ? { launcher } : {}),
    checks,
    warnings,
    problems,
  };
}

export function createPreviewRuntimeCheck(
  options: { readonly repoRoot?: string; readonly timeoutMs?: number } = {},
): PreviewRuntimeCheck {
  const repoRoot = options.repoRoot ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const script = join(repoRoot, ".github", "scripts", "check-preview-runtime.sh");

  return () => {
    const checkedAt = new Date().toISOString();
    if (!existsSync(script)) {
      return {
        ...emptyStatus("attention-required", checkedAt),
        problems: ["preview runtime check script unavailable"],
      };
    }

    const result = spawnSync(script, {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
      timeout: timeoutMs,
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const parsed = parsePreviewRuntimeCheckOutput(stdout, checkedAt);
    if (result.error) {
      return {
        ...parsed,
        status: "attention-required",
        problems: [...parsed.problems, result.error.message],
      };
    }
    if (result.status !== 0 && parsed.problems.length === 0) {
      return {
        ...parsed,
        status: "attention-required",
        problems: [...parsed.problems, stderr.trim() || "preview runtime check failed"],
      };
    }
    return parsed;
  };
}
