# Backend

A Next.js API on Vercel (Mumbai), with Supabase in India for accounts and data. Merged into the Accel Business web app: the pages (sign-in, dashboard, Accel Bot, KYC) live alongside these routes, and `src/proxy.ts` refreshes the session and guards pages.

## Setup

1. Create a Supabase project in the Mumbai region.
2. In Authentication > Sign In / Providers > Email, turn off **Confirm email**.
3. Run `supabase/migrations/0001_init.sql`, `0002_kyc.sql` and `0003_lead_language.sql`, in that order, in the SQL editor.
4. Copy `.env.local.example` to `.env.local` and fill it in. Add the same values to the Vercel project.
5. `npm run dev`. The admin account is created the first time the server starts.

`npm test` needs no services. With the site running, `npm run e2e` checks the whole journey against
the real services and deletes its test accounts afterwards.

## Customer journey

```
sign up ─► POST /api/leads ─► answer each question ─► recommendation ─► explanation
                                                                            │
          tracker ◄─ POST /api/leads/:id/accept ◄─ pick add-ons, re-priced ◄┘
```

1. `POST /api/leads` with `{ language }` (`en`, `hi` or `ta`; English if left out) starts a lead and returns the
   first question in `nextQuestion`. Until the first answer, `PATCH /api/leads/:id` with `{ language }` changes it.
2. `POST /api/leads/:id/answers` with `{ questionId, answer }`, where `answer` is the customer's own
   words. The LLM gets one question, its valid options and the answer, and nothing else.
   - `status: "answered"`: the chosen `value` is validated and saved. Show the new `nextQuestion`.
   - `status: "unclear"`: nothing is saved. Show `reason` and ask `nextQuestion` again.
   - The customer's words are never stored. Conversations don't exist on the server.
3. After the profile questions, `recommendation` appears and the stage becomes Needs assessed. Up to 4
   add-on questions follow, and `nextQuestion` is null when they're done.
4. `POST /api/leads/:id/explanation` writes the plain-language reason once per set of answers.
5. The customer picks one of `bundles` (see **Bundle options**). `POST /api/leads/:id/quote` with
   `{ bundle, selectedAddOns }` re-prices as they switch bundle or tick add-ons. It returns that
   bundle's `recommendation`, the `totals`, and `removedAddOns`: ticked add-ons it can't have.
6. `POST /api/leads/:id/accept` with `{ bundle, selectedAddOns, businessName, contactName, phone }` saves the
   quote, at Quote accepted. Contact details go straight to the database, never to the LLM.

Questions and their options are built from the CSVs at startup. `docs/questions.json` is a snapshot
for reading: refresh it with `npm run questions`.

The LLM can't affect a quote beyond choosing valid options: every value is checked against the
question, and products and prices come only from the recommender. The explanation is told not to
mention prices, and if it does, the recommender's own reasons are used instead.

## Bundle options

When the questions are done, `bundles` lists up to three bundles, Recommended first:

| Tier | How it's built |
| --- | --- |
| `recommended` | The model's pick, as before. The explanation is about this one. |
| `budget` | The cheapest internet connection and mobile plan this customer can have, with fewer mobile lines if the segment's price sensitivity allows. |
| `premium` | The next dearer connection and mobile plan. |

- **Price sensitivity:** `data/price_sensitivity.csv` maps each segment code to `high`, `medium`,
  `medium_low` or `low`. It sets the price quoted from each product's catalogue range: the minimum for
  high, a third and two thirds of the way up for medium and medium_low, and the maximum for low,
  rounded to the nearest rupee. Customers see that one price, not the range. It also sets how far
  Budget cuts mobile lines: down to 1 for high, about half for medium, and none otherwise. A segment the file doesn't list counts as medium, and a bad file stops
  startup. Edit it and redeploy, as with the catalogue.
- **Every bundle follows the catalogue rules** and keeps the items included by default. A bundle
  that comes out the same as Recommended is left out, so some customers see only one or two.
