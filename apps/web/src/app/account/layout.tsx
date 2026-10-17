import { Heart, KeyRound, LayoutDashboard, MessageSquareWarning, Package, ReceiptText, Settings, Star, Store, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { DashboardShell, type NavItem } from "@/components/layout/dashboard-shell";
import { requireUser } from "@/server/auth/session";

// Zone C owns src/app/account/*. Keep requireUser() here — it is the server-side guard.
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/account");
  const nav: NavItem[] = [
    { href: "/account", label: "Обзор", icon: <LayoutDashboard />, exact: true },
    { href: "/account/orders", label: "Заказы и ключи", icon: <Package /> },
    { href: "/account/topup", label: "Пополнение", icon: <Wallet /> },
    { href: "/account/transactions", label: "Транзакции", icon: <ReceiptText /> },
    { href: "/account/favorites", label: "Избранное", icon: <Heart /> },
    { href: "/account/reviews", label: "Мои отзывы", icon: <Star /> },
    { href: "/account/disputes", label: "Споры", icon: <MessageSquareWarning /> },
    { href: "/account/api-keys", label: "API-ключи", icon: <KeyRound /> },
    { href: "/account/settings", label: "Настройки", icon: <Settings /> },
  ];
  if (user.role === "USER") nav.push({ href: "/account/become-seller", label: "Стать продавцом", icon: <Store /> });
  return (
    <>
      <SiteHeader />
      <DashboardShell title="Личный кабинет" nav={nav}>
        {children}
      </DashboardShell>
    </>
  );
}
