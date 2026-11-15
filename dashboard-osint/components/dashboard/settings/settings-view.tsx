"use client";

import { useState } from "react";
import {
  BellRing,
  Database,
  KeyRound,
  LockKeyhole,
  MailCheck,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { DatasecSettingsView } from "../datasec/datasec-settings-view";
import type { DashboardData } from "../types";

type SettingsTab = "datasec" | "profile" | "connectors" | "security" | "operation";

type SettingsViewProps = {
  data: DashboardData;
  onDatasecPerson: (form: FormData) => void;
  onDatasecAsset: (form: FormData) => void;
  onDatasecLoad: (form: FormData) => void;
  onDatasecSelectPerson: (personId: string) => void;
  onSocialAssetsLoad: (form: FormData) => void;
  onSocialAssetStatus: (assetId: string, status: "candidate" | "positive" | "false_positive" | "archived", note?: string) => void;
  onSocialAssetPromote: (form: FormData) => void;
  onAuthUserCreate: (form: FormData) => void;
  onAuthUsersLoad: () => void;
};

const settingsTabs: {
  id: SettingsTab;
  title: string;
  caption: string;
  icon: React.ElementType;
  status: string;
}[] = [
  { id: "datasec", title: "Datasec", caption: "Personas, rostros y memoria OSINT", icon: Database, status: "activo" },
  { id: "profile", title: "Acceso y usuarios", caption: "Sesión, roles, login y permisos", icon: UserRoundCog, status: "base" },
  { id: "connectors", title: "Conectores", caption: "APIs, proveedores y llaves externas", icon: Network, status: "próximo" },
  { id: "security", title: "Seguridad", caption: "Roles, tokens, auditoría y permisos", icon: ShieldCheck, status: "próximo" },
  { id: "operation", title: "Operación", caption: "Perfiles, límites y comportamiento", icon: SlidersHorizontal, status: "próximo" },
];

export function SettingsView({
  data,
  onDatasecPerson,
  onDatasecAsset,
  onDatasecLoad,
  onDatasecSelectPerson,
  onSocialAssetsLoad,
  onSocialAssetStatus,
  onSocialAssetPromote,
  onAuthUserCreate,
  onAuthUsersLoad,
}: SettingsViewProps) {
  const [tab, setTab] = useState<SettingsTab>("datasec");
  const activeTab = settingsTabs.find((item) => item.id === tab) || settingsTabs[0];

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <div className="rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.16),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 sm:p-6">
          <div className="dashboard-hero-layout">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value="Configuración" />
                <StatusBadge value={activeTab.title} />
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-normal sm:text-3xl text-foreground">Centro de configuración</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Administra la base interna, conectores, seguridad y parámetros operativos desde una estructura preparada para crecer.
              </p>
            </div>
            <div className="dashboard-hero-metrics">
              <SettingsMetric label="Sección" value={activeTab.title} />
              <SettingsMetric label="Estado" value={activeTab.status} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid gap-3 md:grid-cols-5">
          {settingsTabs.map((item) => {
            const Icon = item.icon;
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex min-h-[104px] items-start gap-3 rounded-2xl border p-4 text-left transition ${active ? "border-white bg-white text-black" : "border-border bg-black text-foreground hover:border-primary/40"}`}
              >
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${active ? "border-black/10 bg-black text-white" : "border-primary/25 bg-primary/10 text-primary"}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-black">{item.title}</span>
                  <span className={`mt-1 block text-xs leading-relaxed ${active ? "text-black/65" : "text-muted-foreground"}`}>{item.caption}</span>
                  <span className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${active ? "border-black/15 text-black/70" : "border-border text-muted-foreground"}`}>{item.status}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {tab === "datasec" ? (
        <DatasecSettingsView
          data={data}
          onPerson={onDatasecPerson}
          onAsset={onDatasecAsset}
          onLoad={onDatasecLoad}
          onSelectPerson={onDatasecSelectPerson}
          onSocialAssetsLoad={onSocialAssetsLoad}
          onSocialAssetStatus={onSocialAssetStatus}
          onSocialAssetPromote={onSocialAssetPromote}
        />
      ) : null}

      {tab === "profile" ? <AccessUsersPanel session={data.session} users={data.authUsers} onUserCreate={onAuthUserCreate} onUsersLoad={onAuthUsersLoad} /> : null}

      {tab === "connectors" ? (
        <SettingsComingSoon
          icon={KeyRound}
          title="Conectores y proveedores"
          text="Aquí quedarán las llaves, proveedores externos, endpoints y pruebas comerciales de disponibilidad."
        />
      ) : null}

      {tab === "security" ? (
        <SettingsComingSoon
          icon={ShieldCheck}
          title="Seguridad y permisos"
          text="Aquí vivirán roles, acceso por módulo, auditoría de acciones y políticas para datos sensibles."
        />
      ) : null}

      {tab === "operation" ? (
        <SettingsComingSoon
          icon={SlidersHorizontal}
          title="Operación del sistema"
          text="Aquí se configurarán perfiles, límites, comportamiento de búsqueda y parámetros reutilizables."
        />
      ) : null}
    </div>
  );
}

function AccessUsersPanel({
  session,
  users,
  onUserCreate,
  onUsersLoad,
}: {
  session?: any;
  users?: any;
  onUserCreate: (form: FormData) => void;
  onUsersLoad: () => void;
}) {
  const user = session?.user || {};
  const displayName = user.displayName || user.username || "Dashboard Deco";
  const email = user.email || "Usuario local autenticado por el proxy OSINT";
  const role = roleLabel(user.role || "admin");
  const permissionGroups = [
    { title: "Investigación", items: ["Crear búsquedas", "Ver resultados", "Guardar evidencias"] },
    { title: "Datasec", items: ["Crear personas", "Subir imágenes", "Validar coincidencias"] },
    { title: "Operación", items: ["Ver auditoría", "Revisar conectores", "Aplicar perfiles"] },
  ];

  const plannedUsers = [
    { name: "Administrador", level: "Owner", access: "Control total" },
    { name: "Analista", level: "Operator", access: "Investiga y valida evidencias" },
    { name: "Cliente", level: "Viewer", access: "Consulta reportes autorizados" },
  ];

  const accessFlows = [
    {
      title: "Login seguro",
      icon: LockKeyhole,
      state: "activo",
      detail: "El dashboard usa el proxy OSINT con API key interna o JWT del microservicio.",
    },
    {
      title: "Reset password",
      icon: MailCheck,
      state: "pendiente",
      detail: "Debe conectarse a backend con token temporal, expiración y envío por email.",
    },
    {
      title: "Alertas por email",
      icon: BellRing,
      state: "pendiente",
      detail: "Notificar investigaciones terminadas, errores críticos y evidencias listas para revisión.",
    },
  ];

  const accessMatrix = [
    { module: "Investigación", owner: "Total", operator: "Crear y validar", viewer: "Solo lectura" },
    { module: "Rostros", owner: "Total", operator: "Ejecutar jobs", viewer: "Resultados autorizados" },
    { module: "Datasec", owner: "Total", operator: "Curar memoria", viewer: "Consulta limitada" },
    { module: "Operación", owner: "Total", operator: "Ver estado", viewer: "No permitido" },
    { module: "Usuarios", owner: "Gestionar", operator: "No permitido", viewer: "No permitido" },
  ];
  const userList = Array.isArray(users) ? users : [];
  const usersError = !Array.isArray(users) && users?.error ? String(users.error) : "";

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="overflow-hidden xl:col-span-12">
        <div className="rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.98),rgba(15,23,42,0.92))] p-4 sm:p-6">
          <div className="dashboard-hero-layout">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value="sesión activa" />
                <StatusBadge value="roles preparados" />
                <StatusBadge value="email pendiente" />
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-normal sm:text-3xl text-foreground">Gobierno de acceso Deco</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Controla quién entra, qué puede hacer y cómo recibe avisos cuando una investigación, evidencia o alerta operativa necesita atención.
              </p>
            </div>
            <div className="dashboard-hero-metrics">
              <SettingsMetric label="Sesión" value="Activa" />
              <SettingsMetric label="Rol actual" value="Admin" />
              <SettingsMetric label="Login" value="Proxy" />
              <SettingsMetric label="Email" value="Planeado" />
            </div>
          </div>
        </div>
      </Card>

      <Card className="xl:col-span-4">
        <CardHeader title="Perfil actual" eyebrow="sesión activa" action={<StatusBadge value="dashboard" />} />
        <div className="rounded-2xl border border-border bg-black p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
              <UserRoundCog className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-black text-foreground">{displayName}</p>
              <p className="mt-1 text-sm text-muted-foreground">{email}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3">
            <ProfileFact label="Nivel" value={role} />
            <ProfileFact label="Alcance" value="Investigación, Datasec y evidencia" />
            <ProfileFact label="Estado" value={user.status || "Activo"} />
          </div>
        </div>
      </Card>

      <Card className="xl:col-span-8">
        <CardHeader title="Niveles de usuario" eyebrow="permisos planificados" action={<StatusBadge value="roles" />} />
        <div className="grid gap-3 md:grid-cols-3">
          {plannedUsers.map((user) => (
            <div key={user.level} className="rounded-2xl border border-border bg-black p-4">
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                <UsersRound className="h-5 w-5" />
              </div>
              <p className="text-base font-black text-foreground">{user.name}</p>
              <p className="mt-1 text-xs font-black uppercase text-primary">{user.level}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{user.access}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="xl:col-span-5">
        <CardHeader title="Crear usuario" eyebrow="acceso interno" action={<StatusBadge value="owner" />} />
        <form action={onUserCreate} className="grid gap-3">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl border border-primary/25 bg-black text-primary">
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-black text-foreground">Alta controlada</p>
                <p className="text-xs text-muted-foreground">Solo Owner/Admin debe crear accesos nuevos.</p>
              </div>
            </div>
          </div>
          <AccessField name="email" label="Email" placeholder="usuario@empresa.com" type="email" />
          <AccessField name="username" label="Usuario" placeholder="analista-osint" />
          <AccessField name="displayName" label="Nombre visible" placeholder="Analista OSINT" />
          <AccessField name="password" label="Password inicial" placeholder="Mínimo 10 caracteres" type="password" />
          <label className="grid gap-2">
            <span className="text-sm font-bold text-muted-foreground">Rol</span>
            <select name="role" defaultValue="analyst" className="h-12 rounded-2xl border border-border bg-black px-4 text-sm font-semibold text-foreground outline-none focus:border-primary">
              <option value="admin">Owner / Admin</option>
              <option value="analyst">Operator / Analista</option>
              <option value="viewer">Viewer / Cliente</option>
            </select>
          </label>
          <button type="submit" className="h-12 rounded-2xl bg-primary px-4 text-sm font-black text-primary-foreground transition hover:opacity-90">
            Crear usuario
          </button>
        </form>
      </Card>

      <Card className="xl:col-span-7">
        <CardHeader
          title="Usuarios activos"
          eyebrow="directorio interno"
          action={
            <button type="button" onClick={onUsersLoad} className="rounded-full border border-border px-3 py-1 text-xs font-black text-muted-foreground transition hover:border-primary hover:text-foreground">
              Actualizar
            </button>
          }
        />
        <div className="grid gap-3">
          {usersError ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
              {usersError}
            </div>
          ) : userList.length ? userList.map((item: any) => (
            <div key={item.userId || item.email} className="grid gap-3 rounded-2xl border border-border bg-black p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">{item.displayName || item.username}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.email || item.username}</p>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <StatusBadge value={roleLabel(item.role)} />
                <StatusBadge value={item.status || "active"} />
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-border bg-black p-5 text-sm text-muted-foreground">
              No hay usuarios cargados todavía o tu rol no puede consultar el directorio.
            </div>
          )}
        </div>
      </Card>

      <Card className="xl:col-span-12">
        <CardHeader title="Acceso, recuperación y avisos" eyebrow="login + email" action={<StatusBadge value="roadmap" />} />
        <div className="grid gap-3 md:grid-cols-3">
          {accessFlows.map((flow) => {
            const Icon = flow.icon;
            return (
              <div key={flow.title} className="rounded-2xl border border-border bg-black p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <StatusBadge value={flow.state} />
                </div>
                <p className="mt-4 text-base font-black text-foreground">{flow.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{flow.detail}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="xl:col-span-12">
        <CardHeader title="Qué puede hacer cada usuario" eyebrow="matriz de acceso" action={<StatusBadge value="preparado" />} />
        <div className="grid gap-3 md:grid-cols-3">
          {permissionGroups.map((group) => (
            <div key={group.title} className="rounded-2xl border border-border bg-black p-4">
              <p className="text-sm font-black text-foreground">{group.title}</p>
              <div className="mt-3 grid gap-2">
                {group.items.map((item) => (
                  <div key={item} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/20 px-3 py-2">
                    <span className="text-sm text-muted-foreground">{item}</span>
                    <StatusBadge value="permitido" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="xl:col-span-12">
        <CardHeader title="Matriz por rol" eyebrow="control comercial" action={<StatusBadge value="diseñada" />} />
        <div tabIndex={0} role="region" aria-label="Matriz de permisos por rol" className="overflow-x-auto rounded-2xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <div className="min-w-[640px]">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] bg-secondary/40 px-4 py-3 text-xs font-black uppercase text-muted-foreground">
            <span>Módulo</span>
            <span>Owner</span>
            <span>Operator</span>
            <span>Viewer</span>
          </div>
          {accessMatrix.map((row) => (
            <div key={row.module} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] border-t border-border px-4 py-3 text-sm">
              <span className="font-black text-foreground">{row.module}</span>
              <span className="text-muted-foreground">{row.owner}</span>
              <span className="text-muted-foreground">{row.operator}</span>
              <span className="text-muted-foreground">{row.viewer}</span>
            </div>
          ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3">
      <p className="text-[10px] font-black uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-black text-foreground">{value}</p>
    </div>
  );
}

function AccessField({ label, name, placeholder, type = "text" }: { label: string; name: string; placeholder: string; type?: string }) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold text-muted-foreground">{label}</span>
      <input
        className="h-12 rounded-2xl border border-border bg-black px-4 text-sm font-semibold text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
        name={name}
        type={type}
        placeholder={placeholder}
        required
      />
    </label>
  );
}

function roleLabel(role: string) {
  if (role === "admin") return "Owner operativo";
  if (role === "analyst") return "Analista operativo";
  if (role === "viewer") return "Cliente viewer";
  return "Admin operativo";
}

function SettingsMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-[10px] font-black uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-black text-foreground">{value}</p>
    </div>
  );
}

function SettingsComingSoon({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <Card>
      <CardHeader title={title} eyebrow="configuración futura" action={<StatusBadge value="preparado" />} />
      <div className="grid min-h-[260px] place-items-center rounded-2xl border border-dashed border-border bg-black/40 p-8 text-center">
        <div className="max-w-xl">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <p className="mt-4 text-xl font-black text-foreground">{title}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
        </div>
      </div>
    </Card>
  );
}
