/** Next.js startup hook: fail fast on example secrets in a public production deployment. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionSecrets } = await import("@/server/startup-checks");
  assertProductionSecrets();
}
