import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export interface DemoEvidence {
  readonly evidence_ref: string;
  readonly event_type: "authorization.enforcement_recorded.v1";
  readonly effect: "allow" | "deny";
  readonly basis: "explicit";
  readonly subject_ref: "subject_demo";
  readonly policy_ref: "policy_demo_v1";
  readonly classification: "protected";
  readonly durability: "in_memory_demo_only";
}

export interface DemoTranscript {
  readonly mode: "local_e2e";
  readonly transport: {
    readonly protocol: "mcp_streamable_http";
    readonly binding: "127.0.0.1:ephemeral";
    readonly client: "@modelcontextprotocol/client";
    readonly server_process: "isolated_child";
  };
  readonly discovery: { readonly tools: readonly string[] };
  readonly allowed: unknown;
  readonly denied: unknown;
  readonly evidence_projection: readonly DemoEvidence[];
  readonly cleanup: {
    readonly server_process: "stopped";
    readonly fixture: "removed";
  };
}

interface ReadyMessage {
  readonly type: "ready";
  readonly port: number;
}

interface EvidenceMessage {
  readonly type: "evidence";
  readonly evidence: DemoEvidence;
}

function serverEntrypoint(): string {
  const javascript = fileURLToPath(new URL("./server-main.js", import.meta.url));
  return existsSync(javascript)
    ? javascript
    : fileURLToPath(new URL("./server-main.ts", import.meta.url));
}

function validEvidence(value: unknown): value is DemoEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Record<string, unknown>;
  return (
    Object.keys(evidence).length === 8 &&
    typeof evidence.evidence_ref === "string" &&
    /^evidence_demo_[1-9][0-9]*$/u.test(evidence.evidence_ref) &&
    evidence.event_type === "authorization.enforcement_recorded.v1" &&
    (evidence.effect === "allow" || evidence.effect === "deny") &&
    evidence.basis === "explicit" &&
    evidence.subject_ref === "subject_demo" &&
    evidence.policy_ref === "policy_demo_v1" &&
    evidence.classification === "protected" &&
    evidence.durability === "in_memory_demo_only"
  );
}

function parseServerMessage(line: string): ReadyMessage | EvidenceMessage | { type: "stopped" } {
  if (Buffer.byteLength(line, "utf8") > 4_096) throw new Error("invalid demo server output");
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== "object") throw new Error("invalid demo server output");
  const message = value as Record<string, unknown>;
  if (
    Object.keys(message).length === 2 &&
    message.type === "ready" &&
    Number.isInteger(message.port) &&
    Number(message.port) >= 1 &&
    Number(message.port) <= 65_535
  )
    return { type: "ready", port: Number(message.port) };
  if (
    Object.keys(message).length === 2 &&
    message.type === "evidence" &&
    validEvidence(message.evidence)
  )
    return { type: "evidence", evidence: message.evidence };
  if (Object.keys(message).length === 1 && message.type === "stopped") return { type: "stopped" };
  throw new Error("invalid demo server output");
}

interface ExitResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<ExitResult> {
  if (exited(child))
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode as NodeJS.Signals | null,
    });
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("demo server shutdown timed out"));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

function requestStop(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("disconnect", onDisconnect);
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        Object.keys(message).length === 1 &&
        (message as { type?: unknown }).type === "stopping"
      )
        finish();
    };
    const onDisconnect = () => finish(new Error("demo server control channel disconnected"));
    const timeout = setTimeout(
      () => finish(new Error("demo server stop acknowledgement timed out")),
      timeoutMs,
    );
    child.on("message", onMessage);
    child.once("disconnect", onDisconnect);
    if (!child.connected) {
      finish(new Error("demo server control channel unavailable"));
      return;
    }
    child.send({ type: "stop" }, (error) => {
      if (error) finish(error);
    });
  });
}

async function forceStopAndWait(child: ChildProcess): Promise<void> {
  if (exited(child)) return;
  child.kill();
  try {
    await waitForExit(child, 1_000);
    return;
  } catch {
    if (!exited(child)) child.kill("SIGKILL");
  }
  await waitForExit(child, 2_000);
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (exited(child)) {
    const result = await waitForExit(child, 2_000);
    if (result.code !== 0) throw new Error("demo server failed");
    return;
  }
  try {
    await requestStop(child, 1_000);
    const result = await waitForExit(child, 2_000);
    if (result.code !== 0) throw new Error("demo server failed");
  } catch (error) {
    await forceStopAndWait(child);
    throw error;
  }
}

export async function runReadOnlyDemo(
  options: { readonly onFixtureCreated?: (root: string) => void } = {},
): Promise<DemoTranscript> {
  const root = await mkdtemp(join(tmpdir(), "yukh-demo-"));
  let child: ChildProcess | undefined;
  let client: Client | undefined;
  const evidence: DemoEvidence[] = [];
  let transcript: Omit<DemoTranscript, "cleanup"> | undefined;
  try {
    options.onFixtureCreated?.(root);
    await writeFile(join(root, "status.txt"), "synthetic healthy fixture\n", "utf8");
    child = spawn(process.execPath, [...process.execArgv, serverEntrypoint(), root], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stderr?.resume();
    const ready = new Promise<number>((resolve, reject) => {
      let pending = "";
      let resolved = false;
      const timeout = setTimeout(() => reject(new Error("demo server startup timed out")), 5_000);
      child?.once("error", reject);
      child?.once("exit", (code) => {
        if (!resolved) reject(new Error(`demo server exited before readiness (${String(code)})`));
      });
      child?.stdout?.setEncoding("utf8");
      child?.stdout?.on("data", (chunk: string) => {
        pending += chunk;
        if (Buffer.byteLength(pending, "utf8") > 8_192) {
          reject(new Error("invalid demo server output"));
          return;
        }
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        try {
          for (const line of lines) {
            if (line.length === 0) continue;
            const message = parseServerMessage(line);
            if (message.type === "ready") {
              if (resolved) throw new Error("duplicate demo server readiness");
              resolved = true;
              clearTimeout(timeout);
              resolve(message.port);
            } else if (message.type === "evidence") {
              evidence.push(message.evidence);
            }
          }
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
    const port = await ready;
    client = new Client({ name: "yukh-demo-client", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
    );
    const tools = (await client.listTools()).tools.map(({ name }) => name).sort();
    const allowed = await client.callTool({
      name: "node.inspect",
      arguments: { node_ref: "node-demo", path: "status.txt" },
    });
    const denied = await client.callTool({
      name: "node.inspect",
      arguments: { node_ref: "node-denied", path: "status.txt" },
    });
    transcript = {
      mode: "local_e2e",
      transport: {
        protocol: "mcp_streamable_http",
        binding: "127.0.0.1:ephemeral",
        client: "@modelcontextprotocol/client",
        server_process: "isolated_child",
      },
      discovery: { tools },
      allowed,
      denied,
      evidence_projection: evidence,
    };
  } finally {
    let serverExited = child === undefined;
    try {
      try {
        await client?.close();
      } finally {
        if (child)
          try {
            await stopServer(child);
          } finally {
            serverExited = exited(child);
          }
      }
    } finally {
      if (serverExited) await rm(root, { recursive: true, force: true });
    }
  }
  if (!transcript) throw new Error("demo did not complete");
  return {
    ...transcript,
    evidence_projection: [...evidence],
    cleanup: { server_process: "stopped", fixture: "removed" },
  };
}
