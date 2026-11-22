# Prospect Audit Tool: Build Spec (for Codex)

You are building an internal sales tool for Incodet (incodet.com), a small agency that sells AI website chatbots, 24/7 AI calling agents and online booking to local service businesses (salons, barbers, roofers, epoxy flooring, dentists) in the USA, UK, Canada and Australia.

The tool takes a business website URL and/or a Google Maps listing, runs automated checks, and produces a one-page branded PDF audit with a missed-revenue estimate. The PDF is attached to cold outreach emails and DMs, so it must look professional, be accurate, and never overstate findings.

Read this whole file before writing code. Build in the phases listed at the bottom. Do not start a later phase until the current phase passes its acceptance checks.

---

## 1. Stack

- Next.js 15 (App Router) + TypeScript (strict) + Tailwind CSS
- Deploy target: Vercel (serverless functions, Node runtime, not Edge)
- PDF: `@react-pdf/renderer` (no headless Chrome in v1)
- HTML parsing: `cheerio`
- Validation: `zod`
- Tests: `vitest`
- No database in v1. Audits are generated on demand. Keep code structured so a DB (Supabase) can be added later.
- Package manager: pnpm

## 2. Environment variables

Create `.env.example` with:

```
APIFY_TOKEN=                  # primary source for Google listing + reviews
APIFY_PLACES_ACTOR=compass~crawler-google-places
APIFY_REVIEWS_ACTOR=compass~Google-Maps-Reviews-Scraper
GOOGLE_PLACES_API_KEY=        # optional fallback, Places API (New)
PAGESPEED_API_KEY=            # PageSpeed Insights API v5
APP_PASSWORD=                 # simple password gate for the internal UI
AGENCY_NAME=Incodet
AGENCY_URL=https://incodet.com
AGENCY_WHATSAPP=              # digits only, used to build https://wa.me/<number>
AGENCY_EMAIL=
```

Every external integration must degrade gracefully: if a key is missing or a call fails, that check returns status `not_checked` with a reason, and the audit still renders.

## 3. Inputs

UI form (single page, password gated via middleware + cookie):

- Website URL (optional)
- Google Maps URL, or business name + city (optional)
- At least one of the two is required
- Niche dropdown: salon, barber, spa, roofing, epoxy_flooring, dentist, other
- Country: US, UK, CA, AU (controls currency: USD, GBP, CAD, AUD)
- Optional overrides for revenue assumptions (see section 6)
- Prospect contact first name (optional, used in PDF greeting)

Resolution logic:
- Listing data comes from Apify first, via `POST https://api.apify.com/v2/acts/{APIFY_PLACES_ACTOR}/run-sync-get-dataset-items?token=...` with `maxCrawledPlacesPerSearch: 1`. Read name, address, website, phone, rating, review count, opening hours, place ID.
- If `APIFY_TOKEN` is missing or the run fails, fall back to Places API (New) Text Search when `GOOGLE_PLACES_API_KEY` is set. Otherwise listing checks are `not_checked`.
- If only a Maps URL or name+city is given, get the website from the listing.
- If only a website is given, search the listing by page `<title>` / domain plus city/country. If name or domain does not match confidently, skip listing checks and mark them `not_checked`.
- Put all Apify calls in `src/lib/clients/apify.ts`. Actor IDs come from env so a broken actor can be swapped without code changes. Map each actor's output into one internal `Listing` and `Review` type so the rest of the app never touches raw actor fields.

## 4. Checks

Each check returns:

```ts
type CheckResult = {
  id: string;
  label: string;              // human readable, shown on PDF
  status: "pass" | "fail" | "partial" | "not_checked";
  confidence: "high" | "medium" | "low";
  evidence: string;           // short plain-English reason, shown on PDF
  details?: Record<string, unknown>;
};
```

Put each check in its own file under `src/lib/checks/` with a pure detection function that takes fetched data as input (so it is unit testable without network).

### 4.1 Online booking
Fetch the homepage HTML plus up to 5 internal pages whose link text or href contains: book, booking, appointment, schedule, reserve, quote, contact. Look for:
- Known booking platforms in script srcs, iframes or links: Calendly, Acuity, Square Appointments, Fresha, Booksy, Vagaro, GlossGenius, Setmore, SimplyBook.me, Mindbody, Boulevard, Phorest, Timely, Treatwell, Zenoti, Jobber, Housecall Pro, ServiceTitan, LeadConnector/GoHighLevel calendars, Google Calendar appointment schedules, Dentrix/NexHealth/Zocdoc for dentists
- Booking forms with date/time inputs
- Pass = embedded or linked self-serve booking. Partial = only a generic contact/quote form. Fail = phone/email only.

