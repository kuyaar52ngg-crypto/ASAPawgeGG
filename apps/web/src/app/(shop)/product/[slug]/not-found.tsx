import Link from "next/link";
import { PackageX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function ProductNotFound() {
  return (
    <div className="container-page py-16">
      <EmptyState
        icon={<PackageX />}
        title="Товар не найден"
        description="Возможно, он снят с продажи или ссылка устарела. Посмотрите похожие предложения в каталоге."
        action={
          <Button asChild>
            <Link href="/catalog">Перейти в каталог</Link>
          </Button>
        }
      />
    </div>
  );
}
