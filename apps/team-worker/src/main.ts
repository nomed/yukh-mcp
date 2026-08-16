import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { TeamStore } from "../../../packages/team-control/src/store.js";
import { RuntimeOutput } from "../../../packages/team-control/src/runtime-output.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new TypeError("invalid team worker configuration");
  return value;
};

const teamID = process.argv[2];
const agentID = process.argv[3];
if (!teamID || !agentID) throw new TypeError("invalid team worker arguments");
const workspace = required("YUKH_TEAM_WORKSPACE");
const store = new TeamStore(workspace);
const agent = store.agent(teamID, agentID);

const node = process.execPath;
const launcher = required("YUKH_COORDINATION_LAUNCHER");
const mcpMain = required("YUKH_COORDINATION_MCP_MAIN");
const teamControlMain = required("YUKH_TEAM_CONTROL_MCP_MAIN");
const mcpEnv = {
  YUKH_COORDINATION_AGENT: agent.coordination_agent,
  YUKH_COORDINATION_LAUNCHER: launcher,
};
const profile = agent.profile;
const requiredActions = agent.required_actions.join(", ") || "none";
const prompt = `You are ${agent.role}, ${agent.kind} ${agent.agent_id} in team ${agent.team_id}.${profile ? ` Mission: ${profile.mission}\nOperating instructions: ${profile.instructions}\nRequired skills: ${profile.skills.length > 0 ? profile.skills.join(", ") : "none"}.` : ""}\nComplete this task: ${agent.task}\nToken budget: ${agent.token_budget} total input plus output tokens. Keep inspection and tool output bounded. The team already exists: do not call team.create. Required receipt-backed actions before success: ${requiredActions}. A textual claim is not evidence; invoke each required yukh-team-control tool successfully. When engaging a child, use the returned coordination_participant exactly and never add another agent: prefix. Wait for each child with agent.await and inspect its completion before synthesizing. Your Coordination session is already bootstrapped and joined. Use yukh-coordination to replay messages and communicate decisions and blockers. End with one concise public-safe completion summary of at most 4096 UTF-8 bytes; the wrapper persists that final response. You may create a bounded child only when explicitly delegated.`;
const teamControlEnv = {
  YUKH_TEAM_WORKSPACE: workspace,
  YUKH_COORDINATION_LAUNCHER: launcher,
  YUKH_CODEX_EXECUTABLE: required("YUKH_CODEX_EXECUTABLE"),
  YUKH_COPILOT_EXECUTABLE: required("YUKH_COPILOT_EXECUTABLE"),
  YUKH_CALLER_TEAM_ID: agent.team_id,
  YUKH_CALLER_AGENT_ID: agent.agent_id,
  ...Object.fromEntries(
    ["YUKH_CODEX_MODELS", "YUKH_COPILOT_MODELS", "YUKH_CODEX_SKILLS", "YUKH_COPILOT_SKILLS"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]!] as const),
  ),
};

const command =
  agent.runtime === "codex"
    ? required("YUKH_CODEX_EXECUTABLE")
    : required("YUKH_COPILOT_EXECUTABLE");
const args =
  agent.runtime === "codex"
    ? [
        "exec",
        "--ephemeral",
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        ...(profile && profile.model !== "default" ? ["--model", profile.model] : []),
        "-c",
        `mcp_servers.yukh-coordination.command=${JSON.stringify(node)}`,
        "-c",
        `mcp_servers.yukh-coordination.args=${JSON.stringify([mcpMain])}`,
        "-c",
        `mcp_servers.yukh-coordination.env.YUKH_COORDINATION_AGENT=${JSON.stringify(agent.coordination_agent)}`,
        "-c",
        `mcp_servers.yukh-coordination.env.YUKH_COORDINATION_LAUNCHER=${JSON.stringify(launcher)}`,
        "-c",
        `mcp_servers.yukh-team-control.command=${JSON.stringify(node)}`,
        "-c",
        `mcp_servers.yukh-team-control.args=${JSON.stringify([teamControlMain])}`,
        ...Object.entries(teamControlEnv).flatMap(([name, value]) => [
          "-c",
          `mcp_servers.yukh-team-control.env.${name}=${JSON.stringify(value)}`,
        ]),
        prompt,
      ]
    : [
        "-p",
        prompt,
        "-s",
        "--no-ask-user",
        "--allow-all",
        "--output-format",
        "json",
        ...(profile && profile.model !== "default" ? ["--model", profile.model] : []),
        `--additional-mcp-config=${JSON.stringify({
          mcpServers: {
            "yukh-coordination": {
              type: "stdio",
              command: node,
              args: [mcpMain],
              env: mcpEnv,
              tools: ["*"],
            },
            "yukh-team-control": {
              type: "stdio",
              command: node,
              args: [teamControlMain],
              env: teamControlEnv,
              tools: ["*"],
            },
          },
        })}`,
      ];

