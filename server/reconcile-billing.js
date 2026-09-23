import 'dotenv/config';
import * as db from './db.js';
import { createBilling } from './billing.js';
import { logEvent } from './logging.js';
try {
  const billing = createBilling({ db });
  await billing.validateCatalog();
  await billing.reconcile();
  logEvent('billing.reconcile_complete');
} catch (error) {
  logEvent('billing.reconcile_error', { name: error.name, code: error.code }, 'error');
  process.exitCode = 1;
} finally { await db.closeDb(); }
