import type { AgentRecord } from "../../../packages/team-control/src/store.js";

export interface RuntimeTokenFloor {
  readonly schema: 1;
  readonly applies: true;
  readonly runtime: "codex";
  readonly minimum_token_budget: number;
  readonly measured_total_tokens: number;
  readonly measured_cached_input_tokens: number;
  readonly reason: string;
}

export function runtimeTokenFloor(worker: AgentRecord): RuntimeTokenFloor | undefined {
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
    minimum_token_budget: 120_000,
    measured_total_tokens: 116_713,
    measured_cached_input_tokens: 89_600,
    reason:
      "Codex CLI one-command workers have a measured cached input floor near 90k tokens, so smaller total-token budgets are not launch-safe with the CLI runner.",
  };
}

export function assertRuntimeTokenFloor(worker: AgentRecord): void {
  const floor = runtimeTokenFloor(worker);
  if (floor && worker.token_budget < floor.minimum_token_budget)
    throw new Error("worker_token_budget_below_runtime_floor");
}
