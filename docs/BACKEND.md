# Backend

A Next.js API on Vercel (Mumbai), with Supabase in India for accounts and data. Merged into the Accel Business web app: the pages (sign-in, dashboard, Accel Bot, KYC) live alongside these routes, and `src/proxy.ts` refreshes the session and guards pages.

## Setup

1. Create a Supabase project in the Mumbai region.
2. In Authentication > Sign In / Providers > Email, turn off **Confirm email**.
3. Run `supabase/migrations/0001_init.sql` and then `0002_kyc.sql` in the SQL editor.
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

1. `POST /api/leads` starts a lead and returns the first question in `nextQuestion`.
2. `POST /api/leads/:id/answers` with `{ questionId, answer }`, where `answer` is the customer's own
   words. The LLM gets one question, its valid options and the answer, and nothing else.
   - `status: "answered"`: the chosen `value` is validated and saved. Show the new `nextQuestion`.
   - `status: "unclear"`: nothing is saved. Show `reason` and ask `nextQuestion` again.
   - The customer's words are never stored. Conversations don't exist on the server.
3. After the profile questions, `recommendation` appears and the stage becomes Needs assessed. Up to 4
   add-on questions follow, and `nextQuestion` is null when they're done.
4. `POST /api/leads/:id/explanation` writes the plain-language reason once per set of answers.
5. `POST /api/leads/:id/quote` with `{ selectedAddOns }` re-prices as the customer ticks add-ons.
6. `POST /api/leads/:id/accept` with `{ selectedAddOns, businessName, contactName, phone }` saves the
   quote, at Quote accepted. Contact details go straight to the database, never to the LLM.

Questions and their options are built from the CSVs at startup. `docs/questions.json` is a snapshot
for reading: refresh it with `npm run questions`.

The LLM can't affect a quote beyond choosing valid options: every value is checked against the
question, and products and prices come only from the recommender. The explanation is told not to
mention prices, and if it does, the recommender's own reasons are used instead.

## API

Errors are `{ "error": { "code", "message" } }`. Signing in sets cookies, so requests need no token.

| Route | Who | Purpose |
| --- | --- | --- |
| `POST /api/auth/signup`, `login`, `logout` | Anyone | Email and password |
| `GET /api/auth/me` | Signed in | Current user and role |
| `GET /api/questions` | Anyone | All questions and options |
| `GET`, `POST /api/leads` | Customer | Tracker list; start a lead |
| `GET /api/leads/:id` | Owner | Resume a lead, with its stage history |
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

- **Catalogue:** edit `product_catalogue.csv` and commit. The deploy restarts everything.
- **Leads:** update `smb_leads.csv`, run `npm run clean-leads`, and commit `training_leads.csv`.
- **Moving away from Supabase Postgres:** SQL is only in `src/lib/leads/repository.ts` and `src/lib/db.ts`.
