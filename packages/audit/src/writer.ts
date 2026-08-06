import { createHash } from "node:crypto";
import {
  AUDIT_REGISTRY,
  AuditError,
  type AuditCandidate,
  type AuditEventType,
  type ProtectedAuditEvent,
  requiredParentTypes,
  validateAuditCandidate,
  validateProtectedAuditEvent,
} from "./contract.js";

export const AUDIT_GENESIS_HASH = `sha256:${"0".repeat(64)}`;

export interface AuditCommitReceipt {
  readonly event: ProtectedAuditEvent;
  readonly durability: "durable" | "volatile_test_only";
  readonly duplicate: boolean;
}

export interface AuditStore {
  findById(eventId: string): Promise<
    | Readonly<{
        event: ProtectedAuditEvent;
        candidate_digest: string;
        durability: AuditCommitReceipt["durability"];
      }>
    | undefined
  >;
  tail(streamRef: string): Promise<ProtectedAuditEvent | undefined>;
  /**
   * Atomically checks event identity and the stream head, then commits the exact
   * event bytes, candidate digest, sequence, and previous hash.
   */
  append(event: ProtectedAuditEvent, candidateDigest: string): Promise<AuditCommitReceipt>;
}

export function canonicalAuditJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAuditJson).join(",")}]`;
  if (typeof value !== "object") throw new AuditError("audit_integrity_failure");
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalAuditJson(item)}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalAuditJson(value)).digest("hex")}`;
}

export function computeAuditEventHash(
  event: Omit<ProtectedAuditEvent, "integrity"> & {
    readonly integrity: Omit<ProtectedAuditEvent["integrity"], "event_hash">;
  },
): string {
  return sha256(event);
}

function sameOperation(parent: ProtectedAuditEvent, candidate: AuditCandidate): boolean {
  const correlationKeys =
    (candidate.event_type === "apply.admitted.v1" ||
      (candidate.event_type === "authorization.evaluation_recorded.v1" &&
        candidate.payload.authorization_phase === "apply")) &&
    (parent.event_type === "plan.created.v1" || parent.event_type === "approval.approved.v1")
      ? (["trace_ref", "request_ref", "plan_ref", "approval_ref"] as const)
      : ([
          "trace_ref",
          "request_ref",
          "authorization_request_ref",
          "authorization_decision_ref",
          "plan_ref",
          "approval_ref",
          "execution_ref",
        ] as const);
  return (
    correlationKeys.every(
      (key) =>
        parent.correlation[key] === null || parent.correlation[key] === candidate.correlation[key],
    ) &&
    parent.subject.ref === candidate.subject.ref &&
    parent.subject.kind === candidate.subject.kind &&
    parent.capability.id === candidate.capability.id &&
    parent.capability.version === candidate.capability.version &&
    parent.capability.definition_digest === candidate.capability.definition_digest &&
    parent.scope.resource_kind === candidate.scope.resource_kind &&
    parent.scope.resource_set_ref === candidate.scope.resource_set_ref &&
    parent.scope.resource_set_digest === candidate.scope.resource_set_digest &&
    parent.scope.environment_ref === candidate.scope.environment_ref
  );
}

function value(event: ProtectedAuditEvent): Readonly<Record<string, unknown>> {
  return event.payload.value as Readonly<Record<string, unknown>>;
}

function candidateValue(candidate: AuditCandidate): Readonly<Record<string, unknown>> {
  return candidate.payload as Readonly<Record<string, unknown>>;
}

function parent(
  parents: readonly ProtectedAuditEvent[],
  eventType: AuditEventType,
): ProtectedAuditEvent {
  const found = parents.find((event) => event.event_type === eventType);
  if (found === undefined) throw new AuditError("audit_causation_invalid");
  return found;
}

