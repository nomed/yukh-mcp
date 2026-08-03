export interface CoordinationBinding {
  readonly binding_version: 1;
  readonly operation_ref: string;
  readonly subject_ref: string;
  readonly capability_ref: string;
  readonly resource_set_digest: string;
  readonly environment_ref: string;
  readonly plan_digest: string;
  readonly approval_digest: string;
  readonly epoch: number;
  readonly expires_at: string;
}

export interface LeaseCapability {
  readonly kind: "coordination_lease_capability_v1";
  toString(): "LeaseCapability{REDACTED}";
  toJSON(): never;
}

export interface NonceConsumeRequest {
  readonly request_version: 1;
  readonly binding: CoordinationBinding;
  readonly nonce: string;
}
export interface LeaseAcquireRequest {
  readonly request_version: 1;
  readonly binding: CoordinationBinding;
}
export interface LeaseHandleRequest {
  readonly request_version: 1;
  readonly binding: CoordinationBinding;
  readonly lease_capability: LeaseCapability;
}
export interface LeaseRenewRequest extends LeaseHandleRequest {
  readonly expires_at: string;
}

export type NonceResult = Readonly<{ outcome: "consumed" }>;
export type LeaseResult = Readonly<{
  outcome: "acquired" | "renewed";
  lease_capability: LeaseCapability;
  fencing_token: number;
  expires_at: string;
}>;
export type InspectResult = Readonly<{ outcome: "valid" }>;
export type ReleaseResult = Readonly<{ outcome: "released" }>;

export interface CoordinationConsumer {
  consumeNonce(request: NonceConsumeRequest): Promise<NonceResult>;
  acquireLease(request: LeaseAcquireRequest): Promise<LeaseResult>;
  inspectLease(request: LeaseHandleRequest): Promise<InspectResult>;
  renewLease(request: LeaseRenewRequest): Promise<LeaseResult>;
  releaseLease(request: LeaseHandleRequest): Promise<ReleaseResult>;
}

export type CoordinationConsumerErrorCode =
  | "coordination_request_invalid"
  | "coordination_denied"
  | "coordination_conflict"
  | "coordination_replayed"
  | "coordination_stale"
  | "coordination_unavailable"
  | "coordination_response_invalid";

export class CoordinationConsumerError extends Error {
  constructor(readonly code: CoordinationConsumerErrorCode) {
    super(code);
    this.name = "CoordinationConsumerError";
  }
}
