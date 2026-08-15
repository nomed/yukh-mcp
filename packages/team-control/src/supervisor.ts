import { spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { AgentRecord } from "./store.js";

function executable(path: string): string {
  if (!isAbsolute(path)) throw new TypeError("invalid team executable");
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (info.mode & 0o111) === 0 ||
    realpathSync(path) !== path
  )
    throw new TypeError("invalid team executable");
  return path;
}

function file(path: string): string {
  if (!isAbsolute(path)) throw new TypeError("invalid team runtime file");
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== path)
    throw new TypeError("invalid team runtime file");
  return path;
}

export class TeamSupervisor {
  readonly #node: string;
  readonly #worker: string;
  readonly #launcher: string;
  readonly #coordinationMcp: string;
  readonly #codex: string;
  readonly #copilot: string;
  readonly #workspace: string;

  constructor(options: {
    readonly node: string;
    readonly worker: string;
    readonly launcher: string;
    readonly coordinationMcp: string;
    readonly codex: string;
    readonly copilot: string;
    readonly workspace: string;
  }) {
    this.#node = executable(options.node);
    this.#worker = file(options.worker);
    this.#launcher = executable(options.launcher);
    this.#coordinationMcp = file(options.coordinationMcp);
    this.#codex = executable(options.codex);
    this.#copilot = executable(options.copilot);
    this.#workspace = realpathSync(options.workspace);
    if (!lstatSync(this.#workspace).isDirectory()) throw new TypeError("invalid team workspace");
  }

  launch(agent: AgentRecord): number {
    const child = spawn(this.#node, [this.#worker, agent.team_id, agent.agent_id], {
      cwd: this.#workspace,
      detached: true,
      shell: false,
      stdio: "ignore",
      env: {
        HOME: process.env.HOME ?? "",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        YUKH_TEAM_WORKSPACE: this.#workspace,
        YUKH_COORDINATION_LAUNCHER: this.#launcher,
        YUKH_COORDINATION_MCP_MAIN: this.#coordinationMcp,
        YUKH_CODEX_EXECUTABLE: this.#codex,
        YUKH_COPILOT_EXECUTABLE: this.#copilot,
      },
    });
    if (!child.pid) throw new Error("agent_spawn_failed");
    child.unref();
    return child.pid;
  }
}
