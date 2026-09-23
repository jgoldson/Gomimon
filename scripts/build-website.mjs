import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'website');
const packaged = spawnSync(process.execPath, [join(root, 'scripts/package-extension.mjs')], { stdio: 'inherit' });
if (packaged.status !== 0) process.exit(packaged.status || 1);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'config.js', 'assets']) {
  cpSync(join(root, 'website', file), join(output, file), { recursive: true });
}
// Always use the current extension privacy notice.
cpSync(join(root, 'privacy.html'), join(output, 'privacy.html'));
mkdirSync(join(output, 'downloads'));
cpSync(join(root, 'dist', 'gomimon-extension.zip'), join(output, 'downloads', 'gomimon-extension.zip'));
console.log(`Website ready: ${output}`);
