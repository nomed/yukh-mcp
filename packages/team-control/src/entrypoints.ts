import { fileURLToPath } from "node:url";

export interface TeamRuntimeEntrypoints {
  readonly worker: string;
  readonly coordinationMcp: string;
  readonly teamControlMcp: string;
}

function runtimeExtension(): "js" | "ts" {
  return fileURLToPath(import.meta.url).endsWith(".ts") ? "ts" : "js";
}

function appEntrypoint(name: string): string {
  return fileURLToPath(
    new URL(`../../../apps/${name}/src/main.${runtimeExtension()}`, import.meta.url),
  );
}

export function teamRuntimeEntrypoints(): TeamRuntimeEntrypoints {
  return {
    worker: appEntrypoint("team-worker"),
    coordinationMcp: appEntrypoint("coordination-preview"),
    teamControlMcp: appEntrypoint("team-control"),
  };
}
