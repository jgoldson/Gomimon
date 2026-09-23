import { appleWebClient } from './apple-web-client.js';
import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { initDb, processAppleRevocations } from './db.js';
import { logEvent } from './logging.js';

const port = Number(process.env.PORT || 8090);

try {
  await initDb();
  const retryAppleRevocations = () => processAppleRevocations(appleWebClient.revoke)
    .catch(() => logEvent('apple.revocation_retry_failed', {}, 'error'));
  await retryAppleRevocations();
  setInterval(retryAppleRevocations, 60000).unref();
  createServer(createApp()).listen(port, '127.0.0.1', () => {
    logEvent('server.listening', { host: '127.0.0.1', port });
  });
} catch (error) {
  logEvent('server.startup_failed', { name: error.name }, 'error');
  process.exitCode = 1;
}
