import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
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
    run(agent: PreviewAgent, prompt: string): Promise<void> {
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
          : [
              "-p",
              prompt,
              "-s",
              "--no-ask-user",
              "--allow-tool=read",
              "--allow-tool=write",
              "--allow-tool=yukh-coordination",
            ];
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          shell: false,
          stdio: "ignore",
          env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "/usr/bin:/bin" },
        });
        let settled = false;
        const fail = () => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          reject(new Error("agent_unavailable"));
        };
        const timer = setTimeout(fail, timeoutMs);
        child.once("error", fail);
        child.once("close", (code) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          if (code === 0) resolve();
          else reject(new Error("agent_unavailable"));
        });
      });
    },
  };
}
