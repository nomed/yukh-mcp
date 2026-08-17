import type { runApprovedPreflight } from "./approved-run.js";
import type { runApprovedPlan } from "./plan-execute.js";
import type { EngagePreflightOutput } from "./preflight.js";
import type { TeamStore } from "../../../packages/team-control/src/store.js";

type ApprovedRunOutput = Awaited<ReturnType<typeof runApprovedPreflight>>;
type ApprovedPlanRunOutput = Awaited<ReturnType<typeof runApprovedPlan>>;
type TeamStatus = ReturnType<TeamStore["status"]>;

function list(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function compact(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function formatEngagePreflight(
  output: EngagePreflightOutput,
  options?: { readonly runCommand?: string | false },
): string {
  const worker = output.planned_worker;
  const policy = output.policy.recommendation;
  const lines = [
    "Yukh team preflight",
    `Status: ${output.status}`,
    `Workspace: ${output.workspace}`,
    `Approval digest: ${output.approval_digest}`,
    "",
    "Planned worker",
    `- id: ${worker.agent_id}`,
    `- role: ${worker.role}`,
    `- task: ${compact(worker.task, 240)}`,
    `- runtime: ${policy.runtime}`,
    `- model: ${policy.model}`,
    `- skills: ${list(policy.skills)}`,
    `- token budget: ${policy.token_budget}`,
    `- tool mode: ${policy.tool_mode}`,
    `- max commands: ${policy.max_commands}`,
    `- timeout ms: ${policy.runtime_timeout_ms}`,
  ];
  if (output.runtime_token_floor)
    lines.push(
      `- runtime token floor: ${output.runtime_token_floor.minimum_token_budget}`,
      `- floor reason: ${compact(output.runtime_token_floor.reason, 180)}`,
    );
  lines.push(
    "",
    "Budget",
    `- team budget: ${output.budget.budget}`,
    `- allocated: ${output.budget.allocated}`,
    `- observed provider tokens: ${output.provider_tokens_observed}`,
    `- provider launched: ${output.provider_runtime_launched ? "yes" : "no"}`,
  );
  const runCommand =
    options?.runCommand === undefined
      ? `yukh team run-approved --preflight <preflight.json> --approved-digest ${output.approval_digest}`
      : options.runCommand;
  if (runCommand) lines.push("", "Run after approval", runCommand);
  return lines.join("\n");
}

export function formatApprovedRun(output: ApprovedRunOutput): string {
  const usage = output.terminal_agent?.usage;
  const lines = [
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
  ];
  if (usage)
    lines.push(
      `- terminal input: ${usage.input_tokens}`,
      `- terminal cached input: ${usage.cached_input_tokens}`,
      `- terminal uncached input: ${usage.input_tokens - usage.cached_input_tokens}`,
      `- terminal output: ${usage.output_tokens}`,
      `- terminal reasoning output: ${usage.reasoning_output_tokens}`,
    );
  lines.push("", `Terminal worker state: ${output.terminal_agent?.state ?? "not waited"}`);
  return lines.join("\n");
}

export function formatApprovedPlanRun(output: ApprovedPlanRunOutput): string {
  return [
    "Yukh approved plan run",
    `Status: ${output.status}`,
    `Plan: ${output.plan.plan_id}`,
    `Plan state: ${output.plan.state}`,
    `Provider launched: ${output.provider_runtime_launched ? "yes" : "no"}`,
    `Workers: ${output.plan.worker_agent_ids.length}`,
    `Synthesis: ${output.plan.synthesis_agent_id ?? "none"}`,
    "",
    "Tokens",
    `- observed: ${output.team.tokens.observed}`,
    `- allocated: ${output.team.tokens.allocated}`,
    `- remaining: ${output.team.tokens.remaining}`,
    `- pending agents: ${output.team.tokens.pending_agents}`,
    `- unaccounted agents: ${output.team.tokens.unaccounted_agents}`,
    `- exceeded agents: ${output.team.tokens.exceeded_agents}`,
  ].join("\n");
}

export function formatTeamStatus(output: TeamStatus): string {
  const lines = [
    "Yukh team status",
    `Team: ${output.team.team_id}`,
    `State: ${output.team.state}`,
    `Workspace: ${output.team.workspace}`,
    "",
    "Tokens",
    `- budget: ${output.tokens.budget}`,
    `- allocated: ${output.tokens.allocated}`,
    `- observed: ${output.tokens.observed}`,
    `- remaining: ${output.tokens.remaining}`,
    `- pending agents: ${output.tokens.pending_agents}`,
    `- unaccounted agents: ${output.tokens.unaccounted_agents}`,
    `- exceeded agents: ${output.tokens.exceeded_agents}`,
    "",
    "Agents",
  ];
  for (const agent of output.agents)
    lines.push(
      `- ${agent.agent_id} ${agent.kind}/${agent.role} state=${agent.state} budget=${agent.token_budget} observed=${agent.usage?.total_tokens ?? 0} outcome=${agent.completion?.outcome ?? "none"}`,
    );
  return lines.join("\n");
}
