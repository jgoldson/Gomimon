import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import './build-privacy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const safari = process.argv.includes('--safari');
const store = process.argv.includes('--store') || safari;
const packageName = safari ? 'gomimon-safari' : store ? 'gomimon-chrome-store' : 'gomimon-extension';
const staging = join(dist, packageName);
const archive = join(dist, `${packageName}.zip`);

rmSync(staging, { recursive: true, force: true });
rmSync(archive, { force: true });
mkdirSync(staging, { recursive: true });

const files = [
  'manifest.json',
  'background.js',
  'constants.js',
  'feed-logic.js',
  'slop-history.js',
  'content.js',
  'reddit-detector.js',
  'x-detector.js',
  'platforms.js',
  'detector',
  'detector-broker.js',
  'content.css',
  'popup.html',
  'popup-console.css',
  'popup-onboarding.css',
  'popup-settings.css',
  'popup-device.css',
  'privacy.html',
  'popup.js',
  'offscreen.html',
  'offscreen.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'icons/icon.svg',
  'assets',
  'minigames',
  'sounds',
];

files.forEach(relativePath => cpSync(
  join(root, relativePath),
  join(staging, relativePath),
  { recursive: true }
));

// Unpacked builds retain their stable development identity for Google sign-in.
// The Web Store assigns the production identity after the initial draft upload.
if (store) {
  const manifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'));
  delete manifest.key;
  manifest.host_permissions = manifest.host_permissions.filter(pattern => !pattern.includes('localhost'));
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (safari) {
  const manifest = JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8'));
  manifest.permissions = manifest.permissions.filter(value => !['identity', 'offscreen', 'notifications'].includes(value));
  manifest.background.service_worker = 'safari-background.js';
  manifest.version = '1.0.0';
  for (const file of ['safari-background.js', 'safari-auth.js']) cpSync(join(root, 'safari', file), join(staging, file));
  writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

mkdirSync(join(staging, 'sprites', 'animated'), { recursive: true });
readdirSync(join(root, 'sprites'))
  .filter(file => file.endsWith('.svg'))
  .forEach(file => cpSync(join(root, 'sprites', file), join(staging, 'sprites', file)));
readdirSync(join(root, 'sprites', 'animated'))
  .filter(file => file.endsWith('.gif'))
  .forEach(file => cpSync(join(root, 'sprites', 'animated', file), join(staging, 'sprites', 'animated', file)));

const result = spawnSync('/usr/bin/zip', ['-qr', archive, '.'], {
  cwd: staging,
  stdio: 'inherit'
});
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Created ${archive}`);
