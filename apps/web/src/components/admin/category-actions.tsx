"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { ActionDialog, useFieldError } from "./action-dialog";
import { FieldRow, NativeSelect } from "./fields";
import { deleteCategoryAction, saveCategoryAction } from "@/app/admin/categories/actions";

export interface CategoryFormData {
  id?: string;
  name: string;
  slug: string;
  parentId: string;
  icon: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

export function CategoryFormDialog({ category, roots, icons, hasChildren }: { category?: CategoryFormData; roots: { id: string; name: string }[]; icons: readonly string[]; hasChildren?: boolean }) {
  const editing = !!category;
  return (
    <ActionDialog
      trigger={editing ? "Изменить" : "Новая категория"}
      triggerVariant={editing ? "outline" : "default"}
      triggerIcon={editing ? <Pencil /> : <Plus />}
      title={editing ? `Категория «${category.name}»` : "Новая категория"}
      submitLabel={editing ? "Сохранить" : "Создать"}
      success={editing ? "Категория сохранена" : "Категория создана"}
      action={(v) => saveCategoryAction({ id: category?.id, name: v.name, slug: v.slug, parentId: v.parentId, icon: v.icon, description: v.description, sortOrder: v.sortOrder, isActive: v.isActive === "on" })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NameField defaultValue={category?.name ?? ""} />
        <SlugField defaultValue={category?.slug ?? ""} />
        <FieldRow label="Родитель" hint={hasChildren ? "Есть подкатегории — вложить нельзя" : "Пусто — корневая категория"}>
          <NativeSelect name="parentId" defaultValue={category?.parentId ?? ""} disabled={hasChildren}>
            <option value="">— Корневая —</option>
            {roots.filter((r) => r.id !== category?.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </NativeSelect>
        </FieldRow>
        <FieldRow label="Иконка">
          <NativeSelect name="icon" defaultValue={category?.icon ?? ""}>
            <option value="">— нет —</option>
            {icons.map((i) => <option key={i} value={i}>{i}</option>)}
          </NativeSelect>
        </FieldRow>
        <FieldRow label="Порядок сортировки"><Input name="sortOrder" type="number" defaultValue={category?.sortOrder ?? 0} /></FieldRow>
        <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="isActive" defaultChecked={category?.isActive ?? true} className="size-4 accent-[var(--primary)]" /> Показывать на витрине</label>
      </div>
      <FieldRow label="Описание"><Textarea name="description" defaultValue={category?.description ?? ""} maxLength={300} className="min-h-20" /></FieldRow>
    </ActionDialog>
  );
}

function NameField({ defaultValue }: { defaultValue: string }) {
  const error = useFieldError("name");
  return <FieldRow label="Название" error={error}><Input name="name" defaultValue={defaultValue} required minLength={2} maxLength={60} /></FieldRow>;
}
function SlugField({ defaultValue }: { defaultValue: string }) {
  const error = useFieldError("slug");
  return <FieldRow label="Slug (URL)" error={error} hint="Пусто — сформируется из названия"><Input name="slug" defaultValue={defaultValue} placeholder="igry" /></FieldRow>;
}

export function DeleteCategoryButton({ id, name }: { id: string; name: string }) {
  return (
    <ActionDialog trigger="Удалить" triggerIcon={<Trash2 />} title={`Удалить «${name}»?`} description="Удаляются только пустые категории (без товаров и подкатегорий)." submitLabel="Удалить" submitVariant="destructive" success="Категория удалена" action={() => deleteCategoryAction({ id })} />
  );
}
