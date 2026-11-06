# Backend

A Next.js API on Vercel (Mumbai), with Supabase in India for accounts and data. There's no frontend yet.

## Setup

1. Create a Supabase project in the Mumbai region.
2. In Authentication > Sign In / Providers > Email, turn off **Confirm email**.
3. Run `supabase/migrations/0001_init.sql` in the SQL editor.
4. Copy `.env.example` to `.env.local` and fill it in. Add the same values to the Vercel project.
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
| `GET /api/admin/leads` | Admin | All leads, with internal flags and close reasons |
| `PATCH /api/admin/leads/:id` | Admin | `{ stage }` or `{ closeReason }` |
| `POST /api/admin/users` | Primary admin | Create an admin |

## Stages

Needs assessed, Quote accepted, KYC complete, Activated. The first two follow the customer's actions.
Admins set the others, one step at a time. A closed lead keeps its stage and can't be changed, and
customers see that it's closed but not why.

**KYC later:** all stage changes go through `setStage` in `src/lib/leads/repository.ts`, with a null
`changedBy` for automatic changes, so a KYC module can call it directly.

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
