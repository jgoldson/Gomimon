import { readFileSync, writeFileSync } from 'node:fs';

// One source for the bundled, website, and publicly hosted privacy notice.
const source = readFileSync(new URL('../PRIVACY.md', import.meta.url), 'utf8');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const body = source.trim().split(/\n\s*\n/).map(block => block.startsWith('# ')
  ? `<h1>${escape(block.slice(2))}</h1>`
  : `<p>${escape(block.replaceAll('\n', ' '))}</p>`).join('\n');
writeFileSync(new URL('../privacy.html', import.meta.url), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GomiMon Privacy</title><style>body{max-width:720px;margin:48px auto;padding:24px;background:#fff1b9;color:#17263b;font:16px/1.65 system-ui}h1{line-height:1.2}</style></head>
<body><main>${body}</main></body></html>\n`);
