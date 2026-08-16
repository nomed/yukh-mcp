import { execFileSync } from "node:child_process";

const token = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;

export interface CopilotSdkModelInfo {
  readonly id: string;
  readonly [key: string]: unknown;
}

interface CopilotSdkClient {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  forceStop(): Promise<void>;
  listModels(): Promise<readonly CopilotSdkModelInfo[]>;
}

interface CopilotSdkModule {
  readonly CopilotClient: new (options: {
    readonly connection: unknown;
    readonly logLevel: "none";
  }) => CopilotSdkClient;
  readonly RuntimeConnection: {
    readonly forStdio: (options: {
      readonly path: string;
      readonly env: Record<string, string>;
    }) => unknown;
  };
}

const importModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;

export function parseCodexModelCatalog(output: string): readonly string[] {
  const line = output
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .findLast((value) => value.startsWith("{"));
  if (!line) return [];
  const parsed = JSON.parse(line) as { readonly models?: readonly { readonly slug?: unknown }[] };
  return unique(
    (parsed.models ?? [])
      .map((model) => model.slug)
      .filter((slug): slug is string => typeof slug === "string" && token.test(slug)),
  );
}

export function parseCopilotConfigModels(output: string): readonly string[] {
  const lines = output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.includes("`model`: AI model"));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line.includes("`contextTier`:"));
  return unique(
    lines
      .slice(start, end < 0 ? undefined : end)
      .map((line) => line.match(/^\s+-\s+"([^"]+)"/u)?.[1])
      .filter((model): model is string => typeof model === "string" && token.test(model)),
  );
}

export function runtimeModels(
  explicit: string | undefined,
  fallback: readonly string[],
  discover: () => readonly string[],
): readonly string[] {
  if (explicit !== undefined) return unique(explicit.split(",").filter(Boolean));
  let discovered: readonly string[] = [];
  try {
    discovered = discover();
  } catch {
    discovered = [];
  }
  return unique(["default", ...(discovered.length > 0 ? discovered : fallback)]);
}

export async function runtimeModelsAsync(
  explicit: string | undefined,
  fallback: readonly string[],
  discover: () => Promise<readonly string[]>,
): Promise<readonly string[]> {
  if (explicit !== undefined) return unique(explicit.split(",").filter(Boolean));
  let discovered: readonly string[] = [];
  try {
    discovered = await discover();
  } catch {
    discovered = [];
  }
  return unique(["default", ...(discovered.length > 0 ? discovered : fallback)]);
}

export function discoverCodexModels(executable: string): readonly string[] {
  return parseCodexModelCatalog(
    execFileSync(executable, ["debug", "models"], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

export async function discoverCopilotModels(executable: string): Promise<readonly string[]> {
  const sdk = await discoverCopilotModelsWithSdk(executable);
  if (sdk.length > 0) return sdk;
  return discoverCopilotModelsFromCliHelp(executable);
}

export async function discoverCopilotModelsWithSdk(
  executable: string,
  timeoutMs = 15_000,
): Promise<readonly string[]> {
  const sdk = (await importModule("@github/copilot-sdk")) as CopilotSdkModule;
  const client = new sdk.CopilotClient({
    connection: sdk.RuntimeConnection.forStdio({
      path: executable,
      env: {
        HOME: process.env.HOME ?? "",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
    }),
    logLevel: "none",
  });
  try {
    await withTimeout(client.start(), timeoutMs, "copilot_sdk_start_timeout");
    const models = await withTimeout(client.listModels(), timeoutMs, "copilot_sdk_models_timeout");
    return parseCopilotSdkModels(models);
  } finally {
    try {
      await client.stop();
    } catch {
      try {
        await client.forceStop();
      } catch {}
    }
  }
}

export function parseCopilotSdkModels(models: readonly CopilotSdkModelInfo[]): readonly string[] {
  return unique(models.map((model) => model.id).filter((id) => token.test(id)));
}

export function discoverCopilotModelsFromCliHelp(executable: string): readonly string[] {
  return parseCopilotConfigModels(
    execFileSync(executable, ["help", "config"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => token.test(value)))];
}
