export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensurePrimaryAdmin } = await import("./lib/auth/session");
  const { createLlmClient } = await import("./lib/llm/client");

  // Don't touch the CSVs here: this also runs inside the proxy function, whose bundle doesn't
  // include them (outputFileTracingIncludes only applies to routes). The recommender is built
  // lazily on first use, and `npm run build` checks the catalogue up front (scripts/check-data.ts).
  await ensurePrimaryAdmin();
  try {
    const llm = createLlmClient();
    console.log(`LLM provider: ${llm.provider} (${llm.model})`);
  } catch (error) {
    console.error("The assistant won't work until this is fixed:", error);
  }
}
