import { writeSync } from "node:fs";

export type CrashProtocolEvent =
  | {
      readonly phase: "ready";
      readonly fixture: "repository-local";
      readonly mode: "primary" | "recovery";
    }
  | {
      readonly phase: "ready";
      readonly fixture: "lifecycle";
    }
  | {
      readonly phase: "crash";
      readonly fixture: "repository-local" | "lifecycle";
      readonly boundary: string;
      readonly occurrence: number;
    };

export function writeCrashProtocolEvent(event: CrashProtocolEvent): void {
  writeSync(1, `${JSON.stringify(event)}\n`);
}

export function parseCrashProtocolEvents(output: string): CrashProtocolEvent[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CrashProtocolEvent);
}
