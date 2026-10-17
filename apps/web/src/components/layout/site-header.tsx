import Link from "next/link";
import { Suspense } from "react";
import { ShoppingCart, Wallet } from "lucide-react";
import { formatRub } from "@asap/shared";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/server/auth/session";
import { getCategoryTree } from "@/server/categories";
import { getCartCount } from "@/server/cart-count";
import { Logo } from "./logo";
import { SearchBar } from "./search-bar";
import { CatalogMenu } from "./catalog-menu";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { MobileNav } from "./mobile-nav";

export async function SiteHeader() {
  const user = await getSessionUser();
  const [categories, cartCount] = await Promise.all([getCategoryTree().catch(() => []), getCartCount(user?.id)]);

  return (
    <header className="glass sticky top-0 z-40 border-x-0 border-t-0">
      <div className="container-page flex h-16 items-center gap-1 sm:gap-3">
        <MobileNav categories={categories} />
        <Logo className="mr-1" />
        <CatalogMenu categories={categories} />
        <div className="mx-2 hidden max-w-xl flex-1 md:block">
          <Suspense fallback={<div className="skeleton h-11 w-full" />}>
            <SearchBar />
          </Suspense>
        </div>
        <nav className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <Button asChild variant="ghost" size="sm" className="hidden xl:inline-flex">
            <Link href="/steam">Пополнение Steam</Link>
          </Button>
          <ThemeToggle />
          <Button asChild variant="ghost" size="icon" className="relative" aria-label="Корзина">
            <Link href="/cart">
              <ShoppingCart />
              {cartCount > 0 && (
                <span className="gradient-brand absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-5 font-bold text-white">{cartCount > 99 ? "99+" : cartCount}</span>
              )}
            </Link>
          </Button>
          {user ? (
            <>
              <Button asChild variant="glass" size="sm" className="hidden sm:inline-flex">
                <Link href="/account/balance"><Wallet /> {formatRub(user.balance)}</Link>
              </Button>
              <UserMenu user={{ name: user.name, email: user.email, image: user.image, role: user.role, balance: user.balance }} />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm"><Link href="/sign-in">Войти</Link></Button>
              <Button asChild size="sm" className="hidden sm:inline-flex"><Link href="/sign-up">Регистрация</Link></Button>
            </>
          )}
        </nav>
      </div>
      <div className="container-page pb-3 md:hidden">
        <Suspense fallback={<div className="skeleton h-11 w-full" />}>
          <SearchBar />
        </Suspense>
      </div>
    </header>
  );
}
