"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bell, Filter, Menu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import type { DashboardView } from "./types";

const titles: Record<DashboardView, { title: string; subtitle: string }> = {
  overview: { title: "Panel OSINT", subtitle: "Investigaciones, evidencias y reportes listos para operar." },
  search: { title: "Buscar personas", subtitle: "Empieza con un dato. Reúne los resultados en un caso." },
  faces: { title: "Rostros", subtitle: "Busca personas desde una foto y revisa candidatos por score." },
  "face-lab": { title: "Mejora visual", subtitle: "Prepara, analiza y compara imágenes antes de investigar." },
  social: { title: "Social Intel", subtitle: "Instagram, Meta/Facebook profile y Facebook Search." },
  darkweb: { title: "Dark Web", subtitle: "Rastrea alias, filtraciones y entidades públicas de riesgo." },
  evidence: { title: "Evidencias", subtitle: "Consulta hallazgos, imágenes, fuentes y línea de tiempo por caso." },
  network: { title: "Control técnico", subtitle: "Estado de conectores, límites, auditoría y trazabilidad del sistema." },
  settings: { title: "Configuración", subtitle: "Datasec, fuentes internas y memoria visual curada." },
};

type TopbarProps = {
  view: DashboardView;
  apiStatus?: string;
  loading: boolean;
  notifications?: Array<{ title: string; detail: string; tone?: "ok" | "warn" | "bad" | "info" }>;
  onRefresh: () => void;
  onOpenMobile: () => void;
};

export function Topbar({ view, apiStatus, loading, notifications = [], onRefresh, onOpenMobile }: TopbarProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationRoot = useRef<HTMLDivElement>(null);
  const notificationId = useId();
  useEffect(() => {
    if (!notificationsOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!notificationRoot.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const dismissKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissKeyboard);
    };
  }, [notificationsOpen]);
  const copy = titles[view];
  const connectionLabel = getConnectionLabel(apiStatus);
  const unreadCount = notifications.length;

  return (
    <header className={`${view === "search" ? "person-search-topbar " : ""}sticky top-0 z-30 border-b border-border/50 bg-black/95 px-4 py-3 backdrop-blur-sm lg:px-6`}>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button className="h-11 w-11 shrink-0 xl:hidden" variant="secondary" size="icon" aria-label="Abrir menú" onClick={onOpenMobile}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="admin-page-title">{copy.title}</h1>
            <p className="admin-page-subtitle">{copy.subtitle}</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 [&>button]:min-h-11">
          <div className="relative" ref={notificationRoot}>
            <Button className="min-h-11" variant="secondary" type="button" aria-label={`Notificaciones${unreadCount ? ` ${unreadCount}` : ""}`} aria-expanded={notificationsOpen} aria-controls={notificationId} onClick={() => setNotificationsOpen((open) => !open)}>
              <span className="relative">
                <Bell className="h-5 w-5" />
                {unreadCount ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-primary" /> : null}
              </span>
              <span className="hidden sm:inline">Notificaciones</span>
              {unreadCount ? <span className="rounded-full border border-primary/30 px-2 py-0.5 text-xs font-black text-primary">{unreadCount}</span> : null}
            </Button>
            {notificationsOpen ? (
              <div id={notificationId} role="region" aria-label="Actividad reciente" className="absolute left-0 top-12 z-50 max-h-[min(32rem,calc(100dvh-10rem))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-background p-3 shadow-2xl">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-black text-foreground">Actividad reciente</p>
                  <button type="button" onClick={() => setNotificationsOpen(false)} className="text-xs font-bold text-muted-foreground hover:text-foreground">
                    Cerrar
                  </button>
                </div>
                <div className="grid gap-2">
                  {notifications.length ? notifications.slice(0, 6).map((item, index) => (
                    <div key={`${item.title}-${index}`} className="rounded-xl border border-border bg-black p-3">
                      <div className="flex items-start gap-2">
                        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${notificationToneClass(item.tone)}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-black text-foreground">{item.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-border bg-black p-4 text-sm text-muted-foreground">
                      Sin novedades todavía. Cuando crees una investigación o cargues evidencias aparecerán aquí.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          {view !== "search" ? <Button variant="secondary" type="button" aria-label="Filtros">
            <Filter className="h-5 w-5" />
            <span className="hidden sm:inline">Filtros</span>
          </Button> : null}
          <StatusBadge value={connectionLabel} />
          <Button variant="secondary" aria-label="Actualizar" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            <span className="hidden sm:inline">Actualizar</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

function notificationToneClass(tone?: "ok" | "warn" | "bad" | "info") {
  if (tone === "bad") return "bg-red-400";
  if (tone === "warn") return "bg-amber-400";
  if (tone === "info") return "bg-sky-400";
  return "bg-emerald-400";
}

function getConnectionLabel(status?: string) {
  const normalized = String(status || "").toLowerCase();
  if (["ok", "up", "healthy", "listo", "conectado"].includes(normalized)) return "Conectado";
  if (["degraded", "degradado"].includes(normalized)) return "Degradado";
  if (["down", "error", "failed", "offline"].includes(normalized)) return "Sin conexión";
  return "Verificando";
}
