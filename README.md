# Dream Labs Solutions: Netflix Household Updater

Customers enter their mobile number and either

* **Update Household** gets the latest Netflix "Update Primary Location" link from their own Gmail inbox, or
* **TV Login** has the server confirm the TV code on Netflix as their own Netflix account, or
* **Buy Plan** pays for a subscription online with PayPur (UPI), then sends them to WhatsApp with their order details.

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
2. For online purchase, also run [`supabase/migrations/20261007_dreamlabs_payments.sql`](supabase/migrations/20261007_dreamlabs_payments.sql)
   (adds `dl_orders` and the PayPur key columns). It is safe to run again.
3. Load customers either with the admin console (**Customers > Paste Sheet / Upload CSV**) or by running a seed SQL file.

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

## Online purchase (PayPur)

Plans (4K UHD, 1 Device): **3 Months ₹449, 6 Months ₹798, 1 Year ₹1498** (in [`lib/plans.ts`](lib/plans.ts)). The price always comes
from the server, never from the browser.

1. Run the payments SQL (above).
2. Admin > **Settings > Online Purchase (PayPur)**: paste the **Paypur Gateway Key** (PayPur's API key) and **Paypur Gateway Salt**
   (its signing secret) from PayPur > API & SDK > Credentials. They are stored in `dl_settings` (service role only); the admin console
   only ever shows the last 4 characters of the key and never the salt. The card also lists the two return URLs this site gives PayPur.
3. The Buy Plan tab is now live. A customer whose number is not found or whose plan has expired also sees *"You can buy a subscription
   directly"*.

Flow: the server creates an order and a signed PayPur payment (`POST /api/merchant/init`), the customer pays by UPI, PayPur sends them
back to `/api/paypur/callback/success|failure`, the server verifies the callback signature
(`HMAC_SHA256(txn_id|order_id|status|amount, salt)`) and the amount, and `/buy/result` shows the result and opens **WhatsApp** with the
order details. A callback that cannot be verified is confirmed with PayPur's status API for the transaction PayPur issued for that
order, and one transaction can pay only one order. In the admin **Orders** tab, **Activate** opens the customer form with the number and
expiry filled in (you add the Netflix ID), **Check status** asks PayPur again and **Mark paid** is for a payment you confirmed in the
PayPur dashboard.

Optional env vars: `SITE_URL` (public https URL used for the return URLs; defaults to the request's host) and `PAYPUR_BASE_URL`
(only for a sandbox, default `https://upi.paypur.in`).

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
