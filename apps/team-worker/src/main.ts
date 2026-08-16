import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
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
const contextPack = store.contextPack(teamID, agentID);
const modelToolMode = agent.model_tool_mode ?? "default";
const requiredActions = agent.required_actions.join(", ") || "none";
const modelUsesCoordination =
  modelToolMode === "coordination" ||
  modelToolMode === "team" ||
  (modelToolMode === "default" &&
    (agent.kind === "worker" || agent.required_actions.some((action) => action !== "team.status")));
const modelTeamTools = [
  ...new Set(
    modelToolMode === "none" || modelToolMode === "coordination"
      ? []
      : modelToolMode === "team"
        ? agent.can_spawn
          ? ["policy.profile", "team.status", "agent.status", "agent.engage", "agent.await"]
          : ["team.status", "agent.status"]
        : agent.kind === "manager"
          ? agent.required_actions
          : agent.can_spawn
            ? ["team.status", "agent.status", "agent.engage", "agent.await"]
            : ["team.status", "agent.status"],
  ),
];
const modelUsesTeamControl = modelTeamTools.length > 0;
const coordinationInstruction = modelUsesCoordination
  ? "Your Coordination session is already bootstrapped and joined. Use yukh-coordination only for necessary team communication."
  : "";
const teamControlInstruction = modelUsesTeamControl
  ? `Required receipt-backed actions before success: ${requiredActions}. A textual claim is not evidence; invoke each required yukh-team-control tool successfully.`
  : "";
const delegationInstruction =
  agent.can_spawn && modelUsesTeamControl
    ? "When engaging a child, use the returned coordination_participant exactly and never add another agent: prefix. Wait for each child with agent.await and inspect its completion before synthesizing. You may create a bounded child only when explicitly delegated."
    : "";
const allowlist = (name: string, fallback: readonly string[]): readonly string[] => {
  const raw = process.env[name];
  return raw ? raw.split(",").filter(Boolean) : fallback;
};
const planConstraintInstruction =
  agent.output_contract === "team-plan-v1"
    ? `Plan constraints: use only allowlisted models. Codex models: ${allowlist("YUKH_CODEX_MODELS", ["default"]).join(", ")}. Copilot models: ${allowlist("YUKH_COPILOT_MODELS", ["default"]).join(", ")}. Prefer model "default" unless the task explicitly requires another allowlisted model. Do not invent model names. Worker context_paths must name repository-relative regular UTF-8 files, at most four per worker, each file at most 4096 bytes and each worker pack at most 12288 bytes total. If a requested or attractive file may exceed 4096 bytes, omit it or choose a smaller file; never rely on a large document being accepted at execution time. Synthesis must use no context_paths. Budget realistic runtime floors: Codex zero-command review/planning workers with small context currently need at least 18000 total tokens, and Codex tool-free synthesis currently needs at least 16000 total tokens, unless the task supplies fresher measured evidence. Prefer fewer planned agents over under-budgeted agents. Every planned worker and synthesis prompt must require a final public-safe completion summary below 4096 UTF-8 bytes; prefer 3500 bytes or less so the wrapper can persist it. Do not ask planned agents for multi-section reports that exceed the persistence cap.`
    : "";
const outputInstruction =
  agent.output_contract === "team-plan-v1"
    ? "Return only the JSON team execution plan required by the supplied output schema. Include the minimum specialists needed and one concise delivery synthesizer. Every role must be a lowercase slug matching ^[a-z][a-z0-9-]{0,31}$, for example token-efficiency-auditor; spaces are invalid. Select at most four small repository-relative context_paths per worker and none for synthesis. Do not wrap JSON in Markdown."
    : "End with one concise public-safe completion summary of at most 4096 UTF-8 bytes; the wrapper persists that final response.";
const prompt = [
  `You are ${agent.role}, ${agent.kind} ${agent.agent_id} in team ${agent.team_id}.`,
  profile
    ? `Mission: ${profile.mission}\nOperating instructions: ${profile.instructions}\nRequired skills: ${profile.skills.length > 0 ? profile.skills.join(", ") : "none"}.`
    : "",
  `Complete this task: ${agent.task}`,
  contextPack
    ? `Use only this server-prepared context pack (${contextPack.digest}, ${contextPack.byte_length} bytes):\n${contextPack.files.map((file) => `--- ${file.path} ---\n${file.content}`).join("\n")}`
    : "",
  `Token budget: ${agent.token_budget} total input plus output tokens. Runtime bounds: at most ${agent.max_commands ?? 8} command executions and ${agent.timeout_ms ?? 300_000} milliseconds. Keep inspection and tool output bounded.`,
  teamControlInstruction,
  delegationInstruction,
  coordinationInstruction,
  planConstraintInstruction,
  outputInstruction,
]
  .filter(Boolean)
  .join(" ");
