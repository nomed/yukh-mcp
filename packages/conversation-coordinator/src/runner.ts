import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, writeSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import type { PreviewAgent } from "../../coordination-preview/src/launcher.js";
import type { AgentRunner } from "./coordinator.js";

function executable(path: string): string {
  if (!isAbsolute(path)) throw new TypeError("invalid agent executable");
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o111) === 0 ||
    realpathSync(path) !== path
  )
    throw new TypeError("invalid agent executable");
  return path;
}

function workspace(path: string): string {
  if (!isAbsolute(path)) throw new TypeError("invalid agent workspace");
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path)
    throw new TypeError("invalid agent workspace");
  return path;
}

export function createAgentRunner(options: {
  readonly codex: string;
  readonly copilot: string;
  readonly workspace: string;
  readonly timeoutMs?: number;
}): AgentRunner {
  const codex = executable(options.codex);
  const copilot = executable(options.copilot);
  const cwd = workspace(options.workspace);
  const timeoutMs = options.timeoutMs ?? 300_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 900_000)
    throw new TypeError("invalid agent timeout");
  return {
    prepare(agent: PreviewAgent, questionEventID: string, turn: number) {
      const directory = join(cwd, ".yukh", "conversation-agent-logs");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      return {
        log_path: join(
          directory,
          `${new Date().toISOString().replaceAll(":", "-")}-turn-${turn}-${agent}-${questionEventID}.log`,
        ),
      };
    },
    run(
      agent: PreviewAgent,
      prompt: string,
      context?: { readonly log_path?: string },
    ): Promise<void> {
      if (prompt.length === 0 || prompt.length > 1_024)
        return Promise.reject(new TypeError("invalid prompt"));
      const command = agent === "agent-a" ? codex : copilot;
      const args =
        agent === "agent-a"
          ? [
              "exec",
              "--ephemeral",
              "--sandbox",
              "workspace-write",
              "--ask-for-approval",
              "never",
              prompt,
            ]
          : ["-p", prompt, "-s", "--no-ask-user", "--allow-all"];
      return new Promise((resolve, reject) => {
        const log = context?.log_path ? openSync(context.log_path, "a", 0o600) : undefined;
        if (log !== undefined)
          writeSync(log, `agent=${agent}\ncommand=${command}\nargs=${JSON.stringify(args)}\n\n`);
        const child = spawn(command, args, {
          cwd,
          shell: false,
          stdio: ["ignore", log ?? "ignore", log ?? "ignore"],
          env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "/usr/bin:/bin" },
        });
        let settled = false;
        const fail = (reason: "agent_spawn_failed" | "agent_timed_out") => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          if (log !== undefined) closeSync(log);
          reject(new Error(reason));
        };
        const timer = setTimeout(() => fail("agent_timed_out"), timeoutMs);
        child.once("error", () => fail("agent_spawn_failed"));
        child.once("close", (code) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          if (log !== undefined) closeSync(log);
          if (code === 0) resolve();
          else reject(new Error("agent_exit_nonzero"));
        });
      });
    },
  };
}
