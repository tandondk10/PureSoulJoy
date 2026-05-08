// ─── Instrumentation ──────────────────────────────────────────────────────────
type Env = "dev" | "test" | "prod";

const ENV: Env = __DEV__ ? "dev" : "prod";

const IS_PROD = ENV === "prod";

const CONFIG = {
  dev: { level: 4, allowSensitive: true },
  test: { level: 4, allowSensitive: true },
  prod: { level: 1, allowSensitive: false },
};

const CURRENT = CONFIG[ENV];

type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 1,
  warn: 3,
  info: 2,
  debug: 4,
};

export function log(level: LogLevel, message: string, data?: unknown): void {
  if (LEVEL_PRIORITY[level] > CURRENT.level) return;

  const prefix = `[${level.toUpperCase()}]`;

  switch (level) {
    case "error":
      console.error(prefix, message, ...(data !== undefined ? [data] : []));
      break;
    case "warn":
      console.warn(prefix, message, ...(data !== undefined ? [data] : []));
      break;
    default:
      console.log(prefix, message, ...(data !== undefined ? [data] : []));
  }
}

/** Disabled in production — use only for sensitive/PII data. */
export function logSensitive(message: string, data?: unknown): void {
  if (IS_PROD) return;
  console.log("[SENSITIVE]", message, ...(data !== undefined ? [data] : []));
}

/** Wraps a sync or async function with a named timing trace. */
export function withTrace<T extends unknown[], R>(
  name: string,
  fn: (...args: T) => R,
): (...args: T) => R {
  return (...args: T): R => {
    const start = Date.now();
    log("debug", `${name} start`);
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        return result.then(
          (value) => {
            log("debug", `${name} done`, { ms: Date.now() - start });
            return value;
          },
          (err) => {
            log("error", `${name} failed`, { ms: Date.now() - start, err });
            throw err;
          },
        ) as unknown as R;
      }
      log("debug", `${name} done`, { ms: Date.now() - start });
      return result;
    } catch (err) {
      log("error", `${name} failed`, { ms: Date.now() - start, err });
      throw err;
    }
  };
}
