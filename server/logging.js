import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;

export function requestIdFromRequest(req) {
  const incoming = req.get('x-gomimon-request-id');
  return REQUEST_ID_PATTERN.test(incoming || '') ? incoming : randomUUID();
}

export function errorDetails(error) {
  const details = {
    name: typeof error?.name === 'string' ? error.name : 'Error'
  };

  if (typeof error?.code === 'string') details.code = error.code;
  if (Number.isInteger(error?.status)) details.status = error.status;
  if (typeof error?.requestId === 'string') details.providerRequestId = error.requestId;
  if (Number.isFinite(error?.timeoutMs)) details.timeoutMs = error.timeoutMs;
  return details;
}

export function logEvent(event, fields = {}, level = 'info') {
  const logger = typeof console[level] === 'function' ? console[level] : console.info;
  logger(`[GomiMon] ${event}`, JSON.stringify(fields));
}

export function logHashPrefix(hash) {
  return typeof hash === 'string' ? hash.slice(0, 12) : undefined;
}

export function safeSdkMessage(message) {
  return String(message)
    .replace(/[\r\n]+/gu, ' ')
    .slice(0, 240);
}
