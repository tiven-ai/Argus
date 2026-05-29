# Argus M8 — Email Verification + Password Reset (Design Spec)

**Status:** approved 2026-05-29
**Predecessors:** [M0–M6 main spec](2026-05-28-argus-design.md), [M7 RLS + audit](2026-05-29-argus-m7-rls-audit-design.md)
**Goal:** Add email verification (non-blocking, with a nag bar) and a password-reset flow on top of the existing cookie-auth stack. Both share one Resend-backed email infrastructure and one polymorphic one-time-token table.

---

## 1. Success Criteria

M8 is done when all hold:

1. A new `email` module exposes an `EmailSender` interface with `ResendEmailSender` (production) and `MockEmailSender` (tests).
2. Migration `0004_email_verification_and_reset.ts` adds `users.email_verified_at` + creates the polymorphic `auth_one_time_tokens` table.
3. Four new server routes ship: `POST /auth/email-verify/request`, `POST /auth/email-verify/confirm`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`. All shapes follow the table in §4.
4. `/auth/register` fire-and-forgets a verification email; success does not depend on email delivery.
5. `/auth/me` returns `emailVerifiedAt: string | null`.
6. Three new web routes ship: `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password`. Plus a `VerifyNagBar` in `__root.tsx` shown when `emailVerifiedAt === null`, dismissible per session.
7. All visible UI strings translate via en / zh-CN / ja. Server emails are English only (see §10 non-goals).
8. New tests pass: token DAO unit, two route integration suites, one email-sender unit, one E2E extension. CI: existing 94 server + 14 web tests still pass.
9. Rate limit: 60s between same-(user, kind) issue requests; second request silently returns 200 without re-sending.
10. Idempotency: issuing a new token of kind X for a user marks all prior un-consumed kind-X tokens as consumed.

## 2. Scope

**In:** Resend integration, polymorphic token table, 4 server routes, 3 web routes + nag bar, /auth/me extension, i18n keys for new strings, rate limiting on issue requests, register hook for verification email.

**Out (Non-Goals):**

- Magic-link login.
- Email change (update-email flow).
- Account deletion.
- Email body i18n (English-only for M8; locale-aware templates deferred).
- Session invalidation on password reset (existing cookies remain valid until JWT expiry). Documented as known limitation; future work would add a `users.session_version` column + JWT version check.
- New audit*log events for `email_verified` / `password_reset*\*` (user opted out; rely on pino app log).
- Console-stub email sender for local dev (user opted out; `local` mode without `RESEND_API_KEY` raises at send time but does not block register).
- Resend webhook handling (bounces, complaints).
- SPF / DKIM / DMARC tuning guidance.

## 3. Architecture Overview

Three new modules in `apps/server/src/modules/`:

```
email/                                    — Resend client + injectable interface
auth-tokens/                              — polymorphic one-time tokens, hashed + indexed
                                             (NOT under RLS; same tier as users/orgs/ingest_tokens)
```

Plus extensions to `auth/routes.ts` (4 new endpoints + register-side hook) and `auth/dao.ts` (markEmailVerified + updatePassword helpers).

Web app extensions:

```
src/routes/
├── auth.verify-email.tsx                 — confirms token from query string
├── auth.forgot-password.tsx              — request reset form
└── auth.reset-password.tsx               — submit new password form
src/features/email-verify-nag/
└── VerifyNagBar.tsx                      — banner under header when unverified
```

Cookie-based session continues unchanged. `/auth/me` is the only existing endpoint extended (adds `emailVerifiedAt`).

## 4. Routes

| Method + path                       | Auth             | Body                                             | Response                                                      | Behavior                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------- | ------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/email-verify/request`   | logged-in cookie | —                                                | `{ ok: true }`                                                | Look up most recent unconsumed `email_verify` token for `request.auth.user.id`. If `created_at` within last 60s, return 200 without sending. Else: revoke all prior unconsumed `email_verify` tokens for this user, issue a new one (24h expiry), send via `EmailSender`. Always 200.                                    |
| `POST /auth/email-verify/confirm`   | public           | `{ token: string }`                              | `{ ok: true }` or 400 `{ error: 'invalid_or_expired_token' }` | sha256-hash the raw token, lookup in `auth_one_time_tokens` with `kind='email_verify'`, `consumed_at IS NULL`, `expires_at > now()`. If found: `UPDATE users SET email_verified_at = now()` + mark token consumed (single tx).                                                                                           |
| `POST /auth/password-reset/request` | public           | `{ email: string }`                              | `{ ok: true }` always                                         | Look up user by email. 60s rate limit by (email, kind). If user exists and rate-limit-ok: revoke prior unconsumed `password_reset` tokens, issue new (1h expiry), send. If user doesn't exist or rate-limited: return 200 anyway (no leak of enumeration).                                                               |
| `POST /auth/password-reset/confirm` | public           | `{ token: string, newPassword: string }` (min 8) | `{ ok: true }` or 400 `{ error: 'invalid_or_expired_token' }` | sha256-hash token, lookup `kind='password_reset'`. If valid: bcrypt-hash newPassword, `UPDATE users SET password_hash = $1 WHERE id = (token.user_id)`, mark token consumed. **Also revoke all unconsumed `email_verify` and `password_reset` tokens for the same user** (defense — possible takeover paths). Single tx. |