function payloadBindingsMatch(
  candidate: AuditCandidate,
  parents: readonly ProtectedAuditEvent[],
): boolean {
  const child = candidateValue(candidate);
  switch (candidate.event_type) {
    case "audit.stream_opened.v1":
    case "request.accepted.v1":
      return true;
    case "authorization.evaluation_recorded.v1": {
      parent(parents, "request.accepted.v1");
      if (child.authorization_phase === "planning") return child.plan_digest === null;
      return (
        child.plan_digest === value(parent(parents, "plan.created.v1")).plan_digest &&
        (candidate.correlation.approval_ref === null ||
          child.plan_digest === value(parent(parents, "approval.approved.v1")).plan_digest)
      );
    }
    case "authorization.decision_recorded.v1": {
      const evaluation = value(parent(parents, "authorization.evaluation_recorded.v1"));
      return (
        child.authorization_request_digest === evaluation.authorization_request_digest &&
        child.authorization_phase === evaluation.authorization_phase &&
        child.plan_digest === evaluation.plan_digest
      );
    }
    case "authorization.enforcement_recorded.v1": {
      const decision = value(parent(parents, "authorization.decision_recorded.v1"));
      return (
        child.decision_digest === decision.decision_digest &&
        child.authorization_phase === decision.authorization_phase &&
        child.plan_digest === decision.plan_digest &&
        (child.enforcement_result === "enforced"
          ? decision.effect === "allow" && decision.basis === "explicit"
          : decision.effect === "deny")
      );
    }
    case "plan.created.v1": {
      const enforcement = value(parent(parents, "authorization.enforcement_recorded.v1"));
      return (
        enforcement.enforcement_result === "enforced" &&
        enforcement.authorization_phase === "planning" &&
        enforcement.plan_digest === null &&
        child.authorization_decision_digest === enforcement.decision_digest
      );
    }
    case "approval.requested.v1":
      return child.plan_digest === value(parent(parents, "plan.created.v1")).plan_digest;
    case "approval.approved.v1":
      return (
        child.plan_digest === value(parent(parents, "approval.requested.v1")).plan_digest &&
        child.plan_digest === value(parent(parents, "plan.created.v1")).plan_digest
      );
    case "apply.admitted.v1": {
      const enforcement = value(parent(parents, "authorization.enforcement_recorded.v1"));
      return (
        enforcement.enforcement_result === "enforced" &&
        enforcement.authorization_phase === "apply" &&
        enforcement.plan_digest === child.plan_digest &&
        child.plan_digest === value(parent(parents, "plan.created.v1")).plan_digest &&
        child.fresh_authorization_decision_digest === enforcement.decision_digest &&
        (candidate.correlation.approval_ref === null ||
          child.plan_digest === value(parent(parents, "approval.approved.v1")).plan_digest)
      );
    }
    case "execution.attempt_reserved.v1":
      return child.plan_digest === value(parent(parents, "apply.admitted.v1")).plan_digest;
    case "execution.started.v1": {
      const reserved = value(parent(parents, "execution.attempt_reserved.v1"));
      return child.plan_digest === reserved.plan_digest && child.attempt === reserved.attempt;
    }
    case "execution.completed.v1": {
      const started = value(parent(parents, "execution.started.v1"));
      return child.plan_digest === started.plan_digest && child.attempt === started.attempt;
    }
  }
}

