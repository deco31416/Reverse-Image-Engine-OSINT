"use client";

import { useState } from "react";
import { Archive, CheckCircle2, Database, ExternalLink, FileSearch, Globe2, ImagePlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field } from "../forms";
import type { DashboardData } from "../types";

type DatasecTab = "persons" | "assets" | "social" | "import" | "evidence";

type DatasecSettingsViewProps = {
  data: DashboardData;
  onPerson: (form: FormData) => void;
  onAsset: (form: FormData) => void;
  onLoad: (form: FormData) => void;
  onSelectPerson: (personId: string) => void;
  onSocialAssetsLoad: (form: FormData) => void;
  onSocialAssetStatus: (assetId: string, status: "candidate" | "positive" | "false_positive" | "archived", note?: string) => void;
  onSocialAssetPromote: (form: FormData) => void;
};

export function DatasecSettingsView({
  data,
  onPerson,
  onAsset,
  onLoad,
  onSelectPerson,
  onSocialAssetsLoad,
  onSocialAssetStatus,
  onSocialAssetPromote,
}: DatasecSettingsViewProps) {
  const [tab, setTab] = useState<DatasecTab>("persons");
  const datasec = data.datasec || {};
  const detail = data.datasecPersonDetail || {};
  const stats = datasec.stats || {};
  const persons = Array.isArray(datasec.persons?.items) ? datasec.persons.items : [];
  const assets = Array.isArray(datasec.assets?.items) ? datasec.assets.items : [];
  const personPagination = datasec.persons?.pagination || {};
  const assetPagination = datasec.assets?.pagination || {};
  const detailPerson = detail.person;
  const detailAssets = Array.isArray(detail.assets) ? detail.assets : [];
  const storage = data.health?.services?.storage || {};
  const socialAssets = Array.isArray(data.socialAssets) ? data.socialAssets : Array.isArray(data.socialAssets?.items) ? data.socialAssets.items : [];
  const socialPositive = socialAssets.filter((asset: any) => asset.status === "positive").length;

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="overflow-hidden xl:col-span-12">
        <div className="rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 sm:p-6">
          <div className="dashboard-hero-layout">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="ok" label="Datasec interno" />
                <StatusPill tone="info" label="memoria curada" />
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-normal sm:text-3xl text-foreground">Base visual y personas verificables</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Guarda personas, rostros, imágenes y evidencias confirmadas para que futuras investigaciones consulten primero tu base interna.
              </p>
            </div>
            <div className="dashboard-hero-metrics">
              <HeroMetric label="Personas" value={String(stats.persons ?? 0)} />
              <HeroMetric label="Activos" value={String(stats.assets ?? 0)} />
              <HeroMetric label="Validados" value={String(stats.validatedAssets ?? 0)} />
              <HeroMetric label="OSINT" value={String(stats.osintAssets ?? 0)} />
            </div>
          </div>
        </div>
      </Card>

      <Card className="xl:col-span-12">
        <div className="grid gap-3 md:grid-cols-5">
          {[
            ["persons", "Personas", `${stats.persons ?? 0}`],
            ["assets", "Imágenes y señales", `${stats.assets ?? 0}`],
            ["social", "Activos sociales", `${socialAssets.length}`],
            ["import", "Importación", "lotes"],
            ["evidence", "Evidencias guardadas", `${stats.osintAssets ?? 0}`],
          ].map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id as DatasecTab)}
              className={`rounded-2xl border p-4 text-left transition ${tab === id ? "border-white bg-white text-black" : "border-border bg-black text-foreground hover:border-primary/40"}`}
            >
              <p className="text-xs font-black uppercase opacity-70">{label}</p>
              <p className="mt-2 text-2xl font-black">{count}</p>
            </button>
          ))}
        </div>
      </Card>

      <StorageStatusCard storage={storage} />

      {tab === "persons" ? (
        <>
          <DatasecPersonForm onPerson={onPerson} />
          <DatasecPersonList persons={persons} pagination={personPagination} onLoad={onLoad} onSelectPerson={onSelectPerson} />
          <DatasecPersonDetail person={detailPerson} assets={detailAssets} />
        </>
      ) : null}

      {tab === "assets" ? (
        <>
          <DatasecAssetForm onAsset={onAsset} />
          <Card className="xl:col-span-8">
            <CardHeader
              title="Galería Datasec"
              eyebrow="activos recientes"
              action={<DownloadLink href={datasecExportUrl()} label="Exportar" />}
            />
            <DatasecAssetFilters onLoad={onLoad} />
            <DatasecAssetGrid assets={assets} />
            <DatasecPager target="assets" pagination={assetPagination} onLoad={onLoad} />
          </Card>
        </>
      ) : null}

      {tab === "import" ? <DatasecImportPanel /> : null}

      {tab === "social" ? (
        <SocialAssetsPanel
          assets={socialAssets}
          positiveCount={socialPositive}
          onLoad={onSocialAssetsLoad}
          onStatus={onSocialAssetStatus}
          onPromote={onSocialAssetPromote}
        />
      ) : null}

      {tab === "evidence" ? (
        <Card className="xl:col-span-12">
          <CardHeader title="Evidencias guardadas" eyebrow="memoria OSINT" action={<DownloadLink href={datasecExportUrl({ origin: "osint" })} label="Exportar OSINT" />} />
          <form onSubmit={(event) => submit(event, onLoad)} className="mb-4 responsive-filter-grid">
            <input type="hidden" name="target" value="assets" />
            <input type="hidden" name="origin" value="osint" />
            <input name="q" className="control-input" placeholder="Buscar evidencia guardada" />
            <select name="curationStatus" className="control-input" defaultValue="">
              <option value="">Todas</option>
              <option value="candidate">Candidatas</option>
              <option value="validated">Validadas</option>
              <option value="discarded">Descartadas</option>
            </select>
            <input name="limit" className="control-input" defaultValue="24" type="number" min="1" max="100" />
            <Button>Filtrar</Button>
          </form>
          <DatasecAssetGrid assets={assets.filter((asset: any) => asset.origin === "osint")} />
        </Card>
      ) : null}
    </div>
  );
}