### Existing routes that extend

- `POST /auth/register` — after the existing user+org+org_member insert + audit_log emit, call `issueAndSendEmailVerify(deps, user.id, user.email)`. Wrap the whole email-send block in `try { ... } catch (err) { request.log.warn({ err, event: 'email_send_failed' }) }` — register success does not depend on Resend reachability.
- `GET /auth/me` — response shape gains `emailVerifiedAt: string | null` (ISO 8601 if set).

### Helpers

`apps/server/src/modules/auth/email-flows.ts` (new):

```ts
export async function issueAndSendEmailVerify(deps, userId, email): Promise<void>
export async function issueAndSendPasswordReset(deps, userId, email): Promise<void>
```

Each:

1. Revoke prior unconsumed tokens of this kind.
2. Generate `raw = 'verify_' + crypto.randomBytes(32).toString('hex')` (or `reset_` prefix).
3. INSERT row with `token_hash = sha256(raw)`, expiry per kind.
4. Build URL: `${APP_BASE_URL}/auth/verify-email?token=${raw}` (or `/auth/reset-password?token=${raw}`).
5. Render template, call `emailSender.send(...)`.

## 5. Data Model — migration 0004

```sql
-- 1. user verification timestamp
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- 2. polymorphic one-time tokens (NOT under RLS — auth-tier table)
CREATE TABLE auth_one_time_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL,                  -- 'email_verify' | 'password_reset'
  token_hash   text NOT NULL UNIQUE,            -- sha256 of raw token
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_tokens_user_kind_active_idx
  ON auth_one_time_tokens (user_id, kind, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX auth_tokens_hash_active_idx
  ON auth_one_time_tokens (token_hash)
  WHERE consumed_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON auth_one_time_tokens TO argus_app;
```

