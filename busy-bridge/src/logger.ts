/**
 * Structured logging.
 *
 * Deliberately minimal, with one rule that matters: secrets never get logged.
 * Any key whose name looks credential-shaped is redacted before output, so a
 * careless `log.info('config', config)` cannot leak a BUSY API key into a log
 * file that gets emailed to support.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY_PATTERN = /(key|secret|token|password|passwd|credential|authorization)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

let threshold: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
}

export const log = {
  debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};
