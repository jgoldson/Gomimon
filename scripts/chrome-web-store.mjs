// Chrome Web Store API client for GomiMon releases.
//
//   node scripts/chrome-web-store.mjs auth      one-time: sign in and save a refresh token
//   node scripts/chrome-web-store.mjs status    show published/submitted revision state
//   node scripts/chrome-web-store.mjs upload    upload dist/gomimon-chrome-store.zip
//   node scripts/chrome-web-store.mjs publish   submit the current draft for review
//
// Credentials live outside the repo in ~/.config/gomimon/chrome-web-store.json
// (override with CWS_CONFIG): { "clientId", "clientSecret", "refreshToken" }.
// The OAuth client must be a "Desktop app" client in the Google Cloud project
// that has the Chrome Web Store API enabled.
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHER_ID = 'e942669c-a62f-424f-8ada-027db4d1f9b6';
const ITEM_ID = 'ffbifkhfophelclnkmibepadfednkbnf';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const API = 'https://chromewebstore.googleapis.com';
const ITEM = `publishers/${PUBLISHER_ID}/items/${ITEM_ID}`;
const configPath = process.env.CWS_CONFIG || join(homedir(), '.config', 'gomimon', 'chrome-web-store.json');
const archive = join(root, 'dist', 'gomimon-chrome-store.zip');

function readConfig() {
  if (!existsSync(configPath)) {
    throw new Error(`Missing ${configPath}. Create it with {"clientId": "...", "clientSecret": "..."} and run "auth".`);
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function writeConfig(config) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  chmodSync(configPath, 0o600);
}

async function postToken(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Token request failed: ${body.error} ${body.error_description || ''}`);
  return body;
}

async function accessToken() {
  const { clientId, clientSecret, refreshToken } = readConfig();
  if (!refreshToken) throw new Error('No refresh token saved. Run "auth" first.');
  const { access_token } = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret
  });
  return access_token;
}

async function api(method, path, { body, headers } = {}) {
  const response = await fetch(`${API}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...headers },
    body
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${json.error?.message || text}`);
  return json;
}

async function auth() {
  const config = readConfig();
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent'
  });

  const code = await new Promise((done, fail) => {
    server.on('request', (req, res) => {
      const params = new URL(req.url, redirectUri).searchParams;
      res.end(params.get('code') ? 'GomiMon: signed in. You can close this tab.' : 'GomiMon: sign-in failed.');
      server.close();
      params.get('code') ? done(params.get('code')) : fail(new Error(params.get('error') || 'No code returned'));
    });
    console.log(`Opening Google sign-in. If nothing opens, visit:\n${url}`);
    spawn('open', [url.toString()], { stdio: 'ignore' });
  });

  const tokens = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri
  });
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token.');
  writeConfig({ ...config, refreshToken: tokens.refresh_token });
  console.log(`Saved refresh token to ${configPath}`);
}

async function status() {
  const result = await api('GET', `v2/${ITEM}:fetchStatus`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function upload() {
  if (!existsSync(archive)) throw new Error(`Missing ${archive}. Run "npm run package:store" first.`);
  const version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).version;
  console.log(`Uploading ${archive} (manifest ${version})...`);
  let result = await api('POST', `upload/v2/${ITEM}:upload`, {
    body: readFileSync(archive),
    headers: { 'Content-Type': 'application/zip' }
  });
  let state = result.uploadState;
  for (let attempt = 0; /IN_PROGRESS/.test(state) && attempt < 30; attempt++) {
    await new Promise((done) => setTimeout(done, 5000));
    state = (await api('GET', `v2/${ITEM}:fetchStatus`)).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`Upload ended in state ${state}: ${JSON.stringify(result)}`);
  console.log(`Upload succeeded: version ${result.crxVersion || version}.`);
}

async function publish() {
  const result = await api('POST', `v2/${ITEM}:publish`, {
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
    headers: { 'Content-Type': 'application/json' }
  });
  console.log(`Submitted for review. State: ${result.state}`);
  for (const warning of result.warningInfo?.warnings || []) console.warn(`Warning: ${warning.reason} ${warning.description}`);
}

const commands = { auth, status, upload, publish };
const command = commands[process.argv[2]];
if (!command) {
  console.error(`Usage: node scripts/chrome-web-store.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
command().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
