import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { explainRecommendation } from "../src/lib/leads/explain";
import { bundleOptions, chosenBundle, nextQuestion, priceSelection, profileComplete, recommendationFor } from "../src/lib/leads/quote";
import { canAdvance } from "../src/lib/leads/stages";
import { LlmConfigError, LlmError, createLlmClient, type LlmClient } from "../src/lib/llm/client";
import { addOnQuestionId, buildQuestions } from "../src/lib/questions/build";
import { interpretAnswer, parseReply, validValue } from "../src/lib/questions/interpret";
import type { Answers, Question } from "../src/lib/questions/types";
import { TRAINING_COLUMNS } from "../src/lib/recommender/leads";
import { budgetMobileLines, createRecommender, customerView, parseCatalogue, parseLeads, parseSensitivity, type Recommendation } from "../src/lib/recommender";

const ROOT = resolve(import.meta.dirname, "..");
const catalogueCsv = readFileSync(resolve(ROOT, "product_catalogue.csv"), "utf8");
const trainingCsv = readFileSync(resolve(ROOT, "training_leads.csv"), "utf8");
const leads = parseLeads(trainingCsv);
const recommender = createRecommender(parseCatalogue(catalogueCsv), leads, { trees: 12 });
const questionSet = buildQuestions(recommender);
const question = (id: string) => questionSet.questions.find((q) => q.id === id)!;
const addOns = () => questionSet.questions.filter((q) => q.phase === "add_ons");

const profile: Answers = {
  businessType: "Bakery",
  employees: 3,
  sites: 1,
  city: "Ludhiana",
  hasGstin: true,
  currentInternet: "Mobile hotspot",
  monthlyTelecomSpend: null,
  heavyBandwidth: null,
};

/** An LLM that replies from a script and records what it was sent. */
function scripted(...replies: string[]): LlmClient & { sent: string[] } {
  const sent: string[] = [];
  return {
    provider: "test",
    model: "test",
    sent,
    async complete(messages) {
      sent.push(messages.map((m) => m.content).join("\n"));
      const reply = replies.shift();
      if (reply === undefined) throw new Error("No scripted reply left");
      return reply;
    },
  };
}

describe("training data", () => {
  it("holds only the columns the model reads", () => {
    expect(trainingCsv.split(/\r?\n/)[0]!.split(",")).toEqual([...TRAINING_COLUMNS]);
    for (const personal of ["business_name", "gstin", "udyam_number", "contact_name", "contact_role"]) {
      expect(TRAINING_COLUMNS as readonly string[]).not.toContain(personal);
    }
  });
});

describe("questions come from the CSVs", () => {
  it("has one add-on question per add-on, and none for fibre or language", () => {
    const addOns = recommender.catalogue.products.filter((p) => p.role === "add_on");
    expect(questionSet.questions.filter((q) => q.phase === "add_ons").map((q) => q.productId)).toEqual(addOns.map((p) => p.id));
    expect(questionSet.questions.map((q) => q.id)).not.toContain("fibreAvailable");
    expect(questionSet.questions.map((q) => q.id)).not.toContain("preferredLanguage");
  });

  it("follows a catalogue change without any code change", () => {
    const row = `P99,Security,Test Vault,"Secret storage",per account,100,200,0,12,1;2,1,1,N,,1,micro`;
    const changed = createRecommender(parseCatalogue(`${catalogueCsv.trimEnd()}\n${row}\n`), leads, { kind: "frequency" });
    const added = buildQuestions(changed).questions.find((q) => q.productId === "P99");
    expect(added?.question).toBe("Would you like Test Vault? Secret storage.");
    expect(added?.eligibility?.segments).toEqual(["micro"]);
    const asked = `P98,Security,Test Safe,"Locked box",per account,100,200,0,12,1;2,1,1,N,,1,micro,"Do you keep valuables at the shop?"`;
    const withQuestion = createRecommender(parseCatalogue(`${catalogueCsv.trimEnd()}\n${asked}\n`), leads, { kind: "frequency" });
    expect(buildQuestions(withQuestion).questions.find((q) => q.productId === "P98")?.question).toBe("Do you keep valuables at the shop?");
  });

  it("asks every current add-on in the catalogue's plain-language words", () => {
    const addOns = questionSet.questions.filter((q) => q.phase === "add_ons");
    for (const q of addOns) {
      const product = recommender.catalogue.byId.get(q.productId!)!;
      expect(product.customerQuestion).toBeTruthy();
      expect(q.question).toBe(product.customerQuestion);
      expect(q.about).toContain(product.name);
    }
  });

  it("sends the product to the LLM along with the plain question", async () => {
    const llm = scripted(`{"status":"answered","value":"already_have"}`);
    const q = addOns()[0]!;
    await interpretAnswer(llm, q, "we already have one");
    expect(llm.sent[0]).toContain(q.about!);
  });

  it("sends contact details straight to the form, never to the LLM", () => {
    const contact = questionSet.questions.filter((q) => q.phase === "contact");
    expect(contact.length).toBeGreaterThan(0);
    expect(contact.every((q) => q.answerMode === "form")).toBe(true);
    expect(questionSet.questions.filter((q) => q.phase !== "contact").every((q) => q.answerMode === "natural_language")).toBe(true);
  });
});

