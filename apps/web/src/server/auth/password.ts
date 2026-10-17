import "server-only";
import { hash, verify } from "@node-rs/argon2";

/** argon2id with library defaults (m=19 MiB, t=2, p=1). Parameters are embedded in the hash. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Used to equalise timing when the user does not exist
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummy ??= hash("dummy-password-for-timing");
  await verifyPassword(await dummy, password);
}
