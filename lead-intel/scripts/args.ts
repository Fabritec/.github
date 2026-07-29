/** Tiny argv parser: repeatable `--key value`, boolean `--flag`, `--key=value`. */

export interface Args {
  value(name: string): string | undefined;
  values(name: string): string[];
  number(name: string): number | null;
  flag(name: string): boolean;
  positional: string[];
}

export function parseArgs(argv: string[]): Args {
  const map = new Map<string, string[]>();
  const flags = new Set<string>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;

    if (!token.startsWith('-')) {
      positional.push(token);
      continue;
    }

    const trimmed = token.replace(/^--?/, '');
    const eq = trimmed.indexOf('=');
    if (eq !== -1) {
      push(map, trimmed.slice(0, eq), trimmed.slice(eq + 1));
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      push(map, trimmed, next);
      i += 1;
    } else {
      flags.add(trimmed);
    }
  }

  return {
    value: (name) => map.get(name)?.[0],
    values: (name) => map.get(name) ?? [],
    number: (name) => {
      const raw = map.get(name)?.[0];
      if (raw === undefined) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    },
    flag: (name) => flags.has(name),
    positional,
  };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

export function printHelp(command: string, options: [string, string][]): void {
  const width = Math.max(...options.map(([flag]) => flag.length));
  process.stdout.write(`\nUsage: npm run ${command} -- [options]\n\n`);
  for (const [flag, description] of options) {
    process.stdout.write(`  ${flag.padEnd(width)}  ${description}\n`);
  }
  process.stdout.write('\n');
}
