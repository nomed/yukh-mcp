import { createHash } from "node:crypto";
import type { TeamStore } from "../../../packages/team-control/src/store.js";

export type ControlPlaneTeamStatus = {
  readonly schema: "yukh-control-plane-team-status-v1";
  readonly source: "local-team-store" | "unconfigured";
  readonly teams: readonly ControlPlaneTeamSummary[];
};

export type ControlPlaneTeamSummary = {
  readonly team_id: string;
  readonly state: string;
  readonly manager_runtime: string;
  readonly manager_role?: string;
  readonly goal_digest: `sha-256:${string}`;
  readonly tokens: {
    readonly budget: number;
    readonly allocated: number;
    readonly observed: number;
    readonly remaining: number;
    readonly pending_agents: number;
    readonly unaccounted_agents: number;
    readonly exceeded_agents: number;
  };
  readonly receipts_count: number;
  readonly plans: readonly {
    readonly plan_id: string;
    readonly state: string;
    readonly worker_count: number;
    readonly has_synthesis: boolean;
  }[];
  readonly agents: readonly {
    readonly agent_id: string;
    readonly kind: string;
    readonly role: string;
    readonly runtime: string;
    readonly state: string;
    readonly coordination_participant: string;
    readonly token_budget: number;
    readonly observed_tokens: number;
    readonly budget_outcome?: string;
    readonly completion_outcome?: string;
  }[];
};

function digest(value: string): `sha-256:${string}` {
  return `sha-256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createTeamStatus(store?: Pick<TeamStore, "teams">): ControlPlaneTeamStatus {
  if (!store) {
    return {
      schema: "yukh-control-plane-team-status-v1",
      source: "unconfigured",
      teams: [],
    };
  }

  return {
    schema: "yukh-control-plane-team-status-v1",
    source: "local-team-store",
    teams: store.teams().map((status) => ({
      team_id: status.team.team_id,
      state: status.team.state,
      manager_runtime: status.team.manager_runtime,
      ...(status.team.manager_role ? { manager_role: status.team.manager_role } : {}),
      goal_digest: digest(status.team.goal),
      tokens: status.tokens,
      receipts_count: status.receipts.length,
      plans: status.plans.map((plan) => ({
        plan_id: plan.plan_id,
        state: plan.state,
        worker_count: plan.worker_agent_ids.length,
        has_synthesis: plan.synthesis_agent_id !== undefined,
      })),
      agents: status.agents.map((agent) => ({
        agent_id: agent.agent_id,
        kind: agent.kind,
        role: agent.role,
        runtime: agent.runtime,
        state: agent.state,
        coordination_participant: agent.coordination_participant,
        token_budget: agent.token_budget,
        observed_tokens: agent.usage?.total_tokens ?? 0,
        ...(agent.usage ? { budget_outcome: agent.usage.budget_outcome } : {}),
        ...(agent.completion ? { completion_outcome: agent.completion.outcome } : {}),
      })),
    })),
  };
}
