import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && String(item).trim() !== ""),
  );
}

export function stateTone(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (["ok", "up", "healthy", "configured", "success", "completed", "running", "listo", "completado", "conectado"].includes(normalized)) return "ok";
  if (["degraded", "pending", "processing", "unknown", "pendiente", "procesando", "verificando"].includes(normalized)) return "warn";
  return "bad";
}
