import { PageViewTracker } from "./page-view-tracker";
import { YandexMetrika } from "./yandex-metrika";

/**
 * Rendered once in the root layout (zone D):
 *  - Yandex Metrika tag (only when a counter id is configured: NEXT_PUBLIC_YM_ID or Setting "analytics.ymId")
 *  - first-party `page_view` tracking on every navigation
 */
export function Analytics() {
  const raw = Number(process.env.NEXT_PUBLIC_YM_ID);
  const envId = Number.isInteger(raw) && raw > 0 ? raw : null;
  return (
    <>
      <YandexMetrika envId={envId} />
      <PageViewTracker />
    </>
  );
}
