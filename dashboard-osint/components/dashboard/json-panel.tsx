import { Card, CardHeader } from "@/components/ui/card";

export function JsonPanel({ title, eyebrow, value }: { title: string; eyebrow?: string; value: unknown }) {
  return (
    <Card>
      <CardHeader title={title} eyebrow={eyebrow} />
      <pre className="max-h-[360px] overflow-auto rounded-2xl border border-border bg-black/40 p-3 text-[11px] leading-relaxed text-slate-200 md:text-xs">
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
    </Card>
  );
}
