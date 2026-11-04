export type TypeTableProp = {
  type: string;
  description?: string;
  default?: string;
  required?: boolean;
};

/**
 * Every property with its type, default and description in view at once, stacked so
 * it reads the same on a phone. Fumadocs' own table hides descriptions behind toggles.
 */
export function TypeTable({ type }: { type: Record<string, TypeTableProp> }) {
  return (
    <dl className="not-prose my-6 overflow-hidden rounded-xl border bg-fd-card text-sm">
      {Object.entries(type).map(([name, prop]) => (
        <div key={name} className="border-t px-4 py-3 first:border-t-0">
          <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[13px]">
            <span className="font-medium text-fd-primary">
              {name}
              {prop.required ? null : <span className="text-fd-muted-foreground">?</span>}
            </span>
            <span className="min-w-0 break-words text-fd-muted-foreground">{prop.type}</span>
            {prop.default === undefined ? null : (
              <span className="text-fd-muted-foreground">
                = <span className="text-fd-foreground">{prop.default}</span>
              </span>
            )}
          </dt>
          {prop.description ? (
            <dd className="mt-1 text-fd-muted-foreground leading-relaxed">{prop.description}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