### 4.2 Website chatbot / live chat
Detect script srcs, globals or DOM markers for: Intercom, Drift, Tidio, Crisp, tawk.to, LiveChat, Zendesk Chat, HubSpot chat, Freshchat, Olark, LeadConnector chat widget, Podium webchat, Birdeye, Facebook Messenger plugin, Botpress, Voiceflow, Chatbase.
- Also check for a Google Tag Manager container. If GTM is present and no chat is found, set confidence `medium` and evidence "Widgets loaded via Tag Manager may not be visible to this scan".
- Pass = AI/chat widget found. Fail = none found.

### 4.3 Mobile speed
Call PageSpeed Insights API v5 with `strategy=mobile`, `category=performance`.
- Record performance score (0 to 100), LCP, CLS, INP/TBT.
- Pass >= 70, partial 50 to 69, fail < 50.
- Evidence example: "Mobile score 38/100. Page takes about 6.2s to show main content on a phone."
- Timeout 45s. PSI is slow; run it in parallel with other checks.

### 4.4 After-hours contact
Combine:
- Opening hours from Places API (`regularOpeningHours`)
- Whether the site offers any 24/7 channel: online booking (4.1), chatbot (4.2), "24/7" / "after hours" / "emergency" text, SMS/text-us links, AI receptionist markers
- Pass = at least one self-serve channel works outside opening hours. Fail = phone-only and business has fixed hours.
- Compute weekly closed hours from opening hours for use in the revenue model.

### 4.5 Google reviews and response rate
Rating and review count come from the listing.
- Owner response rate: run `APIFY_REVIEWS_ACTOR` for the place, sorted newest, max 30 reviews. Compute % of reviews with an owner response, plus % of 1 to 3 star reviews with a response. Also record the newest unanswered negative review date.
- Places API fallback does not return owner replies, so in fallback mode this check is `not_checked`, evidence "Response rate not checked".
- Fewer than 5 reviews: status `not_checked`, evidence "Too few reviews to judge".
- Pass >= 70% responded, partial 30 to 69%, fail < 30%.

### 4.6 Basic hygiene (small, low weight)
- HTTPS valid
- Mobile viewport meta tag present
- Click-to-call `tel:` link present
- Page title and meta description present

### Fetching rules
- Use a realistic browser User-Agent, 10s timeout per page, max 6 pages per site, follow redirects, respect robots.txt disallow for the paths you fetch.
- Do not scrape Google Maps HTML yourself. Use only Apify actors or Places API.
- Apify runs take 20 to 90 seconds. Start the listing run, reviews run and PageSpeed call in parallel. Use a 120s timeout per Apify call and set route `maxDuration` accordingly. In batch mode, use async runs (`/runs` + poll) instead of run-sync.
- Cache Apify results in memory per place ID for the life of the function to avoid paying twice when the PDF is regenerated after overrides.
- Never throw on a single failed page; record it and continue.

## 5. Score

Overall score 0 to 100, weighted:
- Booking 25, Chatbot 20, After-hours 20, Mobile speed 15, Reviews response 15, Hygiene 5
- `not_checked` checks are excluded and remaining weights re-normalised.
- Grade bands: 80+ "Strong", 60 to 79 "Needs work", below 60 "Losing customers".

## 6. Missed-revenue estimate

This number decides whether the prospect trusts the audit. It must be conservative, shown as a range, and every assumption must be visible.

Model (monthly):

```
missed_after_hours = inquiries_per_month * after_hours_share * (1 - after_hours_capture) * close_rate * avg_ticket
missed_slow_site   = inquiries_per_month * speed_loss_rate * close_rate * avg_ticket   (only if mobile speed fails)
missed_no_booking  = inquiries_per_month * booking_drop_rate * close_rate * avg_ticket  (only if booking fails)
total = sum, then low = total * 0.6, high = total * 1.2
```

- `after_hours_capture` = 0.8 if a chatbot or online booking exists, else 0.
- Store niche presets in `src/config/niches.ts` (avg_ticket in USD, converted by a simple fixed FX table per country in `src/config/currency.ts`). Starting presets, all editable:

