import { cn } from "@/lib/utils";

export function Card({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("bento-card", className)}>{children}</section>;
}

export function CardHeader({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="metric-label mb-1">{eyebrow}</p> : null}
        <h2 className="admin-card-title">{title}</h2>
      </div>
      {action}
    </div>
  );
}
