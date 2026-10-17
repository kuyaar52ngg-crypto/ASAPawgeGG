"use client";
import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useRunAction, type AnyActionResult } from "./use-run-action";

type Values = Record<string, string>;

/**
 * Button → dialog with arbitrary form fields (uncontrolled inputs with `name`) → server action.
 * The action receives a plain `Record<string,string>` (checkboxes: "on" when checked); validate it with zod on the server.
 */
export function ActionDialog({
  trigger,
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerIcon,
  title,
  description,
  submitLabel = "Сохранить",
  submitVariant = "default",
  success,
  action,
  children,
  wide,
}: {
  trigger: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerIcon?: React.ReactNode;
  title: string;
  description?: string;
  submitLabel?: string;
  submitVariant?: ButtonProps["variant"];
  success?: string;
  action: (values: Values) => Promise<AnyActionResult>;
  children?: React.ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[] | undefined>>({});
  const { run, pending } = useRunAction();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Values = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string") values[k] = v;
    setError(null);
    setFieldErrors({});
    run(() => action(values), {
      success,
      onDone: () => setOpen(false),
      onError: (r) => {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          {triggerIcon}
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className={wide ? "max-w-2xl" : undefined}>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FieldErrorsContext.Provider value={fieldErrors}>{children}</FieldErrorsContext.Provider>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" variant={submitVariant} loading={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const FieldErrorsContext = React.createContext<Record<string, string[] | undefined>>({});
/** Error text for a field of the surrounding <ActionDialog>. */
export function useFieldError(name: string): string | undefined {
  return React.useContext(FieldErrorsContext)[name]?.[0];
}
