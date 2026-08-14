import type {
  CoordinationLauncher,
  CoordinationOutput,
  PreviewAgent,
} from "../../coordination-preview/src/launcher.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface AgentRunner {
  run(agent: PreviewAgent, prompt: string): Promise<void>;
}

export interface CoordinatorOptions {
  readonly launchers: Readonly<Record<PreviewAgent, CoordinationLauncher>>;
  readonly runner: AgentRunner;
  readonly maxTurns: number;
  readonly lifetimeMs: number;
  readonly now?: () => number;
}

type RecordValue = { readonly event?: unknown };
type EventValue = {
  readonly id: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
};

function events(output: CoordinationOutput): EventValue[] {
  if (output.status !== "ok" || !output.result || typeof output.result !== "object")
    throw new Error("coordination_protocol_error");
  const records = (output.result as { records?: unknown }).records;
  if (!Array.isArray(records)) throw new Error("coordination_protocol_error");
  return records.map((record: RecordValue) => {
    const event = record?.event;
    if (!event || typeof event !== "object") throw new Error("coordination_protocol_error");
    const value = event as EventValue;
    if (
      !uuid.test(value.id) ||
      typeof value.type !== "string" ||
      !value.data ||
      typeof value.data !== "object"
    )
      throw new Error("coordination_protocol_error");
    return value;
  });
}

function target(event: EventValue): PreviewAgent | undefined {
  if (event.type !== "question" || !Array.isArray(event.data.requested_from)) return undefined;
  if (event.data.requested_from.includes("agent:a")) return "agent-a";
  if (event.data.requested_from.includes("agent:b")) return "agent-b";
  return undefined;
}

export class ConversationCoordinator {
  readonly #options: CoordinatorOptions;
  readonly #started: number;
  readonly #attempted = new Set<string>();
  #turns = 0;

  constructor(options: CoordinatorOptions) {
    if (
      !Number.isInteger(options.maxTurns) ||
      options.maxTurns < 1 ||
      options.maxTurns > 100 ||
      !Number.isInteger(options.lifetimeMs) ||
      options.lifetimeMs < 1_000 ||
      options.lifetimeMs > 86_400_000
    )
      throw new TypeError("invalid coordinator bounds");
    this.#options = options;
    this.#started = (options.now ?? Date.now)();
  }

  async tick(): Promise<"idle" | "invoked" | "complete"> {
    const now = (this.#options.now ?? Date.now)();
    if (this.#turns >= this.#options.maxTurns || now - this.#started >= this.#options.lifetimeMs)
      return "complete";
    const transcript = events(await this.#replay("agent-a"));
    const answered = new Set(
      transcript
        .filter(
          (event) => event.type === "answer" && uuid.test(String(event.data.question_event_id)),
        )
        .map((event) => String(event.data.question_event_id)),
    );
    const question = transcript.find((event) => {
      const addressed = target(event);
      return addressed && !answered.has(event.id) && !this.#attempted.has(event.id);
    });
    if (!question) return "idle";
    const agent = target(question);
    if (!agent) return "idle";
    this.#attempted.add(question.id);
    this.#turns++;
    await this.#options.runner.run(
      agent,
      `Use only yukh-coordination. Bootstrap if required, join, replay, find question event ${question.id}, and answer it preserving work_uri, correlation_id and question_event_id. If the work needs another peer action, publish one directed follow-up question with the same work_uri.`,
    );
    return "invoked";
  }

  async #replay(agent: PreviewAgent): Promise<CoordinationOutput> {
    let output = await this.#options.launchers[agent].invoke("events replay");
    if (output.status === "error" && output.code === "YKC-AUTH-001") {
      const bootstrap = await this.#options.launchers[agent].invoke("session bootstrap");
      if (bootstrap.status !== "ok") return bootstrap;
      output = await this.#options.launchers[agent].invoke("events replay");
    }
    return output;
  }
}
