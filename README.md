# Prospect Audit

Prospect Audit checks a business website and Google listing, then estimates monthly revenue at risk using editable assumptions.

## Local development

Use Node.js 22 or later and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

If the default pnpm store is unavailable in Codex Cloud, use `pnpm --store-dir /workspace/.pnpm-store install --frozen-lockfile`. Set `APP_PASSWORD` in `.env.local`, then sign in at the homepage to run an audit, edit assumptions, or download a PDF. API clients can sign in with the same password and retain the session cookie:

```sh
curl --fail-with-body -c /tmp/prospect-audit.cookies \
  --data-urlencode "password=$APP_PASSWORD" http://localhost:3000/api/login
curl --fail-with-body -b /tmp/prospect-audit.cookies http://localhost:3000/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"websiteUrl":"https://example.com","niche":"other","country":"US"}'
```

Provide `websiteUrl`, `mapsUrl`, or both `businessName` and `city`. Optional fields are `niche`, `country`, `firstName`, and a partial `assumptions` object. Rates in JSON use fractions from 0 to 1. Invalid input returns HTTP 400. The response includes check evidence, score, revenue, and scan notes. Send that JSON to `POST /api/audit/pdf` to receive a one-page PDF. Modify `revenue.assumptions` before sending it to apply overrides. Checks with insufficient data report `not_checked`.

```sh
pnpm test
pnpm build
```

The tests use saved HTML and mocked responses. They require no network or credentials after dependency installation.

## Environment variables

Copy `.env.example` to `.env.local` to override defaults. Website HTML checks and local tests require no API keys.

| Variable | Purpose |
| --- | --- |
| `APIFY_TOKEN` | Primary listing and review lookup. Create an API token in the [Apify Console integrations settings](https://console.apify.com/settings/integrations). |
| `APIFY_PLACES_ACTOR`, `APIFY_REVIEWS_ACTOR` | Apify actor IDs, prefilled in `.env.example`. |
| `GOOGLE_PLACES_API_KEY` | Fallback for listing data. Enable Places API (New) and create an API-restricted key in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials). |
| `PAGESPEED_API_KEY` | Mobile performance check. Enable PageSpeed Insights API and create an API-restricted key in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials). |
| `APP_PASSWORD` | Required shared password for the app and audit API. |
| `AGENCY_NAME`, `AGENCY_URL`, `AGENCY_WHATSAPP`, `AGENCY_EMAIL` | Branding and contact details. Use digits only for WhatsApp. |

## Vercel

Import the repository as a Next.js project, select a supported Node.js version at or above 22, and use the pnpm lockfile. The route uses the Node.js runtime and declares a 360-second maximum duration to accommodate dependent provider calls. Choose a Vercel plan and runtime configuration that support that duration, and allow outbound access to scanned websites, `api.apify.com`, `places.googleapis.com`, and `www.googleapis.com`. Configure a strong shared `APP_PASSWORD` and use HTTPS.

## Limitations

- The scanner follows redirects and respects robots.txt. It examines the homepage and up to five relevant same-origin links from that page. It uses a 10-second budget per page, public HTTP(S) on standard ports, and a 2 MiB response cap.
- Booking links and chat markers are evidence from HTML. JavaScript-injected widgets may be missed. The scanner does not interact with widgets or submit forms.
- Listing and review lookups prefer Apify. Google Places can provide listing data without owner replies. Short Maps links require Apify unless a business name and city are also supplied.
- Revenue is an estimate based on niche presets, a review-count size proxy when available, fixed currency conversions, and the check results. Weekly closures are reported when hours can be parsed.
- Apify actor contract tests use labeled synthetic data. Live actor responses require configured credentials and outbound access.

Generate the three fixture PDFs with `WRITE_AUDIT_SAMPLES=1 pnpm exec vitest run tests/pdf.test.ts`.

## Batch audits

Use the **Batch audits** form or send the UTF-8 CSV to `POST /api/audit/batch` with your session cookie. Upload it as a multipart `file` or as a raw `text/csv` body. The supported columns are `name,website,maps_url,city,country,niche,first_name`. Each row uses the same input rules as the single-audit API. [samples/leads.csv](samples/leads.csv) contains five fixture leads.

The ZIP contains one PDF per successfully processed row and a `results.csv` in input order. The summary includes business, score, estimated revenue range, top issue, and outreach line. Validation and processing failures appear in the top issue column. Blank scores and estimates indicate insufficient evidence.

The batch runs three audits at a time and uses asynchronous Apify runs. Uploads are limited to 128 KiB and 100 leads. The route requires a Vercel configuration that supports an 800-second function duration. If the processing time limit is reached, the ZIP includes completed PDFs and marks the remaining rows in `results.csv`.
