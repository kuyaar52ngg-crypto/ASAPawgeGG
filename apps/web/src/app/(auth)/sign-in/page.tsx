import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { SignInForm } from "../auth-form";

export const metadata = { title: "Вход" };

export default async function SignInPage() {
  if (await getSessionUser()) redirect("/account");
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
