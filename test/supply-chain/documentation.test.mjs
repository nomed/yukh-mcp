import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("documentation exposes the four reader intents", async () => {
  const navigation = await read("mkdocs.yml");

  for (const section of ["Tutorial", "How-to", "Reference", "Explanation"]) {
    assert.match(navigation, new RegExp(`^  - ${section}:`, "m"));
  }
});

test("documentation uses SVG and contains no Mermaid source", async () => {
  const [navigation, architecture] = await Promise.all([
    read("mkdocs.yml"),
    read("docs/architecture/overview.md"),
  ]);

  assert.doesNotMatch(`${navigation}\n${architecture}`, /mermaid/i);
  assert.match(architecture, /assets\/architecture-boundaries\.svg/);
});

test("the landing page starts with the runnable synthetic demo", async () => {
  const home = await read("docs/index.md");

  assert.match(home, /npm ci --ignore-scripts/);
  assert.match(home, /npm run demo/);
  assert.match(home, /not production-ready/i);
  assert.match(home, /ordinary gateway is inert/i);
});
