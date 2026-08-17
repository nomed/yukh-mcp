import type { AgentRecord } from "../../../packages/team-control/src/store.js";

export interface RuntimeTokenFloor {
  readonly schema: 1;
  readonly applies: true;
  readonly runtime: "codex";
  readonly provider: "cli" | "python-app-server";
  readonly minimum_token_budget: number;
  readonly measured_total_tokens: number;
  readonly measured_cached_input_tokens: number;
  readonly reason: string;
}

export function codexWorkerProvider(): "cli" | "python-app-server" {
  return process.env.YUKH_CODEX_WORKER_PROVIDER === "python-app-server"
    ? "python-app-server"
    : "cli";
}

export function runtimeTokenFloor(
  worker: AgentRecord,
  provider: "cli" | "python-app-server" = codexWorkerProvider(),
): RuntimeTokenFloor | undefined {
  if (
    worker.runtime !== "codex" ||
    (worker.model_tool_mode ?? "default") !== "none" ||
    (worker.max_commands ?? 8) > 1
  )
    return undefined;

  return {
    schema: 1,
    applies: true,
    runtime: "codex",
    provider,
    ...(provider === "python-app-server"
      ? {
          minimum_token_budget: 18_000,
          measured_total_tokens: 10_830,
          measured_cached_input_tokens: 10_112,
          reason:
            "Codex Python app-server tool-free workers qualified at 10,830 total tokens with the real Yukh prompt; 18k keeps a conservative launch floor for this opt-in provider.",
        }
      : {
          minimum_token_budget: 120_000,
          measured_total_tokens: 116_713,
          measured_cached_input_tokens: 89_600,
          reason:
            "Codex CLI one-command workers have a measured cached input floor near 90k tokens, so smaller total-token budgets are not launch-safe with the CLI runner.",
        }),
  };
}

export function assertRuntimeTokenFloor(
  worker: AgentRecord,
  provider: "cli" | "python-app-server" = codexWorkerProvider(),
): void {
  const floor = runtimeTokenFloor(worker, provider);
  if (floor && worker.token_budget < floor.minimum_token_budget)
    throw new Error("worker_token_budget_below_runtime_floor");
}
