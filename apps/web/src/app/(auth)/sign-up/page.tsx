import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { SignUpForm } from "../auth-form";

export const metadata = { title: "Регистрация" };

export default async function SignUpPage() {
  if (await getSessionUser()) redirect("/account");
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
