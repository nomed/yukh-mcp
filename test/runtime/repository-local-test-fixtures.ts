import type { ProtectedAuditEvent } from "../../packages/audit/src/contract.js";
import type { RecoveryFact } from "../../packages/audit/src/lifecycle.js";
import {
  computeProtectedEventCandidateDigest,
  validateRepositoryLocalProtectedEvent,
} from "../../packages/audit/src/repository-local-contract.js";
import { AUDIT_GENESIS_HASH, computeAuditEventHash } from "../../packages/audit/src/writer.js";

export const FIXED_NOW = "2026-08-07T12:00:00.000Z";
export const FIXED_LATER = "2026-08-07T12:00:01.000Z";
export const WRITER_REF = "writer.repository-local-test";
export const STREAM_REF = "stream.repository-local-test";
export const D1 = `sha256:${"1".repeat(64)}`;
export const D2 = `sha256:${"2".repeat(64)}`;
export const D3 = `sha256:${"3".repeat(64)}`;

const NULL_CORRELATION = {
  trace_ref: null,
  request_ref: null,
  authorization_request_ref: null,
  authorization_decision_ref: null,
  plan_ref: null,
  approval_ref: null,
  execution_ref: null,
  verification_ref: null,
  rollback_ref: null,
} as const;

export function protectedGenesisEvent(
  overrides: Readonly<{
    eventId?: string;
    streamRef?: string;
    subjectRef?: string;
    committedAt?: string;
  }> = {},
): ProtectedAuditEvent {
  const base = {
    audit_event_version: 1 as const,
    event_id: overrides.eventId ?? "event.repository-local-opened",
    event_type: "audit.stream_opened.v1" as const,
    classification: "operational" as const,
    occurred_at: "2026-08-07T11:59:59.000Z",
    committed_at: overrides.committedAt ?? FIXED_NOW,
    producer: {
      component_ref: "component.audit-writer",
      instance_ref: "instance.repository-local-test",
    },
    correlation: NULL_CORRELATION,
    causation: { parent_event_refs: [] },
    subject: {
      ref: overrides.subjectRef ?? "service.repository-local-audit",
      kind: "system" as const,
    },
    capability: {
      id: "audit.writer",
      version: "1.0.0",
      definition_digest: D1,
    },
    scope: {
      resource_kind: "security-domain",
      resource_set_ref: "resources.repository-local-audit",
      resource_set_digest: D2,
      environment_ref: "test",
    },
    outcome: { status: "accepted" as const, reason_codes: ["accepted" as const] },
    payload: {
      schema_ref: "audit.stream_opened.v1",
      value: { genesis_hash: AUDIT_GENESIS_HASH },
    },
  };
  const integrityWithoutHash = {
    stream_ref: overrides.streamRef ?? STREAM_REF,
    sequence: 0,
    previous_event_hash: AUDIT_GENESIS_HASH,
    algorithm: "sha256_chain_v1" as const,
    writer_ref: WRITER_REF,
  };
  return validateRepositoryLocalProtectedEvent({
    ...base,
    integrity: {
      ...integrityWithoutHash,
      event_hash: computeAuditEventHash({
        ...base,
        integrity: integrityWithoutHash,
      }),
    },
  });
}

export function protectedRequestEvent(
  previous: ProtectedAuditEvent,
  index = 1,
): ProtectedAuditEvent {
  const base = {
    audit_event_version: 1 as const,
    event_id: `event.repository-local-request-${index}`,
    event_type: "request.accepted.v1" as const,
    classification: "protected" as const,
    occurred_at: "2026-08-07T11:59:59.500Z",
    committed_at: FIXED_NOW,
    producer: {
      component_ref: "component.gateway",
      instance_ref: "instance.repository-local-test",
    },
    correlation: {
      ...NULL_CORRELATION,
      trace_ref: `trace.repository-local-${index}`,
      request_ref: `request.repository-local-${index}`,
    },
    causation: { parent_event_refs: [] },
    subject: { ref: "subject.repository-local", kind: "workload" as const },
    capability: {
      id: "service.restart",
      version: "1.0.0",
      definition_digest: D1,
    },
    scope: {
      resource_kind: "service",
      resource_set_ref: "resources.repository-local",
      resource_set_digest: D2,
      environment_ref: "test",
    },
    outcome: { status: "accepted" as const, reason_codes: ["accepted" as const] },
    payload: {
      schema_ref: "audit.request_accepted.v1",
      value: { request_digest: D3 },
    },
  };
  const integrityWithoutHash = {
    stream_ref: previous.integrity.stream_ref,
    sequence: previous.integrity.sequence + 1,
    previous_event_hash: previous.integrity.event_hash,
    algorithm: "sha256_chain_v1" as const,
    writer_ref: WRITER_REF,
  };
  return validateRepositoryLocalProtectedEvent({
    ...base,
    integrity: {
      ...integrityWithoutHash,
      event_hash: computeAuditEventHash({
        ...base,
        integrity: integrityWithoutHash,
      }),
    },
  });
}

export function candidateDigest(event: ProtectedAuditEvent): string {
  return computeProtectedEventCandidateDigest(event);
}

export function recoveryFact(
  index = 0,
  overrides: Readonly<{
    recoveryId?: string;
    eventId?: string;
    observedAt?: string;
  }> = {},
): RecoveryFact {
  return {
    recovery_fact_version: 1,
    recovery_id: overrides.recoveryId ?? `recovery.repository-local-${index}`,
    event_id: overrides.eventId ?? `event.recovery-source-${index}`,
    event_type: "execution.completed.v1",
    original_observed_at:
      overrides.observedAt ?? `2026-08-07T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
    original_observation_parent_event_ref: `event.recovery-parent-${index}`,
    cause: "primary_writer_failed_after_provider_start",
    trace_ref: `trace.recovery-${index}`,
    request_ref: `request.recovery-${index}`,
    execution_ref: `execution.recovery-${index}`,
    plan_digest: D1,
    attempt: 1,
    observed_outcome: "effect_observed",
    withheld_outcome: "completion_unknown",
  };
}
