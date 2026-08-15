import type { CoordinationOutput } from "../../coordination-preview/src/launcher.js";

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
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

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
    !["agent:a", "agent:b"].includes(event.participant.id) ||
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
      "conversation_complete",
    ];
    if (
      record.schema !== 1 ||
      !allowed.includes(record.event) ||
      (record.agent !== undefined && !["agent-a", "agent-b"].includes(record.agent)) ||
      (record.question_event_id !== undefined && !uuid.test(record.question_event_id)) ||
      (record.turn !== undefined && (!Number.isSafeInteger(record.turn) || record.turn < 1))
    )
      throw new Error("coordination_protocol_error");
    return record;
  });
}

export function renderLifecycle(record: LifecycleRecord): string {
  if (record.event === "conversation_complete") return "COORDINATOR  CONVERSATION COMPLETE";
  const label = record.event.replaceAll("_", " ").toUpperCase();
  return `COORDINATOR  ${record.agent ?? "agent"}  ${label}  turn=${record.turn ?? "?"} question=${record.question_event_id ?? "?"}`;
}
