# Security

How QR Attendee protects the data of its users, how to check it, and what to do before each deploy.

## What is protected

| Asset                                           | Protected by                                                                                                                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classes, students and attendance of one account | Row level security (RLS) in Supabase: every row has an owner and each account can only reach its own rows. Rows can only point at rows of the same account (migration 004). Guests (the `anon` role) have no table access.                              |
| Passwords                                       | Never seen or stored by the app. Google sign-in happens on Google's page. Email sign-in goes to Supabase Auth, which stores a hash. The sign-in form tells people never to type their Google password.                                                  |
| Sign-in link (`?code=`)                         | The one-time code Supabase adds to the address after sign-in is single-use, expires in minutes and is useless without a key held only by the browser that started the sign-in (PKCE). The app also removes it from the address bar right after sign-in. |
| The app in the browser                          | Security headers and a strict Content Security Policy (`vercel.json`): no inline or eval scripts, no framing, requests only to the app itself and Supabase.                                                                                             |
| Keys                                            | Only the publishable key is in the app. The secret / `service_role` key is never used here.                                                                                                                                                             |
| Imported files and names                        | Size and row limits, hidden characters removed, 100 character name limit (also enforced in the database).                                                                                                                                               |

## Checks you can run

| Command                       | What it does                                                                                                                                                           | Needs                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `npm run security:check`      | Headers and CSP, secrets in files and in `dist/`, risky code (`v-html`, `eval`...), RLS in the SQL files, `npm audit` for production packages. Exit code 1 on failure. | Node. Run `npm run build` first to include the build. |
| `npm run security:db`         | Runs the database files on a throw-away PostgreSQL and checks that accounts cannot reach each other's data.                                                            | `psql` and `createdb`                                 |
| `supabase/tests/rls.test.sql` | The same isolation test, to run in the **Supabase SQL editor** on the real project. It rolls back, so it leaves nothing behind.                                        | Supabase dashboard                                    |

GitHub Actions (`.github/workflows/security.yml`) runs the first two on every push and pull request. Dependabot (`.github/dependabot.yml`) opens weekly update pull requests.

## Before each deploy

1. `npm run typecheck`, `npm run lint:check`, `npm run build`
2. `npm run security:check` (all PASS, any WARN understood)
3. Migrations up to date on the live project (latest: `004_security_hardening.sql`), then run `supabase/tests/rls.test.sql` in the SQL editor: every line should say PASS.
4. Vercel environment variables hold only `QCLI_SUPABASE_URL` and `QCLI_SUPABASE_KEY` (the publishable key).
5. After deploying, open the site and check in the browser dev tools (Console) that nothing reports a Content Security Policy violation, and try the camera, an export and an import.

## Settings in the dashboards (cannot be checked from the code)

**Supabase → Authentication**

- Email provider on, **Confirm email** on.
- Set the minimum password length to 8 or more (it must match `MIN_PASSWORD_LENGTH` in `src/utils/limits.ts`; the app checks it too, but only the Supabase setting holds when the app is bypassed). Turn on leaked password protection if your plan has it.
- Turn on CAPTCHA protection for sign-ups and sign-ins (for example Cloudflare Turnstile) if the site is public. Check the rate limits.
- URL Configuration: the site URL and redirect URLs list only your real domains. Remove `http://localhost:9000` from the live project (use a separate project for development).
- Turn off providers you do not use.

**Google Cloud Console** → the OAuth client allows only your site's origin and the Supabase callback URL. The client secret lives only in Supabase.

**Vercel / GitHub** → two-factor sign-in on both accounts, a protected `main` branch that requires the checks above, and no secrets in preview deployments beyond the publishable key.

**Supabase project** → two-factor on your account, backups on, and never share the `service_role` key. If a secret key ever reaches the repository, rotate it at once.

## Accepted risks and known limits

- **`npm audit`: 8 moderate advisories**, all in `minimatch` (a pattern-matching slowdown) pulled in by `exceljs` → `archiver` → `glob`. They are only reachable by passing untrusted glob patterns, which the app never does. There is no fixed version that works with `exceljs`, so `security:check` reports a WARN. `uuid` was updated through `overrides`.
- **`style-src 'unsafe-inline'`** is needed by Quasar and Vue for inline styles. Scripts stay strict.
- **Session tokens** are kept in the browser's storage by Supabase (the standard way). The strict CSP is the protection against script injection.
- **Static QR codes**: a student's code never changes, so a shared photo of it works. The name search on the Scan page can also mark attendance without a code. Both are fine on a clerk's own device.
- **Shared accounts**: several clerks sharing one login also share its password, and there is no record of who scanned what.
- **Guest data** stays in the browser of a shared computer until it is cleared.

## Ideas for later (optional)

- A "recorded by" column and an audit trail (who added or removed which record, and when).
- Regenerate all QR codes of a class in one step, or flag a code scanned twice in a session.
- Per-clerk logins on a shared team space instead of a shared password.
- A Content Security Policy report endpoint and Supabase log drains for alerts.
- A `security.txt` file with a contact for reporting problems.
