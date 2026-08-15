import { constants, closeSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

export interface LifecycleRecorder {
  readonly path: string;
  readonly record: (event: object) => void;
  readonly close: () => void;
}

export function createLifecycleRecorder(workspace: string): LifecycleRecorder {
  const directory = join(workspace, ".yukh");
  const path = join(directory, "conversation-lifecycle.jsonl");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error("invalid coordinator lifecycle path");
  const descriptor = openSync(
    path,
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  return {
    path,
    record: (event) => writeSync(descriptor, `${JSON.stringify(event)}\n`, undefined, "utf8"),
    close: () => closeSync(descriptor),
  };
}
