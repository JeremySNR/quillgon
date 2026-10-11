/** Flags that never take a value: `--yes s01` means "yes" and the argument s01. */
export const BOOLEAN_FLAGS = new Set(['yes', 'offline', 'codex', 'default', 'mechanical', 'outline', 'quiet', 'snapshot', 'verbose', 'write', 'help', 'json', 'all-scenes', 'life', 'memoir', 'deep', 'guide']);

export function parseArgs(argv: string[]): { flags: Record<string, string | boolean>; args: string[] } {
  const flags: Record<string, string | boolean> = {};
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      if (eq >= 0) flags[k] = BOOLEAN_FLAGS.has(k) ? !/^(false|no|0)$/i.test(a.slice(eq + 1)) : a.slice(eq + 1);
      else if (!BOOLEAN_FLAGS.has(k) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) flags[k] = argv[++i];
      else flags[k] = true;
    } else args.push(a);
  }
  return { flags, args };
}
