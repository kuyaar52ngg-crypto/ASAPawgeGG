import { PLATFORMS, REGIONS } from "@asap/shared";

export interface ActivationGuide {
  title: string;
  steps: string[];
  note?: string;
}

const PLATFORM_LABEL = (v: string | null) => PLATFORMS.find((p) => p.value === v)?.label ?? v ?? "";

/**
 * Generic "how to receive / activate" instructions by product type + platform.
 * A product may override this with `attributes.activation` (string[]) set by the seller.
 */
export function getActivationGuide(p: { type: string; deliveryMode: string; platform: string | null; region: string | null; attributes?: unknown }): ActivationGuide {
  const custom = (p.attributes as { activation?: unknown } | null)?.activation;
  const regionNote = p.region && p.region !== "GLOBAL" ? `Регион товара — ${REGIONS.find((r) => r.value === p.region)?.label ?? p.region}. Убедитесь, что он подходит вашему аккаунту: изменить регион после активации нельзя.` : undefined;
  if (Array.isArray(custom) && custom.every((s) => typeof s === "string") && custom.length > 0) {
    return { title: "Как активировать", steps: custom as string[], note: regionNote };
  }

  const receive = p.deliveryMode === "AUTO_STOCK" ? "Оплатите заказ — данные появятся в личном кабинете (раздел «Мои заказы») сразу после оплаты и придут на email." : p.deliveryMode === "AUTO_PROVIDER" ? "Оплатите заказ — система выполнит пополнение автоматически, обычно за 1–5 минут. Статус виден в разделе «Мои заказы»." : "Оплатите заказ и укажите данные для выдачи — продавец выполнит заказ вручную, статус виден в разделе «Мои заказы».";

  switch (p.type) {
    case "KEY":
      if (p.platform === "STEAM")
        return { title: "Как активировать ключ Steam", steps: [receive, "Откройте клиент Steam и войдите в аккаунт.", "Меню «Игры» → «Активировать продукт в Steam».", "Введите полученный ключ и подтвердите — игра появится в библиотеке."], note: regionNote };
      if (p.platform === "XBOX")
        return { title: "Как активировать код Xbox", steps: [receive, "Откройте redeem.microsoft.com или приложение Xbox и войдите в аккаунт Microsoft.", "Введите 25-значный код и подтвердите.", "Скачайте игру из библиотеки Xbox / Microsoft Store."], note: regionNote };
      if (p.platform === "NINTENDO")
        return { title: "Как активировать код Nintendo", steps: [receive, "Откройте Nintendo eShop на консоли и выберите «Ввести код».", "Введите код из личного кабинета.", "Загрузите игру — она появится на главном экране."], note: regionNote };
      return { title: `Как активировать ключ ${PLATFORM_LABEL(p.platform)}`.trim(), steps: [receive, `Откройте клиент ${PLATFORM_LABEL(p.platform) || "платформы"} и найдите пункт активации кода.`, "Введите полученный ключ и подтвердите активацию."], note: regionNote };
    case "ACCOUNT":
      return { title: "Как получить доступ", steps: [receive, "Данные аккаунта (логин и пароль) придут в личный кабинет.", "Войдите в аккаунт на консоли и скачайте игру. Не меняйте данные аккаунта и не включайте двухфакторную защиту без согласования с продавцом."], note: regionNote };
    case "SUBSCRIPTION":
      return { title: "Как активировать подписку", steps: [receive, "Следуйте инструкции продавца в карточке заказа — это может быть код, ссылка-приглашение или доступ к аккаунту.", "Если требуется приглашение на вашу почту — убедитесь, что ввели корректный адрес."], note: regionNote };
    case "TOPUP":
      return { title: "Как работает пополнение", steps: ["Укажите логин Steam (тот, что вы вводите при входе, не email и не никнейм).", receive, "Деньги поступят на кошелёк Steam — проверьте баланс в клиенте или на сайте магазина."], note: "Пополнение можно выполнить на любой аккаунт по логину — пароль не требуется. Логин нельзя исправить после оплаты." };
    case "GIFT_CARD":
      return { title: "Как использовать подарочную карту", steps: [receive, `Откройте магазин ${PLATFORM_LABEL(p.platform) || "платформы"} и перейдите к вводу кода.`, "Введите код — сумма зачислится на кошелёк."], note: regionNote ?? "Регион карты должен совпадать с регионом вашего аккаунта." };
    case "CURRENCY":
      return { title: "Как получить валюту", steps: [receive, "Укажите UID/ник игрового аккаунта при оформлении.", "Продавец пополнит аккаунт и отметит заказ выполненным."], note: regionNote };
    default:
      return { title: "Как получить товар", steps: [receive, "Если нужна помощь с активацией — напишите продавцу из карточки заказа или в поддержку."], note: regionNote };
  }
}
