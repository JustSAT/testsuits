# TestSuits — Modern Test Management System

A self-hosted test management platform for manual functional QA. Organise projects, run test suites, track executions, link defects to Jira, and store evidence in MinIO — a lightweight, Docker-Compose alternative to TestRail / Zephyr / qTest.

- **Multi-tenant** — every object is scoped to a Company; cross-tenant access is blocked at the API layer.
- **Jira integration** — Jira credentials are configured once per company; each project picks which Jira project to file bugs into. `Create Jira bug` on a failed execution only enables when the execution's project has a Jira binding and the company has Jira credentials saved.
- **Custom fields** — per-project configurable fields (text, long text, number, select, checkbox) that attach to every test case in the project.
- **Shared / reusable steps** — a per-project library of named steps; insert one into any case from the step editor.
- **Rich-text editor** — WYSIWYG (TipTap) with a toolbar (bold, italic, inline code, bullet/numbered lists, links, undo/redo) on the fields where formatting actually helps forensic detail: step action/expected, preconditions, shared-step library entries, and — on execution detail — *Actual result* and *Why it failed*. Stored and rendered as Markdown, so plain-text content round-trips and existing rows stay readable. Link URLs are restricted to `http(s)`/`mailto`/`tel` — `javascript:` and other schemes are blocked at both insert and render time.
- **Webhooks** — configure outbound HTTP webhooks per project on events (`run.created`, `run.completed`, `run.archived`, `execution.failed`, `execution.passed`, `execution_result.failed`, `execution_result.passed`, `jira.bug_created`). Optional HMAC-SHA256 signing, delivery log, test-fire button.
- **Qase-style repository** — every project is listed in the sidebar under **Projects**, and opens as its test repository: the suite tree with case counts (sub-suites included) on the left, the selected suite's cases and sub-suites on the right, search and **Add filter** on top. Every suite has a **⋮** menu to create a test case or sub-suite in it, edit it (name, parent, description), duplicate it with everything under it, or delete it; checkboxes delete several suites and cases at once.
- **Qase-style case panel** — clicking a case in the repository opens it in a side panel with **General** (description, pre- and post-conditions, parameter groups, steps with substeps and input data, attachments), **Properties** (suite, priority, test level, estimate, tags, requirements, custom fields — saved as you change them), **Runs** (every execution across runs), **History** (field-by-field changes), **Defects** (Jira issues raised from its executions) and **Comments**. Edit, clone and delete sit in the panel header.
- **Qase JSON import / export** — import a Qase repository export into a project (dry-run preview first) and export a project as Qase JSON. Suites and cases remember their Qase id, so importing a newer export updates them in place, and an export imported back changes nothing.
- **Qase-style run creation** — **New run** opens a dialog laid out like Qase's (project and name, description, environment and milestone, assignee and due date, platform / connectivity / locale configurations, test cases). Cases are picked in a suite tree with "selected / total" counts per suite (sub-suites included), the active suite's cases and sub-suites side by side, a search across every case title, and **Add filter** by priority, test level or tag. Pick whole suites, a few sub-suites, or single cases.
- **Kanban run view** — toggle between list and kanban on the Runs page; managers drag cards between columns to change a run's status.
- **Archive runs** — managers can archive a test run to remove it from the active list. An **Archived** tab on the Runs page shows all archived runs; managers can restore them back to active.
- **Evidence storage** — upload screenshots, videos and logs against cases or executions.
- **Full activity log** — per-project event stream with filters.
- **Excel import** — managers bulk-load a project's catalogue from a standard `.xlsx` template (download it from the project page). Nested suites are created from a `Suite Path` column, steps live on their own sheet joined by `Case ID`, and every upload gets a dry-run preview showing exactly what will be created, updated, or skipped before anything is written.
- **CSV export** of run results.
- **API tokens** — personal access tokens (`ts_…` prefix, SHA-256 hashed at rest). Send as `Authorization: Bearer <token>` to call the API from CI. Token auth is read-only on the token management endpoints — tokens can't mint more tokens.
- **Email verification** — new signups must verify their email address before signing in. A tokenized verification link (24 h TTL) is emailed on signup; the UI shows the link in dev mode. Invited, SAML, and SCIM-provisioned users are auto-verified.
- **Two-factor authentication (TOTP)** — optional per-user 2FA. Users enable it from their Profile page (scan QR code with any TOTP app). When enabled, login requires a 6-digit code after the password step. A **Trust this device** checkbox lets users skip 2FA on the same browser for 30 days. Disabling 2FA requires the current password and revokes all trusted devices.
- **Remember me** — unchecked (default) sessions expire in 24 hours; checked sessions last 30 days. The choice carries through the 2FA step so the full flow honours it.
- **Invite flow & password reset** — managers invite teammates via one-time signed links; users reset their own password from the sign-in page. Links go through SMTP (Mailpit in dev, any SMTP provider in prod), and the UI also surfaces a copyable dev link for local testing.
- **Requirements & traceability** — first-class `Requirement` objects per project, with many-to-many links to test cases. The Coverage Matrix has a **Requirement** dimension that pivots the latest execution status per case under each linked requirement; unlinked cells are blank and linked-but-never-executed cells show `UNTESTED`.
- **User locking** — managers can lock any user from the Team page. Locked users cannot sign in, use the app, or call the API (JWT and API-token requests return `423`). Unlock to restore access. The Team list shows each member's avatar (or initials fallback) and last login timestamp.
- **Roles** — `ADMIN` (company settings, SSO/SCIM tokens, audit log), `MANAGER` (all project work), `TESTER` (runs/executions they own, created, or are assigned to; can execute and assign), `VIEWER` (read-only across the company).
- **SCIM 2.0 user provisioning** — working. Issue a per-tenant SCIM token from Company Settings → SSO, point your IdP (Okta, Azure AD, JumpCloud) at `/api/scim/v2`. Groups and role-to-group mapping are not yet supported.
- **SAML SSO — scaffolding only, not production-ready.** The per-company config UI and routes are in place, but `/saml/:slug/login` returns `501` and `/saml/:slug/acs` deliberately rejects requests until a real assertion parser is wired up (see comments in `backend/src/routes/saml.ts` for the exact steps — install `@node-saml/node-saml` and verify against `cfg.x509Cert`). Do not expose these routes to the public internet as-is.
- **Audit log** — `/api/audit` surfaces the tenant-wide activity stream with user/action/date filters and CSV export for compliance reviews.
- **Test case versioning** — every `PATCH /cases/:id` snapshots the prior state to `TestCaseRevision` and `GET /cases/:id/revisions` returns the full audit trail. The case panel's **History** tab lists every edit with its author, time and each changed field before → after.
- **Project workspace (Qase style)** — the sidebar lists the company's projects; the open project expands into its Dashboard, Repository, Test runs, Environments, Milestones, Requirements, Coverage matrix and Settings. Everything inside works on that project, so nothing asks for a project again; `/`, `/runs` and `/matrix` open the last project used.
- **Environments** — each project keeps its environments (title, unique slug, description, Dynamic host pattern or Static URL), shown as cards with their run count; a new run picks its environment from that list.
- **Executive dashboard** — per project: stat tiles, 30-day execution & pass-rate trend, release-readiness per milestone, defect aging buckets, top failing cases.
- **Company profile** — managers rename the company and give it a logo (stored inline, no object storage needed), shown in the sidebar.
- **i18n** — English and French built in with a language switcher; sidebar collapses for more canvas. All API error, warning, and info messages are returned as stable `UPPER_SNAKE_CASE` machine keys (e.g. `INVALID_CREDENTIALS`, `PROJECT_NOT_FOUND`); the frontend translates them via `t('errors.' + key)`. Validation messages, placeholders, and aria-labels are also served from the language files — no hardcoded English in `.tsx` files or API responses.
- **Dark mode** — light by default. Toggle in the sidebar; the choice is saved in `localStorage` and applied pre-hydration so there's no flash on refresh. Toasts and the TipTap editor follow the theme automatically.

