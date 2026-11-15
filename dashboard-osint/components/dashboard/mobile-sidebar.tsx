"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "./sidebar";
import type { DashboardView } from "./types";

type MobileSidebarProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeView: DashboardView;
  onViewChange: (view: DashboardView) => void;
  onLogout?: () => void;
};

export function MobileSidebar({ open, onOpenChange, activeView, onViewChange, onLogout }: MobileSidebarProps) {
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = () => { if (desktop.matches) onOpenChange(false); };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [onOpenChange]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm xl:hidden" />
        <Dialog.Content className="fixed left-0 top-0 z-50 h-dvh w-[min(20rem,calc(100vw-2rem))] max-w-full border-r border-border bg-background p-0 xl:hidden [&>aside]:h-full [&>aside]:w-full">
          <Dialog.Title className="sr-only">Navegación del dashboard</Dialog.Title>
          <Dialog.Description className="sr-only">Selecciona un área del panel OSINT-Deco.</Dialog.Description>
          <div className="absolute right-3 top-3 z-10">
            <Dialog.Close asChild>
              <Button size="icon" variant="secondary" aria-label="Cerrar menú">
                <X className="h-4 w-4" />
              </Button>
            </Dialog.Close>
          </div>
          <Sidebar
            activeView={activeView}
            collapsed={false}
            showToggle={false}
            onToggle={() => undefined}
            onViewChange={(view) => {
              onViewChange(view);
              onOpenChange(false);
            }}
            onLogout={onLogout}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
