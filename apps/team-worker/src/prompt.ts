import type {
  AgentRecord,
  ContextPackDocument,
  ModelToolMode,
} from "../../../packages/team-control/src/store.js";

export function isMicroWorker(agent: AgentRecord): boolean {
  return (
    agent.kind === "worker" &&
    (agent.model_tool_mode ?? "default") === "none" &&
    (agent.max_commands ?? 8) <= 1 &&
    agent.token_budget <= 45_000
  );
}

function contextText(contextPack: ContextPackDocument | undefined): string {
  return contextPack
    ? `Context pack ${contextPack.digest}, ${contextPack.byte_length} bytes:\n${contextPack.files
        .map((file) => `--- ${file.path} ---\n${file.content}`)
        .join("\n")}`
    : "No context pack was supplied. Inspect only the exact files named in the task.";
}

export function buildWorkerPrompt(input: {
  readonly agent: AgentRecord;
  readonly contextPack?: ContextPackDocument;
  readonly modelToolMode: "default" | ModelToolMode;
  readonly requiredActions: string;
  readonly modelUsesCoordination: boolean;
  readonly modelUsesTeamControl: boolean;
  readonly modelTeamTools: readonly string[];
  readonly coordinationInstruction: string;
  readonly teamControlInstruction: string;
  readonly delegationInstruction: string;
  readonly planConstraintInstruction: string;
}): string {
  const { agent, contextPack } = input;
  if (isMicroWorker(agent)) {
    return [
      `You are ${agent.role}, worker ${agent.agent_id}.`,
      `Task: ${agent.task}`,
      contextText(contextPack),
      `Hard bounds: token budget ${agent.token_budget}; max commands ${agent.max_commands ?? 1}; deadline ${agent.timeout_ms ?? 180_000} ms.`,
      "Do the smallest safe change. Do not browse broad repository context. Do not delegate. Keep command output small.",
      "End with one concise public-safe summary under 1200 UTF-8 bytes: changed files, validation run, remaining risk.",
    ].join(" ");
  }

  const profile = agent.profile;
  const outputInstruction =
    agent.output_contract === "team-plan-v1"
      ? "Return only the JSON team execution plan required by the supplied output schema. Include the minimum specialists needed and one concise delivery synthesizer. Every role must be a lowercase slug matching ^[a-z][a-z0-9-]{0,31}$, for example token-efficiency-auditor; spaces are invalid. Select at most four small repository-relative context_paths per worker and none for synthesis. Do not wrap JSON in Markdown."
      : "End with one concise public-safe completion summary of at most 4096 UTF-8 bytes; the wrapper persists that final response.";

  return [
    `You are ${agent.role}, ${agent.kind} ${agent.agent_id} in team ${agent.team_id}.`,
    profile
      ? `Mission: ${profile.mission}\nOperating instructions: ${profile.instructions}\nRequired skills: ${profile.skills.length > 0 ? profile.skills.join(", ") : "none"}.`
      : "",
    `Complete this task: ${agent.task}`,
    contextPack
      ? `Use only this server-prepared context pack (${contextPack.digest}, ${contextPack.byte_length} bytes):\n${contextPack.files.map((file) => `--- ${file.path} ---\n${file.content}`).join("\n")}`
      : "",
    `Token budget: ${agent.token_budget} total input plus output tokens. Runtime bounds: at most ${agent.max_commands ?? 8} command executions and ${agent.timeout_ms ?? 300_000} milliseconds. Keep inspection and tool output bounded.`,
    input.teamControlInstruction,
    input.delegationInstruction,
    input.coordinationInstruction,
    input.planConstraintInstruction,
    outputInstruction,
  ]
    .filter(Boolean)
    .join(" ");
}
