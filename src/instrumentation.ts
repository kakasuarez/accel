export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getRecommender } = await import("./lib/recommender");
  const { ensurePrimaryAdmin } = await import("./lib/auth/session");
  const { createLlmClient } = await import("./lib/llm/client");

  getRecommender(); // A bad catalogue stops startup here.
  await ensurePrimaryAdmin();
  try {
    const llm = createLlmClient();
    console.log(`LLM provider: ${llm.provider} (${llm.model})`);
  } catch (error) {
    console.error("The assistant won't work until this is fixed:", error);
  }
}
