export const WORKER_ACTIVITY_STREAM = "YKR_WORKER_EVENTS_V1";
export const WORKER_ACTIVITY_SUBJECT = "yukh.*.*.runtime.worker.*.*.v1";
export const WORKER_ACTIVITY_SCHEMA =
  "https://yukh.example/schemas/runtime/v1/worker-activity.schema.json";
export const WORKER_ACTIVITY_MAX_PAYLOAD_BYTES = 8_192;

export type WorkerActivityKind =
  "heartbeat" | "log-chunked" | "status-changed" | "tokens-observed" | "artifact-recorded";

export type WorkerActivityEvent = {
  readonly specversion: "1.0";
  readonly id: string;
  readonly source: string;
  readonly type: "worker.activity.v1";
  readonly subject: string;
  readonly time: string;
  readonly datacontenttype: "application/json";
  readonly dataschema: typeof WORKER_ACTIVITY_SCHEMA;
  readonly correlationid?: string;
  readonly causationid?: string;
  readonly data: {
    readonly aggregate_type: "WorkerSession";
    readonly aggregate_id: string;
    readonly producer_id: string;
    readonly sequence: number;
    readonly activity_kind: WorkerActivityKind;
    readonly observed_at: string;
    readonly worker_state?: "defined" | "running" | "completed" | "failed" | "stopped";
    readonly summary?: string;
    readonly artifact_ref?: string;
    readonly tokens?: {
      readonly observed: number;
      readonly budget: number;
      readonly budget_outcome?: "within" | "exceeded";
    };
  };
};

export type WorkerActivityPublishReceipt = {
  readonly stream: typeof WORKER_ACTIVITY_STREAM;
  readonly sequence: number;
  readonly duplicate: boolean;
};

export interface WorkerActivityEventBus {
  publish(event: WorkerActivityEvent): Promise<WorkerActivityPublishReceipt>;
  recent(limit: number): Promise<readonly WorkerActivityEvent[]>;
  close(): Promise<void>;
}

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const nameSegmentPattern = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const tenantPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const subjectPattern =
  /^yukh\.(local|dev|staging|prod)\.[a-z0-9][a-z0-9-]{0,63}\.runtime\.worker\.[a-z0-9][a-z0-9-]{0,127}\.(heartbeat|log-chunked|status-changed|tokens-observed|artifact-recorded)\.v1$/u;
const sourcePattern =
  /^yukh:\/\/runtime\/[a-z0-9][a-z0-9-]{0,63}\/worker\/[a-z0-9][a-z0-9-]{0,127}$/u;
const identifierPattern = /^[a-z][a-z0-9._:-]{0,127}$/u;

export function workerActivitySubject(input: {
  readonly env: "local" | "dev" | "staging" | "prod";
  readonly tenant: string;
  readonly workerId: string;
  readonly kind: WorkerActivityKind;
}): string {
  if (!tenantPattern.test(input.tenant) || !nameSegmentPattern.test(input.workerId)) {
    throw new TypeError("invalid worker activity subject input");
  }
  return `yukh.${input.env}.${input.tenant}.runtime.worker.${input.workerId}.${input.kind}.v1`;
}

export function validateWorkerActivityEvent(event: WorkerActivityEvent): void {
  if (
    event.specversion !== "1.0" ||
    !idPattern.test(event.id) ||
    !sourcePattern.test(event.source) ||
    event.type !== "worker.activity.v1" ||
    !subjectPattern.test(event.subject) ||
    !timePattern.test(event.time) ||
    event.datacontenttype !== "application/json" ||
    event.dataschema !== WORKER_ACTIVITY_SCHEMA ||
    !identifierPattern.test(event.data.aggregate_id) ||
    !identifierPattern.test(event.data.producer_id) ||
    event.data.aggregate_type !== "WorkerSession" ||
    !Number.isSafeInteger(event.data.sequence) ||
    event.data.sequence < 1 ||
    (event.correlationid !== undefined && !identifierPattern.test(event.correlationid)) ||
    (event.causationid !== undefined && !identifierPattern.test(event.causationid)) ||
    (event.data.summary !== undefined && event.data.summary.length > 2_048) ||
    (event.data.activity_kind === "artifact-recorded" && !event.data.artifact_ref) ||
    (event.data.activity_kind === "tokens-observed" && !event.data.tokens) ||
    (event.data.activity_kind === "status-changed" && !event.data.worker_state)
  ) {
    throw new TypeError("invalid worker activity event");
  }
}

export function encodeWorkerActivityEvent(event: WorkerActivityEvent): Uint8Array {
  validateWorkerActivityEvent(event);
  const payload = new TextEncoder().encode(JSON.stringify(event));
  if (payload.byteLength > WORKER_ACTIVITY_MAX_PAYLOAD_BYTES) {
    throw new TypeError("worker activity payload too large");
  }
  return payload;
}

function decodeWorkerActivityEvent(payload: Uint8Array): WorkerActivityEvent | null {
  if (payload.byteLength > WORKER_ACTIVITY_MAX_PAYLOAD_BYTES) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as WorkerActivityEvent;
    validateWorkerActivityEvent(value);
    return value;
  } catch {
    return null;
  }
}

