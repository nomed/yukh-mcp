export interface AuthorizationRequestV1 {
  readonly authorization_request_version: 1;
  readonly authorization_request_id: string;
  readonly request_digest: string;
  readonly subject: Readonly<{
    ref: string;
    kind: "human" | "workload";
    authentication_context_ref: string;
    authentication_strength: "bounded_session" | "phishing_resistant" | "workload_attested";
  }>;
  readonly action: Readonly<{
    capability: Readonly<{ id: string; version: string }>;
    definition_digest: string;
    operation_class: "read" | "mutate";
    effects: readonly ("observe" | "create" | "update" | "delete" | "emit")[];
    approval_mode: "never" | "policy" | "explicit";
  }>;
  readonly resource: Readonly<{
    kind: string;
    refs: readonly string[];
    attributes_digest: string;
  }>;
  readonly environment: Readonly<{ ref: string; attributes_digest: string }>;
  readonly request_context: Readonly<{
    normalized_input_digest: string;
    risk: "low" | "medium" | "high" | "critical";
    requested_at: string;
  }>;
  readonly policy: Readonly<{ bundle_ref: string; revision: number; digest: string }>;
  readonly attributes: Readonly<{
    snapshot_ref: string;
    digest: string;
    observed_at: string;
  }>;
}

export type AuthorizationConstraint =
  | Readonly<{
      type: "output_data_class";
      value: "public" | "operational_metadata" | "internal" | "restricted";
    }>
  | Readonly<{ type: "output_fields" | "allowed_resource_refs"; value: readonly string[] }>
  | Readonly<{
      type: "max_result_items" | "max_output_bytes" | "decision_ttl_ms" | "concurrency_limit";
      value: number;
    }>
  | Readonly<{
      type: "time_window";
      value: Readonly<{ not_before: string; not_after: string }>;
    }>
  | Readonly<{
      type: "input_value_set";
      value: Readonly<{
        path: string;
        values: readonly (string | number | boolean | null)[];
      }>;
    }>;

export type AuthorizationObligation =
  | Readonly<{
      type: "approval_required";
      value: "standard" | "elevated" | "destructive";
    }>
  | Readonly<{
      type: "evidence_profile";
      value: "standard_read" | "standard_mutation" | "enhanced";
    }>
  | Readonly<{
      type: "verification_profile";
      value: "schema_only" | "declared_postconditions" | "independent";
    }>
  | Readonly<{ type: "redaction_profile"; value: "standard" | "strict" | "metadata_only" }>
  | Readonly<{
      type: "concurrency_profile";
      value: "per_subject" | "per_resource" | "exclusive_scope";
    }>;

export interface AuthorizationDecisionV1 {
  readonly authorization_decision_version: 1;
  readonly decision_id: string;
  readonly decision_digest: string;
  readonly authorization_request_id: string;
  readonly request_digest: string;
  readonly effect: "allow" | "deny";
  readonly basis: "explicit" | "default" | "error" | "indeterminate";
  readonly reason_codes: readonly string[];
  readonly subject_ref: string;
  readonly authentication_context_ref: string;
  readonly action: AuthorizationRequestV1["action"];
  readonly resource: Readonly<{ kind: string; refs: readonly string[] }>;
  readonly environment_ref: string;
  readonly policy: AuthorizationRequestV1["policy"];
  readonly attribute_snapshot_ref: string;
  readonly constraints: readonly AuthorizationConstraint[];
  readonly obligations: readonly AuthorizationObligation[];
  readonly issued_at: string;
  readonly expires_at: string;
  readonly evaluator_ref: string;
}

export interface AuthorizationObligationReceipt {
  readonly type: AuthorizationObligation["type"];
  readonly value: string;
  readonly decision_id: string;
}

export interface AuthorizationValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly Readonly<{
    code: string;
    path: string;
    message: string;
  }>[];
}

export interface AuthorizationEvidenceV1 {
  readonly authorization_evidence_version: 1;
  readonly evidence_id: string;
  readonly authorization_request_id: string;
  readonly request_digest: string;
  readonly decision_id: string;
  readonly decision_digest: string;
  readonly effect: AuthorizationDecisionV1["effect"];
  readonly basis: AuthorizationDecisionV1["basis"];
  readonly reason_codes: readonly string[];
  readonly subject_ref: string;
  readonly authentication_context_ref: string;
  readonly action: AuthorizationRequestV1["action"];
  readonly resource: Readonly<{ kind: string; refs: readonly string[] }>;
  readonly environment_ref: string;
  readonly policy: AuthorizationRequestV1["policy"];
  readonly attribute_snapshot_ref: string;
  readonly attribute_snapshot_digest: string;
  readonly constraints_digest: string;
  readonly obligations: readonly AuthorizationObligation[];
  readonly evaluator_ref: string;
  readonly evaluated_at: string;
  readonly enforcement: "not_attempted" | "allowed" | "denied" | "obligation_pending";
  readonly obligation_receipt_refs: readonly string[];
}

export function digest(value: unknown): string;
export function buildAuthorizationRequest(
  input: Readonly<{
    authorization_request_id: string;
    subject: AuthorizationRequestV1["subject"];
    definition: Readonly<{
      capability: Readonly<{ id: string; version: string }>;
      operation: Readonly<{
        class: "read" | "mutate";
        effects: readonly ("observe" | "create" | "update" | "delete" | "emit")[];
      }>;
      approval: Readonly<{ mode: "never" | "policy" | "explicit" }>;
    }>;
    resource: AuthorizationRequestV1["resource"];
    environment: AuthorizationRequestV1["environment"];
    normalized_input: unknown;
    risk: AuthorizationRequestV1["request_context"]["risk"];
    requested_at: string;
    policy: AuthorizationRequestV1["policy"];
    attributes: AuthorizationRequestV1["attributes"];
  }>,
): AuthorizationRequestV1;
export function combineAuthorization(
  input: Readonly<{
    request: AuthorizationRequestV1;
    evaluation: unknown;
    decision_id: string;
    issued_at: string;
    expires_at: string;
  }>,
): AuthorizationDecisionV1;
export function validateAuthorizationRecord(
  kind: "request" | "evaluation" | "decision" | "evidence",
  value: unknown,
): AuthorizationValidationResult;
export function createDecisionEnforcer(): (
  input: Readonly<{
    decision: AuthorizationDecisionV1;
    request: AuthorizationRequestV1;
    now: string;
    obligation_receipts?: readonly AuthorizationObligationReceipt[];
    constraint_handlers?: Readonly<Record<string, (value: unknown) => boolean>>;
    approval_receipt_verifier?: (
      receipt: AuthorizationObligationReceipt,
      decision: AuthorizationDecisionV1,
      request: AuthorizationRequestV1,
    ) => boolean;
  }>,
) => Readonly<{
  allowed: boolean;
  code:
    | "authorized"
    | "decision_already_consumed"
    | "decision_binding_mismatch"
    | "authorization_denied"
    | "decision_stale"
    | "constraint_failed"
    | "constraint_unenforceable"
    | "obligation_pending";
}>;
export function buildAuthorizationEvidence(
  input: Readonly<{
    evidence_id: string;
    request: AuthorizationRequestV1;
    decision: AuthorizationDecisionV1;
    evaluation: Readonly<{ evaluated_at: string }>;
    enforcement: AuthorizationEvidenceV1["enforcement"];
    obligation_receipt_refs?: readonly string[];
  }>,
): AuthorizationEvidenceV1;