const planSchema = fileURLToPath(
  new URL("../../../contracts/team-execution-plan-v1.schema.json", import.meta.url),
);
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
        "--ignore-user-config",
        "--dangerously-bypass-approvals-and-sandbox",
        ...(agent.output_contract === "team-plan-v1" ? ["--output-schema", planSchema] : []),
        ...(profile && profile.model !== "default" ? ["--model", profile.model] : []),
        ...(modelUsesCoordination
          ? [
              "-c",
              `mcp_servers.yukh-coordination.command=${JSON.stringify(node)}`,
              "-c",
              `mcp_servers.yukh-coordination.args=${JSON.stringify([mcpMain])}`,
              "-c",
              `mcp_servers.yukh-coordination.env.YUKH_COORDINATION_AGENT=${JSON.stringify(agent.coordination_agent)}`,
              "-c",
              `mcp_servers.yukh-coordination.env.YUKH_COORDINATION_LAUNCHER=${JSON.stringify(launcher)}`,
            ]
          : []),
        ...(modelUsesTeamControl
          ? [
              "-c",
              `mcp_servers.yukh-team-control.command=${JSON.stringify(node)}`,
              "-c",
              `mcp_servers.yukh-team-control.args=${JSON.stringify([teamControlMain])}`,
              "-c",
              `mcp_servers.yukh-team-control.enabled_tools=${JSON.stringify(modelTeamTools)}`,
              ...Object.entries(teamControlEnv).flatMap(([name, value]) => [
                "-c",
                `mcp_servers.yukh-team-control.env.${name}=${JSON.stringify(value)}`,
              ]),
            ]
          : []),
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
            ...(modelUsesCoordination
              ? {
                  "yukh-coordination": {
                    type: "stdio" as const,
                    command: node,
                    args: [mcpMain],
                    env: mcpEnv,
                    tools: ["*"],
                  },
                }
              : {}),
            ...(modelUsesTeamControl
              ? {
                  "yukh-team-control": {
                    type: "stdio" as const,
                    command: node,
                    args: [teamControlMain],
                    env: teamControlEnv,
                    tools: modelTeamTools,
                  },
                }
              : {}),
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
      readonly bound?: "commands" | "deadline";
      readonly output: RuntimeOutput;
    }>((resolve) => {
      const output = new RuntimeOutput(agent.runtime);
      const child = spawn(command, args, {
        cwd: workspace,
        detached: process.platform !== "win32",
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
      let bound: "commands" | "deadline" | undefined;
      let terminating = false;
      let killTimer: NodeJS.Timeout | undefined;
      const terminate = (): void => {
        if (terminating || !child.pid) return;
        terminating = true;
        try {
          if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        killTimer = setTimeout(() => {
          try {
            if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, 5_000);
      };
      lines.on("line", () => {
        if (bound || output.commandsStarted() <= (agent.max_commands ?? 8)) return;
        bound = "commands";
        terminate();
      });
      const deadlineTimer = setTimeout(() => {
        if (bound) return;
        bound = "deadline";
        terminate();
      }, agent.timeout_ms ?? 300_000);
      const monitor = setInterval(() => {
        if (stopped || store.status(teamID).team.state !== "stopped") return;
        stopped = true;
        terminate();
      }, 500);
      const finish = (exitCode: number): void => {
        clearInterval(monitor);
        clearTimeout(deadlineTimer);
        if (killTimer) clearTimeout(killTimer);
        lines.close();
        resolve({ exitCode, stopped, ...(bound ? { bound } : {}), output });
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
    let proposedPlan: ReturnType<TeamStore["proposePlan"]> | undefined;
    let planInvalid = false;
    if (
      outcome.exitCode === 0 &&
      usage?.budget_outcome === "within" &&
      missingActions.length === 0 &&
      summary &&
      agent.output_contract === "team-plan-v1"
    ) {
      try {
        proposedPlan = store.proposePlan(teamID, agentID, summary);
      } catch {
        planInvalid = true;
      }
    }
    const completion =
      outcome.bound === "commands"
        ? { schema: 1 as const, outcome: "command_budget_exceeded" as const, summary }
        : outcome.bound === "deadline"
          ? { schema: 1 as const, outcome: "runtime_deadline_exceeded" as const, summary }
          : outcome.exitCode !== 0
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
                    : planInvalid
                      ? {
                          schema: 1 as const,
                          outcome: "team_plan_invalid" as const,
                          summary: "Structured team plan validation failed",
                        }
                      : {
                          schema: 1 as const,
                          outcome: "succeeded" as const,
                          summary,
                          ...(proposedPlan ? { plan_id: proposedPlan.plan_id } : {}),
                        };
    store.finish(teamID, agentID, completion, usage);
    if (completion.outcome !== "succeeded") wrapperExitCode = 1;
  }
}
process.exitCode = wrapperExitCode;
