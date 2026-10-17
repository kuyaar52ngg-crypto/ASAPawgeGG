import { requireRole } from "@/server/auth/session";
import { env } from "@/lib/env";
import { AI_PROVIDER_OPTIONS, loadSettings } from "@/server/admin/settings";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "@/components/admin/settings-form";
import { SelectSetting, TextSetting, ToggleSetting } from "@/components/admin/settings-fields";

export const metadata = { title: "Админка · Настройки" };
export const dynamic = "force-dynamic";

const configured = (ok: boolean) => (ok ? <Badge variant="success">ключи заданы</Badge> : <Badge variant="warning">ключи не заданы</Badge>);

export default async function AdminSettingsPage() {
  await requireRole("ADMIN");
  const s = await loadSettings();
  const envYm = process.env.NEXT_PUBLIC_YM_ID;

  return (
    <>
      <PageHeader title="Настройки площадки" description="Хранятся в таблице Setting; каждое изменение пишется в аудит-лог" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Комиссии и холд</CardTitle><CardDescription>Применяются к новым заказам. Индивидуальная комиссия продавца (раздел «Продавцы») приоритетнее общей.</CardDescription></CardHeader>
          <CardContent>
            <SettingsForm section="commission">
              <TextSetting name="commissionPercent" label="Комиссия площадки по умолчанию, %" defaultValue={s.commissionPercent} inputMode="decimal" hint="Доля с каждой продажи, которую получает площадка" />
              <TextSetting name="holdDays" label="Холд средств продавца, дней" defaultValue={s.holdDays} inputMode="numeric" hint="Через сколько дней после выдачи деньги становятся доступны к выводу" />
              <TextSetting name="steamFeePercent" label="Комиссия за пополнение Steam, %" defaultValue={s.steamFeePercent} inputMode="decimal" hint="Наценка в калькуляторе на странице «Пополнение Steam»" />
            </SettingsForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>AI</CardTitle><CardDescription>Провайдер и модель для модерации, споров, сводок и чата. Ключи задаются переменными окружения.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>OpenAI {configured(!!env.ai.openaiKey)}</span>
              <span>Claude {configured(!!env.ai.anthropicKey)}</span>
              <span>OpenRouter {configured(!!env.ai.openrouterKey)}</span>
            </div>
            <SettingsForm section="ai">
              <SelectSetting name="aiProvider" label="Провайдер" defaultValue={s.aiProvider} options={AI_PROVIDER_OPTIONS} hint="Если ключа нет, система автоматически работает в режиме mock" />
              <TextSetting name="aiModel" label="Модель" defaultValue={s.aiModel} placeholder="gpt-4o-mini / claude-haiku-4-5 / openai/gpt-4o-mini" hint="Пусто — модель по умолчанию у провайдера" />
              <TextSetting name="aiThreshold" label="Порог автопубликации товаров (0–100)" defaultValue={s.aiThreshold} inputMode="numeric" hint="Товар с вердиктом «Одобрить» и оценкой не ниже порога публикуется без ручной модерации" />
            </SettingsForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Платёжные методы</CardTitle><CardDescription>Включение/выключение способов оплаты на чекауте и при пополнении баланса</CardDescription></CardHeader>
          <CardContent>
            <SettingsForm section="payments" booleans={["PLATEGA", "ROLLYPAY", "BALANCE", "SANDBOX"]}>
              <ToggleSetting name="PLATEGA" label="Platega (СБП, карты)" defaultChecked={s.payments.PLATEGA} badge={configured(env.platega.configured)} description="Без ключей метод скрыт на чекауте" />
              <ToggleSetting name="ROLLYPAY" label="RollyPay" defaultChecked={s.payments.ROLLYPAY} badge={configured(env.rollypay.configured)} description="Без ключей метод скрыт на чекауте" />
              <ToggleSetting name="BALANCE" label="Оплата с баланса сайта" defaultChecked={s.payments.BALANCE} />
              <ToggleSetting name="SANDBOX" label="Тестовая оплата (sandbox)" defaultChecked={s.payments.SANDBOX} badge={<Badge variant="outline">только разработка</Badge>} description="В продакшене доступна, лишь пока не настроены реальные шлюзы" />
            </SettingsForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Яндекс Метрика</CardTitle><CardDescription>Счётчик подключается на всех публичных страницах: Вебвизор, карта кликов, ecommerce</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            {envYm && <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs">Задана переменная окружения NEXT_PUBLIC_YM_ID={envYm} — она приоритетнее значения ниже.</p>}
            <SettingsForm section="analytics">
              <TextSetting name="ymId" label="ID счётчика" defaultValue={s.ymId} inputMode="numeric" placeholder="12345678" hint="Пусто — Метрика отключена. Админ-панель никогда не отслеживается." />
            </SettingsForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
