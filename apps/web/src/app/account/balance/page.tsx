import { redirect } from "next/navigation";

// Legacy URL used by the header / payment pages: the balance lives on the top-up page.
export default function BalanceRedirect() {
  redirect("/account/topup");
}
