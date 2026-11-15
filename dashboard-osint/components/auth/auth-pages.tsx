"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, BellRing, CheckCircle2, Database, FileCheck2, KeyRound, LockKeyhole, ShieldCheck, UsersRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type AuthMode = "login" | "forgot" | "reset";
type AuthModal = {
  tone: "ok" | "bad" | "info";
  title: string;
  detail: string;
  action?: string;
};

const modeCopy: Record<AuthMode, { title: string; subtitle: string; eyebrow: string; icon: React.ElementType }> = {
  login: {
    eyebrow: "acceso seguro",
    title: "Entrar a OSINT-Deco",
    subtitle: "Accede al panel operativo con usuario autorizado, roles y trazabilidad de sesión.",
    icon: LockKeyhole,
  },
  forgot: {
    eyebrow: "recuperación",
    title: "Recuperar contraseña",
    subtitle: "Solicita un enlace temporal para restablecer el acceso sin exponer información de cuenta.",
    icon: BellRing,
  },
  reset: {
    eyebrow: "nuevo password",
    title: "Definir contraseña",
    subtitle: "Usa el token recibido para dejar una contraseña nueva y volver al panel.",
    icon: KeyRound,
  },
};

const platformSignals = [
  {
    title: "Acceso por rol",
    icon: UsersRound,
  },
  {
    title: "Memoria Datasec",
    icon: Database,
  },
  {
    title: "Evidencia lista",
    icon: FileCheck2,
  },
];

export function AuthPage({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [modal, setModal] = useState<AuthModal | null>(null);
  const copy = modeCopy[mode];
  const Icon = copy.icon;
  const token = params.get("token") || "";
  const next = params.get("next") || "/";

  const endpoint = useMemo(() => {
    if (mode === "login") return "/api/auth/login";
    if (mode === "forgot") return "/api/auth/forgot-password";
    return "/api/auth/reset-password";
  }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setOk(false);

    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());

    try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    setLoading(false);

    if (!response.ok || data?.success === false) {
      const detail = authErrorMessage(response.status, data?.message);
      setMessage(detail);
      setModal({
        tone: "bad",
        title: response.status === 401 ? "Acceso no autorizado" : "No se pudo completar",
        detail,
        action: "Revisar",
      });
      return;
    }

    setOk(true);
    if (mode === "login") {
      setModal({
        tone: "ok",
        title: "Acceso concedido",
        detail: "Sesión validada. Entrando al panel OSINT-Deco.",
        action: "Entrar",
      });
      window.setTimeout(() => {
        router.replace(next.startsWith("/") ? next : "/");
        router.refresh();
      }, 850);
      return;
    }

    const successMessage = data?.message || "Solicitud procesada correctamente.";
    setMessage(successMessage);
    setModal({
      tone: "ok",
      title: mode === "forgot" ? "Solicitud recibida" : "Contraseña actualizada",
      detail: successMessage,
      action: "Listo",
    });
    } catch {
      const detail = 'No se pudo conectar. Intenta de nuevo en unos momentos.';
      setMessage(detail);
      setModal({ tone: 'bad', title: 'Servicio no disponible', detail, action: 'Reintentar' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-foreground">
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-6xl items-center gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section className="min-w-0 rounded-3xl border border-border bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.22),transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(0,0,0,0.94))] p-5 shadow-2xl sm:p-7">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-black text-foreground">OSINT-Deco</p>
              <p className="text-sm font-semibold text-muted-foreground">Developed by OSINT-Deco Team</p>
            </div>
          </div>
          <div className="mt-8 max-w-2xl lg:mt-16">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-black uppercase text-primary">{copy.eyebrow}</span>
            <h1 className="mt-5 break-words text-3xl font-black tracking-normal text-foreground sm:text-4xl xl:text-5xl">{copy.title}</h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">{copy.subtitle}</p>
          </div>
          <div className="mt-12 grid gap-3 md:grid-cols-3">
            {platformSignals.map((item) => {
              const SignalIcon = item.icon;
              return (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="grid gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <SignalIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase text-muted-foreground">{item.title}</p>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-6">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase text-muted-foreground">{copy.eyebrow}</p>
              <h2 className="mt-1 text-2xl font-black text-foreground">{copy.title}</h2>
            </div>
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </div>
          </div>

          <form onSubmit={submit} className="grid gap-4">
            {mode === "login" ? (
              <>
                <AuthField name="username" label="Usuario o email" placeholder="admin / usuario@empresa.com" />
                <AuthField name="password" type="password" label="Contraseña" placeholder="Tu contraseña" />
              </>
            ) : null}

            {mode === "forgot" ? <AuthField name="identifier" label="Usuario o email" placeholder="usuario@empresa.com" /> : null}

            {mode === "reset" ? (
              <>
                <input name="token" type="hidden" defaultValue={token} />
                <AuthField name="password" type="password" label="Nueva contraseña" placeholder="Mínimo 10 caracteres" />
              </>
            ) : null}

            {message ? (
              <div className={`rounded-2xl border p-3 text-sm font-semibold ${ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-red-500/30 bg-red-500/10 text-red-100"}`}>
                {message}
              </div>
            ) : null}

            <Button type="submit" disabled={loading} className="mt-2 h-12 justify-center rounded-2xl">
              {loading ? "Procesando..." : mode === "login" ? "Entrar" : mode === "forgot" ? "Enviar enlace" : "Actualizar contraseña"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </form>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {mode !== "login" ? <Link className="font-bold text-primary hover:text-foreground" href="/login">Volver a login</Link> : null}
            {mode === "login" ? <Link className="font-bold text-primary hover:text-foreground" href="/forgot-password">Olvidé mi contraseña</Link> : null}
          </div>
        </section>
      </div>
      {modal ? <AuthFeedbackModal modal={modal} onClose={() => setModal(null)} /> : null}
    </main>
  );
}

function AuthField({ label, name, type = "text", placeholder }: { label: string; name: string; type?: string; placeholder: string }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold text-muted-foreground">{label}</span>
      <input
        className="h-12 rounded-2xl border border-border bg-black px-4 text-sm font-semibold text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
        name={name}
        type={type}
        placeholder={placeholder}
        required={name !== "displayName"}
        autoComplete={type === "password" ? "current-password" : name}
      />
    </label>
  );
}

function AuthFeedbackModal({ modal, onClose }: { modal: AuthModal; onClose: () => void }) {
  const isOk = modal.tone === "ok";
  const Icon = isOk ? CheckCircle2 : XCircle;
  const toneClass = isOk ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-red-500/30 bg-red-500/10 text-red-100";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-border bg-background p-5 shadow-2xl">
        <div className={`grid h-14 w-14 place-items-center rounded-2xl border ${toneClass}`}>
          <Icon className="h-7 w-7" />
        </div>
        <h3 className="mt-5 text-2xl font-black text-foreground">{modal.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{modal.detail}</p>
        <div className="mt-6 flex justify-end">
          <Button type="button" onClick={onClose} className="rounded-2xl">
            {modal.action || "Cerrar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function authErrorMessage(status: number, message?: string) {
  if (status === 401) return "Usuario o contraseña incorrectos. Verifica el usuario demo o el Owner inicial.";
  if (status === 403) return message || "Este acceso no está habilitado. Solicita permisos a un administrador.";
  if (status >= 500) return "El servicio de autenticación no respondió correctamente. Revisa que el micro OSINT esté levantado.";
  return message || "No se pudo completar la solicitud.";
}
