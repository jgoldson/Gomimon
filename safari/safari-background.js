import { completeDetectorSignIn } from './background.js';
import { createSafariAuth } from './safari-auth.js';
globalThis.gomimonSafariAuth = createSafariAuth({ api: chrome, complete: completeDetectorSignIn });