- **`comparison`** is a fixed line built from the two bundles, such as "Saves ₹399 a month:
  Biz 5G AirFiber 100 instead of Biz Fibre 100, 1 mobile line instead of 2". It's not written by the
  LLM.
- **`quote` and `accept` take `bundle`** (default `recommended`). Switching bundle can change which
  add-ons are available. `quote` leaves out and lists ones that don't fit, but `accept` refuses them,
  so send the `selectedAddOns` that `quote` returned. A bundle not offered to this customer returns
  400 `invalid_bundle`. The accepted quote records `bundle`.

## Languages

Accel Bot runs in English, Hindi and Tamil (`src/lib/i18n/languages.ts`). Bengali, Marathi, Telugu and Kannada
are listed in the picker as coming soon. The language is stored on the lead and applies to everything the
customer sees: questions, chips, the LLM's replies and explanation, the result screen and the voice.

- **Values stay English.** Answers are stored as the same English values whatever the language, so the
  recommender, the admin views and saved quotes don't change. The LLM maps a Hindi or Tamil answer to an
  English value, and a tapped chip is matched directly without the LLM.
- **Translations are files.** English is the source, in the code. `npm run translate` translates new or
  changed strings with the configured LLM into `data/locales/content/<lang>.json` (questions, options,
  catalogue, the server's sentences) and `data/locales/ui/<lang>.json` (the bot's lines and screens). Each
  entry keeps the English it was made from: a translation of older English is never shown, and
  `npm test` fails until it is redone. Have a native speaker review the diff.
