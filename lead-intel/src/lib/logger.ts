/** Minimal level-filtered logger. LOG_LEVEL=debug|info|warn|error, default info. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return LEVELS[raw as Level] ?? LEVELS.info;
}

function emit(level: Level, message: string): void {
  if (LEVELS[level] < currentLevel()) return;
  const stamp = new Date().toISOString().slice(11, 19);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${stamp} ${level.toUpperCase().padEnd(5)} ${message}\n`);
}

export const log = {
  debug: (m: string) => emit('debug', m),
  info: (m: string) => emit('info', m),
  warn: (m: string) => emit('warn', m),
  error: (m: string) => emit('error', m),
};