function DatasecPersonForm({ onPerson }: { onPerson: (form: FormData) => void }) {
  return (
    <Card className="xl:col-span-4">
      <CardHeader title="Nueva persona" eyebrow="registro Datasec" action={<StatusBadge value="curado" />} />
      <form onSubmit={(event) => submit(event, onPerson)} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="firstName" label="Nombre" placeholder="Nombre" required />
          <Field name="lastName" label="Apellido" placeholder="Apellido" />
        </div>
        <Field name="aliases" label="Alias / usernames" placeholder="usuario-ejemplo, alias" />
        <Field name="documentId" label="Documento / cédula" placeholder="ID interno o cédula" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="country" label="País" placeholder="Colombia" />
          <Field name="city" label="Ciudad" placeholder="Bogotá" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="organization" label="Organización" placeholder="Empresa" />
          <Field name="role" label="Cargo" placeholder="Analista" />
        </div>
        <Field name="tags" label="Tags" placeholder="cliente, validado, seguimiento" />
        <label className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">Notas</span>
          <textarea name="notes" className="control-textarea" placeholder="Contexto operativo, fuente, observaciones..." />
        </label>
        <Button>Guardar persona</Button>
      </form>
    </Card>
  );
}

function StorageStatusCard({ storage }: { storage: any }) {
  const provider = String(storage?.provider || "local-volume");
  const cloudinaryEnabled = Boolean(storage?.cloudinaryEnabled);
  const railwayReady = Boolean(storage?.railwayVolumeReady);

  return (
    <Card className="xl:col-span-12">
      <CardHeader title="Almacenamiento visual" eyebrow="uploads + volumen" action={<StatusBadge value={provider === "cloudinary" ? "Cloudinary" : "Local / Railway"} />} />
      <div className="grid gap-3 md:grid-cols-4">
        <StorageFact label="Proveedor" value={provider === "cloudinary" ? "Cloudinary" : "Volumen local"} tone="ok" />
        <StorageFact label="Cloudinary" value={cloudinaryEnabled ? "Activo" : "Apagado"} tone={cloudinaryEnabled ? "warn" : "ok"} />
        <StorageFact label="Railway Volume" value={railwayReady ? "Listo" : "Local"} tone={railwayReady ? "ok" : "info"} />
        <StorageFact label="Ruta pública" value={String(storage?.staticPath || "/uploads")} tone="info" />
      </div>
      <div className="mt-3 grid gap-2 rounded-2xl border border-border bg-black p-4 text-xs text-muted-foreground md:grid-cols-2">
        <p className="break-all"><span className="font-black text-foreground">Directorio:</span> {String(storage?.uploadDir || "./uploads")}</p>
        <p className="break-all"><span className="font-black text-foreground">Base URL:</span> {String(storage?.publicBaseUrl || "http://localhost:7105")}</p>
      </div>
    </Card>
  );
}

