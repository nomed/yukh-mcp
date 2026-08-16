import type { CoordinationOutput } from "../../coordination-preview/src/launcher.js";
import type {
  AgentRecord,
  TeamActionReceipt,
  TeamExecutionPlanRecord,
  TeamRecord,
} from "../../team-control/src/store.js";

export interface WatchRecord {
  readonly sequence: number;
  readonly event: {
    readonly id: string;
    readonly type: string;
    readonly time: string;
    readonly participant: { readonly id: string };
    readonly data: Record<string, unknown>;
  };
  readonly receipt: { readonly receipt_id: string };
}

export interface LifecycleRecord {
  readonly schema: 1;
  readonly event: string;
  readonly agent?: string;
  readonly question_event_id?: string;
  readonly turn?: number;
  readonly failure_code?: string;
}

export interface TeamSnapshot {
  readonly team: TeamRecord;
  readonly agents: readonly AgentRecord[];
  readonly receipts: readonly TeamActionReceipt[];
  readonly plans?: readonly TeamExecutionPlanRecord[];
  readonly tokens: {
    readonly budget: number;
    readonly allocated: number;
    readonly observed: number;
    readonly remaining: number;
    readonly pending_agents: number;
    readonly unaccounted_agents: number;
    readonly exceeded_agents: number;
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const participant = /^agent:[a-z][a-z0-9-]{0,47}$/u;
const lifecycleAgent = /^agent-[a-z][a-z0-9-]{0,47}$/u;

export function watchRecords(output: CoordinationOutput, after: number): WatchRecord[] {
  if (output.status !== "ok" || !output.result || typeof output.result !== "object")
    throw new Error("coordination_protocol_error");
  const records = (output.result as { records?: unknown }).records;
  if (!Array.isArray(records)) throw new Error("coordination_protocol_error");
  return records
    .map((item: unknown) => validate(item))
    .filter((record) => record.sequence > after)
    .sort((left, right) => left.sequence - right.sequence);
}

function validate(item: unknown): WatchRecord {
  if (!item || typeof item !== "object") throw new Error("coordination_protocol_error");
  const record = item as WatchRecord;
  const event = record.event;
  if (
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 1 ||
    !event ||
    !uuid.test(event.id) ||
    !["join", "leave", "question", "answer"].includes(event.type) ||
    typeof event.time !== "string" ||
    !event.participant ||
    !participant.test(event.participant.id) ||
    !event.data ||
    typeof event.data !== "object" ||
    !record.receipt ||
    !uuid.test(record.receipt.receipt_id)
  )
    throw new Error("coordination_protocol_error");
  return record;
}

export function recordIsVisible(record: WatchRecord, present: Set<string>): boolean {
  const actor = record.event.participant.id;
  if (record.event.type === "join") {
    if (present.has(actor)) return false;
    present.add(actor);
  } else if (record.event.type === "leave") {
    present.delete(actor);
  }
  return true;
}

export function renderRecord(record: WatchRecord, verbose: boolean, full = false): string {
  const time = new Date(record.event.time);
  if (Number.isNaN(time.valueOf())) throw new Error("coordination_protocol_error");
  const actor = record.event.participant.id;
  let peer = "";
  if (record.event.type === "question" && Array.isArray(record.event.data.requested_from))
    peer = ` → ${record.event.data.requested_from.join(", ")}`;
  const heading = `${time.toISOString().slice(11, 19)}  ${actor}${peer}  ${record.event.type.toUpperCase()}`;
  const body = record.event.data.body;
  const lines = [heading];
  if (record.event.type === "answer" && typeof record.event.data.question_event_id === "string")
    lines.push(`         ↳ question=${record.event.data.question_event_id}`);
  if (typeof body === "string" && body.length > 0 && body.length <= 4_096) {
    if (full) {
      lines.push(...body.split("\n").map((line) => `         ${line}`));
    } else {
      const compact = body.replace(/\s+/gu, " ").trim();
      lines.push(`         ${compact.length > 240 ? `${compact.slice(0, 239)}…` : compact}`);
    }
  }
  if (verbose) lines.push(`         event=${record.event.id} receipt=${record.receipt.receipt_id}`);
  return lines.join("\n");
}

export function lifecycleRecords(raw: string, after: number): LifecycleRecord[] {
  if (raw.length > 65_536) throw new Error("coordination_protocol_error");
  const lines = raw.split("\n").filter(Boolean);
  return lines.slice(after).map((line) => {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object") throw new Error("coordination_protocol_error");
    const record = value as LifecycleRecord;
    const allowed = [
      "agent_started",
      "answer_verified",
      "agent_completed_without_answer",
      "agent_failed",
      "coordinator_unavailable",
      "coordinator_recovered",
      "conversation_complete",
    ];
    if (
      record.schema !== 1 ||
      !allowed.includes(record.event) ||
      (record.agent !== undefined && !lifecycleAgent.test(record.agent)) ||
      (record.question_event_id !== undefined && !uuid.test(record.question_event_id)) ||
      (record.turn !== undefined && (!Number.isSafeInteger(record.turn) || record.turn < 1)) ||
      (record.failure_code !== undefined &&
        !["agent_spawn_failed", "agent_timed_out", "agent_exit_nonzero", "agent_error"].includes(
          record.failure_code,
        ))
    )
      throw new Error("coordination_protocol_error");
    return record;
  });
}

export function renderLifecycle(record: LifecycleRecord): string {
  if (record.event === "conversation_complete") return "COORDINATOR  CONVERSATION COMPLETE";
  if (record.event === "coordinator_unavailable")
    return "COORDINATOR  COORDINATION TEMPORARILY UNAVAILABLE — RETRYING";
  if (record.event === "coordinator_recovered") return "COORDINATOR  COORDINATION RECOVERED";
  const label = record.event.replaceAll("_", " ").toUpperCase();
  const failure = record.failure_code ? ` failure=${record.failure_code}` : "";
  return `COORDINATOR  ${record.agent ?? "agent"}  ${label}  turn=${record.turn ?? "?"} question=${record.question_event_id ?? "?"}${failure}`;
}

export function renderTeamChanges(
  snapshots: readonly TeamSnapshot[],
  previous: Map<string, string>,
): string[] {
  const lines: string[] = [];
  for (const snapshot of snapshots) {
    const teamKey = `team:${snapshot.team.team_id}`;
    const teamValue = `${snapshot.team.state}:${snapshot.agents.length}:${snapshot.receipts.length}:${snapshot.tokens.allocated}:${snapshot.tokens.observed}:${snapshot.tokens.pending_agents}:${snapshot.tokens.unaccounted_agents}:${snapshot.tokens.exceeded_agents}`;
    if (previous.get(teamKey) !== teamValue) {
      previous.set(teamKey, teamValue);
      lines.push(
        `TEAM  ${snapshot.team.team_id}  ${snapshot.team.state.toUpperCase()}  agents=${snapshot.agents.length}\n      manager=${snapshot.team.manager_role ?? "manager"} runtime=${snapshot.team.manager_runtime} goal=${compact(snapshot.team.goal, 160)}${snapshot.team.manager_mission ? `\n      mission=${compact(snapshot.team.manager_mission, 160)}` : ""}\n      tokens=${snapshot.tokens.observed}/${snapshot.tokens.budget} allocated=${snapshot.tokens.allocated} pending=${snapshot.tokens.pending_agents} unaccounted=${snapshot.tokens.unaccounted_agents} exceeded=${snapshot.tokens.exceeded_agents} receipts=${snapshot.receipts.length}`,
      );
    }
    for (const agent of snapshot.agents) {
      const key = `agent:${agent.agent_id}`;
      const value = `${agent.state}:${agent.task}:${agent.max_commands ?? 8}:${agent.timeout_ms ?? 300_000}:${agent.usage?.total_tokens ?? "pending"}:${agent.completion?.outcome ?? "pending"}`;
      if (previous.get(key) === value) continue;
      previous.set(key, value);
      lines.push(
        `${agent.kind === "manager" ? "MANAGER" : "WORKER"}  ${agent.role}  ${agent.state.toUpperCase()}  runtime=${agent.runtime}${agent.profile ? ` model=${agent.profile.model}` : ""}\n        task=${compact(agent.task, 180)}${agent.profile ? `\n        mission=${compact(agent.profile.mission, 160)} skills=${agent.profile.skills.join(",") || "none"}` : ""}\n        bounds=commands:${agent.max_commands ?? 8} timeout_ms:${agent.timeout_ms ?? 300_000} tools=${agent.model_tool_mode ?? "default"}\n        tokens=${agent.usage?.total_tokens ?? "pending"}/${agent.token_budget} input=${agent.usage?.input_tokens ?? "pending"} cached=${agent.usage?.cached_input_tokens ?? "pending"} output=${agent.usage?.output_tokens ?? "pending"} reasoning=${agent.usage?.reasoning_output_tokens ?? "pending"} accounting=${agent.usage?.source ?? "pending"} completion=${agent.completion?.outcome ?? "pending"}\n        required=${agent.required_actions.join(",") || "none"} receipts=${
          snapshot.receipts
            .filter((receipt) => receipt.actor_agent_id === agent.agent_id)
            .map((receipt) => receipt.action)
            .join(",") || "none"
        }\n        coordination=${agent.coordination_participant} id=${agent.agent_id} parent=${agent.parent_agent_id ?? (agent.kind === "manager" ? "root" : "manager")}`,
      );
    }
    for (const plan of snapshot.plans ?? []) {
      const key = `plan:${plan.plan_id}`;
      const value = `${plan.state}:${plan.worker_agent_ids.join(",")}:${plan.synthesis_agent_id ?? "pending"}:${plan.failure_code ?? "none"}`;
      if (previous.get(key) === value) continue;
      previous.set(key, value);
      lines.push(
        `PLAN  ${plan.plan_id}  ${plan.state.toUpperCase()}  workers=${plan.worker_agent_ids.length} synthesis=${plan.synthesis_agent_id ?? "pending"}\n      digest=${plan.digest} manager=${plan.manager_agent_id}${plan.failure_code ? ` failure=${plan.failure_code}` : ""}`,
      );
    }
  }
  return lines;
}

function compact(value: string, limit: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}