describe("interpreting an answer", () => {
  it("sends the question, its options and the answer, and returns the chosen option", async () => {
    const llm = scripted(`{"status":"answered","value":"Bakery"}`);
    expect(await interpretAnswer(llm, question("businessType"), "we bake bread and cakes")).toEqual({ status: "answered", value: "Bakery" });
    expect(llm.sent[0]).toContain("we bake bread and cakes");
    expect(llm.sent[0]).toContain(`"value":"Salon"`);
  });

  it("passes on the model's reason when the answer is unclear", async () => {
    const llm = scripted(`{"status":"unclear","reason":"Do you mean home or business broadband?"}`);
    expect(await interpretAnswer(llm, question("currentInternet"), "broadband")).toEqual({ status: "unclear", reason: "Do you mean home or business broadband?" });
  });

  it("re-asks instead of storing a value that isn't valid", async () => {
    expect((await interpretAnswer(scripted(`{"status":"answered","value":"Satellite"}`), question("currentInternet"), "something")).status).toBe("unclear");
    expect((await interpretAnswer(scripted(`{"status":"answered","value":null}`), question("city"), "no idea")).status).toBe("unclear");
    expect((await interpretAnswer(scripted(`{"status":"answered","value":0}`), question("employees"), "none")).status).toBe("unclear");
    expect((await interpretAnswer(scripted(`{"status":"answered","value":2.5}`), question("sites"), "two and a bit")).status).toBe("unclear");
  });

  it("reads JSON wrapped in a code fence, and retries once on junk", async () => {
    const fenced = scripted('```json\n{"status":"answered","value":12}\n```');
    expect(await interpretAnswer(fenced, question("employees"), "a dozen")).toEqual({ status: "answered", value: 12 });
    const retried = scripted("no idea", `{"status":"answered","value":4}`);
    expect(await interpretAnswer(retried, question("employees"), "four")).toEqual({ status: "answered", value: 4 });
    await expect(interpretAnswer(scripted("junk", "junk"), question("employees"), "four")).rejects.toBeInstanceOf(LlmError);
  });

  it("stores canonical values, the customer's own value only where allowed, and null only where skippable", () => {
    expect(validValue(question("city"), "ludhiana")).toBe("Ludhiana");
    expect(validValue(question("city"), "Shillong")).toBe("Shillong");
    expect(validValue(question("currentInternet"), "Shillong")).toBeUndefined();
    expect(validValue(question("hasGstin"), true)).toBe(true);
    expect(validValue(question("hasGstin"), "yes")).toBeUndefined();
    expect(validValue(question("hasGstin"), null)).toBeNull();
    expect(validValue(question("businessType"), null)).toBeUndefined();
    expect(validValue(question("monthlyTelecomSpend"), null)).toBeNull();
    expect(validValue(question("employees"), "12")).toBe(12);
  });
});

