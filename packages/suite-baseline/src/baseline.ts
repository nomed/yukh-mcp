import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const repositories = ["nomed.github.io", "yukh-mcp", "yukh-projects", "yukh-coordination"] as const;

export type SuiteRepositoryName = (typeof repositories)[number];

export interface SuiteRepositoryBaseline {
  readonly name: SuiteRepositoryName;
  readonly path: string;
  readonly exists: boolean;
  readonly git_repository: boolean;
  readonly branch: string;
  readonly detached: boolean;
  readonly tracked_clean: boolean;
  readonly head: string;
  readonly title: string;
  readonly package_name?: string;
  readonly package_manager?: string;
  readonly node_engine?: string;
  readonly go_module?: string;
  readonly go_version?: string;
  readonly validation_command: string;
  readonly state: "ok" | "warning" | "error";
  readonly diagnostics: readonly string[];
}

export interface SuiteBaseline {
  readonly schema: 1;
  readonly command: "suite baseline";
  readonly workspace: string;
  readonly state: "ok" | "warning" | "error";
  readonly repositories: readonly SuiteRepositoryBaseline[];
}

const validationCommands: Record<SuiteRepositoryName, string> = {
  "nomed.github.io":
    "npm ci && npm run -s lint && npm test && npm run -s build:pages && npm run -s e2e && npm run -s test:network-denial && npm audit --audit-level=moderate",
  "yukh-mcp":
    "npm ci && npm run -s format:check && npm run -s typecheck && npm test && npm run -s build",
  "yukh-projects":
    "npm ci && npm test && npm run -s verify:bundles && npm audit --audit-level=moderate",
  "yukh-coordination":
    "go test -race ./... && npm install && npm run -s build:primitives && npm run -s check:primitives-bundle && npm test && npm run -s canonical-vectors",
};

function git(path: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function firstHeading(path: string): string {
  const readme = join(path, "README.md");
  if (!existsSync(readme)) return "";
  for (const line of readFileSync(readme, "utf8").split(/\r?\n/u)) {
    if (line.startsWith("#")) return line.replace(/^#+\s*/u, "").trim();
  }
  return "";
}

function packageMetadata(path: string): {
  readonly package_name?: string;
  readonly package_manager?: string;
  readonly node_engine?: string;
} {
  const packagePath = join(path, "package.json");
  if (!existsSync(packagePath)) return {};
  const value = JSON.parse(readFileSync(packagePath, "utf8")) as {
    readonly name?: unknown;
    readonly packageManager?: unknown;
    readonly engines?: { readonly node?: unknown };
  };
  return {
    ...(typeof value.name === "string" ? { package_name: value.name } : {}),
    ...(typeof value.packageManager === "string" ? { package_manager: value.packageManager } : {}),
    ...(typeof value.engines?.node === "string" ? { node_engine: value.engines.node } : {}),
  };
}

function goMetadata(path: string): {
  readonly go_module?: string;
  readonly go_version?: string;
} {
  const goMod = join(path, "go.mod");
  if (!existsSync(goMod)) return {};
  let moduleName: string | undefined;
  let goVersion: string | undefined;
  for (const line of readFileSync(goMod, "utf8").split(/\r?\n/u)) {
    if (line.startsWith("module ")) moduleName = line.slice("module ".length).trim();
    if (line.startsWith("go ")) goVersion = line.slice("go ".length).trim();
  }
  return {
    ...(moduleName ? { go_module: moduleName } : {}),
    ...(goVersion ? { go_version: goVersion } : {}),
  };
}

function repositoryState(name: SuiteRepositoryName, workspace: string): SuiteRepositoryBaseline {
  const path = join(workspace, name);
  const exists = existsSync(path);
  const gitRepository = exists && git(path, ["rev-parse", "--is-inside-work-tree"]) === "true";
  const diagnostics: string[] = [];
  if (!exists) diagnostics.push("missing repository directory");
  if (exists && !gitRepository) diagnostics.push("not a git repository");
  const branch = gitRepository ? (git(path, ["branch", "--show-current"]) ?? "") : "";
  const detached = gitRepository && branch === "";
  if (detached) diagnostics.push("detached HEAD");
  const status = gitRepository
    ? (git(path, ["status", "--short", "--untracked-files=no"]) ?? "")
    : "";
  const trackedClean = gitRepository && status === "";
  if (gitRepository && !trackedClean) diagnostics.push("tracked files are not clean");
  const head = gitRepository ? (git(path, ["rev-parse", "--short=12", "HEAD"]) ?? "") : "";
  const state = diagnostics.some((diagnostic) =>
    [
      "missing repository directory",
      "not a git repository",
      "tracked files are not clean",
    ].includes(diagnostic),
  )
    ? "error"
    : diagnostics.length > 0
      ? "warning"
      : "ok";
  return {
    name,
    path,
    exists,
    git_repository: gitRepository,
    branch: branch || "(detached)",
    detached,
    tracked_clean: trackedClean,
    head,
    title: exists ? firstHeading(path) : "",
    ...packageMetadata(path),
    ...goMetadata(path),
    validation_command: validationCommands[name],
    state,
    diagnostics,
  };
}

export function detectSuiteWorkspace(input = process.cwd()): string {
  const current = resolve(input);
  const candidates = [current, dirname(current)];
  for (const candidate of candidates) {
    if (repositories.every((repo) => existsSync(join(candidate, repo)))) return candidate;
  }
  if ((repositories as readonly string[]).includes(basename(current))) return dirname(current);
  return current;
}

export function suiteBaseline(input?: string): SuiteBaseline {
  const workspace = detectSuiteWorkspace(input);
  const results = repositories.map((repo) => repositoryState(repo, workspace));
  const state = results.some((repo) => repo.state === "error")
    ? "error"
    : results.some((repo) => repo.state === "warning")
      ? "warning"
      : "ok";
  return {
    schema: 1,
    command: "suite baseline",
    workspace,
    state,
    repositories: results,
  };
}

export function formatSuiteBaseline(output: SuiteBaseline): string {
  const lines = [
    "Yukh suite baseline",
    `Workspace: ${output.workspace}`,
    `State: ${output.state}`,
    "",
  ];
  for (const repo of output.repositories) {
    lines.push(
      `${repo.name}: ${repo.state}`,
      `  branch=${repo.branch} head=${repo.head || "unknown"} clean=${repo.tracked_clean ? "yes" : "no"}`,
    );
    const runtime = [
      repo.package_name ? `package=${repo.package_name}` : undefined,
      repo.package_manager ? `manager=${repo.package_manager}` : "manager=unspecified",
      repo.node_engine ? `node=${repo.node_engine}` : undefined,
      repo.go_module
        ? `go=${repo.go_module}${repo.go_version ? `@${repo.go_version}` : ""}`
        : undefined,
    ].filter(Boolean);
    if (runtime.length > 0) lines.push(`  ${runtime.join(" ")}`);
    if (repo.diagnostics.length > 0) lines.push(`  diagnostics=${repo.diagnostics.join(", ")}`);
    lines.push(`  validate=${repo.validation_command}`);
  }
  return lines.join("\n");
}
