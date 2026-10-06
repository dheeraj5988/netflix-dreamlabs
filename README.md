# Dream Labs Solutions: Netflix Household Updater

Customers enter their mobile number and either

* **Update Household** gets the latest Netflix "Update Primary Location" link from their own Gmail inbox, or
* **TV Login** has the server confirm the TV code on Netflix as their own Netflix account.

There is no account picker. Each customer is tied to a **Netflix ID** (the email of their Netflix account) on their row in the
database, and that ID decides the Gmail inbox and the cookies that are used. The Netflix ID is never shown to customers.

The admin console is at `/admin`.

## How a customer is linked to their Netflix account

| Customer row | Used for |
| --- | --- |
| `mobile` | what the customer types |
| `netflix_email` (Netflix ID) | which Gmail inbox the household link is read from, and which vault cookies sign the TV in |
| `expiry_date` | access stops after this date |

Several Netflix IDs usually share one Gmail inbox (`name+4@gmail.com`, `name+5@gmail.com`, `na.me@gmail.com` all land in
`name@gmail.com`). The household lookup therefore only uses emails **addressed to the customer's own Netflix ID**, so one customer
can never receive another account's link.

## Setup

### 1. Database (Supabase)

This app can share a Supabase project with tetra-household. Everything it creates is prefixed `dl_` (`dl_subscribers`,
`dl_accounts`, `dl_activations`, `dl_settings`, function `dl_record_tv_login`, schema `dl_private`) and nothing of tetra's is touched.

1. Supabase > SQL Editor > run [`supabase/migrations/20261006_dreamlabs_v1.sql`](supabase/migrations/20261006_dreamlabs_v1.sql).
   It is safe to run again. The last query should list four tables with `rls_enabled = true` and `anon_access = false`.
2. Load customers either with the admin console (**Customers > Paste Sheet / Upload CSV**) or by running a seed SQL file.

### 2. Environment variables (Vercel)

See [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | same values as tetra-household if you share the project |
| `ADMIN_PASSWORD` | admin console passcode (`ADMIN_SESSION_SECRET` is optional) |
| `CRON_SECRET` | protects the keepalive endpoint |
| `GMAIL_USER_1` / `GMAIL_APP_PASSWORD_1`, `_2`, `_3` ... | one pair per Gmail **inbox** (see below) |

**Gmail inboxes.** Use the real inbox address (no `+tag`) and a Google *App password*. A Netflix ID is matched to the inbox with the
same Gmail address, ignoring `+tags` and dots. For example, `yourname+4@gmail.com`, `yourname+5@gmail.com` and
`YourName@gmail.com` all use the `GMAIL_USER_n=yourname@gmail.com` pair. The admin **Netflix IDs** tab lists every
Netflix ID, tells you which inboxes are still missing, and has a **Test Gmail** button.

### 3. Keepalive (TV login cookies)

Vercel runs a daily cron. For the every-6-hours refresh, add the GitHub Actions secret `CRON_SECRET` and the variable `KEEPALIVE_URL`
(`https://<your-domain>/api/cron/keepalive-cookies`).

## Importing customers

Paste three columns from Google Sheets / Excel (or upload a CSV):

```
NETFLIX ID                         MOBILE NUMBER      EXPIRY
yourname@gmail.com                 91 98765 43210     12-Oct-26
yourname+4@gmail.com               91 91234 56789     15-Jan-27
```

* The mobile number may carry `91`/`+91` and spaces. The expiry may be `14-Jan-27`, `14/01/2027` or `2027-01-14`.
* A mobile number that **already exists is updated** with the new Netflix ID and expiry (a renewal on a new account). Its block flag,
  TV counter and history stay.
* Rows with no mobile number (empty seats) are skipped. If a number appears twice, the later expiry wins.

## TV login cookies

Admin > **Cookie Vault** > Add Account Cookies: paste the cookie JSON for a Netflix account and enter the **same Netflix ID** the
customers have. Adding cookies for an ID already in the vault replaces them. The server loads `netflix.com/tv2` as that account, submits
the customer's code and reports success only if Netflix accepts it. A rejected code or logged-out cookies does not count towards the
monthly limit.

## Development

```bash
pnpm install
cp .env.example .env.local   # fill in the values
pnpm dev
```

`/api/health` reports which environment variables and tables are present (never any data).