- **After changing customer-facing English** (the bot's copy, the questions or the CSVs): run
  `npm run translate`, then `npm run bot:voice` for the new spoken lines.
- **Voice.** Speech recognition is told the language: the browser via `lang`, ElevenLabs Scribe via
  `language_code`. The ElevenLabs voice speaks only the bot's own lines in each language. The default
  model, Multilingual v2, covers Hindi and Tamil. A browser with no voice for the language stays silent.
- **Adding a language:** see the comment at the top of `src/lib/i18n/languages.ts`.

## API

Errors are `{ "error": { "code", "message" } }`. Signing in sets cookies, so requests need no token.

| Route | Who | Purpose |
| --- | --- | --- |
| `POST /api/auth/signup`, `login`, `logout` | Anyone | Email and password |
| `GET /api/auth/me` | Signed in | Current user and role |
| `GET /api/questions` | Anyone | All questions and options |
| `GET`, `POST /api/leads` | Customer | Tracker list; start a lead |
| `GET /api/leads/:id` | Owner | Resume a lead, with its stage history |
| `PATCH /api/leads/:id` | Owner | `{ language }`, before the first answer |
| `POST /api/leads/:id/answers`, `quote`, `explanation`, `accept` | Owner | The journey above |
| `GET`, `POST /api/leads/:id/kyc` | Owner | Latest KYC result; upload documents (multipart) at Quote accepted |
| `POST /api/kyc/validate` | Admin | Dry-run the KYC engine; stores nothing |
| `GET /api/admin/leads` | Admin | All leads, with internal flags and close reasons |
| `PATCH /api/admin/leads/:id` | Admin | `{ stage }` or `{ closeReason }` |
| `POST /api/admin/users` | Primary admin | Create an admin |

## Stages

Needs assessed, Quote accepted, KYC complete, Activated. The first two follow the customer's actions.
Admins set the others, one step at a time. A closed lead keeps its stage and can't be changed, and
customers see that it's closed but not why.

**KYC:** at Quote accepted the customer uploads documents through `POST /api/leads/:id/kyc`. The
parts are `gst_certificate`, `udyam_certificate`, `signatory_id` and `address_proof`. The signatory ID
and address proof are required, plus at least one of GST or Udyam; the engine's completeness rule
decides this. Images are processed in memory. Only the decision and masked findings (code, severity,
document, message) are stored in `kyc_checks`.
- APPROVE calls `setStage(lead, 'KYC complete', null)`.
- After MANUAL_REVIEW, an admin advances the stage.
- After REJECT, the customer can upload again.

## Accounts

- **Primary admin:** created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` at each cold start if missing.
  Changing the password in the environment later does nothing.
- **Other admins:** only the primary admin can create them.
- **Roles:** held in Supabase `app_metadata`, which users can't change themselves.
- **Tables:** row-level security is on with no policies, so Supabase's public API can't reach them.
  Only the server's connection can.

## LLM

`LLM_PROVIDER` picks the provider at startup: `openrouter` (Gemini 2.5 Flash by default) or `local`
(any OpenAI-style server). See `.env.example`. On Vercel, a local model needs a public URL.

## Data updates

- **Catalogue:** edit `product_catalogue.csv`, run `npm run translate`, and commit. The deploy restarts everything.
- **Leads:** update `smb_leads.csv`, run `npm run clean-leads`, and commit `training_leads.csv`.
- **Moving away from Supabase Postgres:** SQL is only in `src/lib/leads/repository.ts` and `src/lib/db.ts`.

## Admin dashboard

`/admin` (admin accounts only; others are sent to `/dashboard`) covers the last 7, 30 or 90 days
(`?days=`), each compared with the period before.

**Key metrics** have targets, defined in `src/lib/admin/kpis.ts`. "Before" is the old sales-led
process, from `training_leads.csv` (time to activate isn't recorded there, so it's the brief's 3–5 days
to quote plus 10–14 to activate).

| KPI | How it's measured | Before | Target |
|---|---|---|---|
| Lead to activation | Activations in the period ÷ leads whose needs were assessed in the period | 18.6% | ≥ 30% |
| Time to activate | Median days from needs assessed to activated, for activations in the period | ~16 days | ≤ 7 days |
| Accepted quotes activated | Activations in the period ÷ quotes accepted in the period | 42.7% | ≥ 75% |
| KYC approved first time | Share of businesses whose first KYC check in the period was approved | none (paper) | ≥ 80% |

Conversion is a flow, not a cohort: following one period's leads to their outcome makes recent periods
look better or worse than they are, since wins and losses settle at different speeds. Cost of
acquisition and 6-month churn aren't shown, because the app doesn't yet record costs or anything after
activation.

Below them: volume (new leads, activations, monthly revenue won, open pipeline), the stage funnel,
bundles accepted, leads by segment, KYC results and closed leads by reason and stage. Leads that never
finished the profile are left out. Quotes accepted before single prices count at their minimum price.

**Leads to call** lists the open leads the advisor couldn't close: no stage change, close or KYC check
for 3 days or more. It ignores the period and is always as of today. Each one gets a chance to activate
(`src/lib/admin/propensity.ts`), and the top 12 are listed with phone, monthly value and the reasons
behind the score. The score is meant to be simple enough to explain on a call:

1. Base rate: how often a lead at that stage activated in `training_leads.csv` (19% from needs
   assessed, 43% from an accepted quote, 63% after KYC).
2. Profile: the odds are multiplied by how segment, GSTIN and current internet did in those leads
   compared with the average, smoothed so that small groups count less. They're treated as independent,
   which overstates leads that are strong on all three. That's fine for ranking.
3. Judgement calls: the odds halve for every 14 idle days past the 3-day line, and halve again if the
   latest KYC check was rejected. The old leads have no dates or KYC results to learn these from.

High is 40% or more and Medium is 20% or more. The score ranks leads; it isn't calibrated. Retrain it on
the app's own leads once enough of them have settled.

**Demo data:** `npm run seed:demo` adds about 460 made-up leads (real profiles from
`training_leads.csv`, quotes from the real recommender) over the last 180 days, all owned by
`demo-data@accel.example`. Running it again replaces them; `npm run seed:demo -- --remove` deletes that
account and, with it, all of its leads, events and KYC checks. Demo outcomes lean on the same profile
signals as the call score (and leads without a GSTIN fail KYC more often), so the call list's order
means something.