export type WorkerActivityJetStreamOptions = {
  readonly servers: string | readonly string[];
  readonly stream?: typeof WORKER_ACTIVITY_STREAM;
  readonly createStream?: boolean;
  readonly maxMessages?: number;
  readonly maxBytes?: number;
  readonly maxAgeNanos?: number;
};

type NatsConnectionLike = {
  close(): Promise<void>;
};

type JetStreamPublishAck = {
  readonly stream: string;
  readonly seq: number;
  readonly duplicate: boolean;
};

type JetStreamLike = {
  publish(
    subject: string,
    payload: Uint8Array,
    options: { readonly msgID: string },
  ): Promise<JetStreamPublishAck>;
  streams: {
    get(stream: string): Promise<{
      info(): Promise<{
        readonly state: { readonly first_seq: number; readonly last_seq: number };
      }>;
      getMessage(query: { readonly seq: number }): Promise<{ readonly data: Uint8Array } | null>;
    }>;
  };
};

type JetStreamManagerLike = {
  streams: {
    info(stream: string): Promise<unknown>;
    add(config: Record<string, unknown>): Promise<unknown>;
  };
};

const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<Record<string, unknown>>;

export class WorkerActivityJetStreamBus implements WorkerActivityEventBus {
  readonly #connection: NatsConnectionLike;
  readonly #jetstream: JetStreamLike;
  readonly #jetstreamManager: () => Promise<JetStreamManagerLike>;

  private constructor(
    connection: NatsConnectionLike,
    jetstreamClient: JetStreamLike,
    jetstreamManagerFactory: () => Promise<JetStreamManagerLike>,
  ) {
    this.#connection = connection;
    this.#jetstream = jetstreamClient;
    this.#jetstreamManager = jetstreamManagerFactory;
  }

  static async connect(
    options: WorkerActivityJetStreamOptions,
  ): Promise<WorkerActivityJetStreamBus> {
    const transport = await dynamicImport("@nats-io/transport-node");
    const jetstreamModule = await dynamicImport("@nats-io/jetstream");
    const connect = transport.connect as (input: {
      readonly servers?: string | readonly string[];
    }) => Promise<NatsConnectionLike>;
    const createJetStream = jetstreamModule.jetstream as (
      connection: NatsConnectionLike,
    ) => JetStreamLike;
    const createJetStreamManager = jetstreamModule.jetstreamManager as (
      connection: NatsConnectionLike,
    ) => Promise<JetStreamManagerLike>;
    const connection = await connect({ servers: options.servers });
    const bus = new WorkerActivityJetStreamBus(connection, createJetStream(connection), () =>
      createJetStreamManager(connection),
    );
    if (options.createStream ?? true) {
      await bus.ensureStream(options);
    }
    return bus;
  }

  async ensureStream(options: WorkerActivityJetStreamOptions): Promise<void> {
    const manager = await this.#jetstreamManager();
    try {
      await manager.streams.info(options.stream ?? WORKER_ACTIVITY_STREAM);
      return;
    } catch {
      await manager.streams.add({
        name: options.stream ?? WORKER_ACTIVITY_STREAM,
        subjects: [WORKER_ACTIVITY_SUBJECT],
        retention: "limits",
        storage: "file",
        discard: "old",
        max_msgs: options.maxMessages ?? 10_000,
        max_bytes: options.maxBytes ?? 64 * 1024 * 1024,
        max_age: options.maxAgeNanos ?? 7 * 24 * 60 * 60 * 1_000_000_000,
        max_msg_size: WORKER_ACTIVITY_MAX_PAYLOAD_BYTES,
        allow_direct: true,
        description: "Yukh bounded runtime worker activity events v1",
      });
    }
  }

  async publish(event: WorkerActivityEvent): Promise<WorkerActivityPublishReceipt> {
    const ack = await this.#jetstream.publish(event.subject, encodeWorkerActivityEvent(event), {
      msgID: event.id,
    });
    if (ack.stream !== WORKER_ACTIVITY_STREAM) throw new Error("worker_activity_stream_mismatch");
    return { stream: WORKER_ACTIVITY_STREAM, sequence: ack.seq, duplicate: ack.duplicate };
  }

  async recent(limit: number): Promise<readonly WorkerActivityEvent[]> {
    const bounded = Math.max(0, Math.min(50, Math.trunc(limit)));
    if (bounded === 0) return [];
    const stream = await this.#jetstream.streams.get(WORKER_ACTIVITY_STREAM);
    const info = await stream.info();
    const events: WorkerActivityEvent[] = [];
    for (
      let sequence = info.state.last_seq;
      sequence >= info.state.first_seq && events.length < bounded;
      sequence -= 1
    ) {
      const message = await stream.getMessage({ seq: sequence }).catch(() => null);
      if (!message) continue;
      const event = decodeWorkerActivityEvent(message.data);
      if (event) events.push(event);
    }
    return events;
  }

  async close(): Promise<void> {
    await this.#connection.close();
  }
}
