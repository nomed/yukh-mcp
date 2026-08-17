import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { RuntimeOutput } from "../../../packages/team-control/src/runtime-output.js";
import type { AgentRecord } from "../../../packages/team-control/src/store.js";

interface CopilotSdkModule {
  readonly CopilotClient: new (options: Record<string, unknown>) => {
    start(): Promise<void>;
    stop(): Promise<readonly Error[]>;
    forceStop(): Promise<void>;
    createSession(config: Record<string, unknown>): Promise<CopilotSdkSession>;
  };
  readonly RuntimeConnection: {
    forStdio(options: { readonly path: string; readonly env: Record<string, string> }): unknown;
  };
}

interface CopilotSdkSession {
  on(handler: (event: unknown) => void): () => void;
  sendAndWait(message: { readonly prompt: string }, timeout: number): Promise<unknown>;
  disconnect?(): Promise<void>;
}

const importModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

export interface CopilotSdkWorkerRunOptions {
  readonly executable: string;
  readonly workspace: string;
  readonly prompt: string;
  readonly agent: AgentRecord;
  readonly timeoutMs: number;
  readonly sdk?: CopilotSdkModule;
}

export interface WorkerRunOutcome {
  readonly exitCode: number;
  readonly stopped: boolean;
  readonly bound?: "commands" | "deadline";
  readonly output: RuntimeOutput;
}

export async function runCopilotSdkWorker({
  executable,
  workspace,
  prompt,
  agent,
  timeoutMs,
  sdk,
}: CopilotSdkWorkerRunOptions): Promise<WorkerRunOutcome> {
  const output = new RuntimeOutput("copilot");
  const module = sdk ?? ((await importModule("@github/copilot-sdk")) as CopilotSdkModule);
  const baseDirectory = join(workspace, ".yukh", "copilot-sdk");
  mkdirSync(baseDirectory, { recursive: true, mode: 0o700 });
  const client = new module.CopilotClient({
    mode: "empty",
    baseDirectory,
    workingDirectory: workspace,
    logLevel: "none",
    connection: module.RuntimeConnection.forStdio({
      path: executable,
      env: {
        HOME: process.env.HOME ?? "",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
    }),
  });
  let deadline = false;
  const timer = setTimeout(() => {
    deadline = true;
    void client.forceStop().catch(() => undefined);
  }, timeoutMs);
  try {
    await client.start();
    const session = await client.createSession({
      clientName: "yukh-team-worker",
      ...(agent.profile && agent.profile.model !== "default" ? { model: agent.profile.model } : {}),
      availableTools: [],
      infiniteSessions: { enabled: false },
    });
    session.on((event) => {
      output.line(JSON.stringify(event));
      captureCopilotSdkUsage(output, event);
    });
    const response = await session.sendAndWait({ prompt }, timeoutMs);
    const content = assistantMessageContent(response);
    if (content) output.setSummary(content);
    await session.disconnect?.();
    const errors = await client.stop();
    return {
      exitCode: errors.length === 0 && !deadline ? 0 : 1,
      stopped: false,
      ...(deadline ? { bound: "deadline" as const } : {}),
      output,
    };
  } catch (error) {
    if (deadline) {
      return { exitCode: 1, stopped: false, bound: "deadline", output };
    }
    process.stderr.write(`yukh-team-worker: copilot sdk runner failed: ${errorMessage(error)}\n`);
    await client.forceStop().catch(() => undefined);
    return { exitCode: 1, stopped: false, output };
  } finally {
    clearTimeout(timer);
  }
}

function captureCopilotSdkUsage(output: RuntimeOutput, event: unknown): void {
  if (!record(event) || event.type !== "session.shutdown" || !record(event.data)) return;
  const totals = Object.values(event.data.modelMetrics ?? {}).reduce(
    (accumulator, metric) => {
      if (!record(metric) || !record(metric.usage)) return accumulator;
      const usage = metric.usage;
      accumulator.input_tokens += safeInteger(usage.inputTokens);
      accumulator.cached_input_tokens += safeInteger(usage.cacheReadTokens);
      accumulator.output_tokens += safeInteger(usage.outputTokens);
      accumulator.reasoning_output_tokens += safeInteger(usage.reasoningTokens);
      return accumulator;
    },
    {
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
    },
  );
  if (totals.input_tokens > 0 || totals.output_tokens > 0)
    output.addUsage("copilot-sdk-v1", totals);
}

function assistantMessageContent(value: unknown): string {
  return record(value) && record(value.data) && typeof value.data.content === "string"
    ? value.data.content
    : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
