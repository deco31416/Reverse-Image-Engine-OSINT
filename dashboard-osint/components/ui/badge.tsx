import { cn, stateTone } from "@/lib/utils";

export function StatusBadge({ value }: { value?: string }) {
  const tone = stateTone(value);
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-full border border-border bg-zinc-900 px-3 text-xs font-semibold text-muted-foreground",
        tone === "ok" && "border-primary/35 text-primary",
        tone === "warn" && "border-chart-4/40 text-chart-4",
        tone === "bad" && "border-destructive/40 text-destructive",
      )}
    >
      <span
        className={cn(
          "status-dot",
          tone === "ok" && "bg-primary",
          tone === "warn" && "bg-chart-4",
          tone === "bad" && "bg-destructive",
        )}
      />
      {value || "unknown"}
    </span>
  );
}
