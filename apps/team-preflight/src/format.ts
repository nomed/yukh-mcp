import type { runApprovedPreflight } from "./approved-run.js";
import type { EngagePreflightOutput } from "./preflight.js";

type ApprovedRunOutput = Awaited<ReturnType<typeof runApprovedPreflight>>;

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

export function formatEngagePreflight(output: EngagePreflightOutput): string {
  const worker = output.planned_worker;
  const policy = output.policy.recommendation;
  return [
    "Yukh team preflight",
    `Status: ${output.status}`,
    `Workspace: ${output.workspace}`,
    `Approval digest: ${output.approval_digest}`,
    "",
    "Planned worker",
    `- id: ${worker.agent_id}`,
    `- role: ${worker.role}`,
    `- runtime: ${policy.runtime}`,
    `- model: ${policy.model}`,
    `- skills: ${list(policy.skills)}`,
    `- token budget: ${policy.token_budget}`,
    `- tool mode: ${policy.tool_mode}`,
    `- max commands: ${policy.max_commands}`,
    `- timeout ms: ${policy.runtime_timeout_ms}`,
    "",
    "Budget",
    `- team budget: ${output.budget.budget}`,
    `- allocated: ${output.budget.allocated}`,
    `- observed provider tokens: ${output.provider_tokens_observed}`,
    `- provider launched: ${output.provider_runtime_launched ? "yes" : "no"}`,
    "",
    "Run after approval",
    `yukh team run-approved --preflight <preflight.json> --approved-digest ${output.approval_digest}`,
  ].join("\n");
}

export function formatApprovedRun(output: ApprovedRunOutput): string {
  return [
    "Yukh approved run",
    `Status: ${output.status}`,
    `Approval digest: ${output.approval_digest}`,
    `Provider launched: ${output.provider_runtime_launched ? "yes" : "no"}`,
    `Launched worker: ${output.launched_worker}`,
    `Receipt: ${output.receipt.receipt_id} (${output.receipt.action})`,
    `Runtime pid: ${output.runtime.pid}`,
    `Runtime log: ${output.runtime.log}`,
    "",
    "Tokens",
    `- observed: ${output.tokens.observed}`,
    `- allocated: ${output.tokens.allocated}`,
    `- remaining: ${output.tokens.remaining}`,
    `- pending agents: ${output.tokens.pending_agents}`,
    `- unaccounted agents: ${output.tokens.unaccounted_agents}`,
    "",
    `Terminal worker state: ${output.terminal_agent?.state ?? "not waited"}`,
  ].join("\n");
}
