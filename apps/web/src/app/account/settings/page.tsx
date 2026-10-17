import { requireUser } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordForm, ProfileForm } from "@/components/cabinet/account-forms";

export const metadata = { title: "Настройки" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser("/account/settings");
  return (
    <>
      <PageHeader title="Настройки" description="Данные профиля и безопасность аккаунта." />
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Профиль</CardTitle><CardDescription>Имя отображается в вашем кабинете и в отзывах (частично скрыто).</CardDescription></CardHeader>
          <CardContent><ProfileForm name={user.name ?? ""} email={user.email} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Смена пароля</CardTitle><CardDescription>Используйте уникальный пароль, которого нет на других сайтах.</CardDescription></CardHeader>
          <CardContent><PasswordForm /></CardContent>
        </Card>
      </div>
    </>
  );
}