function StorageFact({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "info" }) {
  const toneClass = {
    ok: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
    warn: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    info: "border-sky-400/25 bg-sky-400/10 text-sky-100",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-[10px] font-black uppercase opacity-70">{label}</p>
      <p className="mt-2 truncate text-lg font-black">{value}</p>
    </div>
  );
}

function DatasecPersonList({
  persons,
  pagination,
  onLoad,
  onSelectPerson,
}: {
  persons: any[];
  pagination: any;
  onLoad: (form: FormData) => void;
  onSelectPerson: (personId: string) => void;
}) {
  return (
    <Card className="xl:col-span-5">
      <CardHeader title="Personas guardadas" eyebrow="base interna" action={<StatusBadge value={`${pagination.total ?? persons.length} registros`} />} />
      <form onSubmit={(event) => submit(event, onLoad)} className="mb-4 responsive-filter-grid">
        <input type="hidden" name="target" value="persons" />
        <input name="q" className="control-input" placeholder="Buscar nombre, alias, documento o ciudad" />
        <select name="status" className="control-input" defaultValue="">
          <option value="">Todos</option>
          <option value="active">Activos</option>
          <option value="archived">Archivados</option>
        </select>
        <input name="limit" className="control-input" defaultValue="12" type="number" min="1" max="100" />
        <Button>Filtrar</Button>
      </form>
      {persons.length ? (
        <div className="grid gap-3">
          {persons.map((person: any) => (
            <button key={person._id} type="button" onClick={() => onSelectPerson(person._id)} className="flex items-center gap-3 rounded-2xl border border-border bg-black p-3 text-left transition hover:border-primary/50">
              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-secondary/50">
                {person.primaryImageUrl ? <img src={person.primaryImageUrl} alt={person.firstName} className="h-full w-full object-cover" /> : <Database className="h-5 w-5 text-primary" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">{[person.firstName, person.lastName].filter(Boolean).join(" ")}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{person.documentId || person.city || "sin documento"} · {person.status || "active"}</p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">ID: {person._id}</p>
              </div>
            </button>
          ))}
          <DatasecPager target="persons" pagination={pagination} onLoad={onLoad} />
        </div>
      ) : (
        <EmptyBlock text="Todavía no hay personas en Datasec. Crea la primera para asociar imágenes y evidencias." />
      )}
    </Card>
  );
}

function DatasecPersonDetail({ person, assets }: { person?: any; assets: any[] }) {
  return (
    <Card className="xl:col-span-3">
      <CardHeader title="Detalle" eyebrow="persona seleccionada" action={<StatusBadge value={person ? `${assets.length} assets` : "sin selección"} />} />
      {person ? (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-border bg-black p-4">
            <p className="text-lg font-black text-foreground">{[person.firstName, person.lastName].filter(Boolean).join(" ")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{person.documentId || "sin documento"} · {person.city || "sin ciudad"}</p>
            <p className="mt-3 break-all text-[11px] text-muted-foreground">{person._id}</p>
          </div>
          <div className="grid gap-2">
            {assets.slice(0, 6).map((asset: any) => (
              <div key={asset._id} className="rounded-xl border border-border bg-black p-3">
                <p className="truncate text-sm font-black text-foreground">{asset.title || asset.type || "Asset"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{asset.curationStatus || "candidate"} · {asset.origin || "manual"}</p>
              </div>
            ))}
            {!assets.length ? <EmptyBlock text="Esta persona aún no tiene imágenes o evidencias asociadas." /> : null}
          </div>
        </div>
      ) : (
        <EmptyBlock text="Selecciona una persona para revisar su ficha, imágenes y evidencias asociadas." />
      )}
    </Card>
  );
}

function DatasecAssetForm({ onAsset }: { onAsset: (form: FormData) => void }) {
  return (
    <Card className="xl:col-span-4">
      <CardHeader title="Agregar imagen o señal" eyebrow="asset visual" action={<StatusBadge value="manual" />} />
      <form onSubmit={(event) => submit(event, onAsset)} className="grid gap-3">
        <Field name="personId" label="Persona Datasec" placeholder="Opcional: ID de persona" />
        <label className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">Tipo</span>
          <select name="type" className="control-input" defaultValue="image">
            <option value="image">Imagen</option>
            <option value="face">Rostro</option>
            <option value="profile">Perfil</option>
            <option value="post">Publicación</option>
            <option value="link">Enlace</option>
            <option value="document">Documento</option>
          </select>
        </label>
        <Field name="title" label="Título" placeholder="Foto principal, perfil público..." />
        <VisualFilePicker name="imageFile" label="Subir imagen" />
        <Field name="imageUrl" label="URL de imagen" placeholder="https://..." />
        <Field name="url" label="Link de origen" placeholder="https://perfil-o-fuente..." />
        <Field name="tags" label="Tags" placeholder="frontal, perfil, validado" />
        <label className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">Descripción</span>
          <textarea name="description" className="control-textarea" placeholder="Qué representa esta imagen o señal." />
        </label>
        <Button>
          <Database className="h-4 w-4" />
          Guardar en Datasec
        </Button>
      </form>
    </Card>
  );
}

function VisualFilePicker({ name, label }: { name: string; label: string }) {
  const [fileName, setFileName] = useState("");

  return (
    <label className="grid cursor-pointer gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input
        name={name}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name || "")}
      />
      <div className="flex min-h-[70px] items-center justify-between gap-4 rounded-2xl border border-border bg-black px-4 py-3 transition hover:border-primary/50 hover:bg-primary/5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <ImagePlus className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black text-foreground">Seleccionar imagen</p>
            <p className="truncate text-xs text-muted-foreground">PNG, JPG, WEBP o captura del caso</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-primary/40 px-4 py-2 text-xs font-black text-primary">Buscar</span>
      </div>
      <span className="truncate text-xs font-medium text-muted-foreground">{fileName || "Ningún archivo seleccionado"}</span>
    </label>
  );
}

function DatasecAssetFilters({ onLoad }: { onLoad: (form: FormData) => void }) {
  return (
    <form onSubmit={(event) => submit(event, onLoad)} className="mb-4 responsive-filter-grid">
      <input type="hidden" name="target" value="assets" />
      <input name="q" className="control-input" placeholder="Buscar título, fuente o tag" />
      <select name="type" className="control-input" defaultValue="">
        <option value="">Tipo</option>
        <option value="image">Imagen</option>
        <option value="face">Rostro</option>
        <option value="profile">Perfil</option>
        <option value="post">Post</option>
        <option value="link">Link</option>
      </select>
      <select name="curationStatus" className="control-input" defaultValue="">
        <option value="">Estado</option>
        <option value="candidate">Candidato</option>
        <option value="validated">Validado</option>
        <option value="discarded">Descartado</option>
      </select>
      <input name="limit" className="control-input" defaultValue="24" type="number" min="1" max="100" />
      <Button>Filtrar</Button>
    </form>
  );
}

function DatasecAssetGrid({ assets }: { assets: any[] }) {
  if (!assets.length) {
    return <EmptyBlock text="Sin activos para este filtro. Guarda una imagen, perfil o evidencia para verla aquí." />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {assets.map((asset: any) => (
        <div key={asset._id} className="overflow-hidden rounded-2xl border border-border bg-black">
          <div className="aspect-[4/3] bg-secondary/40">
            {asset.imageUrl || asset.thumbnailUrl ? (
              <img src={asset.imageUrl || asset.thumbnailUrl} alt={asset.title || "Datasec"} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-muted-foreground"><FileSearch className="h-8 w-8" /></div>
            )}
          </div>
          <div className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge value={asset.type || "asset"} />
              <StatusBadge value={asset.curationStatus || "candidate"} />
            </div>
            <p className="mt-2 truncate text-sm font-black text-foreground">{asset.title || asset.source || "Activo Datasec"}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{asset.description || asset.url || "sin descripción"}</p>
            {asset.url ? (
              <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" href={asset.url} target="_blank" rel="noreferrer">
                abrir fuente <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
            <div className="mt-3">
              <DownloadLink href={datasecAssetDownloadUrl(asset._id)} label="Descargar" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DatasecPager({ target, pagination, onLoad }: { target: string; pagination: any; onLoad: (form: FormData) => void }) {
  const page = Number(pagination?.page || 1);
  const totalPages = Number(pagination?.totalPages || 1);
  if (totalPages <= 1) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-black p-3">
      <p className="text-xs font-semibold text-muted-foreground">
        Página {page} de {totalPages} · {pagination?.total ?? 0} registros
      </p>
      <div className="flex gap-2">
        <form onSubmit={(event) => submit(event, onLoad)}>
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="page" value={Math.max(page - 1, 1)} />
          <input type="hidden" name="limit" value={pagination?.limit || (target === "persons" ? 12 : 24)} />
          <Button variant="secondary" disabled={!pagination?.hasPrev}>Anterior</Button>
        </form>
        <form onSubmit={(event) => submit(event, onLoad)}>
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="page" value={page + 1} />
          <input type="hidden" name="limit" value={pagination?.limit || (target === "persons" ? 12 : 24)} />
          <Button variant="secondary" disabled={!pagination?.hasNext}>Siguiente</Button>
        </form>
      </div>
    </div>
  );
}

function SocialAssetsPanel({
  assets,
  positiveCount,
  onLoad,
  onStatus,
  onPromote,
}: {
  assets: any[];
  positiveCount: number;
  onLoad: (form: FormData) => void;
  onStatus: (assetId: string, status: "candidate" | "positive" | "false_positive" | "archived", note?: string) => void;
  onPromote: (form: FormData) => void;
}) {
  const candidates = assets.filter((asset) => (asset.status || "candidate") === "candidate").length;
  const falsePositives = assets.filter((asset) => asset.status === "false_positive").length;

  return (
    <>
      <Card className="xl:col-span-12">
        <CardHeader title="Activos sociales" eyebrow="scraper + memoria validable" action={<StatusBadge value={`${assets.length} activos`} />} />
        <div className="grid gap-3 md:grid-cols-4">
          <SocialAssetMetric label="Candidatos" value={String(candidates)} tone="info" />
          <SocialAssetMetric label="Positivos" value={String(positiveCount)} tone="ok" />
          <SocialAssetMetric label="Falsos positivos" value={String(falsePositives)} tone="danger" />
          <SocialAssetMetric label="Fuentes" value={String(new Set(assets.map((asset) => asset.platform)).size)} tone="neutral" />
        </div>
      </Card>

      <Card className="xl:col-span-12">
        <form onSubmit={(event) => submit(event, onLoad)} className="responsive-filter-grid">
          <Field name="owner" label="Owner / username" placeholder="usuario-ejemplo" />
          <label className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Plataforma</span>
            <select name="platform" className="control-input" defaultValue="">
              <option value="">Todas</option>
              {["instagram", "facebook", "tiktok", "x", "youtube", "telegram", "github", "reddit", "bluesky"].map((platform) => (
                <option key={platform} value={platform}>{platform}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Estado</span>
            <select name="status" className="control-input" defaultValue="">
              <option value="">Todos</option>
              <option value="candidate">Candidatos</option>
              <option value="positive">Positivos</option>
              <option value="false_positive">Falsos positivos</option>
              <option value="archived">Archivados</option>
            </select>
          </label>
          <Field name="osintSearchId" label="Caso OSINT" placeholder="searchId relacionado" />
          <Field name="limit" label="Límite" placeholder="50" type="number" />
          <div className="flex items-end">
            <Button>Filtrar</Button>
          </div>
        </form>
      </Card>

      <Card className="xl:col-span-12">
        <CardHeader title="Memoria social" eyebrow="validación operativa" action={<StatusBadge value="curación" />} />
        {assets.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => (
              <SocialAssetCard
                key={asset._id || asset.id || `${asset.platform}-${asset.owner}-${asset.publicUrl}`}
                asset={asset}
                onStatus={onStatus}
                onPromote={onPromote}
              />
            ))}
          </div>
        ) : (
          <EmptyBlock text="Todavía no hay activos sociales. Ejecuta una búsqueda social o facial para alimentar esta memoria." />
        )}
      </Card>
    </>
  );
}

function SocialAssetMetric({ label, value, tone }: { label: string; value: string; tone: "ok" | "info" | "danger" | "neutral" }) {
  const classes = {
    ok: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
    info: "border-sky-400/25 bg-sky-400/10 text-sky-100",
    danger: "border-rose-400/25 bg-rose-400/10 text-rose-100",
    neutral: "border-border bg-black text-foreground",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-[10px] font-black uppercase opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function SocialAssetCard({
  asset,
  onStatus,
  onPromote,
}: {
  asset: any;
  onStatus: (assetId: string, status: "candidate" | "positive" | "false_positive" | "archived", note?: string) => void;
  onPromote: (form: FormData) => void;
}) {
  const id = String(asset._id || asset.id || "");
  const status = String(asset.status || "candidate");
  const image = asset.publicUrl || asset.relativePath || asset.metadata?.avatarUrl || asset.metadata?.profileUrl;
  const title = asset.metadata?.name || asset.metadata?.username || asset.owner || "Activo social";
  const sourceUrl = asset.sourceUrl || asset.metadata?.profileUrl || asset.publicUrl;
  const suggestedAlias = [asset.owner, asset.metadata?.username].filter(Boolean).join(", ");

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-black">
      <div className="aspect-[4/3] bg-secondary/40">
        {image && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(String(image)) ? (
          <img src={image} alt={title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground">
            <Globe2 className="h-9 w-9" />
          </div>
        )}
      </div>
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={asset.platform || "social"} />
          <SocialStatusBadge status={status} />
          <StatusBadge value={asset.type || "asset"} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-black text-foreground">{title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{asset.owner || "unknown"} · {asset.osintSearchId || asset.searchId || "sin caso"}</p>
          {asset.metadata?.score || asset.metadata?.similarity ? (
            <p className="mt-1 text-xs font-semibold text-primary">Score {asset.metadata?.score ?? Math.round(Number(asset.metadata?.similarity || 0) * 100)}</p>
          ) : null}
        </div>
        {sourceUrl ? (
          <a className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" href={sourceUrl} target="_blank" rel="noreferrer">
            abrir fuente <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" variant="secondary" disabled={!id || status === "positive"} onClick={() => onStatus(id, "positive", "Validado desde dashboard")}>
            <CheckCircle2 className="h-4 w-4" />
          </Button>
          <Button type="button" variant="secondary" disabled={!id || status === "false_positive"} onClick={() => onStatus(id, "false_positive", "Descartado desde dashboard")}>
            <XCircle className="h-4 w-4" />
          </Button>
          <Button type="button" variant="secondary" disabled={!id || status === "archived"} onClick={() => onStatus(id, "archived", "Archivado desde dashboard")}>
            <Archive className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={(event) => submit(event, onPromote)} className="grid gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-3">
          <input type="hidden" name="assetId" value={id} />
          <input type="hidden" name="curationStatus" value="validated" />
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-emerald-100">Guardar en Datasec</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">Asocia este hallazgo a una persona o crea una ficha nueva.</p>
            </div>
            <StatusBadge value={status === "positive" ? "validado" : "revisar"} />
          </div>
          <Field name="personId" label="Persona existente" placeholder="ID Datasec opcional" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field name="firstName" label="Nombre nuevo" placeholder="Jose" />
            <Field name="lastName" label="Apellido" placeholder="Cordero" />
          </div>
          <input type="hidden" name="aliases" value={suggestedAlias} />
          <Field name="tags" label="Tags" placeholder={`${asset.platform || "social"}, validado`} />
          <Button type="submit" disabled={!id}>
            <Database className="h-4 w-4" />
            Guardar
          </Button>
        </form>
      </div>
    </article>
  );
}

function SocialStatusBadge({ status }: { status: string }) {
  const label = status === "false_positive" ? "falso" : status === "positive" ? "positivo" : status === "archived" ? "archivado" : "candidato";
  const className = status === "positive"
    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
    : status === "false_positive"
      ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
      : status === "archived"
        ? "border-zinc-400/30 bg-zinc-400/10 text-zinc-100"
        : "border-sky-400/30 bg-sky-400/10 text-sky-100";
  return <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${className}`}>{label}</span>;
}

function DatasecImportPanel() {
  return (
    <Card className="xl:col-span-12">
      <CardHeader title="Importación masiva" eyebrow="próximo paso" action={<StatusBadge value="planificado" />} />
      <div className="grid gap-4 md:grid-cols-3">
        <ImportStep title="1. Subir lote" text="Imágenes individuales, carpeta comprimida o CSV con metadatos." />
        <ImportStep title="2. Revisar columnas" text="Mapear nombre, apellido, documento, ciudad, tags y archivo." />
        <ImportStep title="3. Procesar rostros" text="Detectar rostros, crear crops y preparar búsqueda facial interna." />
      </div>
    </Card>
  );
}

function DownloadLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-secondary px-3 text-xs font-black text-foreground transition hover:border-primary/50"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {label}
    </a>
  );
}

function datasecAssetDownloadUrl(assetId: string) {
  return `/api/osint?path=${encodeURIComponent(`/osint/datasec/assets/${assetId}/download`)}`;
}

function datasecExportUrl(params: Record<string, string> = {}) {
  const query = new URLSearchParams(params);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return `/api/osint?path=${encodeURIComponent(`/osint/datasec/assets/export${suffix}`)}`;
}

function ImportStep({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-black p-5">
      <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
        <Database className="h-5 w-5" />
      </div>
      <p className="text-base font-black text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="grid min-h-[140px] place-items-center rounded-2xl border border-dashed border-border bg-black/40 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-[10px] font-black uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-black text-foreground">{value}</p>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "bad" | "info"; label: string }) {
  const toneClass = {
    ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    bad: "border-red-400/30 bg-red-400/10 text-red-200",
    info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  }[tone];

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${toneClass}`}>{label}</span>;
}

function submit(event: React.FormEvent<HTMLFormElement>, handler: (form: FormData) => void) {
  event.preventDefault();
  handler(new FormData(event.currentTarget));
}