export class AuditWriter {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: Readonly<{
      store: AuditStore;
      streamRef: string;
      writerRef: string;
      now?: () => Date;
    }>,
  ) {
    const reference = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
    if (
      this.options.streamRef.length > 128 ||
      this.options.writerRef.length > 128 ||
      !reference.test(this.options.streamRef) ||
      !reference.test(this.options.writerRef)
    ) {
      throw new AuditError("audit_candidate_invalid");
    }
  }

  commit(candidate: AuditCandidate): Promise<AuditCommitReceipt>;
  commit(candidate: unknown): Promise<AuditCommitReceipt> {
    const operation = this.queue.then(async () => {
      try {
        return await this.commitSerial(validateAuditCandidate(candidate));
      } catch (error) {
        if (error instanceof AuditError) throw error;
        throw new AuditError("audit_unavailable");
      }
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async commitSerial(candidate: AuditCandidate): Promise<AuditCommitReceipt> {
    const candidateDigest = sha256(candidate);
    const existing = await this.options.store.findById(candidate.event_id);
    if (existing !== undefined) {
      if (existing.candidate_digest !== candidateDigest) {
        throw new AuditError("audit_duplicate_conflict");
      }
      return {
        event: existing.event,
        durability: existing.durability,
        duplicate: true,
      };
    }

    const registry = AUDIT_REGISTRY[candidate.event_type];
    const expectedParentTypes = requiredParentTypes(candidate);
    const parents: ProtectedAuditEvent[] = [];
    for (const [index, expectedType] of expectedParentTypes.entries()) {
      const parentRef = candidate.causation.parent_event_refs[index];
      const found = parentRef ? await this.options.store.findById(parentRef) : undefined;
      if (
        found === undefined ||
        found.event.event_type !== expectedType ||
        !sameOperation(found.event, candidate)
      ) {
        throw new AuditError("audit_causation_invalid");
      }
      parents.push(found.event);
    }
    if (!payloadBindingsMatch(candidate, parents)) {
      throw new AuditError("audit_causation_invalid");
    }

    const tail = await this.options.store.tail(this.options.streamRef);
    const sequence = tail === undefined ? 0 : tail.integrity.sequence + 1;
    if (
      (sequence === 0 &&
        (candidate.event_type !== "audit.stream_opened.v1" ||
          candidate.payload.genesis_hash !== AUDIT_GENESIS_HASH)) ||
      (sequence !== 0 && candidate.event_type === "audit.stream_opened.v1")
    ) {
      throw new AuditError("audit_integrity_failure");
    }
    if (
      parents.some(
        (event) =>
          event.integrity.stream_ref === this.options.streamRef &&
          event.integrity.sequence >= sequence,
      )
    ) {
      throw new AuditError("audit_causation_invalid");
    }

    let committedAt: string;
    try {
      committedAt = (this.options.now ?? (() => new Date()))().toISOString();
    } catch {
      throw new AuditError("audit_unavailable");
    }
    const base = {
      audit_event_version: 1 as const,
      event_id: candidate.event_id,
      event_type: candidate.event_type,
      classification: registry.classification,
      occurred_at: candidate.occurred_at,
      committed_at: committedAt,
      producer: candidate.producer,
      correlation: candidate.correlation,
      causation: candidate.causation,
      subject: candidate.subject,
      capability: candidate.capability,
      scope: candidate.scope,
      outcome: candidate.outcome,
      payload: {
        schema_ref: registry.schemaRef,
        value: candidate.payload,
      },
    };
    const integrityWithoutHash = {
      stream_ref: this.options.streamRef,
      sequence,
      previous_event_hash: tail?.integrity.event_hash ?? AUDIT_GENESIS_HASH,
      algorithm: "sha256_chain_v1" as const,
      writer_ref: this.options.writerRef,
    };
    const event: ProtectedAuditEvent = {
      ...base,
      integrity: {
        ...integrityWithoutHash,
        event_hash: computeAuditEventHash({
          ...base,
          integrity: integrityWithoutHash,
        }),
      },
    };
    const receipt = await this.options.store.append(event, candidateDigest);
    if (
      receipt.event.event_id !== candidate.event_id ||
      (!receipt.duplicate && canonicalAuditJson(receipt.event) !== canonicalAuditJson(event)) ||
      (receipt.durability !== "durable" && receipt.durability !== "volatile_test_only")
    ) {
      throw new AuditError("audit_integrity_failure");
    }
    return receipt;
  }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export class InMemoryAuditStore implements AuditStore {
  private readonly events = new Map<
    string,
    Readonly<{
      event: ProtectedAuditEvent;
      candidate_digest: string;
      durability: "volatile_test_only";
    }>
  >();
  private readonly streams = new Map<string, ProtectedAuditEvent[]>();

  async findById(eventId: string) {
    return this.events.get(eventId);
  }

  async tail(streamRef: string) {
    return this.streams.get(streamRef)?.at(-1);
  }

  async append(event: ProtectedAuditEvent, candidateDigest: string) {
    const existing = this.events.get(event.event_id);
    if (existing !== undefined) {
      if (existing.candidate_digest !== candidateDigest) {
        throw new AuditError("audit_duplicate_conflict");
      }
      return {
        event: existing.event,
        durability: "volatile_test_only" as const,
        duplicate: true,
      };
    }
    const stream = this.streams.get(event.integrity.stream_ref) ?? [];
    const tail = stream.at(-1);
    const expectedSequence = tail === undefined ? 0 : tail.integrity.sequence + 1;
    const expectedPrevious = tail?.integrity.event_hash ?? AUDIT_GENESIS_HASH;
    if (
      event.integrity.sequence !== expectedSequence ||
      event.integrity.previous_event_hash !== expectedPrevious
    ) {
      throw new AuditError("audit_integrity_failure");
    }
    const storedEvent = freeze(structuredClone(event));
    stream.push(storedEvent);
    this.streams.set(event.integrity.stream_ref, stream);
    this.events.set(event.event_id, {
      event: storedEvent,
      candidate_digest: candidateDigest,
      durability: "volatile_test_only",
    });
    return {
      event: storedEvent,
      durability: "volatile_test_only" as const,
      duplicate: false,
    };
  }

  readStream(streamRef: string): readonly ProtectedAuditEvent[] {
    return [...(this.streams.get(streamRef) ?? [])];
  }
}

export function verifyAuditStream(events: readonly ProtectedAuditEvent[]): Readonly<{
  valid: boolean;
  code?: "audit_integrity_failure";
  sequence?: number;
}> {
  if (events.length === 0) return { valid: false, code: "audit_integrity_failure" };
  let streamRef: string | undefined;
  for (const [index, uncheckedEvent] of events.entries()) {
    let event: ProtectedAuditEvent;
    let candidate: AuditCandidate;
    try {
      event = validateProtectedAuditEvent(uncheckedEvent);
      candidate = validateAuditCandidate({
        audit_candidate_version: 1,
        event_id: event.event_id,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        producer: event.producer,
        correlation: event.correlation,
        causation: event.causation,
        subject: event.subject,
        capability: event.capability,
        scope: event.scope,
        outcome: event.outcome,
        payload: event.payload.value,
      });
    } catch {
      const sequence =
        typeof uncheckedEvent === "object" &&
        uncheckedEvent !== null &&
        "integrity" in uncheckedEvent &&
        typeof uncheckedEvent.integrity === "object" &&
        uncheckedEvent.integrity !== null &&
        "sequence" in uncheckedEvent.integrity &&
        typeof uncheckedEvent.integrity.sequence === "number"
          ? uncheckedEvent.integrity.sequence
          : undefined;
      return {
        valid: false,
        code: "audit_integrity_failure",
        ...(sequence === undefined ? {} : { sequence }),
      };
    }
    streamRef ??= event.integrity.stream_ref;
    const expectedPrevious =
      index === 0 ? AUDIT_GENESIS_HASH : events[index - 1]?.integrity.event_hash;
    const { event_hash: _eventHash, ...integrityWithoutHash } = event.integrity;
    const computed = computeAuditEventHash({
      ...event,
      integrity: integrityWithoutHash,
    });
    if (
      event.integrity.stream_ref !== streamRef ||
      event.integrity.sequence !== index ||
      event.integrity.previous_event_hash !== expectedPrevious ||
      event.integrity.event_hash !== computed ||
      event.integrity.algorithm !== "sha256_chain_v1" ||
      event.classification !== AUDIT_REGISTRY[candidate.event_type].classification ||
      event.payload.schema_ref !== AUDIT_REGISTRY[candidate.event_type].schemaRef ||
      (index === 0 && event.event_type !== "audit.stream_opened.v1") ||
      (index !== 0 && event.event_type === "audit.stream_opened.v1")
    ) {
      return {
        valid: false,
        code: "audit_integrity_failure",
        sequence: event.integrity.sequence,
      };
    }
  }
  return { valid: true };
}
