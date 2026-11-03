#!/usr/bin/env node
// Automatic security checks for this project. Run:  npm run security:check
// (after `npm run build`, it also scans the built files in dist/spa for secrets).
// It reads files only: nothing is sent anywhere except `npm audit`, which asks the npm registry.
// Exit code 1 when a check FAILS, so it can stop a deploy in CI.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const results = [];
const add = (level, name, detail = '') => results.push({ level, name, detail });
const pass = (n, d) => add('PASS', n, d);
const warn = (n, d) => add('WARN', n, d);
const fail = (n, d) => add('FAIL', n, d);
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.quasar'].includes(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const isText = (f) =>
  /\.(m?[jt]s|vue|json|html|css|scss|md|sql|ya?ml|env|txt|webmanifest|svg)$/i.test(f);

// ---------- 1. Deploy headers (vercel.json) ----------
function checkHeaders() {
  if (!existsSync(join(root, 'vercel.json')))
    return fail('Security headers', 'vercel.json is missing');
  const cfg = JSON.parse(read('vercel.json'));
  const all = Object.fromEntries(
    (cfg.headers ?? [])
      .filter((h) => h.source === '/(.*)')
      .flatMap((h) => h.headers)
      .map((h) => [h.key.toLowerCase(), h.value]),
  );
  const needed = [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ];
  const missing = needed.filter((k) => !all[k]);
  if (missing.length) fail('Security headers', `missing: ${missing.join(', ')}`);
  else pass('Security headers', `${needed.length} headers set for every page`);

  const csp = all['content-security-policy'] ?? '';
  const dir = Object.fromEntries(
    csp
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => [p.split(' ')[0], p]),
  );
  const problems = [];
  if (!/'self'/.test(dir['default-src'] ?? '')) problems.push("default-src should be 'self'");
  if (/unsafe-inline|unsafe-eval|\*(?!\.)/.test(dir['script-src'] ?? '')) {
    problems.push('script-src allows inline/eval/wildcard scripts');
  }
  if (/unsafe-eval/.test(csp)) problems.push("'unsafe-eval' is allowed");
  if (!/'none'/.test(dir['object-src'] ?? '')) problems.push("object-src should be 'none'");
  if (!/'none'/.test(dir['frame-ancestors'] ?? ''))
    problems.push("frame-ancestors should be 'none'");
  if (!dir['base-uri']) problems.push('base-uri is not set');
  if (/http:\/\//.test(csp)) problems.push('CSP allows plain http');
  if (!/camera=\(self\)/.test(all['permissions-policy'] ?? '')) {
    problems.push('Permissions-Policy should allow the camera for this site only: camera=(self)');
  }
  if (problems.length) fail('Content Security Policy', problems.join('; '));
  else pass('Content Security Policy', 'no inline or eval scripts, no framing, no plugins');
}

// ---------- 2. Secrets in the repository and the build ----------
function checkSecrets() {
  const files = [
    ...walk(join(root, 'src')),
    ...walk(join(root, 'public')),
    ...walk(join(root, 'supabase')),
    ...walk(join(root, 'docs')),
    ...walk(join(root, 'scripts')),
    ...walk(join(root, 'dist')),
    ...['README.md', 'package.json', 'quasar.config.ts', 'index.html', 'vercel.json', 'env.example']
      .map((f) => join(root, f))
      .filter(existsSync),
  ].filter(isText);
  const patterns = [
    [/sb_secret_[A-Za-z0-9_-]{10,}/, 'Supabase secret key'],
    [/GOCSPX-[A-Za-z0-9_-]{10,}/, 'Google OAuth client secret'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  ];
  const found = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const [re, label] of patterns)
      if (re.test(text)) found.push(`${label} in ${relative(root, f)}`);
    // A Supabase key is a JWT: its middle part says which role it grants.
    for (const m of text.matchAll(/eyJ[\w-]{10,}\.(eyJ[\w-]{10,})\.[\w-]{10,}/g)) {
      try {
        const role = JSON.parse(Buffer.from(m[1], 'base64url').toString()).role;
        if (role === 'service_role') found.push(`service_role key in ${relative(root, f)}`);
      } catch {
        /* not a JWT */
      }
    }
  }
  if (found.length) fail('Secrets in files', found.join('; '));
  else
    pass(
      'Secrets in files',
      `${files.length} files scanned${existsSync(join(root, 'dist')) ? ' (build included)' : ''}`,
    );

  const tracked = tryGit(['ls-files']);
  if (tracked) {
    const envFiles = tracked
      .split('\n')
      .filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/example/.test(f));
    if (envFiles.length) fail('.env files in git', envFiles.join(', '));
    else pass('.env files in git', 'none are tracked');
  } else warn('.env files in git', 'could not run git');

  const example = read('env.example');
  const filled = example.split('\n').filter((l) => /^\w+=.+/.test(l.trim()));
  if (filled.length) fail('env.example', 'must hold no real values');
  else pass('env.example', 'no values');
  const config = read('quasar.config.ts') + readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8');
  if (/service_role|SERVICE_ROLE/.test(config))
    fail('Service key in app code', 'service_role referenced');
  else pass('Service key in app code', 'only the publishable key is used');
}

function tryGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

// ---------- 3. Risky code patterns ----------
function checkCode() {
  const risky = [
    [/v-html/, 'v-html (inserts raw HTML)'],
    [/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML/, 'innerHTML / outerHTML'],
    [/\beval\s*\(|new Function\s*\(/, 'eval / new Function'],
    [/document\.write\s*\(/, 'document.write'],
    [/localStorage\.setItem\([^)]*(password|token|secret)/i, 'a secret saved in localStorage'],
  ];
  const hits = [];
  for (const f of walk(join(root, 'src')).filter((f) => /\.(ts|vue|js)$/.test(f))) {
    const text = readFileSync(f, 'utf8');
    for (const [re, label] of risky)
      if (re.test(text)) hits.push(`${label} in ${relative(root, f)}`);
  }
  if (hits.length) fail('Risky code patterns', hits.join('; '));
  else pass('Risky code patterns', 'no v-html, innerHTML, eval or document.write');
}

// ---------- 4. Database rules ----------
function checkSql() {
  // Migrations 001 and 002 belong to the old shared-data design and were replaced by 003.
  const files = [
    'supabase/schema.sql',
    ...walk(join(root, 'supabase/migrations'))
      .map((f) => relative(root, f))
      .filter((f) => !/migrations\/00[12]_/.test(f)),
  ];
  const problems = [];
  const schema = read('supabase/schema.sql');
  for (const m of schema.matchAll(/create table\s+(?:if not exists\s+)?(\w+)/gi)) {
    const t = m[1];
    if (!new RegExp(`alter table\\s+${t}\\s+enable row level security`, 'i').test(schema)) {
      problems.push(`table ${t} has no row level security`);
    }
    if (!new RegExp(`create policy[^;]*\\bon\\s+${t}\\b`, 'i').test(schema)) {
      problems.push(`table ${t} has no policy`);
    }
  }
  for (const f of files) {
    const text = read(f);
    if (/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i.test(text))
      problems.push(`${f}: a policy allows everything`);
    if (/grant[^;]*\bto\s+[^;]*\banon\b/i.test(text))
      problems.push(`${f}: grants access to guests (anon)`);
    if (/security definer/i.test(text))
      problems.push(`${f}: security definer function (review it)`);
  }
  if (!/same_owner/.test(schema))
    problems.push('schema.sql lacks the same-owner foreign keys (migration 004)');
  if (problems.length) fail('Database rules (RLS)', problems.join('; '));
  else
    pass(
      'Database rules (RLS)',
      'every table has RLS and owner-only policies; no access for guests',
    );
}

// ---------- 5. Dependencies ----------
function checkAudit() {
  try {
    const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    report(JSON.parse(out));
  } catch (e) {
    // npm audit exits with 1 when it finds something, and still prints the JSON.
    try {
      report(JSON.parse(e.stdout));
    } catch {
      warn('Dependencies (npm audit)', 'could not reach the npm registry');
    }
  }
  function report(data) {
    const v = data.metadata?.vulnerabilities ?? {};
    const text = `critical ${v.critical ?? 0}, high ${v.high ?? 0}, moderate ${v.moderate ?? 0}, low ${v.low ?? 0}`;
    if ((v.critical ?? 0) + (v.high ?? 0) > 0)
      fail('Dependencies (npm audit)', `${text} in packages used by the app`);
    else if ((v.moderate ?? 0) > 0) warn('Dependencies (npm audit)', text);
    else pass('Dependencies (npm audit)', text);
  }
}

checkHeaders();
checkSecrets();
checkCode();
checkSql();
if (!process.argv.includes('--offline')) checkAudit();

const icon = { PASS: '✔', WARN: '!', FAIL: '✘' };
for (const r of results)
  console.log(`${icon[r.level]} ${r.level}  ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
const failed = results.filter((r) => r.level === 'FAIL').length;
const warned = results.filter((r) => r.level === 'WARN').length;
console.log(`\n${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed`);
process.exit(failed ? 1 : 0);