describe("when the customer doesn't know", () => {
  it("survives stray text after the JSON, which used to crash", async () => {
    const llm = scripted('{"status":"answered","value":null}\n":null}');
    const result = await interpretAnswer(llm, question("businessType"), "I don't know");
    expect(result).toEqual({ status: "unclear", reason: expect.stringContaining("we do need this one") });
  });

  it("finds the first complete object, ignoring braces inside strings", () => {
    expect(parseReply('Sure! {"status":"unclear","reason":"Use {curly} words"} trailing }')).toEqual({ status: "unclear", reason: "Use {curly} words" });
    expect(parseReply("{not json} then {\"status\":\"answered\",\"value\":3}")).toEqual({ status: "answered", value: 3 });
    expect(parseReply("no object here")).toBeNull();
  });

  it("lets GST, current internet, spend and heavy use be skipped, but not the rest", () => {
    const skippable = questionSet.questions.filter((q) => q.phase === "profile" && q.skipOption).map((q) => q.id);
    expect(skippable).toEqual(["hasGstin", "currentInternet", "monthlyTelecomSpend", "heavyBandwidth"]);
  });

  it("accepts the skip chip's own label", () => {
    expect(validValue(question("hasGstin"), "Not sure")).toBeNull();
    expect(validValue(question("currentInternet"), "not sure")).toBeNull();
    expect(validValue(question("city"), "Not sure")).toBe("Not sure");
  });

  it("gives the model a hint and uses it when the model gives no reason", async () => {
    const llm = scripted(`{"status":"unclear"}`);
    const result = await interpretAnswer(llm, question("employees"), "no clue");
    expect(llm.sent[0]).toContain("A rough estimate is fine");
    expect(result).toEqual({ status: "unclear", reason: expect.stringContaining("A rough estimate is fine") });
    expect(result.status === "unclear" && result.reason).not.toContain("options");
  });

  it("quotes an unsure GST answer as not registered, and says so to the customer", () => {
    const unsure = recommendationFor(recommender, questionSet, { ...profile, hasGstin: null })!;
    const notRegistered = recommendationFor(recommender, questionSet, { ...profile, hasGstin: false })!;
    expect(unsure.lines.map((l) => l.productId)).toEqual(notRegistered.lines.map((l) => l.productId));
    expect(unsure.flags.find((f) => f.code === "gstin_unconfirmed")).toMatchObject({ audience: "customer" });
    expect(notRegistered.flags.some((f) => f.code === "gstin_unconfirmed")).toBe(false);
  });

  it("quotes without the current internet type when it's unknown", () => {
    const quote = recommendationFor(recommender, questionSet, { ...profile, currentInternet: null })!;
    expect(quote.lines.length).toBeGreaterThan(0);
  });
});

describe("question flow", () => {
  it("asks the profile questions in order, then add-ons", () => {
    expect(nextQuestion(questionSet, {}, null)?.id).toBe("businessType");
    expect(nextQuestion(questionSet, { businessType: "Bakery" }, null)?.id).toBe("employees");
    expect(profileComplete(questionSet, profile)).toBe(true);
    const next = nextQuestion(questionSet, profile, recommendationFor(recommender, questionSet, profile));
    expect(next?.phase).toBe("add_ons");
  });

  it("stops after the add-on limit", () => {
    let answers: Answers = profile;
    let asked = 0;
    for (;;) {
      const next = nextQuestion(questionSet, answers, recommendationFor(recommender, questionSet, answers));
      if (!next) break;
      expect(next.phase).toBe("add_ons");
      answers = { ...answers, [next.id]: asked % 2 ? "no" : "not_sure" };
      asked += 1;
      expect(asked).toBeLessThanOrEqual(questionSet.maxAddOnQuestions);
    }
    expect(asked).toBeGreaterThan(0);
  });

  it("applies add-on answers: yes recommends it, and already having it counts as no", () => {
    const addOn = recommender.recommend({ businessType: "Bakery", employees: 3, sites: 1, cityTier: 2, hasGstin: true }).addOns[0]!;
    const id = addOnQuestionId(addOn.productId);
    const wanted = recommendationFor(recommender, questionSet, { ...profile, [id]: "yes" })!;
    expect(wanted.addOns.find((a) => a.productId === addOn.productId)?.recommendation).toBe("stated_need");
    const has = recommendationFor(recommender, questionSet, { ...profile, [id]: "already_have" })!;
    expect(has.addOns.find((a) => a.productId === addOn.productId)?.recommendation).toBeNull();
  });

  it("quotes an unknown city on the strictest tier and says it's unconfirmed", () => {
    const quote = recommendationFor(recommender, questionSet, { ...profile, city: "Shillong" })!;
    const tierTwo = recommendationFor(recommender, questionSet, profile)!;
    expect(quote.flags.find((f) => f.code === "city_unconfirmed")).toMatchObject({ audience: "customer" });
    expect(quote.lines.map((l) => l.productId)).toEqual(tierTwo.lines.map((l) => l.productId));
    expect(tierTwo.flags.some((f) => f.code === "city_unconfirmed")).toBe(false);
  });
});

