"use client";

import { useRef, useState } from "react";
import { ChevronDown, Image, Loader2, ScanFace, Search, Shield, UserRoundSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as Dialog from "@radix-ui/react-dialog";
import { validatePersonSearchInput } from "@/lib/person-search-input";
import { Card, CardHeader } from "@/components/ui/card";

export function SearchForm({
  onSubmit,
  pending = false,
  className,
}: {
  onSubmit: (form: FormData) => void;
  pending?: boolean;
  className?: string;
}) {
  const [previewSrc, setPreviewSrc] = useState("");
  const [fileName, setFileName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const options = [
    { name: "deepSearch", label: "Ampliar búsqueda", checked: true },
    { name: "youtubeSearch", label: "Incluir videos" },
    { name: "webArchiveSearch", label: "Archivo web" },
    { name: "reverseImageSearch", label: "Buscar coincidencias de la foto" },
    { name: "generateEnhanced", label: "Mejorar la foto" },
  ];

  function handleFilePreview(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setFileName(file?.name || "");
    setError("");
    if (!file) {
      setPreviewSrc(imageUrl.trim());
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (fileInput.current?.files?.[0] === file)
        setPreviewSrc(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    try {
      validatePersonSearchInput(form);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Revisa los datos de búsqueda.",
      );
      searchInput.current?.focus();
      return;
    }
    setError("");
    onSubmit(form);
  }

  return (
    <Card className={`person-search-card ${className || "xl:col-span-7"}`}>
      <form
        aria-label="Búsqueda de personas"
        aria-busy={pending}
        noValidate
        onSubmit={handleSubmit}
        className="person-search-form"
      >
        <input
          type="hidden"
          name="searchEngines"
          value="serper,duckduckgo,bing,tavily,brave"
        />
        <div className="person-search-intro">
          <h2 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">
            <label htmlFor="person-search-term">¿A quién buscas?</label>
          </h2>
          <p
            id="person-search-hint"
            className="mt-2 text-sm text-muted-foreground"
          >
            Nombre, @usuario, correo o teléfono.
          </p>
        </div>
          <div className="person-search-query relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary"
              aria-hidden="true"
            />
            <input
              ref={searchInput}
              id="person-search-term"
              name="searchTerm"
              maxLength={500}
              autoComplete="off"
              className="control-input h-14 pl-12 text-base md:h-14 md:text-base"
              placeholder="Ej.: Laura Gómez o @lauragomez"
              aria-describedby={
                error
                  ? "person-search-hint person-search-error"
                  : "person-search-hint"
              }
              aria-invalid={Boolean(error)}
              onChange={() => setError("")}
            />
          </div>

        <div className="person-search-photo flex min-w-0 items-center gap-3 rounded-xl border border-dashed border-border bg-black p-3">
          {previewSrc ? (
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              aria-label="Ampliar foto"
              className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewSrc}
                alt="Foto de apoyo"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </button>
          ) : (
            <Image
              className="h-6 w-6 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <label
            htmlFor="search-image-file"
            className="min-w-0 flex-1 cursor-pointer rounded-lg py-2 focus-within:ring-2 focus-within:ring-primary"
          >
            <span className="block text-sm font-bold text-foreground">
              {previewSrc ? "Cambiar foto" : "Añadir foto"}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {fileName ||
                (previewSrc ? "Foto por enlace" : "Opcional · JPG, PNG o WEBP")}
            </span>
            <input
              ref={fileInput}
              id="search-image-file"
              name="imageFile"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFilePreview}
              className="sr-only"
            />
          </label>
          {fileName ? (
            <button
              type="button"
              aria-label="Quitar foto"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => {
                if (fileInput.current) fileInput.current.value = "";
                setFileName("");
                setPreviewSrc(imageUrl.trim());
              }}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <details className="person-search-options group rounded-xl border border-border bg-black">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Más opciones
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="person-search-option-groups grid gap-6 border-t border-border p-4">
            <fieldset className="min-w-0">
              <legend className="mb-3 text-sm font-bold text-foreground">
                Datos para precisar
              </legend>
              <div className="person-search-fields grid gap-3">
                <Field name="nombre" label="Nombre" placeholder="Nombre" />
                <Field
                  name="apellido"
                  label="Apellido"
                  placeholder="Apellido"
                />
                <Field
                  name="username"
                  label="Usuario"
                  placeholder="usuario-ejemplo"
                />
                <Field
                  name="email"
                  label="Correo"
                  type="email"
                  placeholder="nombre@correo.com"
                />
                <Field
                  name="telefono"
                  label="Teléfono"
                  type="tel"
                  placeholder="+57..."
                />
                <Field name="alias" label="Alias" placeholder="Apodo o alias" />
                <Field
                  name="ciudad"
                  label="Ciudad"
                  placeholder="Bogotá, Medellín..."
                />
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-3 text-sm font-bold text-foreground">
                Contexto
              </legend>
              <div className="person-search-fields grid gap-3">
                <Field
                  name="organizacion"
                  label="Organización"
                  placeholder="Empresa o institución"
                />
                <Field name="cargo" label="Cargo" placeholder="Cargo" />
                <Field
                  name="industria"
                  label="Sector"
                  placeholder="Tecnología, finanzas..."
                />
                <Field
                  name="educacion"
                  label="Educación"
                  placeholder="Universidad o formación"
                />
                <label className="person-search-notes grid min-w-0 gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Notas
                  </span>
                  <textarea
                    name="notas"
                    className="control-textarea"
                    placeholder="Lo que sabes y qué quieres encontrar"
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-3 text-sm font-bold text-foreground">
                Otra fuente de imagen
              </legend>
              <div className="person-search-fields grid gap-3">
                <Field
                  name="imageUrl"
                  label="Enlace de la foto"
                  placeholder="https://..."
                  value={imageUrl}
                  onChange={(event) => {
                    setImageUrl(event.currentTarget.value);
                    if (!fileName)
                      setPreviewSrc(event.currentTarget.value.trim());
                  }}
                />
                <Field
                  name="datasecAssetId"
                  label="Foto guardada en Datasec"
                  placeholder="ID de imagen"
                />
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-3 text-sm font-bold text-foreground">
                Alcance de búsqueda
              </legend>
              <div className="person-search-fields grid gap-2">
                {options.map((option) => (
                  <label
                    key={option.name}
                    className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 text-sm text-muted-foreground"
                  >
                    <input
                      type="checkbox"
                      name={option.name}
                      defaultChecked={option.checked}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <label className="mt-4 grid gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Nivel de búsqueda
                </span>
                <select
                  name="caseProfile"
                  className="control-input"
                  defaultValue="standard"
                >
                  <option value="standard">Estándar</option>
                  <option value="silent">Bajo impacto</option>
                  <option value="stealth">Discreta</option>
                  <option value="aggressive">Intensiva</option>
                </select>
              </label>
            </fieldset>
          </div>
        </details>

        {error ? (
          <p
            id="person-search-error"
            role="alert"
            className="person-search-error rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={pending}
          className="person-search-submit h-12 w-full rounded-xl"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {pending ? "Iniciando..." : "Iniciar búsqueda"}
        </Button>
      </form>
      <Dialog.Root
        open={previewOpen && Boolean(previewSrc)}
        onOpenChange={setPreviewOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
          <Dialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <Dialog.Title className="font-bold">Foto de apoyo</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Cerrar foto">
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Vista ampliada de la imagen seleccionada.
            </Dialog.Description>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewSrc}
              alt="Foto ampliada"
              referrerPolicy="no-referrer"
              className="max-h-[70dvh] w-full rounded-xl object-contain"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Card>
  );
}

export function SocialForms({
  onInstagram,
  onMeta,
  onFacebook,
}: {
  onInstagram: (form: FormData) => void;
  onMeta: (form: FormData) => void;
  onFacebook: (form: FormData) => void;
}) {
  return (
    <>
      <Card>
        <CardHeader title="Instagram" eyebrow="perfil + actividad" />
        <form onSubmit={(event) => submit(event, onInstagram)} className="grid gap-3">
          <Field name="username" label="Usuario" placeholder="usuario-ejemplo" required />
          <Checkbox name="fetchProfile" label="Perfil público" />
          <Checkbox name="fetchStats" label="Estadísticas" />
          <Checkbox name="fetchPosts" label="Publicaciones" />
          <Checkbox name="detectCollaborators" label="Colaboradores" />
          <Button>
            <UserRoundSearch className="h-4 w-4" />
            Buscar Instagram
          </Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Meta / Facebook" eyebrow="perfil público" />
        <form onSubmit={(event) => submit(event, onMeta)} className="grid gap-3">
          <Field name="username" label="Usuario o página" placeholder="usuario-ejemplo" required />
          <Checkbox name="fetchProfile" label="Perfil público" />
          <Checkbox name="fetchPosts" label="Publicaciones" />
          <Checkbox name="fetchPhotos" label="Fotos públicas" />
          <Button>Buscar perfil</Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Facebook Search" eyebrow="personas + páginas" />
        <form onSubmit={(event) => submit(event, onFacebook)} className="grid gap-3">
          <Field name="query" label="Query" placeholder="persona, página, keyword" required />
          <label className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Tipo</span>
            <select name="searchType" className="control-input">
              <option value="global">global</option>
              <option value="people">people</option>
              <option value="pages">pages</option>
              <option value="posts">posts</option>
              <option value="locations">locations</option>
            </select>
          </label>
          <Button>Buscar Facebook</Button>
        </form>
      </Card>
    </>
  );
}

export function FaceSearchForm({
  onFace,
  onImage,
  onDetect,
}: {
  onFace: (form: FormData) => void;
  onImage: (form: FormData) => void;
  onDetect: (form: FormData) => void;
}) {
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewLabel, setPreviewLabel] = useState("Sin imagen cargada");
  const [previewOpen, setPreviewOpen] = useState(false);

  function handleFilePreview(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      setPreviewSrc("");
      setPreviewLabel("Sin imagen cargada");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPreviewSrc(String(reader.result || ""));
      setPreviewLabel(file.name);
    };
    reader.readAsDataURL(file);
  }

  function handleUrlPreview(event: React.ChangeEvent<HTMLInputElement>) {
    const url = event.currentTarget.value.trim();
    if (!url) return;
    setPreviewSrc(url);
    setPreviewLabel("URL publica");
  }

  return (
    <Card className="xl:col-span-6">
      <CardHeader title="Buscar una persona" eyebrow="subir foto → buscar → revisar" />
      <div className="mb-5 rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
            <ScanFace className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-black text-foreground">Solo necesitas una fotografía</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Selecciona la imagen, verifica el rostro correcto y pulsa iniciar. El sistema revisará fuentes públicas, redes disponibles y memoria interna.
            </p>
          </div>
        </div>
      </div>
      <form className="grid gap-4" autoComplete="off" onSubmit={(event) => submit(event, onDetect)}>
        <div className="grid gap-3 sm:grid-cols-3">
          {["Subir", "URL", "Datasec"].map((item, index) => (
            <label key={item} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-secondary/35 px-3 text-xs font-semibold text-muted-foreground">
              <input name="imageSource" type="radio" value={item === "Subir" ? "upload" : item.toLowerCase()} defaultChecked={index === 0} className="accent-primary" />
              {item}
            </label>
          ))}
        </div>
        <div className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">Subir imagen</span>
          <label htmlFor="face-image-file" className="group flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border bg-black px-4 transition hover:border-primary/50 hover:bg-primary/5">
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                <Image className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-black text-foreground">{previewSrc ? "Imagen seleccionada" : "Seleccionar imagen"}</span>
                <span className="block truncate text-xs text-muted-foreground">{previewSrc ? previewLabel : "PNG, JPG, WEBP o captura del caso"}</span>
              </span>
            </span>
            <span className="shrink-0 rounded-full border border-primary/30 px-3 py-1 text-xs font-bold text-primary transition group-hover:bg-primary/10">Buscar</span>
          </label>
          <input id="face-image-file" name="imageFile" type="file" accept="image/*" onChange={handleFilePreview} className="sr-only" />
        </div>
        <Field name="imageUrl" label="O pegar URL pública" placeholder="https://..." onChange={handleUrlPreview} />
        <div className="rounded-2xl border border-border bg-black p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-muted-foreground">Vista previa</p>
              <p className="mt-1 line-clamp-1 text-sm font-black text-foreground">{previewLabel}</p>
            </div>
            {previewSrc ? (
              <button type="button" onClick={() => setPreviewOpen(true)} className="rounded-full border border-primary/30 px-3 py-1 text-xs font-bold text-primary">
                Ampliar
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => previewSrc && setPreviewOpen(true)}
            className="relative grid aspect-video w-full overflow-hidden rounded-xl border border-border bg-secondary/25 text-muted-foreground"
          >
            {previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="Vista previa de busqueda facial" className="h-full w-full object-contain" />
            ) : (
              <span className="grid h-full place-items-center gap-2 text-xs font-semibold">
                <Image className="mx-auto h-8 w-8 text-primary" />
                Selecciona una imagen o pega una URL
              </span>
            )}
          </button>
        </div>
        <details className="group rounded-2xl border border-border bg-black">
          <summary className="cursor-pointer list-none p-4 text-sm font-black text-foreground">
            Opciones adicionales <span className="ml-2 text-xs font-semibold text-muted-foreground">solo si tienes más datos</span>
          </summary>
          <div className="grid gap-4 border-t border-border p-4">
        <div className="grid gap-3 rounded-2xl border border-border bg-black p-4">
          <div>
            <p className="metric-label mb-1">Datasec</p>
            <p className="text-sm text-muted-foreground">Cruza la foto contra tu base interna para detectar si ya existe una persona parecida o validada.</p>
          </div>
          <Field name="datasecImageId" label="Imagen Datasec" placeholder="ID de imagen Datasec" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="datasecCameraId" label="Cámara" placeholder="camera-01" />
            <Field name="datasecPersonId" label="Persona" placeholder="person-id" />
          </div>
          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 text-xs text-muted-foreground md:text-sm">
            <input name="searchDatasec" type="checkbox" defaultChecked className="accent-primary" />
            Buscar también en Datasec
          </label>
        </div>
        <div className="grid gap-3 rounded-2xl border border-border bg-black p-4">
          <div>
            <p className="metric-label mb-1">Pistas sociales opcionales</p>
            <p className="text-sm text-muted-foreground">No son obligatorias. Si las tienes, el scraper revisa esas redes y compara candidatos con la foto subida.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="firstName" label="Nombre" placeholder="Nombre" />
            <Field name="lastName" label="Apellido" placeholder="Apellido" />
          </div>
          <Field name="username" label="Username" placeholder="usuario / @handle" />
          <label className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Perfiles conocidos</span>
            <textarea name="profileUrls" className="control-textarea" placeholder="https://instagram.com/usuario&#10;https://facebook.com/usuario" />
          </label>
        </div>
        <div className="grid gap-3 rounded-2xl border border-primary/20 bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(0,0,0,0.8))] p-4">
          <div>
            <p className="metric-label mb-1">Plan de búsqueda</p>
            <p className="text-sm text-muted-foreground">Define cuántos candidatos quieres revisar y el score mínimo para no llenar el caso con ruido.</p>
          </div>
          <label className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Modo</span>
            <select name="faceJobMode" className="control-input" defaultValue="standard">
              <option value="quick">Rápido — hasta 5 min</option>
              <option value="standard">Estándar — hasta 15 min</option>
              <option value="deep">Profundo — hasta 60 min</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="maxRuntimeMinutes" label="Minutos" type="number" min="1" max="60" defaultValue="15" />
            <Field name="maxCandidates" label="Candidatos" type="number" min="1" max="200" defaultValue="25" />
            <Field name="minCandidateScore" label="Score mínimo %" type="number" min="0" max="100" defaultValue="40" />
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Fuentes sociales</span>
            <div className="grid gap-2 sm:grid-cols-4">
              {["instagram", "facebook", "tiktok", "x", "youtube", "telegram", "threads", "bluesky"].map((platform) => (
                <label key={platform} className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 text-xs font-semibold text-muted-foreground">
                  <input name="platforms" type="checkbox" value={platform} defaultChecked className="accent-primary" />
                  {platform}
                </label>
              ))}
            </div>
          </div>
        </div>
        <label className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">Base64 avanzado</span>
          <textarea name="imageBase64" className="control-textarea" placeholder="Opcional para pruebas técnicas" />
        </label>
          </div>
        </details>
        <input type="hidden" name="userId" value="reverse-image-engine-dashboard" />
        <div className="grid gap-2">
          <Button className="h-12" type="submit">
            <ScanFace className="h-4 w-4" />
            Detectar rostros
          </Button>
        </div>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Detectar no inicia la investigación. Primero confirmarás qué persona deseas buscar.
        </p>
      </form>
      {previewOpen && previewSrc ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-5xl rounded-2xl border border-border bg-background p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="metric-label">Imagen seleccionada</p>
                <p className="line-clamp-1 text-sm font-black text-foreground">{previewLabel}</p>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} className="rounded-full border border-border px-4 py-2 text-sm font-bold text-muted-foreground">
                Cerrar
              </button>
            </div>
            <div className="max-h-[78vh] overflow-hidden rounded-xl border border-border bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewSrc} alt="Imagen ampliada" className="mx-auto max-h-[78vh] w-full object-contain" />
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function DarkwebForm({ onSubmit }: { onSubmit: (form: FormData) => void }) {
  return (
    <Card className="xl:col-span-5">
      <CardHeader title="Dark Web pipeline" eyebrow="POST /darkweb/search" />
      <form onSubmit={(event) => submit(event, onSubmit)} className="grid gap-3 md:grid-cols-2">
        <Field className="md:col-span-2" name="query" label="Query" placeholder="alias, leak, ransomware, dominio" required />
        <label className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">Preset</span>
          <select name="preset" className="control-input">
            <option value="threat_intel">threat_intel</option>
            <option value="personal_identity">personal_identity</option>
            <option value="ransomware_malware">ransomware_malware</option>
            <option value="corporate_espionage">corporate_espionage</option>
          </select>
        </label>
        <Field name="searchWorkers" label="Search workers" type="number" defaultValue="5" />
        <Field name="scrapeWorkers" label="Scrape workers" type="number" defaultValue="5" />
        <Field name="maxCharsPerPage" label="Chars/page" type="number" defaultValue="2000" />
        <label className="grid gap-2 md:col-span-2">
          <span className="text-xs font-medium text-muted-foreground">Instrucciones</span>
          <textarea name="customInstructions" className="control-textarea" />
        </label>
        {["refineQuery", "aiFilter", "scrapeContent", "generateReport"].map((name) => (
          <Checkbox key={name} name={name} label={name} />
        ))}
        <Button className="md:col-span-2">
          <Shield className="h-4 w-4" />
          Ejecutar darkweb
        </Button>
      </form>
    </Card>
  );
}

export function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; className?: string }) {
  const { label, className, ...inputProps } = props;
  return (
    <label className={className ? `grid min-w-0 gap-2 ${className}` : "grid min-w-0 gap-2"}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <input className="control-input" {...inputProps} />
    </label>
  );
}

function Checkbox({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 text-xs text-muted-foreground md:text-sm">
      <input name={name} type="checkbox" defaultChecked className="accent-primary" />
      {label}
    </label>
  );
}

function submit(event: React.FormEvent<HTMLFormElement>, handler: (form: FormData) => void) {
  event.preventDefault();
  handler(new FormData(event.currentTarget));
}
