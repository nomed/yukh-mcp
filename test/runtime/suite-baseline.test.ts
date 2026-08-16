import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  detectSuiteWorkspace,
  formatSuiteBaseline,
  suiteBaseline,
} from "../../packages/suite-baseline/src/baseline.js";

const repositories = ["nomed.github.io", "yukh-mcp", "yukh-projects", "yukh-coordination"] as const;

function git(path: string, args: readonly string[]): void {
  execFileSync("git", ["-C", path, ...args], {
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Yukh Test",
      GIT_AUTHOR_EMAIL: "yukh-test@example.invalid",
      GIT_COMMITTER_NAME: "Yukh Test",
      GIT_COMMITTER_EMAIL: "yukh-test@example.invalid",
    },
  });
}

async function createRepository(root: string, name: (typeof repositories)[number]): Promise<void> {
  const path = join(root, name);
  await mkdir(path, { recursive: true });
  git(path, ["init", "-b", "main"]);
  await writeFile(join(path, "README.md"), `# ${name}\n`, "utf8");
  if (name === "yukh-coordination") {
    await writeFile(
      join(path, "go.mod"),
      "module github.com/nomed/yukh-coordination\n\ngo 1.26\n",
      "utf8",
    );
    await writeFile(
      join(path, "package.json"),
      JSON.stringify({ name: "@yukh/coordination-conformance-js", engines: { node: ">=24" } }),
      "utf8",
    );
  } else {
    await writeFile(
      join(path, "package.json"),
      JSON.stringify({
        name: name === "yukh-mcp" ? "yukh-mcp" : `@nomed/${name}`,
        engines: { node: ">=22" },
      }),
      "utf8",
    );
  }
  git(path, ["add", "."]);
  git(path, ["commit", "-m", "initial"]);
}

test("suite baseline reports all repositories without mutating them", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-suite-baseline-"));
  try {
    for (const repo of repositories) await createRepository(root, repo);
    const output = suiteBaseline(root);
    assert.equal(output.state, "ok");
    assert.equal(output.repositories.length, 4);
    assert.deepEqual(
      output.repositories.map((repo) => repo.name),
      [...repositories],
    );
    assert.equal(
      output.repositories.every((repo) => repo.tracked_clean),
      true,
    );
    assert.equal(
      output.repositories.every((repo) => repo.branch === "main"),
      true,
    );
    assert.match(output.repositories[0]!.validation_command, /npm ci/u);
    assert.match(output.repositories[3]!.validation_command, /go test -race/u);
    const text = formatSuiteBaseline(output);
    assert.match(text, /Yukh suite baseline/u);
    assert.match(text, /nomed.github.io: ok/u);
    assert.match(text, /yukh-coordination: ok/u);
    assert.doesNotMatch(text, /"repositories"/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("suite baseline warns for detached heads and detects the parent workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-suite-baseline-detached-"));
  try {
    for (const repo of repositories) await createRepository(root, repo);
    git(join(root, "yukh-mcp"), ["switch", "--detach", "HEAD"]);
    assert.equal(detectSuiteWorkspace(join(root, "yukh-mcp")), root);
    const output = suiteBaseline(join(root, "yukh-mcp"));
    const mcp = output.repositories.find((repo) => repo.name === "yukh-mcp");
    assert.equal(output.state, "warning");
    assert.equal(mcp?.detached, true);
    assert.equal(mcp?.state, "warning");
    assert.deepEqual(mcp?.diagnostics, ["detached HEAD"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("suite baseline fails on tracked-file drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "yukh-suite-baseline-dirty-"));
  try {
    for (const repo of repositories) await createRepository(root, repo);
    await writeFile(join(root, "yukh-projects", "README.md"), "# changed\n", "utf8");
    const output = suiteBaseline(root);
    const projects = output.repositories.find((repo) => repo.name === "yukh-projects");
    assert.equal(output.state, "error");
    assert.equal(projects?.state, "error");
    assert.deepEqual(projects?.diagnostics, ["tracked files are not clean"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