## Stack

| Layer             | Tech                                                              |
| ----------------- | ----------------------------------------------------------------- |
| Frontend          | React 18, Vite, TypeScript, Tailwind (with `darkMode: "class"`), TanStack Query, Zustand |
| Forms             | react-hook-form + Zod (shared schemas with the backend)           |
| Feedback          | sonner toasts for async / server errors; inline ARIA-wired errors for field validation |
| Theming           | class-strategy dark mode; state in `lib/theme.tsx`; pre-hydration set in `index.html` |
| Backend           | Node.js 20, Express, TypeScript, Prisma, Zod, JWT auth            |
| Database          | PostgreSQL 16                                                     |
| Object storage    | MinIO (S3-compatible)                                             |
| Drag-and-drop     | dnd-kit (for reorderable test steps)                              |
| Orchestration     | Docker Compose                                                    |

## Prerequisites

- Docker 24+ with Docker Compose v2
- That's it — everything else runs inside containers.

## Quick start

```bash
git clone https://github.com/<your-org>/testsuits.git
cd testsuits
cp .env.example .env
docker compose up --build
```

On first boot the API container runs `prisma db push` to create the schema and `prisma db seed` to insert the generic demo data. Open:

| Service        | URL                                         |
| -------------- | ------------------------------------------- |
| Web UI         | http://localhost:5173                       |
| API            | http://localhost:4000/api                   |
| MinIO console  | http://localhost:9005 (minioadmin/minioadmin) |
| Mailpit (mail) | http://localhost:8025                       |
| Postgres       | localhost:5434 (user/pass: `testsuits`)     |

### Seeded accounts

The seed creates two isolated tenants so you can verify cross-company isolation immediately:

| Tenant                    | Email                         | Password   | Role    |
| ------------------------- | ----------------------------- | ---------- | ------- |
| Acme QA (primary demo)    | `manager@acme.local`          | `acme123`  | MANAGER |
| Acme QA                   | `tester@acme.local`           | `acme123`  | TESTER  |
| Globex QA (isolation test)| `manager@globex.local`        | `globex123`| MANAGER |
| Globex QA                 | `tester@globex.local`         | `globex123`| TESTER  |

The Acme tenant ships with two projects:

- **Acme Checkout** — 3 suites (Cart, Payment, Shipping), 10 cases, 2 milestones, 4 runs covering smoke / full regression / offline / localisation, a failing execution linked to a sample Jira key, comments, activity-log entries, API token, and attachment metadata.
- **Acme Customer Portal** — 2 suites (Account, Orders), 5 cases, 1 milestone, 1 smoke run with a failing profile-update execution.

The Globex tenant has a single project (`BILLING`) with a small run so the isolation test is still useful: log in as a Globex user and confirm you can't see Acme's data, then check that Globex's own project still renders on every page.

## Configuration

All runtime configuration is controlled by `.env`. Copy `.env.example` and tweak as needed.

### Required

| Variable           | Purpose                                                   |
| ------------------ | --------------------------------------------------------- |
| `POSTGRES_USER`    | Postgres superuser (created on first boot)                |
| `POSTGRES_PASSWORD`| Postgres password                                         |
| `POSTGRES_DB`      | Database name                                             |
| `DATABASE_URL`     | Prisma connection string (uses the three vars above)      |
| `JWT_SECRET`       | Signing secret for JWTs — **required in production** (API refuses to start with the default/empty value when `NODE_ENV=production`). Generate with `openssl rand -hex 48`. |
| `API_PORT`         | Port the Express API listens on (inside the container)    |
| `WEB_PORT`         | Port the Vite dev server listens on                       |
| `VITE_API_URL`     | URL the **browser** uses to reach the API                 |
| `VITE_DEFAULT_LANGUAGE` | Optional UI language for first-time visitors (`en` or `fr`, baked in at build time). Empty = follow the browser language. A language picked in the switcher is always remembered. |
| `VITE_THEME_URL`   | Optional base URL of a deployment theme (e.g. `/theme`, baked in at build time). Empty = stock TestSuits look. See *Theming a deployment*. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of origins allowed to call the API. Leave empty in dev for auto-reflect. **Required in production** — an empty list denies all cross-origin requests. |
| `TRUST_PROXY`      | Number of reverse-proxy hops to trust for `X-Forwarded-For` (e.g. `1` behind a single LB). Without this, per-IP rate limits collapse every request onto the proxy IP. |

### Theming a deployment

Set `VITE_THEME_URL` at build time to restyle one deployment without forking the UI. The URL must serve:

| File            | Purpose |
| --------------- | ------- |
| `theme.css`     | Overrides the palette and font variables declared on `:root` in `frontend/src/index.css` (`--brand-*`, `--slate-*` as `R G B` triplets, `--font-sans`). Use `html:root` / `html.dark:root` selectors so they win over the defaults. |
| `favicon.svg`   | Browser tab icon. |
| `mark.svg`, `mark-dark.svg` | Logo mark shown before the wordmark (light and dark mode). |

Serve the files from your reverse proxy (or any static host); the theme is linked in `index.html`, so it applies before first paint.

### Host port overrides

Change these if the defaults collide with something else on your host:

| Variable                  | Default | Maps to                             |
| ------------------------- | ------- | ----------------------------------- |
| `POSTGRES_HOST_PORT`      | `5434`  | Postgres `5432` inside the container |
| `MINIO_HOST_PORT`         | `9004`  | MinIO S3 API `9000`                 |
| `MINIO_CONSOLE_HOST_PORT` | `9005`  | MinIO web console `9001`            |

### Object storage (MinIO)

| Variable              | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `MINIO_ROOT_USER`     | MinIO admin user                                                          |
| `MINIO_ROOT_PASSWORD` | MinIO admin password                                                      |
| `MINIO_BUCKET`        | Bucket name (created automatically by the `minio-init` service)           |
| `S3_PUBLIC_ENDPOINT`  | URL the **browser** uses for signed downloads (host + `MINIO_HOST_PORT`)  |

### Optional: auto-configure Jira

Set these to have the seed attach a `JiraConfig` to the Acme tenant on first boot. `JIRA_PROJECT_KEY`, if present, is bound to the `CHECKOUT` project so the per-project targeting is ready-to-go too. Omit these to configure Jira through the UI instead (Company Settings → Jira, then Project Settings → Jira binding).

```env
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_USER=you@example.com
JIRA_TOKEN=your-atlassian-api-token
JIRA_PROJECT_KEY=PROJ
```