No RLS (same tier as `users`, `orgs`, `ingest_tokens` per M7 spec §4.2). Reasoning: authentication-flow tables are accessed without an `org_id` context (public confirm endpoints don't know the org until the user is identified by the token).

The `idx WHERE consumed_at IS NULL` partial indexes keep both common lookups (by hash, by user+kind) cheap as the table grows. No retention policy in M8 (table grows monotonically; cleanup is future work).

## 6. Email Module

`apps/server/src/modules/email/`:

```
email/
├── index.ts                                  — public surface
├── types.ts                                  — EmailSender interface + EmailMessage type
├── resend-sender.ts                          — ResendEmailSender
├── mock-sender.ts                            — MockEmailSender (tests + DI fixture)
├── factory.ts                                — pick sender based on env
└── templates.ts                              — 3 inline templates (English)
```

```ts
// types.ts
export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>
}

// resend-sender.ts
import { Resend } from 'resend'
export class ResendEmailSender implements EmailSender {
  private client: Resend
  constructor(
    private apiKey: string,
    private from: string,
  ) {
    this.client = new Resend(apiKey)
  }
  async send(msg: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    })
    if (error) throw new Error(`Resend send failed: ${error.message}`)
  }
}

// mock-sender.ts
export class MockEmailSender implements EmailSender {
  public sent: EmailMessage[] = []
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg)
  }
}

// factory.ts
export function makeEmailSender(opts: { resendApiKey?: string; from: string }): EmailSender {
  if (!opts.resendApiKey) {
    throw new Error('RESEND_API_KEY not configured (M8 has no console-stub fallback)')
  }
  return new ResendEmailSender(opts.resendApiKey, opts.from)
}
```

Wired in `server.ts` and stored as a Fastify decorator `app.emailSender`. The `EmailSender` is constructed lazily: server boot succeeds without `RESEND_API_KEY`, but the first `send()` call throws if it's missing — tolerable because the call path is wrapped in try/catch at register time, and the explicit user-triggered routes return 500 (which the web app translates to a generic error).

### Templates (`templates.ts`)

Three inline TS functions returning `EmailMessage` minus `to`:

```ts
export function emailVerifyTemplate(verifyUrl: string): Omit<EmailMessage, 'to'>
export function passwordResetTemplate(resetUrl: string): Omit<EmailMessage, 'to'>
export function passwordChangedTemplate(): Omit<EmailMessage, 'to'>
```

Each returns subject + HTML + plain-text. HTML is ~30 lines of static markup (heading + paragraph + button-styled `<a>` + footer). Plain-text is `Confirm your email at <URL>` style. English only.

`passwordChangedTemplate()` is sent at the end of `/auth/password-reset/confirm` success — a courtesy notification, no link, just "your password was changed at <time> from <ip>".

## 7. Environment

`apps/server/src/env.ts` additions:

```ts
RESEND_API_KEY: z.string().optional()
EMAIL_FROM: z.string().default('Argus <noreply@argus.dev>')
APP_BASE_URL: z.string().url().default('http://localhost:5173')
```

`local` mode tolerates missing `RESEND_API_KEY` (boot succeeds; emails throw at send-time but never block register's response). `multi-tenant` mode logs a warning at boot if `RESEND_API_KEY` is unset. No hard fail at boot; tests pass without setting any of these.

## 8. Web App

### New routes

| Route                                | Auth   | Purpose                                                                                                                                                                    |
| ------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/verify-email?token=<token>`   | public | On mount, POST `confirm`. Show one of: "Verifying...", "✓ Email verified", "✗ Link invalid or expired". Link to `/sessions` (if logged in) or `/login` on success.         |
| `/auth/forgot-password`              | public | Email input. Submit → POST request. Always shows uniform "If that email exists, we've sent a reset link" response.                                                         |
| `/auth/reset-password?token=<token>` | public | New password form (min 8). Submit → POST confirm. On success, redirect `/login`. On failure: "Link expired or invalid; request a new one." link → `/auth/forgot-password`. |

Same UniFi-themed visual treatment as login/register pages.

### `VerifyNagBar` component

Lives in `apps/web/src/features/email-verify-nag/VerifyNagBar.tsx`. Mounted in `__root.tsx` between the `<header>` and `<main><Outlet /></main>` blocks.

Display rules:

- Show only if `user && user.emailVerifiedAt === null && !sessionStorage.getItem('argus.verifyNagDismissed')`
- Layout: thin amber strip, text "Please verify your email — check your inbox", buttons "Resend" + "Dismiss"
- "Resend" POSTs `/auth/email-verify/request`, then shows "Sent. Check your inbox." for 5s
- "Dismiss" sets `sessionStorage.setItem('argus.verifyNagDismissed', '1')` and hides
- Re-shows on the next browser session

### `/login` page

Add a small "Forgot password?" link below the password input → `/auth/forgot-password`.

### `AuthProvider` extension

Update the `User` type to include `emailVerifiedAt: string | null`. `useAuth()` returns the updated type.

### i18n keys

New keys in `en.json`, `zh-CN.json`, `ja.json`:

```json
{
  "shell": {
    "verifyNag": {
      "message": "Please verify your email — check your inbox.",
      "resend": "Resend",
      "resent": "Sent. Check your inbox.",
      "dismiss": "Dismiss"
    }
  },
  "auth": {
    "verifyEmail": {
      "verifying": "Verifying…",
      "success": "✓ Email verified.",
      "failed": "✗ This link is invalid or expired.",
      "goLogin": "Go to login",
      "goSessions": "Go to sessions"
    },
    "forgotPassword": {
      "title": "Reset your password",
      "email": "Email",
      "submit": "Send reset link",
      "submitting": "Sending…",
      "confirmation": "If that email exists in our records, we've sent a reset link.",
      "backToLogin": "Back to login"
    },
    "resetPassword": {
      "title": "Choose a new password",
      "newPassword": "New password (min 8 chars)",
      "submit": "Update password",
      "submitting": "Updating…",
      "success": "Password updated. Sign in with your new password.",
      "failed": "This link is invalid or expired. Request a new one.",
      "requestAnother": "Request another reset link"
    },
    "login": {
      "forgot": "Forgot password?"
    }
  }
}
```

Translations for zh-CN and ja follow the M6 conventions.

## 9. Testing

### Server

| File                                               | Scope                                                                                                                                                                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/email/mock-sender.test.ts`                   | Trivial: collects messages                                                                                                                                                                                        |
| `test/email/resend-sender.test.ts`                 | Mocks `Resend` class (`vi.mock('resend', () => ...)`), asserts `send()` is called with `{ from, to, subject, html, text }`. One test for the error path (Resend returns `{ error }`).                             |
| `test/auth-tokens/dao.test.ts`                     | issue (hash uniqueness), consume, expire (verifies `expires_at < now` returns null), revoke (mark prior consumed), partial-index hit                                                                              |
| `test/auth/email-verify.test.ts`                   | request 60s rate limit / confirm valid / confirm expired / confirm consumed twice / unauthorized request returns 401                                                                                              |
| `test/auth/password-reset.test.ts`                 | request returns 200 for unknown email / request rate-limited / confirm valid → login with new pwd works / confirm expired / confirm consumed → emits passwordChanged email / login with old pwd fails after reset |
| `test/auth/integration.test.ts` (extend M7's file) | register → MockEmailSender has 1 sent message with verify URL → extract token from URL → POST confirm → `emailVerifiedAt` now set on `/auth/me`                                                                   |

All routes integration tests use `MockEmailSender` injected via the existing dep-injection pattern. The Resend SDK is never imported at runtime in tests.

### Web

No new unit tests (M6 set no precedent for adding them per visual change). Verification via Claude Preview smoke after T-fin:

- Register → see nag bar
- Click Resend → "Sent. Check your inbox."
- Visit `/auth/verify-email?token=<good-token>` → "Email verified"; back to sessions → nag bar gone
- Visit `/auth/forgot-password` → submit → confirmation text
- Open Resend link → reset → log in with new pwd

### Total counts after M8

Server: 94 + ~22 = ~116 tests.
Web: still 14.
Total: ~130.

## 10. Risk Register (carried as known M8 limitations)

| Risk                                                | M8 stance                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Resend outage blocks register                       | Fire-and-forget at register; user can hit Resend later. Logged via pino.                                 |
| Existing sessions remain valid after password reset | Documented. JWT does not encode a session_version. Future work to add.                                   |
| CSRF on `/auth/email-verify/request`                | Relies on M4 cookie `SameSite=Lax`. If config flips to `None`, add CSRF token.                           |
| Email enumeration via register endpoint             | Register continues to 400 on existing email (pre-M8 behavior preserved). Reset flow is enumeration-safe. |
| Spam folder placement                               | Out of scope; relies on Resend's reputation.                                                             |
| Email i18n                                          | Deferred. M8 sends English. Future: pass locale from web to API; render in user's language.              |
| Token table grows unbounded                         | Deferred. Cleanup job is future work; partial indexes keep queries fast meanwhile.                       |

## 11. CLAUDE.md Update

In "Common pitfalls" add:

```
- **Sending email from a route handler:** use `app.emailSender.send(...)` via the Fastify decorator from the email module. Wrap in try/catch when the operation is best-effort (e.g., register's verification email); let it surface when the user explicitly triggered it (e.g., `/auth/password-reset/request`). Tests use MockEmailSender via the existing DI pattern.
```

In "Working rules" append:

```
- **Adding a new auth one-time-token kind:** extend `TokenKind` in `apps/server/src/modules/auth-tokens/types.ts`, write an `issueAndSend<Kind>` helper in `apps/server/src/modules/auth/email-flows.ts`, add a public confirm route, write the matching integration test under `apps/server/test/auth/`. Don't pile new kinds into existing helpers.
```

## 12. Backlog after M8

- Email body i18n.
- Session invalidation on password change (JWT version).
- Magic-link login.
- Email change (update-email flow).
- Token cleanup job.
- Audit events for `email_verified` / `password_reset_*` (user opted out; revisit if compliance needs).
- M9 (multi-user-per-org).

---
