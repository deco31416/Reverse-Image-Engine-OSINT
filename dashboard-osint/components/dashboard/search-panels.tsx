"use client";

import type { ElementType } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarClock, Database, Eye, FileText, FolderOpen, Link2, SearchCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SearchItem = {
  id?: string;
  _id?: string;
  searchId?: string;
  query?: string;
  status?: string;
  resultCount?: number;
  clusterLetter?: string;
  createdAt?: string;
  updatedAt?: string;
  enhancedImageUrl?: string;
  scores?: Record<string, unknown>;
};

export function normalizeSearchItems(payload: any): SearchItem[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.searches)) return payload.searches;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function getSearchId(item: SearchItem | undefined) {
  return item?.searchId || item?.id || item?._id;
}

export function statusLabel(value?: string) {
  const normalized = String(value || "").toLowerCase();
  const labels: Record<string, string> = {
    completed: "completado",
    processing: "procesando",
    queued: "en cola",
    running: "buscando",
    cancelled: "cancelada",
    pending: "pendiente",
    failed: "fallido",
    error: "error",
    active: "activo",
  };
  return labels[normalized] || value || "caso";
}

export function SearchResultPanel({
  apiBase,
  result,
  onLoad,
}: {
  apiBase: string;
  result?: SearchItem;
  onLoad: (searchId: string) => void;
}) {
  const searchId = getSearchId(result);
  const query = result?.query || "Sin investigación creada";
  const createdAt = formatDate(result?.createdAt);

  return (
    <Card className="xl:col-span-5">
      <CardHeader title="Tu investigación" action={result?.status ? <StatusBadge value={statusLabel(result.status)} /> : null} />
      {searchId ? (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-border bg-black p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border text-primary">
                <SearchCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-black text-foreground">{query}</p>
                <p className="mt-1 text-xs text-muted-foreground">Caso guardado en tu espacio.</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <ResultFact label="Fecha" value={createdAt} icon={CalendarClock} />
            <ResultFact label="Estado" value={statusLabel(result?.status)} icon={SearchCheck} />
            <ResultFact label="Hallazgos" value={String(result?.resultCount ?? "-")} icon={Database} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" onClick={() => onLoad(searchId)}>
              <Link2 className="h-4 w-4" />
              Abrir caso
            </Button>
            <Button variant="secondary" asChild>
              <a href={reportHref(apiBase, searchId, "pdf")} target="_blank" rel="noreferrer">
                <FileText className="h-4 w-4" />
                Descargar PDF
              </a>
            </Button>
          </div>
          <details className="rounded-xl border border-border bg-black">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted-foreground">Más acciones</summary>
            <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
              <SearchDetailDialog item={result || {}} triggerLabel="Ver detalles" />
              <Button variant="secondary" asChild>
                <a href={reportHref(apiBase, searchId, "markdown")} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" />Reporte en texto</a>
              </Button>
            </div>
          </details>
        </div>
      ) : (
        <EmptySearchState />
      )}
    </Card>
  );
}

