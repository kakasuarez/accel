# Bundle recommender

Recommends a base bundle and a ranked add-on picker for a business. Everything is built when the
server starts, from two files:

- **`product_catalogue.csv`**: the source of truth for products, prices and what's allowed.
- **`training_leads.csv`**: past leads with personal columns removed, used to train the model and work
  out quantities and rates. `npm run clean-leads` recreates it from `smb_leads.csv`, which is never
  committed or deployed.

Nothing about any product is written in the code, and a test fails if a product id appears in `src/`.

## How a recommendation is made

```
profile ──► segment ──► catalogue rules ──► allowed products ──► random forest ranks them
                                                                     │
                     link + mobile plan + core items  ◄──────────────┤
                     add-on picker, recommended first ◄──────────────┘
```

1. **Segment** comes from the business type, using the table in the leads. Three or more sites
   means multi-site, except for manufacturers. Unknown types use keywords, then size.
2. **Catalogue rules filter first.** These are absolute: `target_segments`, city tier, minimum
   employees and sites, GSTIN, fibre availability and `requires_one_of`. The model can only choose
   from what's left, so it can't repeat a past sale the catalogue forbids.
3. **The model picks** the link and the mobile plan with the highest score. Heavy bandwidth moves up
   to the next faster, dearer allowed link.
4. **Core items** are add-ons at least 90% of a segment buys, such as email for professional offices.
5. **The picker** holds every other add-on the customer can buy. Stated needs are recommended first,
   then the model's top picks, up to the median real add-on count. Nothing is pre-selected, and the
   customer chooses. `priceWithAddOns` prices the selection, including longer contracts or installs.

If a customer asks for something they can't have, it appears in `blocked` with a reason. If no link
is allowed, the result says so with the `no_eligible_link` flag (2 of 5,000 leads: manufacturers
without a GSTIN).

## The model

**A random forest, one per product,** predicting "would this customer buy this?". Each is trained
only on activated leads allowed to buy that product. It's seeded, so results are repeatable.

A single "which bundle" classifier wouldn't work: the 368 sales contain 227 distinct product sets.

**Features:** employees, sites, city tier, GSTIN, current spend, spend per employee, staff per site,
segment, current internet and business type. Missing spend uses the segment's median.

Decision tree, random forest, extra trees, gradient boosting, logistic regression and k-nearest
neighbours were compared, and random forest was the most consistent. A single decision tree was
clearly worse. Adding turnover, provider and Udyam, using per-segment models, or training only on
retained customers didn't help.

### Results

Out of sample, on activated leads the model didn't train on. `npm run evaluate` reproduces this.
The baseline gives each customer their segment's most-bought options.

| | Link | Mobile plan | Mobile, prof offices | Add-on precision | Bundle F1 |
| --- | --- | --- | --- | --- | --- |
| Baseline, cross-validated | 0.752 | 0.788 | 0.435 | 0.424 | 0.603 |
| **Random forest, cross-validated** | **0.733** | **0.856** | **0.616** | **0.439** | **0.622** |
| Baseline, trained Apr–May, tested June | 0.733 | 0.787 | 0.400 | 0.428 | 0.599 |
| **Random forest, trained Apr–May, tested June** | **0.705** | **0.827** | **0.511** | **0.461** | **0.616** |

How to read this:

- **The clear win is the mobile plan,** because current spend really does relate to it.
- **Add-ons are a small gain** of 1.5–3 points, about the size of the noise between folds.
- **The link is slightly worse than the baseline** by about 2–3 points. Fibre speed is close to
  random in this data.
- **Multi-site always gets Biz Fibre 300,** the only link with catalogue-legal sales in that segment.
- **Leaf size was tuned on the same folds,** so cross-validated figures are a little optimistic. The
  June split wasn't used for tuning.
- **Accuracy here means matching past sales,** not proven suitability. Stated needs can't be tested
  because the leads don't record them, and dropped leads have no bundle on record.

