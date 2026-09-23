import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(root, 'dist/gomimon-chrome-store');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'manifest.json'), 'utf8'));
const expected = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
delete expected.key;
expected.host_permissions = expected.host_permissions.filter(p => !p.includes('localhost'));
assert.deepEqual(manifest, expected, 'Store manifest differs from the sanitized current source');
assert(!manifest.key && !manifest.host_permissions.some(p => /localhost|127\.0\.0\.1/.test(p)));

let checked = 0;
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(packageRoot, path);
    assert(!/(^|\/)(?:\..*|node_modules|server|tests|output)(\/|$)|\.(?:pem|key|p12|pfx|bak|backup)$/i.test(name), `Private/development file: ${name}`);
    if (entry.isDirectory()) { inspect(path); continue; }
    const bytes = readFileSync(path);
    if (name !== 'manifest.json') assert(bytes.equals(readFileSync(join(root, name))), `Stale packaged file: ${name}`);
    checked++;
    if (!/\.(?:html|css|js)$/.test(name)) continue;
    const source = bytes.toString('utf8');
    const patterns = name.endsWith('.html') ? [/\b(?:src|href)=["']([^"']+)["']/g]
      : name.endsWith('.css') ? [/url\(["']?([^)'"\s]+)["']?\)/g]
      : [/\bimport\s+(?:[^;\n]*?\s+from\s+)?["'](\.[^"']+)["']/g];
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
      const ref = match[1];
      if (/^(?:[a-z]+:|#|\/\/)/i.test(ref) || ref.includes('${')) continue;
      const target = resolve(dirname(path), ref.split(/[?#]/)[0]);
      assert(target.startsWith(`${packageRoot}/`) && existsSync(target), `Missing or external local reference: ${name} -> ${ref}`);
    }
  }
}
inspect(packageRoot);
const manifestFiles = [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(s => [...s.js, ...s.css])];
for (const file of manifestFiles) assert(existsSync(join(packageRoot, file)), `Missing manifest asset: ${file}`);
console.log(`Verified ${checked} current store files, production manifest, and local HTML/CSS/module references.`);
