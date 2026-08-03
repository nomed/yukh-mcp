export type LogLevel = "info" | "warn" | "error";
export type LogEvent =
  | "runtime_started"
  | "runtime_stopping"
  | "runtime_stopped"
  | "request_completed"
  | "request_rejected"
  | "runtime_failure";

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  event: LogEvent;
  correlation_ref?: string;
  status?: number;
  code?:
    | "body_too_large"
    | "host_rejected"
    | "origin_rejected"
    | "method_not_allowed"
    | "route_not_found"
    | "internal_error";
}

export interface Logger {
  write(
    level: LogLevel,
    event: LogEvent,
    fields?: Pick<LogRecord, "correlation_ref" | "status" | "code">,
  ): void;
}

export function createLogger(
  options: { sink?: (line: string) => void; now?: () => Date } = {},
): Logger {
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  return {
    write(level, event, fields = {}) {
      sink(
        JSON.stringify({
          timestamp: now().toISOString(),
          level,
          event,
          ...fields,
        } satisfies LogRecord),
      );
    },
  };
}