describe("what customers and the LLM can see", () => {
  const full = recommendationFor(recommender, questionSet, { ...profile, hasGstin: false })!;
  const view = customerView(full);

  it("removes internal flags, model scores and the fibre question", () => {
    expect(full.flags.some((f) => f.audience === "internal")).toBe(true);
    expect(view.flags.every((f) => f.audience === "customer")).toBe(true);
    const text = JSON.stringify(view);
    expect(text).not.toContain('"score"');
    expect(text).not.toContain('"support"');
    expect(view.openQuestions.some((q) => q.key === "fibreAvailable")).toBe(false);
  });

  it("never gives the explanation model internal flags or prices", async () => {
    const llm = scripted("This bundle suits your bakery.");
    expect(await explainRecommendation(llm, profile, view)).toBe("This bundle suits your bakery.");
    expect(llm.sent[0]).not.toContain("Sort out documents");
    expect(llm.sent[0]).not.toContain("monthlyMin");
  });

  it("falls back to the recommender's reasons if the explanation mentions a price", async () => {
    const text = await explainRecommendation(scripted("It only costs ₹999 a month."), profile, view);
    expect(text).not.toContain("999 a month");
    expect(text).toContain(view.lines[0]!.name);
  });
});

describe("bundle options", () => {
  const sensitive = createRecommender(parseCatalogue(catalogueCsv), leads, { trees: 12 }, parseSensitivity(readFileSync(resolve(ROOT, "data/price_sensitivity.csv"), "utf8")));
  const set = buildQuestions(sensitive);
  const answersFor = (businessType: string, employees: number, sites = 1): Answers => ({ ...profile, businessType, employees, sites, city: "Mumbai" });
  const options = (answers: Answers) => bundleOptions(sensitive, set, answers)!;
  const mobileLines = (r: Recommendation) => r.lines.find((l) => l.role === "mobile")!.quantity;

  it("reads price sensitivity per segment from the CSV, with medium for anything unlisted", () => {
    expect(["micro", "prof", "multi", "mfg"].map((s) => sensitive.priceSensitivity(s))).toEqual(["high", "medium", "medium_low", "low"]);
    expect(sensitive.priceSensitivity("new_segment")).toBe("medium");
    expect(recommender.priceSensitivity("micro")).toBe("medium");
    expect(() => parseSensitivity("segment,price_sensitivity\nmicro,very")).toThrow(/must be one of/);
  });

  it("cuts mobile lines by sensitivity: down to 1, about half, or not at all", () => {
    expect([10, 3, 1].map((n) => budgetMobileLines("high", n))).toEqual([1, 1, 1]);
    expect([10, 3, 1].map((n) => budgetMobileLines("medium", n))).toEqual([5, 2, 1]);
    expect([10, 3].map((n) => budgetMobileLines("medium_low", n))).toEqual([10, 3]);
    expect([10, 3].map((n) => budgetMobileLines("low", n))).toEqual([10, 3]);
  });

  it("puts Recommended first, Budget cheaper and Premium dearer, all different", () => {
    for (const answers of [answersFor("Salon", 6), answersFor("Law office", 12), answersFor("Gym chain", 60, 6), answersFor("Packaging unit", 40)]) {
      const [first, ...rest] = options(answers);
      expect(first!.tier).toBe("recommended");
      expect(first!.comparison).toBeNull();
      for (const option of rest) {
        const delta = option.recommendation.totals.monthly - first!.recommendation.totals.monthly;
        expect(option.tier === "budget" ? delta < 0 : delta > 0).toBe(true);
        expect(option.comparison).toMatch(option.tier === "budget" ? /^Saves ₹/ : /more a month/);
      }
      expect(new Set(rest.map((o) => o.tier)).size).toBe(rest.length);
    }
  });

  it("gives the most price-sensitive segment the deepest Budget cut", () => {
    const micro = options(answersFor("Salon", 6));
    const budget = micro.find((o) => o.tier === "budget")!;
    expect(mobileLines(budget.recommendation)).toBe(1);
    expect(budget.comparison).toContain("1 mobile line instead of");
    const mfg = options(answersFor("Packaging unit", 40));
    const mfgBudget = mfg.find((o) => o.tier === "budget");
    if (mfgBudget) expect(mobileLines(mfgBudget.recommendation)).toBe(mobileLines(mfg[0]!.recommendation));
  });

  it("only offers products the catalogue allows in every bundle", () => {
    for (const option of options(answersFor("Law office", 12))) {
      for (const line of option.recommendation.lines) {
        const product = sensitive.catalogue.byId.get(line.productId)!;
        expect(product.targetSegments).toContain(option.recommendation.segment);
      }
    }
  });

  it("keeps the city and GST notes on every bundle", () => {
    for (const option of options({ ...answersFor("Salon", 6), city: "Shillong", hasGstin: null })) {
      expect(option.recommendation.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["city_unconfirmed", "gstin_unconfirmed"]));
    }
  });

  it("refuses a bundle this customer isn't offered", () => {
    const answers = answersFor("Salon", 6);
    const offered = options(answers).map((o) => o.tier);
    const missing = (["budget", "premium"] as const).find((t) => !offered.includes(t));
    if (missing) expect(() => chosenBundle(sensitive, set, answers, missing)).toThrow(expect.objectContaining({ status: 400, code: "invalid_bundle" }));
    expect(chosenBundle(sensitive, set, answers, "recommended")?.tier).toBe("recommended");
  });

  it("prices a bundle and drops ticked add-ons it doesn't allow", () => {
    const answers = answersFor("Law office", 12);
    const [recommended, ...rest] = options(answers);
    const ticked = recommended!.recommendation.addOns.slice(0, 3).map((a) => a.productId);
    for (const option of rest) {
      const priced = priceSelection(option.recommendation, [...ticked, "NOPE"], sensitive.catalogue);
      expect(priced.removedAddOns.map((a) => a.productId)).toContain("NOPE");
      expect(priced.selectedAddOns.every((id) => option.recommendation.addOns.some((a) => a.productId === id))).toBe(true);
    }
  });

  it("still shows quotes saved before mobile plans had alternatives", () => {
    const { mobileAlternatives: _dropped, ...saved } = recommendationFor(recommender, questionSet, answersFor("Law office", 12))!;
    expect(customerView(saved as never).mobileAlternatives).toEqual([]);
  });
});