export function RecentSearchesPanel({
  payload,
  onLoad,
}: {
  payload: any;
  onLoad: (searchId: string) => void;
}) {
  const searches = normalizeSearchItems(payload);
  const total = Number(payload?.total ?? searches.length);

  return (
    <Card className="xl:col-span-12">
      <CardHeader title="Investigaciones recientes" action={<span className="text-sm font-semibold text-muted-foreground">{total} casos</span>} />
      {searches.length ? (
        <div className="grid gap-3">
          {searches.slice(0, 8).map((item) => {
            const searchId = getSearchId(item);
            return (
              <div key={searchId || item.query} className="grid gap-3 rounded-2xl border border-border bg-black p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-base font-black text-foreground">{item.query || "Investigación sin título"}</p>
                    <StatusBadge value={statusLabel(item.status)} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDate(item.createdAt)}</span>
                    <span>{Number(item.resultCount || 0)} hallazgos</span>
                    <span>grupo {item.clusterLetter || "-"}</span>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:flex">
                  <SearchDetailDialog item={item} triggerLabel="Detalle" compact />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!searchId}
                    onClick={() => searchId && onLoad(searchId)}
                    className="w-full lg:w-auto"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Abrir caso
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-black p-5 text-sm text-muted-foreground">
          Aquí aparecerán tus próximas investigaciones.
        </div>
      )}
    </Card>
  );
}

function ResultFact({ label, value, icon: Icon }: { label: string; value: string; icon: ElementType }) {
  return (
    <div className="rounded-2xl border border-border bg-black p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="metric-label">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className={cn("truncate text-lg font-black text-foreground", value === "-" && "text-muted-foreground")}>{value}</p>
    </div>
  );
}

function EmptySearchState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-black p-5">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border text-primary">
          <SearchCheck className="h-5 w-5" />
        </div>
        <div>
          <p className="text-base font-black text-foreground">Sin caso creado</p>
          <p className="mt-1 text-sm text-muted-foreground">Cuando generes una investigación verás aquí el resumen, hallazgos, grupo y reportes.</p>
          <div className="mt-4 grid gap-2 text-xs font-semibold text-muted-foreground sm:grid-cols-3">
            <span className="rounded-xl border border-border px-3 py-2">Estado</span>
            <span className="rounded-xl border border-border px-3 py-2">Hallazgos</span>
            <span className="rounded-xl border border-border px-3 py-2">Reportes</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchDetailDialog({ item, triggerLabel, compact }: { item: SearchItem; triggerLabel: string; compact?: boolean }) {
  const searchId = getSearchId(item);
  const scoreEntries = Object.entries(item.scores || {}).filter(([, value]) => value !== undefined && value !== null);

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="secondary" size={compact ? "sm" : "default"} className="w-full">
          <Eye className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-3 bottom-3 z-50 grid max-h-[88dvh] gap-4 overflow-auto rounded-[1.2rem] border border-border bg-card p-4 shadow-2xl outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="metric-label mb-1">detalle del caso</p>
              <Dialog.Title className="truncate text-xl font-black text-foreground">{item.query || "Investigación sin título"}</Dialog.Title>
              <Dialog.Description className="mt-1 break-all text-xs text-muted-foreground">{searchId || "sin identificador"}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Cerrar detalle">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="rounded-2xl border border-border bg-black p-4">
            <p className="metric-label mb-2">Resumen operativo</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Esta vista reúne la información clave que devuelve el microservicio para revisar el caso sin abrir JSON en la pantalla principal.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <ResultFact label="Estado" value={statusLabel(item.status)} icon={SearchCheck} />
            <ResultFact label="Hallazgos" value={String(item.resultCount ?? 0)} icon={Database} />
            <ResultFact label="Grupo" value={item.clusterLetter || "-"} icon={FolderOpen} />
            <ResultFact label="Fecha" value={formatDate(item.createdAt)} icon={CalendarClock} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DetailLine label="Identificador" value={searchId || "-"} />
            <DetailLine label="Actualizado" value={formatDate(item.updatedAt)} />
            <DetailLine label="Tipo" value={(item as any).searchType || "-"} />
            <DetailLine label="Categoría" value={(item as any).category || "-"} />
          </div>

          {scoreEntries.length ? (
            <div className="rounded-2xl border border-border bg-black p-4">
              <p className="metric-label mb-3">Puntajes</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {scoreEntries.map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-4 rounded-xl border border-border px-3 py-2">
                    <span className="text-sm font-semibold text-muted-foreground">{key}</span>
                    <span className="text-sm font-black text-foreground">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {item.enhancedImageUrl ? (
            <div className="rounded-2xl border border-border bg-black p-4">
              <p className="metric-label mb-2">Imagen mejorada</p>
              <a className="break-all text-sm font-semibold text-primary hover:underline" href={item.enhancedImageUrl} target="_blank" rel="noreferrer">
                {item.enhancedImageUrl}
              </a>
            </div>
          ) : null}

          <details className="rounded-2xl border border-border bg-black p-4">
            <summary className="cursor-pointer text-sm font-black text-foreground">Datos recibidos</summary>
            <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-border bg-background p-3 text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(item, null, 2)}
            </pre>
          </details>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-black p-3">
      <p className="metric-label mb-1">{label}</p>
      <p className="break-words text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function reportHref(apiBase: string, searchId: string, type: "markdown" | "pdf") {
  return `${apiBase}?path=${encodeURIComponent(`/osint/report/${searchId}/${type}`)}`;
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
