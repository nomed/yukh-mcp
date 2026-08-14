import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawn } from "node:child_process";

const maximumOutputBytes = 1 << 20;
const commandNames = new Set([
  "session bootstrap",
  "session join",
  "question ask",
  "question answer",
  "events replay",
  "session leave",
]);

export type PreviewAgent = "agent-a" | "agent-b";

export interface CoordinationOutput {
  readonly schema: 1;
  readonly status: "ok" | "error";
  readonly command: string;
  readonly result?: unknown;
  readonly code?: string;
}

export function validateLauncher(path: string): string {
  if (!isAbsolute(path)) throw new TypeError("invalid Coordination launcher");
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o111) === 0)
    throw new TypeError("invalid Coordination launcher");
  const resolved = realpathSync(path);
  if (resolved !== path) throw new TypeError("invalid Coordination launcher");
  return path;
}

export function validateAgent(value: string): PreviewAgent {
  if (value !== "agent-a" && value !== "agent-b") throw new TypeError("invalid Coordination agent");
  return value;
}

function closedOutput(raw: Buffer, command: string): CoordinationOutput {
  if (raw.length === 0 || raw.length > maximumOutputBytes)
    throw new Error("coordination_protocol_error");
  const value: unknown = JSON.parse(raw.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("coordination_protocol_error");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["schema", "status", "command", "result", "code"]);
  if (
    Object.keys(record).some((key) => !allowed.has(key)) ||
    record.schema !== 1 ||
    (record.status !== "ok" && record.status !== "error") ||
    record.command !== command ||
    (record.status === "error" &&
      (typeof record.code !== "string" || !/^YKC-[A-Z]+-[0-9]{3}$/u.test(record.code))) ||
    (record.status === "ok" && "code" in record)
  )
    throw new Error("coordination_protocol_error");
  return record as unknown as CoordinationOutput;
}

export interface CoordinationLauncher {
  invoke(command: string, input?: object): Promise<CoordinationOutput>;
}

export function createCoordinationLauncher(options: {
  readonly path: string;
  readonly agent: PreviewAgent;
  readonly timeoutMs?: number;
}): CoordinationLauncher {
  const path = validateLauncher(options.path);
  const agent = validateAgent(options.agent);
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000)
    throw new TypeError("invalid Coordination timeout");
  return {
    invoke(command, input) {
      if (!commandNames.has(command)) return Promise.reject(new TypeError("invalid command"));
      const commandParts = command.split(" ");
      return new Promise((resolve, reject) => {
        const child = spawn(path, [agent, ...commandParts], {
          shell: false,
          stdio: ["pipe", "pipe", "ignore"],
          env: {
            HOME: process.env.HOME ?? "",
            PATH: process.env.PATH ?? "/usr/bin:/bin",
          },
        });
        const chunks: Buffer[] = [];
        let length = 0;
        let failed = false;
        const fail = () => {
          if (failed) return;
          failed = true;
          child.kill("SIGKILL");
          reject(new Error("coordination_unavailable"));
        };
        const timer = setTimeout(fail, timeoutMs);
        child.once("error", fail);
        child.stdout.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > maximumOutputBytes) fail();
          else chunks.push(chunk);
        });
        child.stdin.once("error", fail);
        child.once("close", (code) => {
          clearTimeout(timer);
          if (failed) return;
          try {
            const output = closedOutput(Buffer.concat(chunks), command);
            if ((output.status === "ok" && code !== 0) || (output.status === "error" && code === 0))
              throw new Error("coordination_protocol_error");
            resolve(output);
          } catch {
            reject(new Error("coordination_protocol_error"));
          }
        });
        child.stdin.end(input === undefined ? undefined : `${JSON.stringify(input)}\n`);
      });
    },
  };
}
