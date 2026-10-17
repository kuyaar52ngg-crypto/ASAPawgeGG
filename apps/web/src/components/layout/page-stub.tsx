import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Temporary placeholder for pages that a feature zone will implement. Remove usage when the real page lands. */
export function PageStub({ zone, title, description }: { zone: string; title: string; description?: string }) {
  return (
    <div className="container-page py-10">
      <h1 className="mb-2 text-2xl font-bold sm:text-3xl">{title}</h1>
      {description && <p className="mb-6 text-muted-foreground">{description}</p>}
      <Card>
        <CardContent className="flex items-center gap-4 pt-6 sm:pt-6">
          <span className="flex size-12 items-center justify-center rounded-xl bg-warning/15 text-warning"><Construction className="size-6" /></span>
          <p className="text-sm text-muted-foreground">Раздел в разработке (зона {zone}). Страница-заглушка от фундамента.</p>
        </CardContent>
      </Card>
    </div>
  );
}
