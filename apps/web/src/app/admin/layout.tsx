import { BarChart3, ClipboardList, FolderTree, LayoutDashboard, Percent, ScrollText, Settings, ShieldCheck, ShoppingBag, Sparkles, Store, Users, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/layout/site-header";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireRole } from "@/server/auth/session";

// Zone D owns src/app/admin/*. Keep requireRole("ADMIN") — server-side guard (every page and action re-checks it too).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("ADMIN");
  return (
    // `ym-hide-content`: Yandex Metrika Webvisor must never record back-office screens
    <div className="ym-hide-content">
      <SiteHeader />
      <DashboardShell
        title="Админка"
        nav={[
          { href: "/admin", label: "Метрики", icon: <LayoutDashboard />, exact: true },
          { href: "/admin/analytics", label: "Трафик и события", icon: <BarChart3 /> },
          { href: "/admin/users", label: "Пользователи", icon: <Users /> },
          { href: "/admin/sellers", label: "Продавцы", icon: <Store /> },
          { href: "/admin/products", label: "Модерация товаров", icon: <ShieldCheck /> },
          { href: "/admin/orders", label: "Заказы", icon: <ShoppingBag /> },
          { href: "/admin/disputes", label: "Споры и возвраты", icon: <ClipboardList /> },
          { href: "/admin/payouts", label: "Выплаты", icon: <Wallet /> },
          { href: "/admin/categories", label: "Категории", icon: <FolderTree /> },
          { href: "/admin/promocodes", label: "Промокоды", icon: <Percent /> },
          { href: "/admin/ai-logs", label: "AI-логи", icon: <Sparkles /> },
          { href: "/admin/audit", label: "Аудит-лог", icon: <ScrollText /> },
          { href: "/admin/settings", label: "Настройки", icon: <Settings /> },
        ]}
      >
        {children}
      </DashboardShell>
    </div>
  );
}