| niche | inquiries/mo | after_hours_share | close_rate | avg_ticket USD | speed_loss_rate | booking_drop_rate |
|---|---|---|---|---|---|---|
| salon | 120 | 0.30 | 0.50 | 70 | 0.05 | 0.10 |
| barber | 150 | 0.25 | 0.60 | 35 | 0.05 | 0.10 |
| spa | 90 | 0.30 | 0.45 | 120 | 0.05 | 0.10 |
| roofing | 40 | 0.30 | 0.20 | 8000 | 0.05 | 0.05 |
| epoxy_flooring | 30 | 0.30 | 0.20 | 3500 | 0.05 | 0.05 |
| dentist | 80 | 0.30 | 0.40 | 250 | 0.05 | 0.08 |
| other | 60 | 0.30 | 0.30 | 200 | 0.05 | 0.08 |

- Scale `inquiries_per_month` by review count as a size proxy: `clamp(userRatingCount / median_reviews_for_niche, 0.5, 2.0)`. Put medians in the niche config.
- UI must allow overriding every assumption before generating the PDF.
- Round to clean numbers (nearest 50 for small values, nearest 500 above 10,000).
- The PDF must label it "Estimated" and print the assumptions in small text.

## 7. PDF (one page, A4 for UK/AU, Letter for US/CA)

Layout top to bottom:
1. Header: business name, address, date, "Online Presence Audit". Agency logo placeholder at `public/logo.png` and name from env.
2. Score badge (big number + grade band) and the missed-revenue range in large type: "Estimated revenue at risk: £1,200 to £2,400 / month".
3. Five check rows, each with an icon (green tick, amber, red cross, grey dash for not checked), label, one-line evidence.
4. "Top 3 fixes" box: generated from failed checks in weight order, one sentence each, plain English, outcome-focused (e.g. "Add 24/7 online booking so evening visitors can book instead of leaving").
5. Footer CTA: "Want this fixed? Reply to this email or message us on WhatsApp." with clickable links to AGENCY_URL and `https://wa.me/<AGENCY_WHATSAPP>`, plus small-print assumptions and "Automated scan on <date>. Some widgets may not be detected."

Design: clean, white background, one accent color (configurable in `src/config/brand.ts`), Inter font, generous spacing. Must stay on one page even with long business names (truncate with ellipsis). No em dashes anywhere in generated copy.

File name: `audit-<business-slug>-<yyyy-mm-dd>.pdf`

## 8. API

- `POST /api/audit` body = form input, returns JSON `{ business, checks, score, revenue, fixes }`
- `POST /api/audit/pdf` body = same JSON (after user overrides), returns `application/pdf`
- `POST /api/audit/batch` (phase 3) accepts CSV (columns: name, website, maps_url, city, country, niche, first_name), processes with concurrency 3, returns a ZIP of PDFs plus a `results.csv` summary (business, score, revenue_low, revenue_high, top_issue, email-ready one-line hook).
- Set `maxDuration` on routes so PSI calls do not time out on Vercel.

## 9. UI

- Single page: form on the left, results preview on the right
- Results show each check with evidence, editable revenue assumptions, live-updating estimate, and "Download PDF" button
- Also show a copyable one-line outreach hook generated from the worst finding, e.g. "Ran a quick check on your site: no way to book after 6pm and the mobile page takes 6s to load. Put it in a one-page audit, want me to send it over?"
- Mobile friendly

## 10. Quality bar

- TypeScript strict, no `any` in check logic
- Unit tests for every detector using saved HTML fixtures in `tests/fixtures/` (create fixtures for: a Fresha salon site, a Calendly site, a site with Tidio, a GTM-only site, a phone-only roofing site, a broken site)
- Unit tests for score and revenue maths, including `not_checked` re-normalisation
- All network calls behind a small client module so tests can mock them. Tests must pass with no network access and no API keys.
- README: setup, env vars, how to get each API key, how to deploy to Vercel, known limitations
- Never invent data. If something could not be checked, say so on the PDF.

## 11. Phases

Phase 1: Project scaffold, env handling, fetch layer, detectors 4.1, 4.2, 4.6 with fixtures and tests, `/api/audit` returning JSON for a website-only input. Acceptance: `pnpm test` and `pnpm build` pass.

Phase 2: Apify listing resolution (Places API fallback), 4.3 PageSpeed, 4.4 after-hours, 4.5 reviews via Apify, save one real sample output from each actor in `tests/fixtures/apify/` for mapping tests, scoring, revenue model, UI with overrides. Acceptance: full JSON audit from either input type, tests pass.

Phase 3: PDF generation, PDF download, outreach hook, password gate. Acceptance: PDF renders on one page for 3 fixture audits (save sample PDFs to `samples/`).

Phase 4: Batch CSV to ZIP endpoint and UI upload. Acceptance: 5-row sample CSV produces 5 PDFs and results.csv.

At the end of each phase, list what was built, what is stubbed, and any limitations found.
