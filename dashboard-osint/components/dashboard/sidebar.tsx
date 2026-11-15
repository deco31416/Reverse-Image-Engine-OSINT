"use client";

import { ChevronLeft, Database, Eye, Globe2, Grip, LayoutDashboard, LogOut, Menu, Network, ScanFace, Settings, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardView } from "./types";

const navGroups: { label: string; items: { id: DashboardView; label: string; icon: React.ElementType }[] }[] = [
  {
    label: "Deco",
    items: [
      { id: "overview", label: "Operación", icon: LayoutDashboard },
      { id: "search", label: "Búsqueda OSINT", icon: Eye },
      { id: "faces", label: "Rostros", icon: ScanFace },
      { id: "face-lab", label: "Mejora visual", icon: Sparkles },
    ],
  },
  {
    label: "Inteligencia",
    items: [
      { id: "social", label: "Social Intel", icon: Globe2 },
    ],
  },
  {
    label: "Control",
    items: [
      { id: "evidence", label: "Evidencias", icon: Database },
      { id: "network", label: "Red y auditoría", icon: Network },
    ],
  },
];

type SidebarProps = {
  activeView: DashboardView;
  collapsed: boolean;
  onViewChange: (view: DashboardView) => void;
  onToggle: () => void;
  onLogout?: () => void;
  showToggle?: boolean;
};

export function Sidebar({ activeView, collapsed, onViewChange, onToggle, onLogout, showToggle = true }: SidebarProps) {
  return (
    <aside
      className={cn(
        "sticky top-0 flex h-dvh shrink-0 flex-col border-r border-border bg-black transition-all duration-200",
        collapsed ? "w-[80px] px-3 py-4" : "w-[256px] p-4",
      )}
    >
      <div className={cn("mb-8 grid min-h-14 items-center gap-3", collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[46px_1fr]")}>
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.30),transparent_55%),rgba(37,99,235,0.08)] text-primary shadow-[0_0_28px_rgba(37,99,235,0.12)]">
          <Grip className="h-7 w-7" strokeWidth={2.4} />
        </div>
        <div className={cn("min-w-0 overflow-hidden transition-all", collapsed && "hidden")}>
          <p className="admin-brand-title">OSINT-Deco</p>
          <p className="admin-brand-subtitle">Panel de control</p>
        </div>
      </div>

      <nav aria-label="Navegación principal" className={cn("grid min-h-0 flex-1 content-start overflow-y-auto overscroll-contain pr-1 scrollbar-thin", collapsed ? "gap-3" : "gap-5")}>
        {navGroups.map((group) => (
          <div key={group.label} className={cn("grid content-start", collapsed ? "gap-2" : "gap-3")}>
            {collapsed ? (
              <div className="mx-auto my-1 h-px w-8 bg-border" />
            ) : (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs font-bold text-muted-foreground">
                <span className="h-px bg-border" />
                <span>{group.label}</span>
                <span className="h-px bg-border" />
              </div>
            )}
            <div className="grid gap-2">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeView;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onViewChange(item.id)}
                    className={cn(
                      "group grid h-11 items-center rounded-2xl border border-transparent text-left text-base font-semibold text-muted-foreground transition hover:border-border hover:bg-secondary/35 hover:text-foreground",
                      collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[42px_1fr]",
                      active && "border-primary/45 bg-[linear-gradient(90deg,rgba(37,99,235,0.12),rgba(2,6,23,0.35))] text-foreground shadow-[inset_3px_0_0_rgba(59,130,246,0.9)] hover:border-primary/55 hover:bg-primary/10 hover:text-foreground",
                    )}
                    title={item.label}
                    aria-label={item.label}
                  >
                    <span className={cn("grid h-8 w-8 place-items-center transition", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className={cn("truncate transition-opacity", collapsed && "hidden")}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-4 grid shrink-0 gap-3">
        <button
          className={cn(
            "group grid h-11 items-center rounded-2xl border border-border bg-black text-left text-base font-semibold text-foreground transition hover:border-primary/45 hover:bg-secondary/35",
            collapsed ? "grid-cols-1 justify-items-center px-0" : "grid-cols-[42px_1fr] px-0",
            activeView === "settings" && "border-primary/45 bg-[linear-gradient(90deg,rgba(37,99,235,0.12),rgba(2,6,23,0.35))] shadow-[inset_3px_0_0_rgba(59,130,246,0.9)]",
          )}
          type="button"
          onClick={() => onViewChange("settings")}
          title="Configuración"
          aria-label="Configuración"
        >
          <span className={cn("grid h-8 w-8 place-items-center transition", activeView === "settings" ? "text-primary" : "text-muted-foreground group-hover:text-foreground")}>
            <Settings className="h-[18px] w-[18px]" />
          </span>
          <span className={cn("truncate transition-opacity", collapsed && "hidden")}>Configuración</span>
        </button>
        <Button variant="secondary" className={cn("h-11 justify-start rounded-2xl", collapsed && "justify-center px-0")} type="button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={onLogout}>
          <LogOut className="h-4 w-4" />
          <span className={cn(collapsed && "hidden")}>Cerrar sesión</span>
        </Button>
      </div>

      {showToggle ? (
        <Button variant="ghost" className={cn("mt-3 h-11 rounded-2xl text-muted-foreground", collapsed ? "justify-center px-0" : "justify-start")} onClick={onToggle} title={collapsed ? "Expandir menú" : "Contraer menú"} aria-label={collapsed ? "Expandir menú" : "Contraer menú"}>
          {collapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          <span className={cn(collapsed && "hidden")}>Contraer menú</span>
        </Button>
      ) : null}
    </aside>
  );
}
