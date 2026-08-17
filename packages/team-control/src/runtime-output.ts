import type { AgentUsage } from "./store.js";

interface MutableUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}

type UsageSource = AgentUsage["source"];

export class RuntimeOutput {
  readonly #runtime: "codex" | "copilot";
  #summary = "";
  readonly #usage: MutableUsage = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
  #usageObserved = false;
  #commandsStarted = 0;
  #usageSource: UsageSource = "codex-json-v1";

  constructor(runtime: "codex" | "copilot") {
    this.#runtime = runtime;
  }

  line(raw: string): void {
    if (Buffer.byteLength(raw, "utf8") > 1_048_576) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    if (!value || typeof value !== "object") return;
    const event = value as Record<string, unknown>;
    if (this.#runtime === "codex") this.#codex(event);
    else this.#copilot(event);
  }

  summary(): string {
    const normalized = this.#summary.trim();
    return Buffer.byteLength(normalized, "utf8") <= 4_096 ? normalized : "";
  }

  commandsStarted(): number {
    return this.#commandsStarted;
  }

  setSummary(summary: string): void {
    this.#summary = summary;
  }

  addUsage(source: UsageSource, usage: MutableUsage): void {
    const counts = [
      usage.input_tokens,
      usage.cached_input_tokens,
      usage.output_tokens,
      usage.reasoning_output_tokens,
    ];
    if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) return;
    if (usage.cached_input_tokens > usage.input_tokens) return;
    if (usage.reasoning_output_tokens > usage.output_tokens) return;
    this.#usageSource = source;
    this.#usage.input_tokens += usage.input_tokens;
    this.#usage.cached_input_tokens += usage.cached_input_tokens;
    this.#usage.output_tokens += usage.output_tokens;
    this.#usage.reasoning_output_tokens += usage.reasoning_output_tokens;
    this.#usageObserved = true;
  }

  usage(budget: number): AgentUsage | undefined {
    if (!this.#usageObserved) return undefined;
    const total = this.#usage.input_tokens + this.#usage.output_tokens;
    return {
      schema: 1,
      source: this.#usageSource,
      ...this.#usage,
      total_tokens: total,
      budget_outcome: total <= budget ? "within" : "exceeded",
    };
  }

  #codex(event: Record<string, unknown>): void {
    if (
      event.type === "item.started" &&
      object(event.item) &&
      event.item.type === "command_execution"
    )
      this.#commandsStarted += 1;
    if (event.type === "item.completed" && object(event.item)) {
      const item = event.item;
      if (item.type === "agent_message" && typeof item.text === "string") this.#summary = item.text;
    }
    if (event.type !== "turn.completed" || !object(event.usage)) return;
    const usage = event.usage;
    const counts = [
      usage.input_tokens,
      usage.cached_input_tokens,
      usage.output_tokens,
      usage.reasoning_output_tokens,
    ];
    if (counts.some((count) => !Number.isSafeInteger(count) || Number(count) < 0)) return;
    this.addUsage("codex-json-v1", {
      input_tokens: Number(usage.input_tokens),
      cached_input_tokens: Number(usage.cached_input_tokens),
      output_tokens: Number(usage.output_tokens),
      reasoning_output_tokens: Number(usage.reasoning_output_tokens),
    });
  }

  #copilot(event: Record<string, unknown>): void {
    if (!object(event.data)) return;
    if (
      ["assistant.message", "assistant.message_delta"].includes(String(event.type)) &&
      typeof event.data.content === "string"
    )
      this.#summary = event.data.content;
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