API tokens: [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

### Email

Outgoing email (password reset, team invites) is sent via SMTP, or through Microsoft 365 when the `GRAPH_*` variables are set. In dev the compose stack ships a [Mailpit](https://github.com/axllent/mailpit) container that catches every message — no real mailbox required.

| Variable            | Default                                      | Purpose                                                      |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `SMTP_URL`          | `smtp://mailpit:1025`                        | SMTP connection string. Unset = log the body, don't send     |
| `MAIL_FROM`         | `TestSuits <no-reply@testsuits.local>`       | From header on every message                                 |
| `APP_URL`           | `http://localhost:5173`                      | Base URL used to build links (reset, invite) in email bodies |
| `MAILPIT_SMTP_PORT` | `1025`                                       | Host-side SMTP port for Mailpit                              |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | — | Entra app (client credentials) allowed to send as `GRAPH_SENDER` |
| `GRAPH_SENDER`      | —                                            | Microsoft 365 mailbox to send as. All four `GRAPH_*` set = Graph takes priority over Gmail/SMTP, and `MAIL_FROM` is ignored |
| `MAILPIT_UI_PORT`   | `8025`                                       | Host-side web UI for Mailpit                                 |

Open [http://localhost:8025](http://localhost:8025) to read every email the app sends. For production, set `SMTP_URL` to your provider's URL (e.g. `smtps://postmaster@mg.example.com:KEY@smtp.mailgun.org:465`) — no code changes needed.

## Working with the app

### Accessing from another device on your LAN

`VITE_API_URL` and `S3_PUBLIC_ENDPOINT` are URLs **the browser** resolves. When you open the UI from another machine, replace `localhost` with your host's LAN address, e.g.:

```env
VITE_API_URL=http://192.168.1.20:4000/api
S3_PUBLIC_ENDPOINT=http://192.168.1.20:9004
```

Then restart: `docker compose up -d --build web`.

### Re-seeding / resetting

Wipe everything and start from scratch:

```bash
docker compose down -v   # -v removes the postgres-data and minio-data volumes
docker compose up --build
```

Run just the seed against an already-running stack:

```bash
docker compose exec api npx tsx prisma/seed.ts
```

The seed is idempotent — rows that already exist are skipped.

### Resetting a single tenant's demo

Log in as a manager, delete the project from the UI, then re-run the seed; it will re-create just the missing pieces.

## Configuring Jira from the UI

Jira is split across two screens: credentials + templates live at the **company** level (they're reused by every project in the tenant), and the target Jira project lives on each **project**.

### 1. Company-level credentials (once per tenant)

1. Log in as a manager.
2. Open **Company Settings → Jira**.
3. Fill in:
   - **Base URL** (e.g. `https://acme.atlassian.net`)
   - **Email** (the owner of the API token)
   - **API token** — create at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
   - **Default issue type** (default: `Bug`)
   - Optional: summary / description templates used when filing bugs
4. **Test connection** → **Save**.

### 2. Per-project binding (once per project)

1. Open the project → **Settings → Jira**.
2. Pick the **Jira project** to file bugs into (the dropdown lists projects discovered via the company's saved credentials).
3. Optionally override the issue type and pick a parent epic.
4. **Save**.

### Per-combination execution (platforms × connectivity × locale)

When a run is created with multi-select platforms (`Web`, `Android`, …), multi-select connectivities (`Online`, `Offline`), and a comma-separated locale field (`en, fr, ar`), each test case in the run is split into one **TestExecutionResult** row per combination. The Run Detail page renders a *Result per combination* matrix for the selected case:

- Each row shows a combo label (e.g. `Android · Offline · fr`), a status pill, and pass/fail/blocked/skipped buttons.
- **FAILED requires both a failure reason and an actual result** — the API rejects the save with `RESULT_FAILED_REQUIRES_REASON_AND_DETAILS` otherwise, and the cell stays red with a "needs reason & details" hint until both are filled.
- A **Mark all passed** shortcut sets every remaining row to `PASSED` via `POST /execution-results/bulk` — the happy path for cases that work on every platform.
- The case isn't considered done until every cell has a non-`PENDING` status; the parent `TestExecution.status` aggregates the children (`FAILED` if any failed, `BLOCKED` if any blocked, `PENDING` if any pending, else `PASSED`/`SKIPPED`).
- The aggregate badge calls out the exact failing combos — so "passed on Windows, failed on Android" stays visible as `Failed on: Android · Offline`.

Runs created *before* this feature have no result rows and fall back to the legacy single-status editor — they keep working unchanged.

### 3. Filing bugs

On a per-combo matrix, every failing cell has its own **Create Jira bug** button that opens one ticket per failing combination — `Android · Offline · en` files a separate ticket from `iOS · Online · fr`, so each bug has precise reproduction context. The ticket description pulls the combo-specific `failureReason` and `actualResult` (both are required before the save is accepted, so the ticket is never blank on arrival). Legacy single-status executions still use the old **Create Jira bug** button on the parent row.

The button is only enabled when the company has Jira credentials saved **and** the execution's project has a Jira binding.

## Email verification, invites & password reset

Outbound mail goes through SMTP. In development, the `mailpit` container in `docker-compose.yml` provides a local SMTP sink + web UI — open http://localhost:8025 to read mail sent by the app. In production, point `SMTP_URL` at your real provider (Mailgun, SES, Postmark, etc).

### Signing up (email verification required)

1. Fill in the signup form and submit.
2. The server creates the company and user but does **not** sign you in. Instead, it emails a verification link valid for 24 hours. In dev mode the link is also shown in the UI.
3. Click the verification link. The server marks the email as verified, issues a JWT, and logs you in.
4. Until verified, login is blocked with a "please verify your email" message and a **Resend** button.

Invited users, SAML-authenticated users, and SCIM-provisioned users skip verification — their email ownership is already established.

### Invite a teammate

1. Log in as a manager.
2. Open **Team → Invite teammate**.
3. Fill in name, email, and role, and click **Invite**.
4. The server issues a one-time link valid for 7 days and emails it to the invitee. In dev, the UI also shows the link for easy copy-paste.
5. The invitee opens the link, sets their password, and is signed in directly — no second step, no shared passwords. The account is automatically marked as email-verified.

### Forgot your password?

The sign-in page has a **Forgot your password?** link. Enter your email; if it matches an account, the server issues a one-time link valid for 1 hour and emails it. The response is identical for known and unknown emails (no user enumeration).

## Two-factor authentication (TOTP)

2FA is opt-in per user and disabled by default.

### Enabling 2FA

1. Open **Profile** from the sidebar.
2. In the **Two-factor authentication** section, click **Enable 2FA**.
3. Scan the QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.), or enter the manual key.
4. Type the 6-digit code from the app and click **Verify**.
5. 2FA is now active for your account.

### Signing in with 2FA

After entering your email and password, a second screen asks for the 6-digit code from your authenticator app. The challenge token is valid for 5 minutes. Check **Trust this device for 30 days** to skip the code step on future logins from the same browser.

### Trusted devices

When you check "Trust this device" during 2FA, the server issues an opaque token (`td_` prefix, SHA-256 hashed at rest, 30-day expiry). On subsequent logins the token is sent via `X-Trust-Token` header; if it's valid for the authenticated user, the 2FA step is bypassed. Trusted device tokens are revoked automatically when:

- The user changes their password
- The user resets their password
- 2FA is disabled

Logout does **not** revoke trusted devices — the trust represents the machine, not the session. A forced session revocation (401) clears the trust token from the browser.

### Disabling 2FA

In **Profile → Two-factor authentication**, enter your current password and click **Disable 2FA**. All trusted devices are revoked.

### Remember me

The login page has a **Remember me for 30 days** checkbox. When unchecked (default), the JWT session expires in 24 hours. When checked, it lasts 30 days. The flag is carried through the 2FA challenge flow so the session duration is honoured regardless of whether 2FA is enabled.

## API tokens (for CI / scripting)

Open **API tokens** from the sidebar. Create a token, give it a name, and copy the plaintext — the server stores only a SHA-256 hash and the plaintext is shown exactly once. Use it as:

```bash
curl -H "Authorization: Bearer ts_<your-token>" https://testsuits.example.com/api/runs
```

Tokens inherit the creator's role and company. Token-authenticated callers can hit every endpoint **except** the token management endpoints (`GET/POST/DELETE /api/tokens`) — those require a JWT session so a compromised token can't mint fresh credentials.

Revoke a token anytime from the same page. Revocation is immediate.

A `CI seed token` is created automatically by the seed for the primary manager; the plaintext is printed to the seed log so you can demo the flow end-to-end.

## Requirements & traceability

Requirements are first-class per-project objects. Open a project → **Requirements** to create them; each one has an external reference (a URL or ID in your requirements system — Jira story, Confluence page, etc) and a title.

Link requirements to cases from **Case → Edit → Linked requirements** (multi-select). The legacy free-text `requirements[]` on a case still works and is shown in a separate panel; use the first-class links for anything that should surface in traceability reporting.

The Coverage Matrix picks up a new dimension: select **Requirement** on the Matrix page and the columns become the project's requirements. Each cell shows the latest non-`PENDING` execution status for the case, limited to the requirements the case is linked to. Cells for unlinked requirements are blank; cells for linked requirements that have never been executed show `UNTESTED`.

## Browsing the repository

Open a project from the sidebar (projects are listed under **Projects**) or the Projects page to see its repository. The left pane is the suite tree; each count is every case under that suite, sub-suites included. **Suites** at the top of the tree shows the root suites under **All cases**; clicking a suite opens it on the right with its breadcrumb, description, own cases (priority icon, title, test level) and its sub-suites. Search and **Add filter** (priority, test level, tag) narrow the tree, counts and lists.

Managers get a **⋮** menu on every suite:

- **Create test case** / **Create suite** — a new case or sub-suite inside it. **+ Test case** in the header and **+** next to *Suites* do the same from the top.
- **Edit** — name, parent suite (or *Project root*) and description. A suite cannot move under itself or one of its sub-suites (`SUITE_INVALID_PARENT`).
- **Duplicate** — copies the suite next to the original as "… (copy)", with all its sub-suites and cases (`POST /suites/:id/duplicate`). Executions, comments and attachments are not copied.
- **Delete** — removes the suite, its sub-suites and their cases, including their results in test runs, after a confirmation that says how many suites and cases go. Tick several suites or cases and use **Delete** in the selection bar to remove them together.

The **⋮** in the header leads to the project's test runs, milestones, requirements, Excel import and settings. Old `/suites/:id` links open the repository with that suite selected.

## Choosing a run's test cases

On **Runs → New run**, a dialog asks for the project and a name (prefilled as `Test run YYYY/MM/DD`), an optional description, the environment, milestone, default assignee and due date, and the **Configurations**: the platforms, connectivities and locales to run on (each case is executed once per combination). Under **Test cases**, **Select cases** opens the picker.

The picker shows the project's suite tree on the left; each suite's checkbox covers every case under it, sub-suites included, and its `selected/total` count does too. Click a suite to see its own cases and its sub-suites on the right, where single cases or whole sub-suites can be ticked; each case shows its priority as an icon. The search box filters every case title across the project, and **Add filter** narrows the list by priority, test level or tag (any chosen value within a field, every field). Search and filters only change what is shown: every ticked case goes into the run, and the header keeps counting against the whole project. **Done** keeps the selection and **Start run** creates the run.

Over the API, `POST /runs` takes `caseIds`, `suiteIds` or both. A suite id brings all cases of that suite and its sub-suites. Ids that are not in the run's project are rejected with `RUN_CASES_NOT_IN_PROJECT` / `RUN_SUITES_NOT_IN_PROJECT`. `GET /projects/:id/case-tree` returns the project's suites (`id`, `parentId`, `name`, `description`) and cases (`id`, `suiteId`, `title`, `priority`, `testLevel`, `tags`) that the picker is built from.

## Projects, environments and runs

Open a project from the sidebar: it expands into the project's pages (Dashboard, Repository, Test runs, Environments, Milestones, Requirements, Coverage matrix, Settings for managers), and every one of them works on that project — runs are created in it, the dashboard and the matrix count only it. The last project opened is remembered, so `/`, `/runs` and `/matrix` land back in it.

**Environments** lists the project's environments as cards (type, title, slug, host, run count and last run). **New environment** asks for a title, a slug (suggested from the title; lowercase letters, digits and dashes, unique in the project), a description and the type: *Dynamic* matches hosts by pattern (e.g. `*.feature.company.com`, for feature branches and preview builds), *Static* points at one URL (staging, production). Managers edit or delete an environment from its card menu; deleting it leaves its runs with the environment's name. **New run** picks the environment from the project's list (or *Not set*).

## Working with a test case

Click a case in the repository to open it in the side panel (the URL keeps `?case=<id>`, so the view can be shared; old `/cases/:id` links land there too). The header shows its title and suite path, with **Edit**, **Clone** and **Delete** for managers.

- **General** — description, pre-conditions, post-conditions, parameter groups (a table: one column per parameter, one row per combination), steps and attachments. Each step has an action, optional input data and an expected result, and can hold substeps (checks inside the step, each with its own action, optional input data and expected result). **Edit** turns this tab into the editor: rich text for the texts, a table editor for parameters, and steps you can drag to reorder, add substeps to, or insert from the shared-step library.
- **Properties** — suite (moving the case), priority, test level, estimate, tags, free-text requirements, custom fields and linked requirements. Changes save immediately.
- **Runs** — every execution of the case, newest run first, with its status, environment and who ran it.
- **History** — each edit with its author, time and every changed field before → after.
- **Defects** — Jira issues raised or linked on the case's executions.
- **Comments** — the case's discussion.

Executing a run shows the same steps, substeps, input data and parameter table.

## Importing from and exporting to Qase (JSON)

In the repository's **⋮** menu, **Import from Qase (JSON)** takes the file Qase's *Export → JSON* produces. Choosing it runs a preview (`POST /imports/qase/preview`, writes nothing) with the suites and cases to create, update or leave as they are; **Import** applies it in one transaction. Mapping:

| Qase | TestSuits |
| ---- | --------- |
| suite (title, description, nesting) | suite |
| title, description, preconditions, postconditions | same fields |
| priority high / medium / low | HIGH / MEDIUM / LOW (a case already Critical stays Critical) |
| severity, type, behavior, layer, Platform custom field | tags `severity:major`, `type:functional`, `behavior:positive`, `layer:e2e`, `platform:any` (unset values and the default type "other" are skipped) |
| params | parameters |
| steps, nested steps, data, expected_result | steps, substeps, input data, expected result (a step without one gets "—") |

Suites and cases keep their Qase id (`externalRef`). Importing a newer export matches by that id, falls back to suite path + title for items that have none yet (made here or imported from Excel), updates what changed (with a revision, so History shows it) and never deletes anything. **Export to Qase (JSON)** downloads the project in the same format; imported items keep their Qase ids, others get new numbers, and tags with the prefixes above go back into their Qase fields. Exporting a project and importing the file again reports everything unchanged.

## Importing test cases from Excel

Managers and admins can bulk-load a project's catalogue from a spreadsheet. Open a project → **Import from Excel** (`/projects/:id/import`).

### 1. Download the template

Click **Download template**. The workbook is generated by the API (`GET /api/imports/cases/template.xlsx`) and always matches the current schema — don't keep an old copy around. It has three sheets:

| Sheet          | Purpose                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| `Test Cases`   | One row per case. `Case ID`, `Suite Path`, and `Title` are required.                  |
| `Test Steps`   | One row per step, joined to a case by `Case ID`. Optional — cases can have no steps.  |
| `Instructions` | Per-column guidance and the allowed enum values.                                      |

`Test Cases` columns:

| Column              | Required | Notes                                                                                                     |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `Case ID`           | yes      | Any identifier unique **within the file** (e.g. `TC-001`). Joins steps to cases; it is *not* stored in the app. If two rows share an ID, **both** are rejected and their step rows are flagged — there is no way to tell which case a step belonged to. |
| `Suite Path`        | yes      | `LMS > Assignments` — `>` nests. Missing suites are created automatically, up to 6 levels deep.             |
| `Title`             | yes      | Max 500 characters.                                                                                        |
| `Priority`          | no       | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`. Defaults to `MEDIUM`. Dropdown-validated in the template.           |
| `Test Level`        | no       | `SMOKE` / `SANITY` / `REGRESSION` / `ADVANCED` / `EXPLORATORY`. Defaults to `REGRESSION`.                   |
| `Preconditions`     | no       | Free text.                                                                                                 |
| `Tags`              | no       | Comma-separated. Max 30 per case.                                                                          |
| `Estimated Minutes` | no       | Whole number from 1 to 100000 (the column is a 32-bit int in Postgres).                                     |
| `Requirements`      | no       | One reference per line, or separated by `;`. Max 50 per case. Populates the legacy free-text `requirements[]` field. |

`Test Steps` columns: `Case ID` (required), `Step` (optional — sets ordering; blank falls back to sheet order), `Action` (required), `Expected Result` (required).

Header matching is case- and punctuation-insensitive, and common synonyms are accepted (`Module`/`Area` → `Suite Path`, `Summary`/`Scenario` → `Title`, `Severity` → `Priority`, …), so a sheet you already maintain often imports without reshaping. Unknown columns are ignored.

### 2. Preview

Pick the file and click **Analyse file**. This calls `POST /api/imports/cases/preview`, which **writes nothing** and returns:

- counts for cases to create / update / skip, new suites, and total steps;
- the suite paths that would be created;
- a per-row table showing the decision for each case;
- a list of row-level problems, each with its sheet, row number, and a translated message.

### 3. Import

**When a case already exists** (same title in the same resolved suite) choose either:

- **Skip** (default) — leave the existing case untouched.
- **Update** — overwrite it with the values from the file. This snapshots the previous state to `TestCaseRevision` first, exactly like `PATCH /api/cases/:id`, so the case history stays complete.

If any row has a problem the import refuses with `IMPORT_HAS_ERRORS`. Either fix the file and re-upload, or tick **Import valid rows only** to import everything else and leave the flagged rows out.

The commit runs in a single transaction — suites and cases either all land or none do — and writes one `CASE_CREATED` / `CASE_UPDATED` activity entry per case with `payload.source = "excel-import"`.

### Limits

`.xlsx` only, 5 MB per upload, 1000 cases and 10000 steps per file, suite paths up to 6 levels. Both endpoints are manager-gated (`MANAGER` or `ADMIN`) and scoped to the caller's company — importing into another tenant's project returns `404`.

Because an `.xlsx` is a zip, the 5 MB cap only bounds the *compressed* bytes — a small "zip bomb" could otherwise exhaust the API process for every tenant on the instance. Before ExcelJS is handed the file, each entry is decompressed by the importer itself and the bytes that actually come out are counted, aborting the stream the moment the running total passes 64 MiB (`IMPORT_ARCHIVE_TOO_LARGE`). Archives with more than 512 entries are refused outright.

The sizes declared in the zip central directory are **not** trusted: they are attacker-controlled, and a file can claim one byte per entry while really inflating to gigabytes. They serve only as a cheap early reject. Output is discarded as it is counted, so peak memory stays flat regardless of what the archive claims or contains.

### Known limitation: duplicate suite names

The schema has no unique constraint on `(projectId, parentId, name)` for suites, or on case title within a suite — two sibling suites may legitimately share a name. The importer therefore resolves a colliding name deterministically (oldest row wins, ordered by `createdAt`).

Concurrency is handled with a transaction-scoped Postgres advisory lock taken per project (`pg_advisory_xact_lock`) at the start of the commit. Two imports into the same project serialise; imports into different projects still run in parallel, and the lock is released automatically on commit or rollback. Because the preview is computed before the lock is held, every decision is **re-resolved against the catalogue read under the lock** before anything is written — a row the preview called `CREATE` becomes a skip (or an update) if it turns out to already exist. The preview is a proposal; the in-transaction read is authoritative, which is why the committed counts can legitimately differ from the ones previewed.

This makes concurrent *imports* safe without a schema migration. It does not serialise an import against a case created through `POST /api/cases` at the same instant — that path has no such constraint today either. Adding the unique index would close both and is worth doing if you decide same-named siblings should never be allowed.

## Domain model

```
Company (name, slug, logo — inline image data URL)
  ├── Users (MANAGER / TESTER)
  │     ├── emailVerifiedAt, totpSecret, totpEnabledAt, isLocked, lastLoginAt
  │     ├── owned TestRuns
  │     ├── assigned TestExecutions
  │     ├── Comments
  │     ├── ActivityLog entries
  │     ├── ApiTokens
  │     ├── EmailVerificationTokens
  │     └── TrustedDevices (td_ tokens, SHA-256, 30d TTL)
  ├── JiraConfig (optional, 1 per company — credentials + templates)
  └── Projects
        ├── jiraProjectKey / jiraIssueType / jiraParentEpicKey (per-project target)
        ├── customFields (JSON array — text/textarea/number/select/checkbox)
        ├── SharedSteps (reusable step library)
        ├── Webhooks (outbound HTTP on events; HMAC signing + delivery log)
        ├── Milestones
        ├── TestSuites (tree — suites can have sub-suites)
        │     ├── externalRef (Qase id when imported from Qase)
        │     └── TestCases
        │           ├── description, preconditions, postconditions (Markdown)
        │           ├── parameters (JSON: [{ title, values[] }] — row n is the n-th value of each)
        │           ├── steps (ordered JSON array, drag-to-reorder, Markdown;
        │           │          each step: action, expected, data?, substeps?[{ action, expected?, data? }])
        │           ├── externalRef (Qase id when imported from Qase)
        │           ├── customFieldValues (keyed by project's customFields)
        │           ├── tags, priority, testLevel
        │           ├── Attachments
        │           └── Comments
        ├── Environments (title, slug unique per project, description,
        │                 type DYNAMIC/STATIC, host — pattern or URL)
        └── TestRuns
              ├── Milestone (optional)
              ├── status (PENDING/IN_PROGRESS/COMPLETED/ARCHIVED)
              ├── Environment (optional; `environment` keeps its title, and the free
              │                text of runs made before environments existed)
              ├── platforms[], connectivities[], locale, dueDate
              └── TestExecutions
                    ├── status (aggregate — rolls up child TestExecutionResults)
                    ├── failureReason / actualResult (legacy runs only; per-combo runs use results[])
                    ├── assignee, durationMinutes
                    ├── jiraIssueKey / jiraIssueUrl (legacy runs only)
                    ├── Attachments, Comments
                    └── TestExecutionResults (one per platform × connectivity × locale)
                          ├── platform, connectivity, locale
                          ├── status (PENDING/PASSED/FAILED/BLOCKED/SKIPPED)
                          ├── failureReason, actualResult, notes (required when FAILED)
                          └── jiraIssueKey / jiraIssueUrl (one bug per failing combo)
```

Enums: `Role` (`MANAGER`, `TESTER`), `RunStatus` (`PENDING`/`IN_PROGRESS`/`COMPLETED`/`ARCHIVED`), `Priority` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `TestLevel` (`SMOKE`/`SANITY`/`REGRESSION`/`ADVANCED`/`EXPLORATORY`), `Platform` (`WEB`/`WINDOWS`/`MACOS`/`ANDROID`/`IOS`), `Connectivity` (`ONLINE`/`OFFLINE`), `EnvironmentType` (`DYNAMIC`/`STATIC`).

### Role capabilities

| Action                                              | ADMIN | MANAGER | TESTER                                    | VIEWER |
| --------------------------------------------------- | ----- | ------- | ----------------------------------------- | ------ |
| View projects, suites, cases, milestones            | ✔     | ✔       | ✔                                         | ✔      |
| View runs & executions                              | ✔     | ✔       | only those they created or are assigned to | ✔      |
| Create/edit projects, suites, cases, milestones     | ✔     | ✔       | —                                         | —      |
| Create test runs                                    | ✔     | ✔       | ✔                                         | —      |
| Archive / restore test runs                         | ✔     | ✔       | —                                         | —      |
| Execute tests (per-combo status, reason, actual result, notes, duration) | ✔     | ✔       | ✔                                         | —      |
| Assign / reassign executions (single & bulk)        | ✔     | ✔       | ✔                                         | —      |
| Add / remove / change roles of teammates            | ✔     | ✔       | —                                         | —      |
| Lock / unlock users                                 | ✔     | ✔       | —                                         | —      |
| Company Jira credentials + templates                | ✔     | ✔       | view only                                 | view only |
| Per-project Jira binding (target project, epic)     | ✔     | ✔       | view only                                 | view only |
| Create / link / unlink Jira issues on executions    | ✔     | ✔       | ✔ (within their visible work)             | —      |
| Configure SSO / SAML, manage SCIM tokens            | ✔     | —       | —                                         | —      |
| Export audit log                                    | ✔     | ✔       | —                                         | —      |

## Folder layout

```
backend/
  prisma/
    schema.prisma      Data model
    seed.ts            Generic demo seed (shipped publicly)
    seed.hapster.ts    Local-only seed extension (gitignored — optional)
    seed.*.local.ts    More local-only seed extensions (gitignored — optional)
    migrations/        Generated Prisma migrations
  src/
    app.ts             Express setup + router mounting
    db.ts              Prisma client
    middleware/        auth, scope, error
    lib/               s3, jira, logger, activity
    routes/            auth, projects, suites, cases, runs, executions,
                       attachments, dashboard, jira, milestones,
                       comments, users, activity
  src/
    app.ts             Express setup + router mounting
    db.ts              Prisma client
    middleware/        auth, scope (tenant + tester visibility), logging, error
    lib/               s3, jira (discover + md→ADF), logger, activity, webhooks,
                       excelCases (import template + workbook parser),
                       suiteTree (sub-suite case totals and expansion),
                       qase + qaseImport (Qase JSON mapping, import, export)
    routes/            auth, twoFactor, users, companies, projects, suites,
                       cases, milestones, runs, executions, attachments,
                       comments, activity, dashboard, matrix, jira,
                       sharedSteps, webhooks, imports, environments
frontend/
  src/
    App.tsx            Router
    i18n/              en.json, fr.json — kept in sync (see CLAUDE.md)
    lib/               api, auth, status, logger, enums, markdown (safe renderer),
                       caseTree (run case picker tree + selection),
                       caseModel (case shapes, parameter rows, history diff),
                       currentProject (project from the URL, else the last opened)
    components/        Layout (collapsible, company header), Comments,
                       ActivityFeed, LanguageSwitcher, PasswordInput,
                       CustomFieldsEditor, SharedStepsEditor, WebhooksEditor,
                       NewRunModal + CasePickerModal (create a run, pick its
                       cases), CaseFilterBar, PriorityIcon, ui/MultiSelect,
                       ui/ActionMenu, repository/ (suite, case and Qase import
                       dialogs), case/ (CasePanel with its tabs, CaseEditor,
                       StepsView, LinkedRequirements), ProjectRedirect,
                       CompanyProfileCard
    pages/             Login, VerifyEmail, Dashboard, Projects, ProjectDetail
                       (the project's repository: suite tree + cases),
                       CompanySettings (company Jira creds + templates),
                       ProjectSettings (tabbed: Jira / custom fields /
                       shared steps / webhooks),
                       Team, Milestones, Matrix (coverage by platform /
                       connectivity / locale), Environments,
                       SuiteDetail (redirects into the repository), CaseDetail (Markdown + shared-step
                       library + custom fields), Runs (list / kanban toggle),
                       RunDetail, Profile (password, 2FA, avatar),
                       ImportCases (Excel bulk import), Tokens, Audit,
                       SsoSettings
docker-compose.yml     postgres + minio + minio-init + mailpit + api + web
```

## Local development

Docker is the recommended path. If you want to run the services natively (e.g. for faster hot-reload on the backend), point your local Node.js 20 at the Postgres and MinIO containers:

```bash
# One-time
cd backend && npm install
cd ../frontend && npm install

# Backend (reads DATABASE_URL from .env)
cd backend
npx prisma generate
npm run dev

# Frontend
cd ../frontend
npm run dev
```

You can still run just Postgres + MinIO in Docker:

```bash
docker compose up -d db minio minio-init
```

### Extending the seed with local fixtures

`prisma/seed.ts` automatically loads `prisma/seed.hapster.ts` if the file is present, then every `prisma/seed.*.local.ts` file in alphabetical order. Both patterns are gitignored, so you can keep one file per internal tenant (e.g. `seed.acme-internal.local.ts`). Each file exports a default async function:

```ts
// backend/prisma/seed.hapster.ts
import { PrismaClient } from "@prisma/client";

export default async function (prisma: PrismaClient) {
  // create your internal tenant, users, projects, etc.
}
```

Run it:

```bash
docker compose exec api npx tsx prisma/seed.ts
```

## API surface (high level)

All routes live under `/api`. Authentication is required except the public endpoints called out below. Every authenticated route is scoped to the caller's company; cross-tenant reads return 404 (not 403) so existence is never leaked.

**Authentication:** send `Authorization: Bearer <token>` where `<token>` is either a JWT (interactive login) or an API token (`ts_…` prefix, SHA-256 hashed). API-token callers can't call the token management endpoints themselves — those require a JWT session.

**Error responses** use stable machine keys, not English prose. Every error is returned as `{ "error": "UPPER_SNAKE_CASE_KEY" }` (e.g. `INVALID_CREDENTIALS`, `PROJECT_NOT_FOUND`, `RUN_REQUIRES_CASES`). Validation errors add a `details` object: `{ "error": "VALIDATION_FAILED", "details": { "formErrors": [], "fieldErrors": { ... } } }`. Clients should match on these keys, not on human-readable text.

| Area              | Routes                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Auth (public)     | `POST /auth/login`, `POST /auth/signup`, `POST /auth/forgot`, `POST /auth/reset`, `GET /auth/invite/:token`, `POST /auth/accept-invite`, `POST /auth/verify-email`, `POST /auth/resend-verification` |
| Auth (mgr)        | `POST /auth/invite`                                                                                             |
| 2FA (public)      | `POST /2fa/authenticate`                                                                                        |
| 2FA (auth)        | `GET /2fa/status`, `POST /2fa/setup`, `POST /2fa/confirm-setup`, `POST /2fa/disable`                            |
| Tokens            | `GET /tokens`, `POST /tokens`, `DELETE /tokens/:id` — all require an interactive (JWT) session                  |
| Users             | `GET /users`, `GET /users/me`, `POST /users` (mgr), `PATCH/DELETE /users/:id` (mgr), `PATCH /users/:id/lock` (mgr) |
| Companies         | `GET /companies/current`, `PATCH /companies/current` (mgr — `name`, `logo` as a PNG/JPEG/WebP/GIF data URL up to 400 KB, `null` removes it) |
| Environments      | `GET /environments?projectId=` (with `runCount`, `lastRunAt`), `POST /environments` (mgr), `PATCH/DELETE /environments/:id` (mgr) |
| Projects          | `GET /projects`, `POST /projects` (mgr), `GET/PATCH/DELETE /projects/:id`, `GET/PUT /projects/:id/custom-fields` (PUT mgr), `GET /projects/:id/case-tree` |
| Requirements      | `GET /requirements?projectId=…`, `GET /requirements/:id`, `POST /requirements` (mgr), `PATCH/DELETE /requirements/:id` (mgr), `POST/DELETE /requirements/:id/cases[/:caseId]` (mgr) |
| Shared steps      | `GET /shared-steps?projectId=…`, `POST /shared-steps` (mgr), `PATCH/DELETE /shared-steps/:id` (mgr)              |
| Webhooks          | `GET /webhooks/events`, `GET /webhooks?projectId=…`, `POST/PATCH/DELETE /webhooks/:id` (mgr), `POST /webhooks/:id/test` (mgr) |
| Suites            | `POST /suites` (mgr), `GET/PATCH/DELETE /suites/:id` (PATCH/DELETE mgr), `POST /suites/:id/duplicate` (mgr)       |
| Cases             | `POST /cases` (mgr), `GET /cases/:id`, `PATCH/DELETE /cases/:id` (mgr; PATCH can move the case to another suite of the project), `POST /cases/:id/clone` (mgr), `GET /cases/:id/revisions`, `GET /cases/:id/executions` |
| Excel import      | `GET /imports/cases/template.xlsx` (mgr), `POST /imports/cases/preview` (mgr, multipart — dry run), `POST /imports/cases` (mgr, multipart — commit) |
| Qase JSON         | `POST /imports/qase/preview` (mgr, multipart `projectId` + `file` — dry run), `POST /imports/qase` (mgr, multipart — commit), `GET /imports/qase/export?projectId=` |
| Milestones        | `GET /milestones`, `POST /milestones` (mgr), `PATCH/DELETE /milestones/:id` (mgr)                                |
| Runs              | `GET /runs`, `POST /runs` (mgr; `environmentId` picks a project environment, unknown → `ENVIRONMENT_NOT_IN_PROJECT`), `GET/PATCH/DELETE /runs/:id`, `GET /runs/:id/export.csv` |
| Executions        | `GET /executions/:id`, `PATCH /executions/:id` (legacy runs only — per-combo runs must use `/execution-results/*`), `POST /executions/bulk-assign` |
| Execution results | `PATCH /execution-results/:id`, `POST /execution-results/bulk` — per-combo status, failureReason, actualResult. `FAILED` requires both a reason and actual result. |
| Attachments       | `POST /attachments` (multipart), `GET /attachments/:id/download`, `DELETE /attachments/:id`                      |
| Comments          | `GET /comments?caseId\|executionId\|runId=…`, `POST /comments`, `DELETE /comments/:id`                           |
| Jira (company)    | `GET/PUT/DELETE /jira/config` (PUT/DELETE mgr), `POST /jira/test`, `GET /jira/defaults/templates`                |
| Jira (discover)   | `GET /jira/discover/projects`, `/jira/discover/issue-types`, `/jira/discover/epics`                              |
| Jira (project)    | `GET /jira/projects/:id/binding`, `PUT /jira/projects/:id/binding` (mgr)                                         |
| Jira (bugs)       | `POST /jira/executions/:id/{create-bug,link,unlink}` (legacy) · `POST /jira/results/:id/{create-bug,link,unlink}` (per-combo — one ticket per failing platform × connectivity × locale) |
| Matrix            | `GET /matrix/projects/:id?dimension=platform\|connectivity\|locale\|requirement`                                 |
| Activity          | `GET /activity?projectId=…&entityType=…&entityId=…`                                                              |
| Audit             | `GET /audit?userId=…&action=…&from=…&to=…&format=csv` (mgr)                                                      |
| Case history      | `GET /cases/:id/revisions`                                                                                       |
| Dashboard         | `GET /dashboard?projectId=` — includes trend, releaseReadiness, defectAging (the UI always passes the current project) |
| SAML (admin)      | `GET/PUT /saml/config` (admin); `GET /saml/:slug/login`, `POST /saml/:slug/acs` (public, IdP-facing)             |
| SCIM tokens       | `GET/POST/DELETE /scim-tokens` (admin) — issue/revoke provisioning tokens                                       |
| SCIM v2           | `GET/POST /scim/v2/Users`, `GET/PATCH/DELETE /scim/v2/Users/:id` (Bearer SCIM token)                             |
| Client errors     | `POST /_client-log` (no auth) — frontend posts `window.onerror` / `unhandledrejection` via `sendBeacon`; per-IP rate-limited, routed through the server logger with `source:"client"` and session/user-correlation fields. |

`(mgr)` = manager-level (MANAGER or ADMIN). `(admin)` = ADMIN-only.

## Security notes

### Authentication

- **JWTs** are signed with `JWT_SECRET`. The API refuses to start when `NODE_ENV=production` and `JWT_SECRET` is unset or equal to the default placeholder — use `openssl rand -hex 48` to generate a strong value.
- **API tokens** (`ts_…` prefix) are stored as SHA-256 hashes — a compromised database row can't be used to impersonate the caller. Plaintext is shown exactly once at creation.
- **Token management endpoints require a JWT session** — API-token callers can't mint, list, or revoke tokens, so a leaked token can't be used to create fresh credentials.
- **Email verification** — new signups cannot log in until they verify their email via a tokenized link (24 h TTL, SHA-256 hashed at rest, single-use). Invited, SAML, and SCIM users are auto-verified. Resend is rate-limited and the response is identical for known/unknown emails.
- **Two-factor authentication** — optional TOTP (RFC 6238). The secret is stored per-user; `totpEnabledAt` is `null` until setup is confirmed with a valid code. Login returns a short-lived challenge JWT (5 min) instead of a session when 2FA is active; the full session JWT is only issued after the TOTP code is verified. Disabling 2FA requires the current password.
- **Trusted devices** — when a user checks "Trust this device" during 2FA, an opaque token (`td_` prefix, 256-bit, SHA-256 hashed at rest, 30-day server-side expiry) is issued. On subsequent logins the token is sent via `X-Trust-Token` and validated against `TrustedDevice.tokenHash` + `userId` + `expiresAt`. The token only bypasses the 2FA step — the user's password is still verified. Tokens are revoked on password change, password reset, or 2FA disable; logout does not revoke them.
- **Remember me** — controls JWT lifespan: unchecked = 24 h, checked = 30 d. The flag is forwarded through the 2FA challenge so the session duration is honoured end-to-end.
- **Password reset** wipes the door on both sides: every outstanding JWT for that user is revoked (via `passwordUpdatedAt` compared against the JWT's `iat`), every API token is deleted, and every trusted device token is revoked. If a password leaks, a single reset kicks everyone off the account.
- **Login is timing-neutral** — bcrypt runs even when the email is unknown so response latency can't be used to enumerate accounts.
- **Client error pipeline** (`POST /_client-log`) is **unauthenticated by design** — browsers can't send JWTs on `navigator.sendBeacon`. It's rate-limited per IP, body-capped, and zod-validated. Identity fields (`userId`, `userEmail`, `sessionId`) are **client-asserted and never used for authorization** — only for correlating client errors to backend traces. Authz still lives on the JWT-protected `/api/*` routes.

### Rate limiting

All credential-adjacent endpoints are rate-limited per IP:

| Endpoint              | Window | Max requests |
| --------------------- | ------ | ------------ |
| `POST /auth/login`    | 1 min  | 10           |
| `POST /auth/signup`   | 1 hour | 5            |
| `POST /auth/forgot`   | 1 hour | 5            |
| `POST /auth/reset`    | 1 min  | 10           |
| `POST /auth/invite`   | 1 hour | 30           |
| `GET /auth/invite/:t` | 1 min  | 30           |
| `POST /auth/accept-invite` | 1 min | 10      |
| `POST /auth/verify-email`  | 1 min  | 10           |
| `POST /auth/resend-verification` | 1 hour | 5     |
| `POST /2fa/setup`          | 1 min  | 10           |
| `POST /2fa/confirm-setup`  | 1 min  | 10           |
| `POST /2fa/disable`        | 1 min  | 10           |
| `POST /2fa/authenticate`   | 1 min  | 10           |

When deployed behind a reverse proxy, set `TRUST_PROXY` (e.g. `1` for a single hop) so limits key off the real client IP instead of the proxy.

### Password policy

Applied on signup, password reset, and invite-accept:

- Minimum 10 characters, maximum 128.
- Rejects a small list of common passwords (`password`, `12345678`, `qwerty`, `admin123`, etc).
- Login does not re-validate strength, so pre-policy accounts keep working until their next reset.

### CORS

Set `CORS_ALLOWED_ORIGINS` to a comma-separated list of origins the browser may call from (scheme + host + port). In development, an empty list auto-reflects the request's Origin; in production, an empty list denies all cross-origin requests.

### Other

- **Reset / invite tokens** are cryptographically random 192-bit values, SHA-256 hashed at rest, and single-use. Raw tokens are never logged — only the token row ID is.
- **`devToken` field** in `/auth/forgot`, `/auth/invite`, `/auth/signup`, and `/auth/resend-verification` responses is only populated when `NODE_ENV !== "production"`, so the plaintext never leaks in prod even if the UI would still render it.
- **Expired `PasswordResetToken` and `InviteToken` rows** are swept every 6 hours by a background task (`backend/src/lib/cleanup.ts`), so the tables don't grow unbounded.
- **Attachments** are stored privately in MinIO; downloads go through signed URLs served by `S3_PUBLIC_ENDPOINT`.
- **`.env`** is gitignored by default. Never commit a populated `.env` or `seed.hapster.ts`.
- **All multi-tenant reads** are scoped by `companyId` at the query level (see `backend/src/middleware/scope.ts`). Cross-tenant lookups return 404 (not 403) so existence isn't leaked.
- **`uuid` override in `backend/package.json`.** exceljs 4.4.0 pins `uuid@^8.3.2`, which `npm audit` flags for [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — a missing buffer bounds check in the v3/v5/v6 generators when a `buf` argument is supplied. exceljs only ever calls `v4` and never passes `buf`, so the vulnerable path is unreachable, but `npm audit fix --force` would "resolve" it by downgrading exceljs to 3.4.0 (a breaking change). An `overrides` entry pins the patched `uuid@^11.1.1` under exceljs instead, which keeps the audit clean and still resolves to a CJS build under the `require` condition that exceljs uses. Drop the override once exceljs ships a newer uuid.

## Troubleshooting

- **"Failed to resolve import @dnd-kit/core"** — run `docker compose up -d --build web`. The web image bakes `node_modules` at build time; adding a dependency requires rebuilding.
- **Browser can't reach the API from another device** — set `VITE_API_URL` to your host's LAN IP (not `localhost`) and rebuild the web container.
- **Signed download URLs fail** — `S3_PUBLIC_ENDPOINT` must be the URL the **browser** can hit (host IP + `MINIO_HOST_PORT`), not the in-Docker MinIO address.
- **Port already in use** — override the corresponding `*_HOST_PORT` in `.env`.
- **Seed did nothing on a fresh DB** — check `docker compose logs api | grep Seed`. Every seed step logs either "created" or "skipping".

## Webhooks

Each project can register outbound webhooks under **Project Settings → Webhooks**. Supported events:

| Event                  | Fires when                                                             |
| ---------------------- | ---------------------------------------------------------------------- |
| `run.created`          | a test run is created                                                  |
| `run.completed`        | a test run's status is set to `COMPLETED`                              |
| `run.archived`         | a test run is archived                                                 |
| `execution.passed`     | a legacy (single-status) execution transitions to `PASSED`             |
| `execution.failed`     | a legacy (single-status) execution transitions to `FAILED`             |
| `execution_result.passed` | a per-combo result row transitions to `PASSED`                      |
| `execution_result.failed` | a per-combo result row transitions to `FAILED`                      |
| `jira.bug_created`     | a Jira bug is auto-filed (payload includes `resultId` when the bug was filed per combo) |

Request body:

```json
{
  "event": "execution.failed",
  "projectId": "…",
  "deliveredAt": "2026-04-15T09:00:00.000Z",
  "data": { "executionId": "…", "runId": "…", "caseId": "…", "...": "..." }
}
```

If a signing secret is configured, every request carries
`x-testsuits-signature: <hex>` where `<hex>` is `HMAC-SHA256(secret, rawBody)`.
Every delivery is recorded (status + error) and shown on the webhook row. Use
the **test** button to fire a sample payload at any time.

## Roadmap

- SSO end-to-end against a real IdP — schema, admin UI, and the SP-initiated `/login` + `/acs` routes are shipped; the remaining gap is wiring `@node-saml/node-saml` into [backend/src/routes/saml.ts](backend/src/routes/saml.ts) to verify SAML assertions against the stored x509 cert
- SCIM groups / role-to-group mapping (Users work today)
- Playwright / Cypress reporter packages
- Traceability matrix report
- Test case versioning / history diff

## License

Copyright © 2026 Salah AWAD. All rights reserved.

TestSuits is distributed under the [Business Source License 1.1](LICENSE).

- **Free for** personal use, evaluation, non-commercial projects, and **your
  own internal business operations** (using TestSuits to manage your own
  company's QA).
- **Requires a commercial agreement for** offering TestSuits (or a derivative)
  to third parties as a hosted or managed service — for example, a
  multi-tenant SaaS.

On the Change Date (2030-04-15) this version of the code becomes available
under the Apache License 2.0.

To request a commercial licence, see [COMMERCIAL.md](COMMERCIAL.md) or email
`salah.awad@outlook.com`. Contributions are accepted under DCO sign-off — see
[CONTRIBUTING.md](CONTRIBUTING.md).
