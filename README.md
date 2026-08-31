# SSL Billing — GST Freight Invoicing

Tax invoicing, multi-LR consignment billing, payment receipts and customer statements
for Shree Sanwariya Logistics.

- **Frontend:** React 19 + Vite + Tailwind v4 (semantic design tokens, light/dark)
- **Backend:** Express (runs on Node locally, and on Cloudflare Workers in production)
- **Database:** Supabase (PostgREST + Storage), accessed with the service-role key

## Run locally

```bash
npm install
cp .env.example .env      # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, ADMIN_*
npm run dev               # http://localhost:3000
```

With no Supabase credentials the app falls back to a local JSON store at `data/app_db.json`,
so you can develop entirely offline.

## Deploy to Cloudflare Workers (terminal only)

**1. Authenticate.** Either sign in interactively (opens a browser once):

```bash
npx wrangler login
```

…or, for a fully headless/CI setup, create an API token at
*dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"*
and export it:

```bash
export CLOUDFLARE_API_TOKEN=xxxxxxxx
export CLOUDFLARE_ACCOUNT_ID=xxxxxxxx   # only needed if the token covers several accounts
npx wrangler whoami                      # confirm it works
```

**2. Push the secrets** (reads `.env`, pipes each value on stdin — nothing is echoed):

```bash
./scripts/cf-secrets.sh --dry-run   # see what will be sent
./scripts/cf-secrets.sh             # actually push
npx wrangler secret list            # verify
```

**3. Deploy:**

```bash
npm run cf:deploy      # vite build && wrangler deploy
```

Wrangler prints the live URL (`https://ssl-billing.<subdomain>.workers.dev`). Afterwards:

```bash
npx wrangler tail                     # live logs
npx wrangler deployments list         # history
npx wrangler rollback                 # revert to the previous version
```

`wrangler.jsonc` serves `dist/` from Cloudflare's edge cache and routes only `/api/*`
into the Worker. `placement.mode = "smart"` runs the Worker near Supabase rather than
near the visitor, which matters because each API request makes several DB round-trips.

`npm run cf:dev` runs the production build locally under the Workers runtime
(secrets come from `.dev.vars`, which is gitignored).

### Troubleshooting

**"The request to Cloudflare's API timed out."** — usually not a network problem. Wrangler
prints that when the *asset upload* is slow on a weak uplink, and it can also mask the real
error. Re-run with debug logging to see the actual API response:

```bash
WRANGLER_LOG=debug WRANGLER_SEND_METRICS=false npx wrangler deploy
```

The first deploy uploads every asset (~170 s on a slow link); later deploys only send changed
files, so they take seconds.

**"Uncaught TypeError: require_streams(...) is not a function" (error 10021)** — already fixed,
but here is why. `iconv-lite@0.4` ends with `require("./streams")(iconv)`, calling a module as a
function; esbuild's CJS interop breaks that and the Worker fails to boot. Express reaches
iconv-lite only through body-parser/raw-body, which use three functions, so
`worker/iconv-lite-shim.cjs` reimplements them on the native `TextDecoder` and
`wrangler.jsonc` aliases the package to it for the Workers build only. Node (`npm run dev`)
still uses the real iconv-lite. Side benefit: the bundle lost iconv-lite's encoding tables,
dropping the upload from 1731 KiB to 1207 KiB (gzip 412 KB → 220 KB).

If you add another dependency that fails to boot the same way, check the debug log for the
offending `require_*(...)` and either alias it or replace it with a Workers-native equivalent.

### Custom domain

```bash
npx wrangler deploy --route "billing.yourdomain.com/*"
```

The domain must already be a zone on the same Cloudflare account.

## Design system

`src/index.css` defines every colour as a semantic token (`surface`, `ink`, `accent`,
`positive`, …) and re-points those same tokens for dark mode, so components never hard-code
a colour and both themes stay consistent. `src/components/ui.tsx` holds the shared
primitives (Button, Modal, DataTable, Field, StatCard…). Rules baked in:

- touch targets ≥ 44px, focus rings never removed, `prefers-reduced-motion` respected
- text contrast verified at ≥ 4.5:1 in **both** themes (accent fills use a darker shade
  because `#EA580C` only reaches 3.55:1 against white)
- `DataTable` renders a real table on desktop and stacked cards on phones — no horizontal
  scrolling, and a bottom tab bar replaces the sidebar below `lg`

## Supabase schema (production database)

The app talks to Supabase via PostgREST. If the hosted tables are missing a column the app
writes (for example `customers.contact_person` or `invoices.lr_items`), Supabase answers
`PGRST204 … column … in the schema cache`. The server now **drops the unknown column, retries,
and logs a warning** so saving keeps working — but the value is not persisted (for customers it
is folded into `notes`).

To store every field properly, run the idempotent migration once in the Supabase SQL editor:

```
supabase/migrations/20260829_add_missing_columns.sql
```

It adds `customers.contact_person / whatsapp / shipping_address / credit_limit / notes`,
`invoices.lr_items` (multiple LRs on one bill), `invoices.vehicle_no`, and refreshes the
PostgREST schema cache.

## Multi-LR billing

One tax invoice can cover several LRs / bilties. Each line has its own LR number, date, route,
weight, rate and freight; total freight is the sum of the lines. The lines are stored in
`invoices.lr_items` and printed as a "Consignment Details" table on the PDF. Older single-LR
invoices continue to work unchanged.
