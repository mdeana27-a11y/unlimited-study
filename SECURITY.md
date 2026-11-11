# Security notes

## Threat model in one paragraph
~400 students on a shared campus network, one admin, content that is course material (not exam secrets). Realistic threats: classmates guessing names/codes, scripted brute force, a student poking at admin routes, uploaded-file abuse, CSRF, and leaking the roster. The roster is the root of trust, so it is never exposed through any API a student can call.

## What is implemented (and tested in `tests/`)
| Area | Control |
|---|---|
| Passwords | argon2id (`argon2`), admin only; students have no password |
| Sessions | random 256-bit cookie token, **only its SHA-256 is stored**; `HttpOnly`, `SameSite=Lax`, `Secure` in production; rotation on every login; idle timeout (student 2 h, admin 30 min) and absolute expiry (7 d / 8 h); logout and logout-everywhere revoke server-side |
| CSRF | double-submit token (signed, HMAC-SHA256) required on every non-GET `/api` request |
| Brute force | per-IP rate limit on auth routes (express-rate-limit) + **persisted progressive lockout** per student code (5 failures → 1, 2, 4 … 60 min) and per admin email (3 failures). Lockout keys on the *submitted* code, so it does not reveal whether a code exists. A high per-IP lockout (40) is deliberate: a whole lecture hall shares one NAT address |
| Enumeration | wrong name, wrong code, unknown code and deactivated student all return the same `401 invalid_credentials`; unknown admin e-mails cost the same argon2 time as known ones |
| Google | ID token verified **server-side** (signature, audience = your client ID, issuer, expiry, `email_verified`). Unlinked Gmail accounts receive no session; they get a 10-minute signed link token and must prove a matching roster name + code once. One e-mail ↔ one student |
| Authorisation | `requireAuth` / `requireAdmin` middleware; students get 403 on every `/api/admin/*` route (attempts are logged as `admin_denied`); no student-facing endpoint returns roster or log data |
| Input | zod schemas on every body/query/param; strict schema for subject edits |
| Uploads | extension allow-list (pdf, pptx, docx, xlsx, zip, png, jpg/jpeg, mp4, txt, ipynb), size cap, random stored name, stored **outside** the web root, SHA-256 recorded, served only through an authenticated route that looks the file up by id (path traversal impossible), `Content-Disposition: attachment` + `nosniff` |
| Headers | helmet; CSP with **no inline scripts and no inline styles** (`script-src 'self'` + Google's GSI), `frame-ancestors 'none'`, HSTS in production |
| Output | all dynamic HTML escaped; CSV export neutralises formula injection (`=`, `+`, `-`, `@`) |
| Logging | pino with cookie / CSRF-header redaction; activity log never stores passwords or tokens; retention purge (default 12 months) |
| Supply chain | `npm audit`: 0 vulnerabilities at build time; fonts and libraries are self-hosted (no CDN at runtime) |

## Known limits — please read
- **Name + code is a weak credential.** Names are on printed attendance sheets. It is a convenience gate, not strong authentication. Anyone who knows a classmate's full name and code can sign in as them (until the lockout slows guessing). Mitigations: Google linking, admin can deactivate/unlink any student, every sign-in is logged with IP and browser.
- The server trusts the proxy count you configure (`TRUST_PROXY`); wrong value ⇒ wrong IPs in logs/limits.
- SQLite is a single file: back up `STORAGE_DIR` (database + uploads) regularly.
- Uploaded files are not virus-scanned. The allow-list and attachment-only delivery reduce risk but do not remove it.
- IP addresses and device info are personal data. The login page says so; set `LOG_RETENTION_MONTHS` to what your university's policy allows.
- No end-to-end browser tests of the Google popup (it needs a real client ID); the server side is tested with an injected verifier.
