/**
 * Runs the whole customer and admin journey against a running site, using the real database,
 * Supabase Auth and LLM from .env.local. Test accounts and their leads are deleted afterwards.
 *
 *   npm run build && npm start     (in one terminal)
 *   npm run e2e                    (in another)
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function browser() {
  const jar = new Map<string, string>();
  return async (method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair!.indexOf("=");
      jar.set(pair!.slice(0, at), pair!.slice(at + 1));
    }
    return { status: response.status, json: await response.json().catch(() => null) };
  };
}

function step(name: string) {
  console.log(`  ok  ${name}`);
}

// Written the way a customer might type, in different words from the options.
const ANSWERS: Record<string, string> = {
  businessType: "we run a small bakery selling bread and cakes",
  employees: "there are about a dozen of us",
  sites: "just the one shop",
  city: "Ludhiana in Punjab",
  hasGstin: "yes we have a GST number",
  currentInternet: "we mostly share a phone hotspot",
  monthlyTelecomSpend: "around 3k a month",
  heavyBandwidth: "no, nothing like that, mostly billing",
};

const stamp = Date.now();
const created: string[] = [];
const signUp = async (user: ReturnType<typeof browser>, email: string) => {
  const result = await user("POST", "/api/auth/signup", { email, password: "e2e-password-1" });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  created.push(result.json.user.id);
};

async function run() {
  const customer = browser();
  const stranger = browser();
  const admin = browser();
  const secondAdmin = browser();

  assert.equal((await customer("GET", "/api/leads")).status, 401);
  step("signed-out requests are refused");

  const questions = (await customer("GET", "/api/questions")).json;
  assert.ok(questions.questions.length > 0);
  step(`questions load (${questions.questions.length})`);

  await signUp(customer, `e2e-customer-${stamp}@example.com`);
  await signUp(stranger, `e2e-stranger-${stamp}@example.com`);
  step("customers can sign up without verifying email");

  const started = await customer("POST", "/api/leads");
  assert.equal(started.status, 201);
  const id: string = started.json.leadId;
  let state = started.json;
  assert.equal(state.stage, null);

  const unclear = await customer("POST", `/api/leads/${id}/answers`, { questionId: state.nextQuestion.id, answer: "banana" });
  assert.equal(unclear.json.status, "unclear", JSON.stringify(unclear.json));
  console.log(`      unclear reason: ${unclear.json.reason}`);
  step("an unclear answer is re-asked with a reason");

  while (state.nextQuestion) {
    const q = state.nextQuestion;
    const answer = ANSWERS[q.id] ?? "no thanks, we don't need that";
    const result = await customer("POST", `/api/leads/${id}/answers`, { questionId: q.id, answer });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.json.status, "answered", `${q.id}: ${JSON.stringify(result.json)}`);
    console.log(`      ${q.id}: "${answer}" -> ${JSON.stringify(result.json.value)}`);
    state = result.json;
  }
  step("natural language answers map to valid options");
  assert.equal(state.stage, "Needs assessed");
  assert.ok(state.recommendation.lines.length > 0);
  assert.ok(!JSON.stringify(state.recommendation).includes('"score"'));
  assert.ok(state.recommendation.flags.every((f: Json) => f.audience === "customer"));
  step(`recommended ${state.recommendation.lines.map((l: Json) => l.name).join(", ")}, with no internal data`);

  const { explanation } = (await customer("POST", `/api/leads/${id}/explanation`)).json;
  assert.ok(explanation?.length > 20);
  console.log(`      ${explanation}`);
  step("explanation written");

  const addOn = state.recommendation.addOns[0]?.productId;
  const ticked = addOn ? [addOn] : [];
  const quote = await customer("POST", `/api/leads/${id}/quote`, { selectedAddOns: ticked });
  assert.equal(quote.status, 200);
  const unknown = await customer("POST", `/api/leads/${id}/quote`, { selectedAddOns: ["NOPE"] });
  assert.deepEqual(unknown.json.removedAddOns.map((a: Json) => a.productId), ["NOPE"]);
  step("picker prices add-ons and leaves out ones that aren't available");

  const bundles: Json[] = state.bundles;
  assert.equal(bundles[0].tier, "recommended");
  for (const b of bundles) console.log(`      ${b.label}: ${b.recommendation.totals.monthlyMin}/month${b.comparison ? ` (${b.comparison})` : ""}`);
  const budget = bundles.find((b) => b.tier === "budget");
  assert.ok(budget, "A micro business should be offered a Budget bundle");
  assert.ok(budget.recommendation.totals.monthlyMin < bundles[0].recommendation.totals.monthlyMin);
  const priced = await customer("POST", `/api/leads/${id}/quote`, { bundle: "budget", selectedAddOns: ticked });
  assert.equal(priced.status, 200, JSON.stringify(priced.json));
  assert.deepEqual(priced.json.recommendation.lines.map((l: Json) => l.productId), budget.recommendation.lines.map((l: Json) => l.productId));
  const offered = bundles.map((b) => b.tier);
  const missing = ["budget", "premium"].find((t) => !offered.includes(t));
  if (missing) assert.equal((await customer("POST", `/api/leads/${id}/quote`, { bundle: missing, selectedAddOns: [] })).json.error.code, "invalid_bundle");
  const selected: string[] = priced.json.selectedAddOns;
  step(`${bundles.length} bundles offered, Recommended first; Budget prices correctly`);

  assert.equal((await stranger("GET", `/api/leads/${id}`)).status, 404);
  assert.equal((await stranger("GET", "/api/admin/leads")).status, 403);
  step("customers can't reach other leads or admin routes");

  assert.equal((await customer("POST", `/api/leads/${id}/accept`, { selectedAddOns: ["NOPE"], bundle: "budget", businessName: "x", contactName: "y", phone: "+91 98765 43210" })).status, 400);
  const contact = { selectedAddOns: selected, bundle: "budget", businessName: "E2E Bakery", contactName: "Test Person", phone: "+91 98765 43210" };
  const accepted = await customer("POST", `/api/leads/${id}/accept`, contact);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  assert.equal(accepted.json.lead.stage, "Quote accepted");
  assert.equal(accepted.json.lead.quote.bundle, "budget");
  assert.deepEqual(accepted.json.lead.quote.lines.map((l: Json) => l.productId), budget.recommendation.lines.map((l: Json) => l.productId));
  assert.equal((await customer("POST", `/api/leads/${id}/accept`, contact)).status, 409);
  step("quote accepted once");

  const login = await admin("POST", "/api/auth/login", { email: env("ADMIN_EMAIL"), password: env("ADMIN_PASSWORD") });
  assert.equal(login.status, 200, "The admin is created at server startup: is the server running with this env?");
  const me = (await admin("GET", "/api/auth/me")).json.user;
  assert.equal(me.isPrimaryAdmin, true);
  step("primary admin exists and can sign in");

  const newAdmin = { email: `e2e-admin-${stamp}@example.com`, password: "e2e-password-2" };
  const made = await admin("POST", "/api/admin/users", newAdmin);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  created.push(made.json.user.id);
  await secondAdmin("POST", "/api/auth/login", newAdmin);
  assert.equal((await secondAdmin("GET", "/api/admin/leads")).status, 200);
  assert.equal((await secondAdmin("POST", "/api/admin/users", { email: `e2e-x-${stamp}@example.com`, password: "e2e-password-3" })).status, 403);
  step("primary admin can create admins; other admins can't");

  const listed = (await admin("GET", "/api/admin/leads")).json.leads.find((l: Json) => l.id === id);
  assert.equal(listed.email, `e2e-customer-${stamp}@example.com`);
  assert.equal((await admin("PATCH", `/api/admin/leads/${id}`, { stage: "Activated" })).status, 409);
  assert.equal((await admin("PATCH", `/api/admin/leads/${id}`, { stage: "KYC complete" })).status, 200);
  assert.equal((await customer("PATCH", `/api/admin/leads/${id}`, { stage: "Activated" })).status, 403);
  step("admin moves stages one step at a time");

  assert.equal((await admin("PATCH", `/api/admin/leads/${id}`, { closeReason: "E2E: not needed" })).status, 200);
  const tracker = (await customer("GET", "/api/leads")).json.leads.find((l: Json) => l.id === id);
  assert.equal(tracker.status, "closed");
  assert.equal(tracker.stage, "KYC complete");
  assert.deepEqual(tracker.history.map((h: Json) => h.stage), ["Needs assessed", "Quote accepted", "KYC complete", "KYC complete"]);
  assert.ok(!JSON.stringify(tracker).includes("E2E: not needed"));
  step("tracker shows history, and closed leads hide the reason");

  await customer("POST", "/api/auth/logout");
  assert.equal((await customer("GET", "/api/leads")).status, 401);
  step("sign-out works");
}

try {
  await run();
  console.log("\nAll checks passed.");
} finally {
  for (const id of created) await supabase.auth.admin.deleteUser(id);
}
