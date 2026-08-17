import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeOutput } from "../../../packages/team-control/src/runtime-output.js";
import type { AgentRecord } from "../../../packages/team-control/src/store.js";
import type { WorkerRunOutcome } from "./copilot-sdk-runner.js";

export interface CodexPythonWorkerRunOptions {
  readonly executable: string;
  readonly python: string;
  readonly workspace: string;
  readonly prompt: string;
  readonly agent: AgentRecord;
  readonly timeoutMs: number;
  readonly workerSource?: string;
}

export async function runCodexPythonWorker({
  executable,
  python,
  workspace,
  prompt,
  agent,
  timeoutMs,
  workerSource,
}: CodexPythonWorkerRunOptions): Promise<WorkerRunOutcome> {
  const output = new RuntimeOutput("codex");
  const temporary = mkdtempSync(join(tmpdir(), "yukh-codex-python-worker."));
  const promptPath = join(temporary, "prompt.txt");
  const probePath = join(temporary, "worker.py");
  writeFileSync(promptPath, prompt, { mode: 0o600 });
  writeFileSync(probePath, workerSource ?? pythonWorkerSource(), { mode: 0o600 });

  return await new Promise<WorkerRunOutcome>((resolve) => {
    let bound: "deadline" | undefined;
    const child = spawn(python, [probePath], {
      cwd: workspace,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        HOME: process.env.HOME ?? "",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        YUKH_CODEX_EXECUTABLE: executable,
        YUKH_CODEX_PYTHON_PROMPT_PATH: promptPath,
        YUKH_CODEX_PYTHON_MODEL: agent.profile?.model ?? "default",
      },
    });
    if (!child.stdout || !child.stderr) throw new Error("agent_output_unavailable");
    child.stderr.pipe(process.stderr);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    let stdoutEnded = false;
    let closed = false;
    let childExitCode = 1;
    const timer = setTimeout(() => {
      bound = "deadline";
      child.kill("SIGTERM");
    }, timeoutMs);
    const killTimer = setTimeout(() => {
      if (bound) child.kill("SIGKILL");
    }, timeoutMs + 5_000);
    child.once("error", () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      rmSync(temporary, { recursive: true, force: true });
      resolve({ exitCode: 1, stopped: false, output });
    });
    const maybeFinish = (): void => {
      if (!stdoutEnded || !closed) return;
      clearTimeout(timer);
      clearTimeout(killTimer);
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          readonly final_response?: unknown;
          readonly usage_last?: unknown;
        };
        if (typeof result.final_response === "string") output.setSummary(result.final_response);
        if (record(result.usage_last))
          output.addUsage("codex-python-app-server-v1", {
            input_tokens: safeInteger(result.usage_last.input_tokens),
            cached_input_tokens: safeInteger(result.usage_last.cached_input_tokens),
            output_tokens: safeInteger(result.usage_last.output_tokens),
            reasoning_output_tokens: safeInteger(result.usage_last.reasoning_output_tokens),
          });
      } catch {
        // The wrapper fails closed below through exitCode and missing accounting.
        process.stderr.write(
          `yukh-team-worker: codex python runner emitted invalid output bytes=${Buffer.concat(chunks).length}\n`,
        );
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
      resolve({ exitCode: childExitCode, stopped: false, ...(bound ? { bound } : {}), output });
    };
    child.stdout.once("end", () => {
      stdoutEnded = true;
      maybeFinish();
    });
    child.once("close", (code) => {
      closed = true;
      childExitCode = code ?? 1;
      maybeFinish();
    });
  });
}

function pythonWorkerSource(): string {
  return String.raw`
import json
import os
from pathlib import Path

from openai_codex import ApprovalMode, Codex, CodexConfig, Sandbox

codex_bin = os.environ["YUKH_CODEX_EXECUTABLE"]
workspace = os.getcwd()
prompt = Path(os.environ["YUKH_CODEX_PYTHON_PROMPT_PATH"]).read_text()
model = os.environ.get("YUKH_CODEX_PYTHON_MODEL", "default")

config = CodexConfig(
    codex_bin=codex_bin,
    cwd=workspace,
    env={
        "HOME": os.environ.get("HOME", ""),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
    },
    config_overrides=('web_search="disabled"',),
)


def breakdown(value):
    if value is None:
        return None
    return {
        name: getattr(value, name)
        for name in (
            "cached_input_tokens",
            "input_tokens",
            "output_tokens",
            "reasoning_output_tokens",
            "total_tokens",
        )
    }


with Codex(config) as codex:
    thread = codex.thread_start(
        cwd=workspace,
        sandbox=Sandbox.read_only,
        approval_mode=ApprovalMode.deny_all,
        ephemeral=True,
    )
    run_options = {
        "sandbox": Sandbox.read_only,
        "approval_mode": ApprovalMode.deny_all,
        "effort": "low",
        "summary": "none",
    }
    if model != "default":
        run_options["model"] = model
    result = thread.run(prompt, **run_options)
    print(
        json.dumps(
            {
                "schema": 1,
                "status": result.status.value,
                "thread_id": thread.id,
                "turn_id": result.id,
                "duration_ms": result.duration_ms,
                "final_response": result.final_response or "",
                "usage_last": breakdown(result.usage.last if result.usage else None),
            },
            sort_keys=True,
        )
    )
`;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}