Other checks: no catalogue violations across all 5,000 leads; the picker holds 97% of add-ons really
sold from about 9 options; quantities are exact 66% of the time and within 1 for 83%; and base
bundle plus recommended add-ons has a median value of 1.02× real deals (p10 0.58, p90 1.69).

To use the baseline instead: `createRecommender(catalogue, leads, { kind: "frequency" })`.

### Explaining a recommendation

A forest doesn't produce plain-language reasons. Each item's `why` therefore uses the catalogue
description, plus take-up among similar customers when the model recommended it. `score` is the
model's estimate, useful for ranking but not a promise to show customers.

## Changing the catalogue

Edit `product_catalogue.csv` and restart the server. There's no build step, and the model retrains
on start, which takes a few seconds.

| Change | What happens |
| --- | --- |
| Prices, setup, contract, install days, names, descriptions | Used immediately |
| Tiers, staff or site minimums, GSTIN, dependencies, target segments | Enforced immediately, and the model retrains on the new rules |
| Remove a product | Gone. Its past sales are ignored |
| Add a product | Available straight away, not recommended until it has sales |
| Broken file or missing column | The server refuses to start, with a clear error |

Files saved from Excel or other tools work, including any line ending and a byte-order mark.

**How roles are worked out for new rows:**

- **Mobile plan:** unit is `per line`.
- **Link:** category `Connectivity`, unit `per site`, and empty `requires_one_of`.
- **Add-on:** everything else.
- **Fibre:** the name or description mentions fibre, and not "without fibre".
- **Speed:** read from text like "300 Mbps".

So a new product needs to follow those conventions. A new link in another category would be treated
as an add-on.

**Limits to expect:**

- New products have no sales, so they only appear in the picker and alternatives. They're chosen as
  the link only if nothing else is allowed. They're recommended once leads record sales.
- Questions and reasons come from a template and the catalogue wording, not hand-written copy, so the
  AI layer should reword them. `Would you like Static IP? Fixed public IP...` is the raw form.
- Tier and segment rules for the flags (tier 2 fibre, first-time connection) are written for today's
  tiers and segments. A new segment code needs leads before anyone can be classified into it.

## Flags

Only show flags with `audience: "customer"`. Internal ones quote churn and conversion rates.

| Flag | Audience | Evidence |
| --- | --- | --- |
| `retention_risk_first_business_link` | Internal | Churn 23% (41/179) vs 4% (3/69), micro and prof |
| `kyc_risk_no_gstin` | Internal | 5% (30/577) activated vs 24% (338/1,397) from needs assessment |
| `tier2_fibre_delivery_risk` | Internal | 51% (126/245) vs 75% (205/274) activated after KYC. Leased-line manufacturers show no gap |
| `fibre_unconfirmed`, `long_install`, `second_site_not_covered`, `no_eligible_link`, `segment_inferred` | Customer | Guidance, not statistics |

Rates are recalculated from the leads at each start.

## Decisions

- **The catalogue is the source of truth,** including `target_segments`. 91 of the 368 sold bundles
  include a product the catalogue doesn't allow, 43 of them Biz Fibre 100 at multi-site businesses.
  Those sales are excluded from what's learned for that product.
- **Add-ons are the customer's choice.** Nothing is added automatically.
- **Two-site businesses** are parked: they get what history shows (one link) plus a flag.
- **No mobile-only option,** as that's a product decision outside this work.

## What the data doesn't support

- **`products_of_interest`:** spread evenly across each segment's targeted products, with no link to
  what's bought or to conversion.
- **Affordability rules:** the estimated price against current spend doesn't predict "Price too
  high". Real quotes aren't recorded, so this is a proxy.
- **Churn by product:** nothing survives correction for multiple tests (churn AUC 0.58).

## Using it from Next.js

`docs/BACKEND.md` covers how the site uses the recommender. Call it from server code only, and send
customers and the LLM `customerView(result)`, never the raw result.
