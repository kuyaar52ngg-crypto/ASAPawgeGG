"use client";
import Link from "next/link";
import { Heart, LogOut, Package, ShieldCheck, Store, User, Wallet } from "lucide-react";
import { formatRub, type RoleName } from "@asap/shared";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/avatar";
import { signOutAction } from "@/server/auth/actions";

export interface HeaderUser {
  name: string | null;
  email: string;
  image: string | null;
  role: RoleName;
  balance: number;
}

const ROLE_LABEL: Record<RoleName, string> = { USER: "Покупатель", SELLER: "Продавец", ADMIN: "Администратор" };

export function UserMenu({ user }: { user: HeaderUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full p-0.5 pr-1 transition hover:bg-foreground/5 focus-visible:outline-2" aria-label="Меню пользователя">
          <UserAvatar name={user.name ?? user.email} image={user.image} className="size-9" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-3 py-2.5">
          <p className="truncate text-sm font-semibold">{user.name ?? user.email}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <p className="mt-1 text-[11px] font-semibold tracking-wide text-primary uppercase">{ROLE_LABEL[user.role]}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Личный кабинет</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/account"><User /> Личный кабинет</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/orders"><Package /> Мои заказы</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/favorites"><Heart /> Избранное</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/balance"><Wallet /> Баланс · {formatRub(user.balance)}</Link>
        </DropdownMenuItem>
        {(user.role === "SELLER" || user.role === "ADMIN") && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/seller"><Store /> Кабинет продавца</Link>
            </DropdownMenuItem>
          </>
        )}
        {user.role === "ADMIN" && (
          <DropdownMenuItem asChild>
            <Link href="/admin"><ShieldCheck /> Админка</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild destructive>
            <button type="submit" className="w-full"><LogOut /> Выйти</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

