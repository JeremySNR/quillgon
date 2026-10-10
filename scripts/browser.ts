import fs from 'node:fs';

/**
 * Which Chromium the browser scripts drive: $CHROME if set, else a known system install,
 * else Playwright's own (`pnpm exec playwright-core install chromium`, as CI does).
 */
export function chromePath(): string | undefined {
  if (process.env.CHROME) return process.env.CHROME;
  const known = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  return known.find((p) => fs.existsSync(p));
}
