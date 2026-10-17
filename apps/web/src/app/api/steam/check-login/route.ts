import { z } from "zod";
import { jsonError, jsonOk, limitByIp, parseJson } from "@/lib/api";
import { checkSteamLogin } from "@/server/topup/provider";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  login: z
    .string()
    .trim()
    .min(3, "Минимум 3 символа")
    .max(64)
    .regex(/^[A-Za-z0-9_.-]+$/, "Логин Steam: латиница, цифры, _ . -"),
});

/** POST /api/steam/check-login { login } — validates the Steam login through the configured TopupProvider. */
export async function POST(req: Request) {
  const limited = await limitByIp(req, "steam-check-login", 20, 60);
  if (limited) return limited;
  const [body, err] = await parseJson(req, bodySchema);
  if (err) return err;
  try {
    return jsonOk(await checkSteamLogin(body.login));
  } catch (e) {
    console.error("[steam/check-login]", (e as Error).message);
    return jsonError(502, "provider_unavailable", "Сервис проверки логина временно недоступен. Попробуйте позже.");
  }
}
