import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const directory = new URL("../../.github/workflows/", import.meta.url);
const workflows = readdirSync(directory)
  .filter((name) => name.endsWith(".yml"))
  .sort();
const node24ActionPins = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
  "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
  "github/codeql-action/analyze@d1ba80a13dd99fba24a470575428917156a28b43",
  "github/codeql-action/init@d1ba80a13dd99fba24a470575428917156a28b43",
  "github/codeql-action/upload-sarif@d1ba80a13dd99fba24a470575428917156a28b43",
]);

for (const filename of workflows) {
  const source = readFileSync(new URL(filename, directory), "utf8");

  test(`${filename} pins every external action to a commit`, () => {
    const actionLines = source.split("\n").filter((line) => /^\s*uses:\s*/.test(line));
    assert(actionLines.length > 0, `${filename} has no inspectable action references`);
    for (const line of actionLines) {
      const reference = line
        .replace(/^\s*uses:\s*/, "")
        .split(/\s+#/, 1)[0]
        ?.trim();
      assert.match(reference ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[a-f0-9]{40}$/, line);
    }
  });

  test(`${filename} avoids privileged pull-request execution`, () => {
    assert.equal(source.includes("pull_request_target:"), false);
  });

  test(`${filename} declares explicit permissions and a timeout`, () => {
    assert.match(source, /^permissions:\n/m);
    assert.match(source, /^\s+timeout-minutes:\s+[0-9]+$/m);
  });
}

test("JavaScript actions use reviewed Node 24 releases", () => {
  for (const filename of workflows) {
    const source = readFileSync(new URL(filename, directory), "utf8");
    const references = source
      .split("\n")
      .filter((line) =>
        /^\s*uses:\s+(?:actions\/(?:checkout|configure-pages|setup-node|setup-python|upload-artifact|upload-pages-artifact)|github\/codeql-action\/(?:analyze|init|upload-sarif))@/.test(
          line,
        ),
      )
      .map((line) =>
        line
          .replace(/^\s*uses:\s*/, "")
          .split(/\s+#/, 1)[0]
          ?.trim(),
      );

    for (const reference of references) {
      assert(node24ActionPins.has(reference), `${filename}: ${reference}`);
    }
  }
});

test("workflow inventory is explicit", () => {
  assert.deepEqual(workflows, [
    "ci.yml",
    "codeql.yml",
    "dependency-review.yml",
    "pages.yml",
    "scorecard.yml",
    "yukh-bootstrap.yml",
    "yukh-projects-shadow.yml",
    "yukh-reconcile.yml",
  ]);
  assert.equal(basename(join(".github", "workflows")), "workflows");
});

test("Yukh Projects migration remains manual, immutable, and shadow-only", () => {
  const source = readFileSync(new URL("yukh-projects-shadow.yml", directory), "utf8");
  assert.match(
    source,
    /nomed\/yukh-projects@d58837397bc5856923e0e742458be34d8e5a27d6/u,
  );
  assert.match(source, /workflow_dispatch:/u);
  assert.equal(source.includes("issues:"), true);
  assert.equal(source.includes("types: [opened"), false);
  assert.equal(source.includes("apply-action"), false);
  assert.equal(source.includes("apply-enabled"), false);
  assert.equal(source.includes("github-write-token"), false);
  assert.equal(source.includes("mode:"), true);
  assert.match(source, /^          mode: legacy-shadow$/mu);
  assert.match(source, /mode: read-only shadow/u);
  assert.match(source, /retention-days: 1/u);
});

test("Yukh Projects shadow policy is versioned with its workflow", () => {
  const source = readFileSync(new URL("../../.yukh/project.yaml", import.meta.url), "utf8");
  assert.match(source, /^version: 1$/mu);
  assert.match(source, /^  repository: yukh-mcp$/mu);
  assert.match(source, /^  marker: yukh$/mu);
  assert.match(
    source,
    /^  kind:\n    project_field: Work Type\n    target: issue_type\n    required: true$/mu,
  );
  assert.equal(
    source.match(/^    target: issue_type$/gmu)?.length,
    1,
    "the logical work type target must remain explicit for owner-aware routing",
  );
  assert.match(source, /^  area:\n    project_field: Area$/mu);
  assert.doesNotMatch(source, /^  area:\n    project_field: Component$/mu);
  assert.match(source, /^  status:\n    project_field: Status\n    derived: true$/mu);
  assert.match(source, /^  overwrite_human_values: false$/mu);
});
