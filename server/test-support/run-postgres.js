import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const adminUrl = process.env.BILLING_TEST_ADMIN_URL || `postgresql://${encodeURIComponent(process.env.USER || 'postgres')}@localhost/postgres`;
const admin = new pg.Client({ connectionString: adminUrl });
const name = `gomimon_billing_test_${randomBytes(6).toString('hex')}`;
await admin.connect();
let created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  const target = new URL(adminUrl); target.pathname = `/${name}`;
  console.log('Running billing tests against an isolated temporary Postgres database.');
  const child = spawn(process.execPath, ['--test', 'billing-postgres.test.js'], { cwd: new URL('..', import.meta.url), stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: target.href, RUN_BILLING_POSTGRES: 'true', DAILY_CHECK_LIMIT: '1000', SERVER_DAILY_CHECK_LIMIT: '100000' } });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
}