interface CoordinationAttempt {
  readonly ok: boolean;
  readonly code?: string;
}

async function coordination(
  commandArgs: readonly string[],
  input?: object,
): Promise<CoordinationAttempt> {
  return await new Promise<CoordinationAttempt>((resolve) => {
    const child = spawn(launcher, [agent.coordination_agent, ...commandArgs], {
      cwd: workspace,
      shell: false,
      stdio: ["pipe", "pipe", "inherit"],
      env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    if (input) child.stdin.end(`${JSON.stringify(input)}\n`);
    else child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ ok: false });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      try {
        const output = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          status?: unknown;
          code?: unknown;
        };
        resolve({
          ok: code === 0 && output.status === "ok",
          ...(typeof output.code === "string" ? { code: output.code } : {}),
        });
      } catch {
        resolve({ ok: false });
      }
    });
  });
}

let bootstrap: CoordinationAttempt = { ok: false };
for (let attempt = 1; attempt <= 3; attempt++) {
  bootstrap = await coordination(["session", "bootstrap"]);
  if (bootstrap.ok || bootstrap.code !== "YKC-UNAVAILABLE-001") break;
  process.stderr.write(`yukh-team-worker: coordination bootstrap unavailable attempt=${attempt}\n`);
  await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
}
const joined =
  bootstrap.ok &&
  (
    await coordination(["session", "join"], {
      capabilities: ["publish", "replay"],
      session_label: agent.role,
      status: "available",
    })
  ).ok;
if (!joined) {
  process.stderr.write("yukh-team-worker: coordination bootstrap or join failed\n");
  store.transition(teamID, agentID, "failed");
  process.exitCode = 1;
} else {
  store.transition(teamID, agentID, "running");
}

const outcome = !joined
  ? { exitCode: 1, stopped: false }
  : await new Promise<{
      readonly exitCode: number;
      readonly stopped: boolean;
      readonly output: RuntimeOutput;
    }>((resolve) => {
      const output = new RuntimeOutput(agent.runtime);
      const child = spawn(command, args, {
        cwd: workspace,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "/usr/bin:/bin" },
      });
      if (!child.stdout || !child.stderr) throw new Error("agent_output_unavailable");
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on("line", (line) => output.line(line));
      let stopped = false;
      let killTimer: NodeJS.Timeout | undefined;
      const monitor = setInterval(() => {
        if (stopped || store.status(teamID).team.state !== "stopped") return;
        stopped = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      }, 500);
      const finish = (exitCode: number): void => {
        clearInterval(monitor);
        if (killTimer) clearTimeout(killTimer);
        lines.close();
        resolve({ exitCode, stopped, output });
      };
      child.once("error", () => finish(1));
      child.once("close", (code) => finish(code ?? 1));
    });
let wrapperExitCode = outcome.stopped ? 0 : outcome.exitCode;
if (joined && "output" in outcome) {
  if (outcome.stopped) {
    store.transition(teamID, agentID, "stopped");
  } else {
    const summary = outcome.output.summary();
    const usage = outcome.output.usage(agent.token_budget);
    const missingActions = store.missingRequiredActions(teamID, agentID);
    const completion =
      outcome.exitCode !== 0
        ? { schema: 1 as const, outcome: "agent_exit_nonzero" as const, summary }
        : !usage
          ? { schema: 1 as const, outcome: "token_accounting_unavailable" as const, summary }
          : usage.budget_outcome === "exceeded"
            ? { schema: 1 as const, outcome: "token_budget_exceeded" as const, summary }
            : missingActions.length > 0
              ? {
                  schema: 1 as const,
                  outcome: "required_action_missing" as const,
                  summary: `Missing required action receipts: ${missingActions.join(", ")}`,
                }
              : !summary
                ? { schema: 1 as const, outcome: "completion_missing" as const, summary: "" }
                : { schema: 1 as const, outcome: "succeeded" as const, summary };
    store.finish(teamID, agentID, completion, usage);
    if (completion.outcome !== "succeeded") wrapperExitCode = 1;
  }
}
process.exitCode = wrapperExitCode;