describe("lead stages", () => {
  it("lets admins move a lead one step, only after the quote is accepted", () => {
    expect(canAdvance("Quote accepted", "KYC complete")).toBe(true);
    expect(canAdvance("KYC complete", "Activated")).toBe(true);
    expect(canAdvance("Needs assessed", "Quote accepted")).toBe(false);
    expect(canAdvance("Quote accepted", "Activated")).toBe(false);
    expect(canAdvance("Activated", "KYC complete")).toBe(false);
    expect(canAdvance(null, "KYC complete")).toBe(false);
  });
});

describe("LLM providers", () => {
  let server: Server;
  let baseUrl: string;
  const requests: { auth?: string; body: { model: string; response_format?: unknown } }[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      let data = "";
      request.on("data", (chunk) => (data += chunk));
      request.on("end", () => {
        requests.push({ auth: request.headers.authorization, body: JSON.parse(data) });
        if (request.headers.authorization === "Bearer bad") {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: { message: "Invalid key" } }));
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "hello" } }] }));
      });
    });
    await new Promise<void>((done) => server.listen(0, done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => server.close());

  it("uses OpenRouter with Gemini 2.5 Flash by default", async () => {
    const llm = createLlmClient({ OPENROUTER_API_KEY: "key", OPENROUTER_BASE_URL: baseUrl });
    expect(llm.provider).toBe("openrouter");
    expect(await llm.complete([{ role: "user", content: "hi" }], { json: true })).toBe("hello");
    expect(requests.at(-1)).toMatchObject({ auth: "Bearer key", body: { model: "google/gemini-2.5-flash-lite", response_format: { type: "json_object" } } });
  });

  it("switches to a local model on the env variable, with no key needed", async () => {
    const llm = createLlmClient({ LLM_PROVIDER: "local", LOCAL_LLM_BASE_URL: baseUrl, LOCAL_LLM_MODEL: "llama3" });
    expect(llm.provider).toBe("local");
    await llm.complete([{ role: "user", content: "hi" }]);
    expect(requests.at(-1)?.auth).toBeUndefined();
    expect(requests.at(-1)?.body.model).toBe("llama3");
  });

  it("can turn JSON mode off for local servers that reject it", async () => {
    const llm = createLlmClient({ LLM_PROVIDER: "local", LOCAL_LLM_BASE_URL: baseUrl, LOCAL_LLM_MODEL: "m", LOCAL_LLM_JSON_MODE: "false" });
    await llm.complete([{ role: "user", content: "hi" }], { json: true });
    expect(requests.at(-1)?.body.response_format).toBeUndefined();
  });

  it("explains what's missing or wrong", async () => {
    expect(() => createLlmClient({})).toThrow(LlmConfigError);
    expect(() => createLlmClient({ LLM_PROVIDER: "local" })).toThrow("LOCAL_LLM_MODEL");
    expect(() => createLlmClient({ LLM_PROVIDER: "other" })).toThrow("must be one of");
    const bad = createLlmClient({ OPENROUTER_API_KEY: "bad", OPENROUTER_BASE_URL: baseUrl });
    await expect(bad.complete([{ role: "user", content: "hi" }])).rejects.toThrow("Invalid key");
  });
});
