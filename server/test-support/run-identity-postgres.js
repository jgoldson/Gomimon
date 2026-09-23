import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const admin = new pg.Client({ connectionString: process.env.IDENTITY_TEST_ADMIN_URL || `postgresql://${encodeURIComponent(process.env.USER)}@localhost/postgres` });
await admin.connect();
const name = `gomimon_identity_test_${randomBytes(6).toString('hex')}`;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.IDENTITY_TEST_ADMIN_URL || `postgresql://${encodeURIComponent(process.env.USER)}@localhost/postgres`); url.pathname = `/${name}`;
  const child = spawn(process.execPath, ['--test', 'identity-postgres.test.js'], { cwd: new URL('..', import.meta.url), stdio: 'inherit', env: { ...process.env, DATABASE_URL: url.href, RUN_IDENTITY_POSTGRES: 'true' } });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end(); }
