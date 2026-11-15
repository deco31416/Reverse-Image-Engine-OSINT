"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, Database, ExternalLink, FileSearch, FileText, Gauge, Globe2, Image, KeyRound, Link2, Radar, ScanFace, SearchCheck, ShieldCheck, Sparkles, Trash2, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { compact } from "@/lib/utils";
import { getPersonSearchIdentity } from "@/lib/person-search-input";
import { ClientState, DEFAULT_API_BASE, OsintApi } from "@/lib/osint-api";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileSidebar } from "./mobile-sidebar";
import { JsonPanel } from "./json-panel";
import { DarkwebForm, FaceSearchForm, Field, SearchForm, SocialForms } from "./forms";
import { RecentSearchesPanel, SearchResultPanel, getSearchId, normalizeSearchItems, statusLabel } from "./search-panels";
import { SettingsView } from "./settings/settings-view";
import type { DashboardData, DashboardView } from "./types";

const emptyData: DashboardData = { errors: [] };
const VIEW_STORAGE_KEY = "reverse-image-engine-osint-deco.dashboard.view";
const dashboardViews: DashboardView[] = ["overview", "search", "faces", "face-lab", "social", "evidence", "network", "settings"];
type SocialResultFilter = "all" | "photos" | "posts" | "links";
type ConfirmDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
};
type FaceNotice = { tone: "info" | "success" | "error"; title: string; message: string };

export function DashboardApp() {
  const [hydrated, setHydrated] = useState(false);
  const [view, setViewState] = useState<DashboardView>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [clientState, setClientState] = useState<ClientState>({
    apiBase: DEFAULT_API_BASE,
  });
  const [data, setData] = useState<DashboardData>(emptyData);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [faceConfirmationOpen, setFaceConfirmationOpen] = useState(false);
  const [faceToConfirm, setFaceToConfirm] = useState<any>();
  const [faceNotice, setFaceNotice] = useState<FaceNotice | null>(null);

  const api = useMemo(() => new OsintApi(clientState), [clientState]);

  const setView = useCallback((nextView: DashboardView) => {
    setViewState(nextView);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    }
  }, []);

  async function run(scope: string, job: () => Promise<void>) {
    try {
      setLoading(true);
      await job();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setData((current) => ({
        ...current,
        errors: [{ scope, message }, ...current.errors].slice(0, 8),
      }));
      return message;
    } finally {
      setLoading(false);
    }
  }

  const refresh = useCallback(async () => {
    await run("refresh", async () => {
      const [health, session] = await Promise.allSettled([
        api.health(),
        fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()),
      ]);

      const healthValue = valueOf(health);
      const healthOk =
        health.status === "fulfilled" &&
        healthValue?.success !== false &&
        String(healthValue?.status || "").toLowerCase() !== "down";

      if (!healthOk) {
        setData((current) => ({
          ...current,
          health: healthValue,
          session: valueOf(session),
          apiStatus: "down",
          errors: [
            {
              scope: "refresh",
              message: healthValue?.message || "Micro OSINT no disponible todavía. Espera el puerto 7105 y pulsa Actualizar.",
            },
            ...current.errors,
          ].slice(0, 8),
        }));
        return;
      }

      const [audit, diagnostics, authUsers] = await Promise.allSettled([
        api.serviceAudit("test"),
        api.diagnostics("test"),
        fetch("/api/auth/users", { cache: "no-store" }).then(async (response) => {
          const payload = await response.json().catch(() => null);
          return response.ok ? payload : { error: payload?.message || "No tienes permiso para consultar usuarios" };
        }),
      ]);
      const next: Partial<DashboardData> = {
        health: healthValue,
        audit: valueOf(audit),
        diagnostics: valueOf(diagnostics),
        session: valueOf(session),
        authUsers: valueOf(authUsers),
        apiStatus: valueOf(health)?.status || (health.status === "fulfilled" ? "ok" : "down"),
      };

      const [searches, stats, network, socialHealth, datasec, socialAssets] = await Promise.allSettled([
        api.searches(),
        api.stats(),
        api.networkBundle(),
        api.socialHealthBundle(),
        api.datasecBundle(),
        api.listSocialAssets({ limit: 50 }),
      ]);
      next.searches = valueOf(searches);
      next.stats = valueOf(stats);
      next.network = parseNetwork(valueOf(network));
      next.socialHealth = parseSocialHealth(valueOf(socialHealth));
      next.datasec = parseDatasecBundle(valueOf(datasec));
      next.socialAssets = valueOf(socialAssets);

      setData((current) => ({ ...current, ...next }));
    });
  }, [api]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function createAuthUser(form: FormData) {
    await run("auth-user-create", async () => {
      const response = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") || "").trim(),
          username: String(form.get("username") || "").trim(),
          displayName: String(form.get("displayName") || "").trim(),
          password: String(form.get("password") || "").trim(),
          role: String(form.get("role") || "analyst"),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || "No se pudo crear el usuario");
      const users = await fetch("/api/auth/users", { cache: "no-store" }).then(async (res) => {
        const payload = await res.json().catch(() => null);
        return res.ok ? payload : { error: payload?.message || "No tienes permiso para consultar usuarios" };
      });
      setData((current) => ({ ...current, authUsers: users, profileResult: data }));
    });
  }

  async function loadAuthUsers() {
    await run("auth-users", async () => {
      const users = await fetch("/api/auth/users", { cache: "no-store" }).then(async (res) => {
        const payload = await res.json().catch(() => null);
        return res.ok ? payload : { error: payload?.message || "No tienes permiso para consultar usuarios" };
      });
      setData((current) => ({ ...current, authUsers: users }));
    });
  }

  useEffect(() => {
    const savedView = window.localStorage.getItem(VIEW_STORAGE_KEY) as DashboardView | null;
    if (savedView && dashboardViews.includes(savedView)) {
      setViewState(savedView);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void refresh();
  }, [clientState.apiBase, hydrated]);

  useEffect(() => {
    if (!hydrated || view !== "evidence" || data.caseSummary || loading) return;

    let cancelled = false;
    async function loadLatestEvidenceCase() {
      try {
        let searchesPayload = data.searches;
        let searches = normalizeSearchItems(searchesPayload);

        if (!searches.length) {
          searchesPayload = await api.searches();
          searches = normalizeSearchItems(searchesPayload);
          if (cancelled) return;
          setData((current) => ({ ...current, searches: searchesPayload }));
        }

        const latest = searches[0];
        const searchId = latest?.searchId || latest?.id;
        if (searchId && !cancelled) {
          await loadCaseById(searchId);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setData((current) => ({
          ...current,
          errors: [{ scope: "evidence-auto-load", message }, ...current.errors].slice(0, 8),
        }));
      }
    }

    void loadLatestEvidenceCase();
    return () => {
      cancelled = true;
    };
  }, [api, data.caseSummary, data.searches, hydrated, loading, view]);

  useEffect(() => {
    const jobId = data.faceJob?.jobId || data.faceJob?.searchId;
    const status = String(data.faceJob?.status || "");
    if (!jobId || !["queued", "processing"].includes(status)) return;

    const timer = window.setTimeout(() => {
      api.getFaceJob(String(jobId))
        .then((faceJob) => {
          setData((current) => ({
            ...current,
            faceJob,
            faceResult: faceJob?.faceResult
              ? {
                  ...faceJob,
                  searchId: faceJob.searchId || faceJob.jobId,
                  faceSearch: faceJob.faceResult,
                }
              : current.faceResult,
            lastSearch: faceJob?.searchId ? { searchId: faceJob.searchId, status: faceJob.status } : current.lastSearch,
          }));
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setData((current) => ({
            ...current,
            errors: [{ scope: "face-job", message }, ...current.errors].slice(0, 8),
          }));
        });
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [api, data.faceJob?.jobId, data.faceJob?.searchId, data.faceJob?.status, data.faceJob?.updatedAt]);

  useEffect(() => {
    const searchId = data.faceJob?.searchId || data.faceJob?.jobId || data.faceResult?.searchId;
    const status = String(data.faceJob?.status || data.faceResult?.status || "");
    if (!searchId || !["completed", "failed", "cancelled"].includes(status)) return;
    api.identityMemorySubject(String(searchId))
      .then((identityMemory) => setData((current) => ({ ...current, identityMemory })))
      .catch(() => undefined);
  }, [api, data.faceJob?.jobId, data.faceJob?.searchId, data.faceJob?.status, data.faceResult?.searchId, data.faceResult?.status]);

  async function createSearch(form: FormData) {
    if (searchPending) return;
    setSearchPending(true);
    try {
    await run("search", async () => {
      const imageUrl = String(form.get("imageUrl") || "").trim();
      const imageFile = form.get("imageFile");
      const imageBase64 = imageFile instanceof File && imageFile.size > 0 ? await fileToBase64(imageFile) : "";
      const datasecAssetId = String(form.get("datasecAssetId") || "").trim();
      const payload: any = {
        personalInfo: getPersonSearchIdentity(form),
        context: compact({
          organizacion: form.get("organizacion"),
          cargo: form.get("cargo"),
          industria: form.get("industria"),
          educacion: form.get("educacion"),
          notas: form.get("notas"),
        }),
        options: {
          searchEngines: String(form.get("searchEngines") || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          caseProfile: String(form.get("caseProfile") || "standard"),
          deepSearch: form.has("deepSearch"),
          youtubeSearch: form.has("youtubeSearch"),
          webArchiveSearch: form.has("webArchiveSearch"),
          reverseImageSearch: form.has("reverseImageSearch"),
          generateEnhanced: form.has("generateEnhanced"),
        },
        userId: "reverse-image-engine-dashboard",
      };
      if (imageBase64 || imageUrl || datasecAssetId) {
        payload.image = compact({
          source: datasecAssetId && !imageBase64 && !imageUrl ? "datasec" : "upload",
          url: imageUrl,
          base64: imageBase64,
          datasecImageId: datasecAssetId,
        });
      }
      const lastSearch = await api.createSearch(payload);
      setData((current) => ({ ...current, lastSearch }));
      await refresh();
    });
    } finally {
      setSearchPending(false);
    }
  }

  async function runInstagram(form: FormData) {
    await run("instagram", async () => {
      const socialResult = await api.instagram({
        username: form.get("username"),
        fetchProfile: form.has("fetchProfile"),
        fetchStats: form.has("fetchStats"),
        fetchPosts: form.has("fetchPosts"),
        detectCollaborators: form.has("detectCollaborators"),
      });
      setData((current) => ({ ...current, socialResult }));
    });
  }

  async function runFaceSearch(form: FormData) {
    await run("face-search", async () => {
      const body = await facePayload(form);
      const faceJob = await api.createFaceJob(body);
      setData((current) => ({
        ...current,
        faceJob,
        faceResult: {
          ...faceJob,
          searchId: faceJob?.searchId || faceJob?.jobId,
        },
        lastSearch: faceJob?.searchId ? { searchId: faceJob.searchId, status: faceJob.status } : current.lastSearch,
      }));
    });
  }

  async function detectFaces(form: FormData) {
    setFaceNotice({ tone: "info", title: "Detectando rostros…", message: "Deco está analizando la fotografía. La búsqueda todavía no ha comenzado." });
    let detected = false;
    const detectionError = await run("face-detect", async () => {
      const body = await facePayload(form);
      const faceSelection = await api.detectFaces({
        imageUrl: body.imageUrl,
        imageBase64: body.imageBase64,
        datasecImageId: body.datasecImageId,
        userId: body.userId,
        label: [body.firstName, body.lastName, body.username].filter(Boolean).join(" ") || "dashboard-face-search",
      });
      setData((current) => ({ ...current, faceSelection: { ...faceSelection, controls: body }, selectedFace: undefined }));
      const faces = Array.isArray(faceSelection?.faces) ? faceSelection.faces : [];
      if (faces.length) {
        detected = true;
        setFaceNotice({ tone: "success", title: `${faces.length} rostro${faces.length === 1 ? "" : "s"} detectado${faces.length === 1 ? "" : "s"}`, message: "Confirma la persona correcta para iniciar la investigación." });
        setFaceToConfirm(faces[0]);
        setFaceConfirmationOpen(true);
      }
    });
    if (!detected) setFaceNotice({
      tone: "error",
      title: "No se pudo confirmar un rostro",
      message: detectionError || "El detector no devolvió ningún rostro utilizable. Prueba una imagen más clara.",
    });
  }

  async function searchDetectedFace(face: any) {
    setFaceNotice({ tone: "info", title: "Iniciando búsqueda…", message: "Preparando internet, redes sociales y memoria interna." });
    let started = false;
    const startError = await run("face-search-selected", async () => {
      const controls = data.faceSelection?.controls || {};
      const faceJob = await api.createFaceJob({
        imageUrl: face?.imageUrl,
        searchDatasec: true,
        userId: "reverse-image-engine-dashboard",
        datasecImageId: controls.datasecImageId,
        datasecCameraId: controls.datasecCameraId,
        datasecPersonId: controls.datasecPersonId,
        firstName: controls.firstName,
        lastName: controls.lastName,
        username: controls.username,
        profileUrls: controls.profileUrls,
        mode: controls.mode || "standard",
        maxRuntimeMs: controls.maxRuntimeMs || 15 * 60 * 1000,
        maxCandidates: controls.maxCandidates || 25,
        minCandidateScore: controls.minCandidateScore ?? 0.4,
        platforms: controls.platforms || ["instagram", "facebook", "tiktok", "x", "youtube", "telegram", "threads", "bluesky"],
        selectedFace: {
          faceId: face?.faceId,
          publicId: face?.publicId,
          index: face?.index,
          original: face?.original,
          boundingBox: face?.boundingBox,
          qualityScore: face?.qualityScore,
          selectionToken: face?.selectionToken,
        },
      });
      setData((current) => ({
        ...current,
        faceJob,
        identityMemory: undefined,
        selectedFace: face,
        faceResult: {
          ...faceJob,
          searchId: faceJob?.searchId || faceJob?.jobId,
          selectedFace: face,
        },
        lastSearch: faceJob?.searchId ? { searchId: faceJob.searchId, status: faceJob.status } : current.lastSearch,
      }));
      setFaceConfirmationOpen(false);
      setFaceToConfirm(undefined);
      started = true;
      setFaceNotice({ tone: "success", title: "Búsqueda iniciada", message: "Deco ya está investigando este rostro. Puedes seguir el avance o detenerlo." });
      window.setTimeout(() => document.getElementById("face-investigation-status")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    });
    if (!started) setFaceNotice({ tone: "error", title: "La búsqueda no comenzó", message: startError || "El backend no confirmó la creación del trabajo." });
  }

  async function runImageSearch(form: FormData) {
    await run("image-search", async () => {
      const body = await facePayload(form);
      const faceResult = await api.imageSearch(body);
      setData((current) => ({ ...current, faceResult, lastSearch: faceResult }));
      if (faceResult?.searchId) await refresh();
    });
  }

  async function cancelFaceJob(jobId: string) {
    await run("face-job-cancel", async () => {
      const faceJob = await api.cancelFaceJob(jobId);
      setData((current) => ({ ...current, faceJob }));
    });
  }

  async function runEnhanceFace(form: FormData) {
    await run("enhance-face", async () => {
      const front = await faceToolImageSource(form, "front");
      const faceToolResult = await api.enhanceImage({
        frontImage: front.image,
        frontImageDatasecAssetId: front.datasecAssetId,
        description: String(form.get("description") || "").trim(),
      });
      setData((current) => ({ ...current, faceToolResult }));
    });
  }

  async function runAnalyzeFace(form: FormData) {
    await run("analyze-face", async () => {
      const image = await faceToolImageSource(form, "analysis");
      const faceToolResult = await api.analyzeFace({
        imageUrl: image.image,
        imageDatasecAssetId: image.datasecAssetId,
      });
      setData((current) => ({ ...current, faceToolResult }));
    });
  }

  async function runCompareFaces(form: FormData) {
    await run("compare-faces", async () => {
      const first = await faceToolImageSource(form, "first");
      const second = await faceToolImageSource(form, "second");
      const faceToolResult = await api.compareFaces({
        imageUrl1: first.image,
        imageDatasecAssetId1: first.datasecAssetId,
        imageUrl2: second.image,
        imageDatasecAssetId2: second.datasecAssetId,
      });
      setData((current) => ({ ...current, faceToolResult }));
    });
  }

  async function runMeta(form: FormData) {
    await run("meta", async () => {
      const socialResult = await api.meta({
        username: form.get("username"),
        fetchProfile: form.has("fetchProfile"),
        fetchPosts: form.has("fetchPosts"),
        fetchPhotos: form.has("fetchPhotos"),
      });
      setData((current) => ({ ...current, socialResult }));
    });
  }

  async function runFacebook(form: FormData) {
    await run("facebook", async () => {
      const socialResult = await api.facebookSearch({ query: form.get("query"), searchType: form.get("searchType") });
      setData((current) => ({ ...current, socialResult }));
    });
  }

  async function runDarkweb(form: FormData) {
    await run("darkweb", async () => {
      const darkwebResult = await api.darkweb({
        query: form.get("query"),
        preset: form.get("preset"),
        customInstructions: form.get("customInstructions"),
        refineQuery: form.has("refineQuery"),
        aiFilter: form.has("aiFilter"),
        scrapeContent: form.has("scrapeContent"),
        generateReport: form.has("generateReport"),
        searchWorkers: Number(form.get("searchWorkers")),
        scrapeWorkers: Number(form.get("scrapeWorkers")),
        maxCharsPerPage: Number(form.get("maxCharsPerPage")),
      });
      setData((current) => ({ ...current, darkwebResult }));
    });
  }

  async function loadCase(form: FormData) {
    await run("case", async () => {
      const searchId = String(form.get("searchId"));
      const [search, evidence, evidenceStats, scores, timeline, visualSummary, jobStatus] = await api.getCase(searchId);
      setData((current) => ({ ...current, caseSummary: { search, evidenceStats, scores, jobStatus }, evidence, timeline, visualSummary }));
    });
  }

  async function applyProfile(form: FormData) {
    await run("profile", async () => {
      const profileResult = await api.profile(String(form.get("profile")));
      const network = parseNetwork(await api.networkBundle());
      setData((current) => ({ ...current, profileResult, network }));
    });
  }

  async function createDatasecPerson(form: FormData) {
    await run("datasec-person", async () => {
      const created = await api.createDatasecPerson({
        firstName: String(form.get("firstName") || "").trim(),
        lastName: String(form.get("lastName") || "").trim(),
        aliases: splitList(form.get("aliases")),
        documentId: String(form.get("documentId") || "").trim(),
        country: String(form.get("country") || "").trim(),
        city: String(form.get("city") || "").trim(),
        organization: String(form.get("organization") || "").trim(),
        role: String(form.get("role") || "").trim(),
        phone: String(form.get("phone") || "").trim(),
        email: String(form.get("email") || "").trim(),
        tags: splitList(form.get("tags")),
        notes: String(form.get("notes") || "").trim(),
      });
      const datasec = parseDatasecBundle(await api.datasecBundle());
      setData((current) => ({ ...current, datasec: { ...datasec, lastCreated: created } }));
    });
  }

  async function createDatasecAsset(form: FormData) {
    await run("datasec-asset", async () => {
      const imageFile = form.get("imageFile");
      const commonPayload = {
        personId: String(form.get("personId") || "").trim() || undefined,
        type: String(form.get("type") || "image"),
        origin: "manual",
        title: String(form.get("title") || "").trim(),
        description: String(form.get("description") || "").trim(),
        url: String(form.get("url") || "").trim(),
        imageUrl: String(form.get("imageUrl") || "").trim(),
        thumbnailUrl: String(form.get("thumbnailUrl") || "").trim(),
        source: "dashboard",
        curationStatus: "validated",
        tags: splitList(form.get("tags")),
      };
      const created = imageFile instanceof File && imageFile.size > 0
        ? await api.uploadDatasecImage({
            ...commonPayload,
            imageBase64: await fileToBase64(imageFile),
            filename: imageFile.name,
            mimeType: imageFile.type,
          })
        : await api.createDatasecAsset(commonPayload);
      const datasec = parseDatasecBundle(await api.datasecBundle());
      setData((current) => ({ ...current, datasec: { ...datasec, lastCreated: created } }));
    });
  }

  async function loadDatasec(form: FormData) {
    await run("datasec-load", async () => {
      const target = String(form.get("target") || "persons");
      const q = String(form.get("q") || "").trim();
      const page = Number(form.get("page") || 1);
      const limit = Number(form.get("limit") || (target === "persons" ? 12 : 24));
      const datasec = data.datasec || {};

      if (target === "assets") {
        const assets = await api.listDatasecAssets({
          q,
          page,
          limit,
          type: String(form.get("type") || ""),
          curationStatus: String(form.get("curationStatus") || ""),
          origin: String(form.get("origin") || ""),
          personId: String(form.get("personId") || ""),
        });
        setData((current) => ({ ...current, datasec: { ...datasec, assets } }));
        return;
      }

      const persons = await api.listDatasecPersons({
        q,
        page,
        limit,
        status: String(form.get("status") || ""),
      });
      setData((current) => ({ ...current, datasec: { ...datasec, persons } }));
    });
  }

  async function selectDatasecPerson(personId: string) {
    await run("datasec-person-detail", async () => {
      const datasecPersonDetail = await api.getDatasecPerson(personId);
      setData((current) => ({ ...current, datasecPersonDetail }));
    });
  }

  async function loadSocialAssets(form: FormData) {
    await run("social-assets-load", async () => {
      const socialAssets = await api.listSocialAssets({
        platform: String(form.get("platform") || ""),
        owner: String(form.get("owner") || ""),
        status: String(form.get("status") || ""),
        osintSearchId: String(form.get("osintSearchId") || ""),
        limit: Number(form.get("limit") || 50),
      });
      setData((current) => ({ ...current, socialAssets }));
    });
  }

  async function markSocialAsset(assetId: string, status: "candidate" | "positive" | "false_positive" | "archived", note?: string) {
    await run("social-asset-status", async () => {
      const updated = await api.markSocialAssetStatus(assetId, { status, note });
      const socialAssets = await api.listSocialAssets({ limit: 50 });
      setData((current) => ({ ...current, socialAssets, profileResult: updated }));
    });
  }

  async function promoteSocialAsset(form: FormData) {
    await run("social-asset-promote", async () => {
      const assetId = String(form.get("assetId") || "").trim();
      const firstName = String(form.get("firstName") || "").trim();
      const lastName = String(form.get("lastName") || "").trim();
      const promoted = await api.promoteSocialAssetToDatasec(assetId, {
        personId: String(form.get("personId") || "").trim() || undefined,
        createPerson: firstName ? { firstName, lastName, aliases: splitList(form.get("aliases")), tags: ["social-scraper"] } : undefined,
        curationStatus: String(form.get("curationStatus") || "validated"),
        tags: splitList(form.get("tags")),
      });
      const [datasec, socialAssets] = await Promise.all([
        api.datasecBundle(),
        api.listSocialAssets({ limit: 50 }),
      ]);
      setData((current) => ({
        ...current,
        datasec: { ...parseDatasecBundle(datasec), lastPromoted: promoted },
        socialAssets,
        profileResult: promoted,
      }));
    });
  }

  async function promoteEvidence(form: FormData) {
    await run("datasec-promote", async () => {
      const promoted = await api.promoteEvidenceToDatasec({
        evidenceId: String(form.get("evidenceId") || "").trim(),
        personId: String(form.get("personId") || "").trim() || undefined,
        curationStatus: String(form.get("curationStatus") || "candidate"),
        tags: splitList(form.get("tags")),
      });
      const datasec = parseDatasecBundle(await api.datasecBundle());
      setData((current) => ({ ...current, datasec: { ...datasec, lastPromoted: promoted } }));
    });
  }

  async function enrichEvidenceImage(evidenceId: string, searchId?: string) {
    await run("evidence-image-enrichment", async () => {
      const enriched = await api.enrichEvidenceImage(evidenceId);
      if (searchId) await loadCaseById(searchId);
      setData((current) => ({ ...current, profileResult: enriched }));
    });
  }

  async function reviewIdentityCandidate(candidateId: string, status: "probable" | "rejected", searchId?: string) {
    await run("identity-candidate-review", async () => {
      await api.reviewIdentityCandidate(candidateId, {
        status,
        reason: status === "probable" ? "Marcado como candidato probable por el analista" : "Descartado manualmente por el analista",
      });
      if (searchId) {
        const identityMemory = await api.identityMemorySubject(searchId);
        setData((current) => ({ ...current, identityMemory }));
      }
    });
  }

  async function updateCase(form: FormData) {
    await run("case-update", async () => {
      const searchId = String(form.get("searchId") || "").trim();
      if (!searchId) throw new Error("Carga un caso antes de actualizarlo.");
      await api.updateSearch(searchId, {
        query: String(form.get("query") || "").trim(),
        description: String(form.get("description") || "").trim(),
        tags: splitList(form.get("tags")),
      });
      await loadCaseById(searchId);
      const searches = await api.searches();
      setData((current) => ({ ...current, searches }));
    });
  }

  async function rerunCase(searchId: string) {
    await run("case-rerun", async () => {
      if (!searchId) throw new Error("Carga un caso antes de relanzar búsqueda.");
      const jobStatus = await api.reExecuteSearch(searchId);
      await loadCaseById(searchId);
      setData((current) => ({ ...current, profileResult: jobStatus }));
    });
  }

  async function refineCase(form: FormData) {
    await run("case-refine", async () => {
      const searchId = String(form.get("searchId") || "").trim();
      if (!searchId) throw new Error("Carga un caso antes de crear una búsqueda refinada.");
      const refined = await api.refineSearchFromPositives(searchId, {
        query: String(form.get("query") || "").trim(),
        note: String(form.get("note") || "").trim(),
      });
      const nextSearchId = String(refined.searchId || "");
      if (nextSearchId) await loadCaseById(nextSearchId);
      const searches = await api.searches();
      setData((current) => ({ ...current, searches, profileResult: refined }));
    });
  }

  async function validateEvidence(evidenceId: string, status: "valid" | "false_positive", searchId?: string) {
    await run("evidence-validate", async () => {
      if (!evidenceId) throw new Error("Esta evidencia no trae identificador validable.");
      const validated = await api.validateEvidence(evidenceId, { status });
      if (searchId) await loadCaseById(searchId);
      setData((current) => ({ ...current, profileResult: validated }));
    });
  }

  async function clearCaseEvidences(searchId: string) {
    if (!searchId) return;
    setConfirmDialog({
      title: "Limpiar evidencias",
      description: "Se borrarán todos los hallazgos de este expediente, pero el caso seguirá existiendo para relanzarlo o documentarlo.",
      confirmLabel: "Limpiar evidencias",
      onConfirm: async () => {
        await run("case-clear-evidences", async () => {
          const result = await api.clearSearchEvidences(searchId);
          await loadCaseById(searchId);
          setData((current) => ({ ...current, profileResult: result }));
        });
      },
    });
  }

  async function deleteCase(searchId: string) {
    if (!searchId) return;
    let inventory: any;
    try {
      inventory = await api.caseCleanupPreview(searchId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setData((current) => ({ ...current, errors: [{ scope: "case-cleanup-preview", message }, ...current.errors].slice(0, 8) }));
      return;
    }
    setConfirmDialog({
      title: "Eliminar expediente",
      description: `Se eliminarán ${inventory.evidences || 0} evidencias, ${inventory.identityCandidates || 0} candidatos, ${inventory.targetSubjects || 0} sujetos con sus plantillas biométricas y ${inventory.custodyFolders?.length || 0} carpetas de custodia. Si falla un archivo, Mongo no se eliminará y podrás reintentar.`,
      confirmLabel: "Eliminar expediente",
      onConfirm: async () => {
        await run("case-delete", async () => {
          const result = await api.deleteSearch(searchId);
          const searches = await api.searches();
          setData((current) => ({
            ...current,
            searches,
            caseSummary: undefined,
            evidence: undefined,
            timeline: undefined,
            visualSummary: undefined,
            profileResult: result,
          }));
        });
      },
    });
  }

  async function deleteEvidence(evidenceId: string, searchId?: string) {
    if (!evidenceId) return;
    setConfirmDialog({
      title: "Archivar evidencia",
      description: "El hallazgo saldrá de las vistas normales, conservará su cadena de custodia y podrá restaurarse después.",
      confirmLabel: "Archivar evidencia",
      onConfirm: async () => {
        await run("evidence-delete", async () => {
          const result = await api.deleteEvidence(evidenceId);
          if (searchId) await loadCaseById(searchId);
          setData((current) => ({ ...current, profileResult: result }));
        });
      },
    });
  }

  async function restoreEvidence(evidenceId: string, searchId?: string) {
    await run("evidence-restore", async () => {
      const result = await api.restoreEvidence(evidenceId);
      if (searchId) await loadCaseById(searchId);
      setData((current) => ({ ...current, profileResult: result }));
    });
  }

  if (!hydrated) {
    return <DashboardBootScreen />;
  }

  return (
    <div className="dashboard-shell min-h-dvh xl:grid xl:grid-cols-[auto_minmax(0,1fr)]">
      <div className="hidden xl:block">
        <Sidebar activeView={view} collapsed={collapsed} onToggle={() => setCollapsed((item) => !item)} onViewChange={setView} onLogout={logout} />
      </div>
      <MobileSidebar open={mobileOpen} onOpenChange={setMobileOpen} activeView={view} onViewChange={setView} onLogout={logout} />

      <main className="min-w-0">
        <Topbar
          view={view}
          apiStatus={data.apiStatus}
          loading={loading}
          notifications={buildDashboardNotifications(data)}
          onRefresh={refresh}
          onOpenMobile={() => setMobileOpen(true)}
        />
        <div className="dashboard-content mx-auto min-w-0 max-w-[1600px] px-4 pb-4 pt-4 lg:px-6 lg:pb-6">
          <DashboardAlerts data={data} />
          <div>{renderView(view)}</div>
          <Footer />
        </div>
      </main>
      {confirmDialog ? (
        <ConfirmActionModal
          dialog={confirmDialog}
          loading={loading}
          onClose={() => setConfirmDialog(null)}
          onConfirm={async () => {
            const action = confirmDialog.onConfirm;
            setConfirmDialog(null);
            await action();
          }}
        />
      ) : null}
      {faceConfirmationOpen && faceToConfirm ? (
        <FaceSearchConfirmationModal
          face={faceToConfirm}
          faces={Array.isArray(data.faceSelection?.faces) ? data.faceSelection.faces : []}
          loading={loading}
          onSelect={setFaceToConfirm}
          onClose={() => {
            setFaceConfirmationOpen(false);
            setFaceToConfirm(undefined);
          }}
          onConfirm={() => searchDetectedFace(faceToConfirm)}
        />
      ) : null}
      {faceNotice ? (
        <FaceOperationNotice notice={faceNotice} onClose={() => setFaceNotice(null)} />
      ) : null}
    </div>
  );

  function renderView(active: DashboardView) {
    if (active === "overview") return <Overview data={data} />;
    if (active === "search") return <SearchView data={data} apiBase={clientState.apiBase} onSearch={createSearch} onLoadLast={loadCaseById} pending={searchPending} />;
    if (active === "faces") {
      return (
        <FacesView
          data={data}
          onFace={runFaceSearch}
          onImage={runImageSearch}
          onDetect={detectFaces}
          onSearchDetectedFace={searchDetectedFace}
          onRequestFaceConfirmation={(face) => {
            setFaceToConfirm(face);
            setFaceConfirmationOpen(true);
          }}
          onLoad={loadCaseById}
          onCancelFaceJob={cancelFaceJob}
          onReviewIdentityCandidate={reviewIdentityCandidate}
        />
      );
    }
    if (active === "face-lab") {
      return (
        <FaceLabView
          result={data.faceToolResult}
          onEnhance={runEnhanceFace}
          onAnalyze={runAnalyzeFace}
          onCompare={runCompareFaces}
        />
      );
    }
    if (active === "social") return <SocialView data={data} onInstagram={runInstagram} onMeta={runMeta} onFacebook={runFacebook} />;
    if (active === "darkweb") return <DarkwebView data={data} onDarkweb={runDarkweb} />;
    if (active === "evidence") {
      return (
        <EvidenceView
          data={data}
          onLoadCase={loadCase}
          onPromote={promoteEvidence}
          onUpdateCase={updateCase}
          onRerunCase={rerunCase}
          onRefineCase={refineCase}
          onValidateEvidence={validateEvidence}
          onClearCaseEvidences={clearCaseEvidences}
          onDeleteCase={deleteCase}
          onDeleteEvidence={deleteEvidence}
          onRestoreEvidence={restoreEvidence}
          onEnrichEvidenceImage={enrichEvidenceImage}
          onReviewIdentityCandidate={reviewIdentityCandidate}
        />
      );
    }
    if (active === "settings") {
      return (
        <SettingsView
          data={data}
          onDatasecPerson={createDatasecPerson}
          onDatasecAsset={createDatasecAsset}
          onDatasecLoad={loadDatasec}
          onDatasecSelectPerson={selectDatasecPerson}
          onSocialAssetsLoad={loadSocialAssets}
          onSocialAssetStatus={markSocialAsset}
          onSocialAssetPromote={promoteSocialAsset}
          onAuthUserCreate={createAuthUser}
          onAuthUsersLoad={loadAuthUsers}
        />
      );
    }
    return <NetworkView data={data} loading={loading} onProfile={applyProfile} />;
  }

  async function loadCaseById(searchId: string) {
    await run("case", async () => {
      const [caseData, identityMemoryResult, archivedEvidence] = await Promise.all([
        api.getCase(searchId),
        api.identityMemorySubject(searchId).catch(() => null),
        api.archivedEvidence(searchId).catch(() => []),
      ]);
      const [search, evidence, evidenceStats, scores, timeline, visualSummary, jobStatus] = caseData;
      setData((current) => ({ ...current, caseSummary: { search, evidenceStats, scores, jobStatus }, evidence, archivedEvidence, timeline, visualSummary, identityMemory: identityMemoryResult }));
      setView("evidence");
    });
  }
}

function FaceOperationNotice({ notice, onClose }: { notice: FaceNotice; onClose: () => void }) {
  const styles = notice.tone === "success"
    ? "border-emerald-500/40 bg-emerald-950/95 text-emerald-100"
    : notice.tone === "error"
      ? "border-danger/45 bg-red-950/95 text-red-100"
      : "border-primary/45 bg-slate-950/95 text-foreground";
  return (
    <div className={`fixed right-4 top-4 z-[60] w-[min(420px,calc(100vw-2rem))] rounded-2xl border p-4 shadow-2xl shadow-black/60 backdrop-blur ${styles}`} role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {notice.tone === "success" ? <CheckCircle2 className="h-5 w-5" /> : notice.tone === "error" ? <AlertTriangle className="h-5 w-5" /> : <Activity className="h-5 w-5 animate-pulse" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">{notice.title}</p>
          <p className="mt-1 text-xs leading-relaxed opacity-80">{notice.message}</p>
        </div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-current/20 opacity-70 hover:opacity-100" aria-label="Cerrar notificación">
          <XCircle className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function FaceSearchConfirmationModal({
  face,
  faces,
  loading,
  onSelect,
  onClose,
  onConfirm,
}: {
  face: any;
  faces: any[];
  loading: boolean;
  onSelect: (face: any) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const image = face?.thumbnailUrl || face?.imageUrl;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="face-confirm-title">
      <div className="w-full max-w-2xl rounded-[1.35rem] border border-primary/35 bg-card p-5 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="metric-label">Paso 2 de 2</p>
            <h2 id="face-confirm-title" className="mt-1 text-2xl font-black text-foreground">Confirma a quién deseas buscar</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              El rostro ya fue detectado. La investigación todavía no ha comenzado.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-[220px_1fr]">
          <div className="aspect-square overflow-hidden rounded-2xl border border-primary/35 bg-black">
            {image ? <img src={image} alt="Rostro seleccionado" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><ScanFace className="h-10 w-10 text-primary" /></div>}
          </div>
          <div className="grid content-start gap-3">
            <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
              <p className="text-sm font-black text-foreground">Persona seleccionada</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Al iniciar, Deco consultará memoria interna, imágenes públicas y redes disponibles. Podrás detener el proceso desde el indicador de progreso.</p>
            </div>
            {faces.length > 1 ? (
              <div>
                <p className="mb-2 text-xs font-bold text-muted-foreground">La fotografía contiene {faces.length} rostros. Elige uno:</p>
                <div className="flex flex-wrap gap-2">
                  {faces.map((item: any, index: number) => (
                    <button key={item.faceId || index} type="button" onClick={() => onSelect(item)} className={`h-16 w-16 overflow-hidden rounded-xl border-2 bg-black ${item.faceId === face.faceId ? "border-primary" : "border-border"}`}>
                      <img src={item.thumbnailUrl || item.imageUrl} alt={`Persona ${index + 1}`} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button type="button" onClick={onConfirm} disabled={loading}>
            <SearchCheck className="h-4 w-4" />
            {loading ? "Iniciando búsqueda…" : "Iniciar búsqueda de esta persona"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmActionModal({
  dialog,
  loading,
  onClose,
  onConfirm,
}: {
  dialog: ConfirmDialogState;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[1.35rem] border border-danger/35 bg-card p-5 shadow-2xl shadow-black/50">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-danger/35 bg-danger/10 text-danger">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xl font-black text-foreground">{dialog.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{dialog.description}</p>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-border bg-black p-4">
          <p className="text-xs font-black uppercase text-danger">Acción sensible</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Esta operación modifica los datos guardados del expediente. Revisa que el caso correcto esté cargado antes de continuar.
          </p>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="secondary" className="h-11" disabled={loading} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" className="h-11 bg-danger text-white hover:bg-danger/90" disabled={loading} onClick={onConfirm}>
            <Trash2 className="h-4 w-4" />
            {loading ? "Procesando..." : dialog.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Overview({ data }: { data: DashboardData }) {
  const searchItems = normalizeSearchItems(data.searches);
  const auditRows = visibleAuditRows(data.audit?.auditRows);
  const connectedSources = auditRows.filter((row: any) => ["ok", "configured"].includes(String(row.status).toLowerCase())).length;
  const totalSources = auditRows.length || 0;
  const latestSearch = searchItems[0];
  const isOnline = ["ok", "up"].includes(String(data.health?.status || data.apiStatus || "").toLowerCase());

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="min-h-[280px] overflow-hidden xl:col-span-8">
        <CardHeader title="Resumen de investigaciones" eyebrow="visión general" action={<StatusBadge value={isOnline ? "listo" : "pendiente"} />} />
        <div className="grid min-h-[180px] rounded-[1.15rem] border border-border bg-black p-5">
          <div className="grid content-between gap-5">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-border text-primary">
                <Radar className="h-6 w-6" />
              </div>
              <div>
                <p className="admin-section-title">Centro de inteligencia OSINT</p>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Crea casos, reúne evidencias públicas y prepara reportes para revisión operativa sin exponer configuración técnica.
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Signal label="Último caso" value={latestSearch?.query || "Sin casos"} />
              <Signal label="Fuentes disponibles" value={totalSources ? `${connectedSources}/${totalSources}` : "Pendiente"} />
              <Signal label="Estado" value={isOnline ? "Listo para operar" : "Conexión pendiente"} />
            </div>
          </div>
        </div>
      </Card>
      <Metric title="Investigaciones" value={searchItems.length || 0} icon={FileSearch} className="xl:col-span-4" />
      <Metric title="Fuentes" value={totalSources ? `${connectedSources}/${totalSources}` : "-"} icon={Globe2} className="xl:col-span-4" />
      <Metric title="Evidencias" value={data.stats?.totalEvidences ?? data.stats?.evidenceCount ?? "-"} icon={Database} className="xl:col-span-4" />
      <Metric title="Reportes" value={searchItems.length ? "Listos" : "-"} icon={FileText} className="xl:col-span-4" />
      <Card className="xl:col-span-8">
        <CardHeader title="Actividad reciente" eyebrow="casos" />
        <div className="grid gap-3">
          {searchItems.length ? searchItems.slice(0, 4).map((item: any) => (
            <div key={item.searchId || item._id || item.id || item.query} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-black p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-foreground">{item.query || "Investigación sin título"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{statusLabel(item.status)} · {item.createdAt || "sin fecha"}</p>
              </div>
              <StatusBadge value={statusLabel(item.status)} />
            </div>
          )) : (
            <div className="rounded-2xl border border-border bg-black p-5 text-sm text-muted-foreground">
              Todavía no hay investigaciones visibles. Crea una búsqueda para empezar a llenar este panel.
            </div>
          )}
        </div>
      </Card>
      <Card className="xl:col-span-4">
        <CardHeader title="Acciones rápidas" eyebrow="operación" />
        <div className="grid gap-3">
          <QuickAction title="Crear investigación" text="Inicia un caso multi-modal con datos, imagen o contexto." />
          <QuickAction title="Revisar evidencias" text="Abre hallazgos, fuentes y reportes por searchId." />
          <QuickAction title="Control técnico" text="Consulta conectores y auditoría cuando algo no responda." />
        </div>
      </Card>
    </div>
  );
}

function DashboardBootScreen() {
  return (
    <div className="min-h-screen bg-black p-4 lg:p-7">
      <div className="mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-[1600px] place-items-center">
        <Card className="w-full max-w-2xl overflow-hidden">
          <div className="rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.20),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
                <Radar className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-black text-foreground">Reverse Image Engine</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Preparando tu último espacio de trabajo y sincronizando el panel.
                </p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full w-2/3 rounded-full bg-primary" />
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SearchView({ data, apiBase, onSearch, onLoadLast, pending }: {
  data: DashboardData;
  apiBase: string;
  onSearch: (form: FormData) => void;
  onLoadLast: (searchId: string) => void;
  pending: boolean;
}) {
  const hasResult = Boolean(getSearchId(data.lastSearch));
  const hasRecent = normalizeSearchItems(data.searches).length > 0;
  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <SearchForm onSubmit={onSearch} pending={pending} className={hasResult ? "xl:col-span-7" : "w-full max-w-[1040px] justify-self-center xl:col-span-12"} />
      {hasResult ? <SearchResultPanel apiBase={apiBase} result={data.lastSearch} onLoad={onLoadLast} /> : null}
      {hasRecent ? <RecentSearchesPanel payload={data.searches} onLoad={onLoadLast} /> : null}
    </div>
  );
}

function FacesView({
  data,
  onFace,
  onImage,
  onDetect,
  onSearchDetectedFace,
  onRequestFaceConfirmation,
  onLoad,
  onCancelFaceJob,
  onReviewIdentityCandidate,
}: {
  data: DashboardData;
  onFace: (form: FormData) => void;
  onImage: (form: FormData) => void;
  onDetect: (form: FormData) => void;
  onSearchDetectedFace: (face: any) => void;
  onRequestFaceConfirmation: (face: any) => void;
  onLoad: (searchId: string) => void;
  onCancelFaceJob: (jobId: string) => void;
  onReviewIdentityCandidate: (candidateId: string, status: "probable" | "rejected", searchId?: string) => void;
}) {
  const result = normalizeFaceResult(data.faceResult, data.selectedFace);
  const faceJob = data.faceJob || {};
  const candidateGroups = groupFaceCandidates(result.matches);

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="overflow-hidden xl:col-span-12">
        <div className="rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.20),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 sm:p-6">
          <div className="dashboard-hero-layout">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="ok" label="Búsqueda facial" />
                <StatusPill tone="info" label="Imagen inversa" />
                <StatusPill tone="warn" label="IA visual" />
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-normal sm:text-3xl text-foreground">Busca una persona desde un rostro</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Sube una foto y el investigador facial cruza imagen inversa, Datasec, memoria social y fuentes públicas para ordenar candidatos por confianza.
              </p>
            </div>
            <div className="dashboard-hero-metrics">
              <HeroMetric label="Modo" value={faceJob.modeProfile || result.mode} />
              <HeroMetric label="Matches" value={String(result.totalMatches)} />
              <HeroMetric label="Perfiles" value={String(result.profiles.length)} />
              <HeroMetric label="Estado" value={commercialFaceStatus(faceJob.status || (result.searchId ? "listo" : "nuevo"))} />
            </div>
          </div>
        </div>
      </Card>
      <FaceSearchForm onFace={onFace} onImage={onImage} onDetect={onDetect} />
      <Card id="face-investigation-status" className="scroll-mt-4 xl:col-span-6">
        <CardHeader
          title="Investigación facial"
          eyebrow="candidatos + score + fuentes"
          action={<StatusBadge value={result.searchId ? commercialFaceStatus(result.status) : "sin búsqueda"} />}
        />
        {result.searchId ? (
          <div className="grid gap-4">
            {faceJob.jobId || faceJob.searchId ? <FaceJobProgress job={faceJob} onCancel={onCancelFaceJob} /> : null}
            <FaceInvestigationBrief result={result} job={faceJob} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Signal label="Caso" value={compactId(String(result.searchId))} />
              <Signal label="Rostros" value={String(result.facesDetected ?? "-")} />
              <Signal label="Coincidencias" value={String(result.totalMatches)} />
              <Signal label="Tiempo" value={result.processingTime ? `${result.processingTime}ms` : "-"} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <FaceImageCard title="Imagen original" src={result.originalImageUrl} />
              <FaceImageCard title="Rostro detectado" src={result.croppedFaceUrl} />
            </div>
            <FaceAnalysisSummary analysis={result.analysis} />
            <FaceVisualContextPanel context={result.visualContext} />
            <div className="flex flex-wrap gap-2">
              {result.engines.length ? result.engines.map((engine: string) => (
                <StatusPill key={engine} tone="info" label={engine} />
              )) : (
                <StatusPill tone="warn" label="motores pendientes" />
              )}
            </div>
            <Button type="button" variant="secondary" onClick={() => onLoad(String(result.searchId))}>
              <FileSearch className="h-4 w-4" />
              Abrir evidencias del caso
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-black p-5">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
                <ScanFace className="h-6 w-6" />
              </div>
              <div>
                <p className="text-base font-black text-foreground">Sube un rostro y recibe candidatos</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  El sistema intentará encontrar coincidencias públicas, revisar tu Datasec y comparar contra memoria social guardada. Si agregas nombre o username, buscará también perfiles sociales.
                </p>
              </div>
            </div>
          </div>
        )}
      </Card>
      <IdentityMemoryPanel
        memory={data.identityMemory}
        searchId={result.searchId ? String(result.searchId) : undefined}
        onReview={onReviewIdentityCandidate}
      />
      <FaceSelectionPanel selection={data.faceSelection} selectedFace={data.selectedFace} onSearchFace={onRequestFaceConfirmation} />
      <Card className="xl:col-span-7">
        <CardHeader title="Candidatos visuales" eyebrow="ordenados por confianza" action={<StatusBadge value={`${result.matches.length} candidatos`} />} />
        {result.matches.length ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Signal label="Pistas destacadas" value={String(candidateGroups.high.length)} />
              <Signal label="Perfiles" value={String(candidateGroups.profiles.length)} />
              <Signal label="Fuentes web" value={String(candidateGroups.sources.length)} />
              <Signal label="Solo imagen" value={String(candidateGroups.imageOnly.length)} />
            </div>
            <FaceCandidateSection
              title="Pistas visuales destacadas"
              eyebrow="relevancia del buscador, no identidad confirmada"
              empty="Todavía no hay pistas visuales destacadas."
              items={candidateGroups.high}
            />
            <FaceCandidateSection
              title="Perfiles localizados"
              eyebrow="redes y páginas personales"
              empty="No se localizaron perfiles sociales claros todavía."
              items={candidateGroups.profiles}
            />
            <FaceCandidateSection
              title="Fuentes web"
              eyebrow="páginas donde aparece"
              empty="No hay páginas fuente con URL accionable todavía."
              items={candidateGroups.sources}
            />
            <FaceCandidateSection
              title="Pistas visuales"
              eyebrow="cache o imagen sin perfil"
              empty="No hay imágenes cacheadas sin fuente."
              items={candidateGroups.imageOnly}
              compact
            />
          </div>
        ) : (
          <EmptyBlock text="Cuando el investigador encuentre candidatos, aparecerán aquí con imagen, fuente y score. Si solo tienes rostro, prueba Datasec activo y modo profundo." />
        )}
      </Card>
      <Card className="xl:col-span-5">
        <CardHeader title="Perfiles detectados" eyebrow="social profiles" action={<StatusBadge value={`${result.profiles.length} perfiles`} />} />
        {result.profiles.length ? (
          <div className="grid gap-3">
            {result.profiles.slice(0, 10).map((profile: any, index: number) => (
              <div key={profile.url || profile.username || index} className="rounded-2xl border border-border bg-black p-4">
                <p className="text-sm font-black text-foreground">{profile.username || profile.name || "Perfil social"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{profile.platform || profile.source || "social"} · coincidencia visual</p>
                {profile.url ? (
                  <a className="mt-2 block truncate text-xs font-semibold text-primary hover:underline" href={profile.url} target="_blank" rel="noreferrer">
                    {profile.url}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyBlock text="Sin perfiles sociales detectados todavía." />
        )}
      </Card>
      <DatasecFacesPanel datasec={result.datasec} />
    </div>
  );
}

function FaceSelectionPanel({
  selection,
  selectedFace,
  onSearchFace,
}: {
  selection?: any;
  selectedFace?: any;
  onSearchFace: (face: any) => void;
}) {
  const faces = Array.isArray(selection?.faces) ? selection.faces : [];

  return (
    <Card className="xl:col-span-12">
      <CardHeader
        title="Rostros encontrados"
        eyebrow="elige a quien buscar"
        action={<StatusBadge value={selection?.status ? `${faces.length} listos` : "pendiente"} />}
      />
      {faces.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {faces.map((face: any, index: number) => (
            <div
              key={face.faceId || face.imageUrl || index}
              className={`flex h-full flex-col rounded-2xl border bg-black p-3 ${selectedFace?.faceId === face.faceId ? "border-primary shadow-[0_0_0_1px_rgba(47,128,237,0.45)]" : "border-border"}`}
            >
              <button
                type="button"
                className="group relative aspect-square overflow-hidden rounded-2xl border border-border bg-secondary/30"
                onClick={() => onSearchFace(face)}
              >
                {face.imageUrl || face.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={face.thumbnailUrl || face.imageUrl} alt={face.label || "Rostro detectado"} className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                ) : (
                  <div className="grid h-full place-items-center text-muted-foreground">
                    <ScanFace className="h-8 w-8" />
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full border border-primary/30 bg-black/80 px-3 py-1 text-xs font-black text-primary">
                  {face.label || `Rostro ${index + 1}`}
                </span>
              </button>
              <div className="mt-3 grid flex-1 gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-foreground">{face.fallback ? "Imagen completa" : `Persona ${index + 1}`}</p>
                  <StatusPill tone={selectedFace?.faceId === face.faceId ? "info" : face.fallback ? "warn" : "ok"} label={selectedFace?.faceId === face.faceId ? "seleccionado" : face.fallback ? "manual" : `${Math.round(face.qualityScore || 0)}%`} />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {face.fallback
                    ? "No hubo detector disponible o no encontró rostro. Puedes buscar con la imagen completa."
                    : "Recorte listo para buscar en Datasec, memoria social y fuentes públicas."}
                </p>
                <Button type="button" className="mt-auto" onClick={() => onSearchFace(face)}>
                  <SearchCheck className="h-4 w-4" />
                  {selectedFace?.faceId === face.faceId ? "Buscar de nuevo" : "Buscar esta persona"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-black p-5">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
              <ScanFace className="h-6 w-6" />
            </div>
            <div>
              <p className="text-base font-black text-foreground">Detecta primero si la foto trae varias personas</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Usa “Detectar rostros” para separar cada cara, elegir la correcta y lanzar la investigación sin contaminar el caso con personas equivocadas.
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function FaceCandidateSection({
  title,
  eyebrow,
  empty,
  items,
  compact,
}: {
  title: string;
  eyebrow: string;
  empty: string;
  items: any[];
  compact?: boolean;
}) {
  if (!items.length) return <EmptyBlock text={empty} />;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="metric-label">{eyebrow}</p>
          <h4 className="text-lg font-black text-foreground">{title}</h4>
        </div>
        <StatusBadge value={`${items.length} visibles`} />
      </div>
      <div className={`grid gap-3 ${compact ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {items.slice(0, compact ? 6 : 8).map((match: any, index: number) => (
          <FaceCandidateCard key={match.url || match.sourceUrl || match.imageUrl || index} match={match} />
        ))}
      </div>
    </div>
  );
}

function FaceCandidateCard({ match }: { match: any }) {
  return (
    <div className="rounded-2xl border border-border bg-black p-3">
      <div className="aspect-video overflow-hidden rounded-xl border border-border bg-secondary/30">
        {candidateImageSrc(match) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={candidateImageSrc(match)} alt={match.title || "match facial"} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground"><Image className="h-8 w-8" /></div>
        )}
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-black text-foreground">{cleanFaceCandidateTitle(match.title) || "Candidato visual"}</p>
        <StatusPill tone={isImageOnlyCandidate(match) ? "warn" : "ok"} label={isImageOnlyCandidate(match) ? "imagen" : "fuente"} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{candidateSourceLabel(match)} · confianza {formatFaceScore(match)}</p>
      {candidateSourceUrl(match) ? (
        <a className="mt-2 flex items-center gap-2 truncate text-xs font-semibold text-primary hover:underline" href={candidateSourceUrl(match)} target="_blank" rel="noreferrer">
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Abrir fuente localizada</span>
        </a>
      ) : (
        <p className="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
          Coincidencia visual sin perfil localizado. Úsala como pista y valida con más fuentes.
        </p>
      )}
    </div>
  );
}

function FaceLabView({
  result,
  onEnhance,
  onAnalyze,
  onCompare,
}: {
  result?: any;
  onEnhance: (form: FormData) => void;
  onAnalyze: (form: FormData) => void;
  onCompare: (form: FormData) => void;
}) {
  const type = detectFaceToolResultType(result);

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="overflow-hidden xl:col-span-12">
        <div className="rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 sm:p-6">
          <div className="dashboard-hero-layout">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone="info" label="Mejora" />
                <StatusPill tone="ok" label="Análisis" />
                <StatusPill tone="warn" label="Comparación" />
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-normal sm:text-3xl text-foreground">Prepara imágenes antes de buscar</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Usa este laboratorio cuando la foto esté pixelada, oscura o necesites comparar dos rostros antes de crear una investigación formal.
              </p>
            </div>
            <div className="dashboard-hero-metrics">
              <HeroMetric label="Modo" value={type === "empty" ? "listo" : type} />
              <HeroMetric label="Entrada" value="foto" />
              <HeroMetric label="Salida" value={type === "empty" ? "pendiente" : "generada"} />
              <HeroMetric label="Uso" value="preparar" />
            </div>
          </div>
        </div>
      </Card>
      <FaceToolsPanel onEnhance={onEnhance} onAnalyze={onAnalyze} onCompare={onCompare} />
      <FaceToolResultPanel result={result} />
    </div>
  );
}

function FaceAnalysisSummary({ analysis }: { analysis?: any }) {
  const labels = Array.isArray(analysis?.labels) ? analysis.labels : [];
  const emotions = Array.isArray(analysis?.emotions) ? analysis.emotions : [];

  if (!analysis && !labels.length && !emotions.length) {
    return <EmptyBlock text="El análisis facial aparecerá aquí cuando el micro detecte rostro, etiquetas o descripción visual." />;
  }

  return (
    <div className="rounded-2xl border border-border bg-black p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-black text-foreground">Lectura visual</p>
        <StatusPill tone="info" label={analysis?.age ? `${analysis.age.min ?? "?"}-${analysis.age.max ?? "?"}` : "análisis"} />
      </div>
      {analysis?.description ? <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{analysis.description}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {[...emotions, ...labels].slice(0, 10).map((item: string) => (
          <span key={item} className="rounded-full border border-border bg-secondary/35 px-3 py-1 text-xs font-semibold text-muted-foreground">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function FaceInvestigationBrief({ result, job }: { result: ReturnType<typeof normalizeFaceResult>; job: any }) {
  const controls = result.controls || job.controls || {};
  const discovery = result.discovery || {};
  const scraperTotal = Number(result.socialScraper?.total || result.socialScraper?.matches?.length || 0);
  const datasecEnabled = Boolean(result.datasec?.enabled || job.searchDatasec);
  const engines = result.engines.length ? result.engines : job.enginesUsed || [];
  const minScore = Number(controls.minCandidateScore ?? job.minCandidateScore ?? 0);

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-black text-foreground">Cómo se buscó este rostro</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            El sistema combinó coincidencia visual pública, memoria interna y señales sociales. Los candidatos se filtran por score y se guardan como expediente revisable.
          </p>
        </div>
        <StatusPill tone={result.totalMatches ? "ok" : "warn"} label={result.totalMatches ? "candidatos encontrados" : "sin candidato fuerte"} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <Signal label="Motores" value={Array.isArray(engines) && engines.length ? String(engines.length) : "-"} />
        <Signal label="Datasec" value={datasecEnabled ? "activo" : "omitido"} />
        <Signal label="Social" value={scraperTotal ? `${scraperTotal} señales` : discovery.beforeVisualCompare ? "consultado" : "sin pistas"} />
        <Signal label="Score mínimo" value={minScore ? `${Math.round(minScore * 100)}%` : "-"} />
      </div>
    </div>
  );
}

function FaceToolResultPanel({ result }: { result?: any }) {
  const type = detectFaceToolResultType(result);

  return (
    <Card className="xl:col-span-12">
      <CardHeader title="Resultado IA" eyebrow="lectura facial" action={<StatusBadge value={type === "empty" ? "sin análisis" : "listo"} />} />
      {type === "empty" ? (
        <div className="rounded-2xl border border-border bg-black p-5">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <p className="text-base font-black text-foreground">Sin análisis facial todavía</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Usa mejorar, analizar o comparar para ver un resumen visual claro sin JSON técnico.
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {type === "compare" ? (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-border bg-black p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-lg font-black text-foreground">{result.isSamePerson ? "Posible misma persona" : "Personas distintas o no concluyente"}</p>
              <StatusPill tone={result.isSamePerson ? "ok" : "warn"} label={`${Math.round(Number(result.confidence || 0) * 100)}%`} />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{result.reasoning || "Sin razonamiento disponible."}</p>
          </div>
        </div>
      ) : null}
      {type === "analyze" ? (
        <div className="grid gap-3">
          <Signal label="Edad estimada" value={String(result.ageRange || "unknown")} />
          <Signal label="Expresión" value={String(result.expressionAnalysis?.primaryEmotion || result.emotions?.[0] || "unknown")} />
          <Signal label="Calidad" value={String(result.poseAndCapture?.imageQuality || "unknown")} />
          <div className="rounded-2xl border border-border bg-black p-4">
            <p className="metric-label mb-2">Resumen</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{result.professionalSummary || "Sin resumen disponible."}</p>
          </div>
        </div>
      ) : null}
      {type === "enhance" ? (
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <FaceImageCard title="Mejorada" src={result.enhancedImageUrl} />
            <FaceImageCard title="Perfil izquierdo" src={result.leftProfileImageUrl} />
            <FaceImageCard title="Perfil derecho" src={result.rightProfileImageUrl} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Signal label="Modo" value={String(result.profileGenerationMode || "procesado")} />
            <Signal label="Confianza" value={`${Math.round(Number(result.confidence || 0) * 100)}%`} />
          </div>
          {result.profileGenerationError ? <EmptyBlock text={String(result.profileGenerationError)} /> : null}
        </div>
      ) : null}
    </Card>
  );
}

function DatasecFacesPanel({ datasec }: { datasec?: any }) {
  const candidates = Array.isArray(datasec?.candidates) ? datasec.candidates : [];
  const crops = Array.isArray(datasec?.faceCrops) ? datasec.faceCrops : [];

  return (
    <Card className="xl:col-span-12">
      <CardHeader
        title="Datasec"
        eyebrow="candidatos internos"
        action={<StatusBadge value={datasec?.enabled ? `${candidates.length} candidatos` : "sin búsqueda"} />}
      />
      {datasec?.error ? <EmptyBlock text={`Datasec no respondió: ${datasec.error}`} /> : null}
      {datasec?.enabled ? (
        <div className="grid gap-4">
          {crops.length ? (
            <div>
              <p className="metric-label mb-3">Rostros recortados</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                {crops.slice(0, 6).map((crop: any, index: number) => (
                  <FaceImageCard key={crop.faceId || crop.url || index} title={crop.faceId || `Rostro ${index + 1}`} src={crop.url} />
                ))}
              </div>
            </div>
          ) : null}
          {candidates.length ? (
            <div>
              <p className="metric-label mb-3">Imágenes candidatas</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                {candidates.slice(0, 12).map((item: any, index: number) => (
                  <div key={item.id || item.url || index} className="rounded-2xl border border-border bg-black p-3">
                    <div className="aspect-square overflow-hidden rounded-xl border border-border bg-secondary/30">
                      {item.url || item.secureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.secureUrl || item.url} alt={item.id || "datasec"} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-muted-foreground"><Image className="h-7 w-7" /></div>
                      )}
                    </div>
                    <p className="mt-2 truncate text-xs font-black text-foreground">{item.id || "Imagen Datasec"}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {item.metadata?.cameraId || "sin cámara"} · {item.faces?.length ?? 0} rostros
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyBlock text="Datasec está activo, pero no devolvió candidatos para estos filtros." />
          )}
        </div>
      ) : (
        <EmptyBlock text="Activa Datasec en el formulario o usa una imagen/cámara/persona Datasec para consultar candidatos internos." />
      )}
    </Card>
  );
}

function FaceJobProgress({ job, onCancel }: { job: any; onCancel: (jobId: string) => void }) {
  const progress = Math.max(0, Math.min(Number(job.progress || 0), 100));
  const status = String(job.status || "queued");
  const tone = status === "completed" ? "ok" : status === "failed" || status === "cancelled" ? "bad" : "info";
  const jobId = String(job.jobId || job.searchId || "");
  const canCancel = Boolean(jobId && ["queued", "processing"].includes(status));
  const events = Array.isArray(job.events) ? job.events : [];

  return (
    <div className="rounded-2xl border border-border bg-black p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="metric-label mb-1">Investigador facial</p>
          <p className="text-sm font-black text-foreground">{faceStageTitle(job.stage || status)}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{faceStageMessage(job.stage || status, job.message)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill tone={tone as any} label={commercialFaceStatus(status)} />
          {canCancel ? (
            <Button type="button" variant="secondary" onClick={() => onCancel(jobId)}>
              <XCircle className="h-4 w-4" />
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full border border-border bg-secondary/50">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
        <span><strong className="text-foreground">{progress}%</strong> avance</span>
        <span><strong className="text-foreground">{job.attempts ?? 0}</strong> intentos</span>
        <span><strong className="text-foreground">{job.matchesFound ?? 0}</strong> candidatos</span>
        <span><strong className="text-foreground">{Math.round(Number(job.maxRuntimeMs || 0) / 60000) || "-"}</strong> min máx.</span>
      </div>
      {events.length ? (
        <div className="mt-4 rounded-2xl border border-border bg-secondary/20 p-3">
          <p className="metric-label mb-3">Línea de investigación</p>
          <div className="grid gap-3">
            {events.slice(-8).map((event: any, index: number) => (
              <div key={`${event.stage || "event"}-${event.at || index}`} className="grid grid-cols-[18px_1fr] gap-3">
                <span className="mt-1 h-3 w-3 rounded-full border border-primary/40 bg-primary/20" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black text-foreground">{event.title || faceStageTitle(event.stage) || "Etapa"}</p>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">{formatEventTime(event.at)}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{event.message || "Etapa procesada."}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FaceVisualContextPanel({ context }: { context?: any }) {
  if (!context) return null;

  const available = context.available !== false;
  const people = Number(context.people || context.summary?.people || 0);
  const detections = Array.isArray(context.topDetections)
    ? context.topDetections
    : Array.isArray(context.detections)
      ? context.detections
      : [];
  const labelMap = context.labels || context.summary?.labels || {};
  const labels = Object.entries(labelMap)
    .map(([label, count]) => ({ label, count: Number(count) || 0 }))
    .filter((item) => item.label && item.count > 0)
    .slice(0, 8);
  const tags = Array.isArray(context.contextTags) ? context.contextTags.slice(0, 8) : [];
  const warning = context.warning || context.error;

  return (
    <div className="rounded-2xl border border-primary/20 bg-[linear-gradient(135deg,rgba(37,99,235,0.10),rgba(0,0,0,0.88))] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="metric-label mb-1">Contexto visual</p>
          <p className="text-sm font-black text-foreground">
            {available ? "Análisis de escena activado" : "Análisis de escena no disponible"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Este sensor no confirma identidad; ayuda a priorizar pistas por entorno, objetos, prendas, logos o señales visibles.
          </p>
        </div>
        <StatusPill tone={available ? "info" : "warn"} label={available ? `${people} persona(s)` : "degradado"} />
      </div>

      {labels.length || detections.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Signal label="Personas" value={String(people)} />
          <Signal label="Detecciones" value={String(detections.length || labels.reduce((sum, item) => sum + item.count, 0))} />
          <Signal label="Modelo" value={String(context.model || "visual")} />
        </div>
      ) : null}

      {labels.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {labels.map((item) => (
            <StatusPill key={item.label} tone="info" label={`${humanVisualLabel(item.label)} ×${item.count}`} />
          ))}
        </div>
      ) : null}

      {tags.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag: string) => (
            <StatusPill key={tag} tone="ok" label={humanVisualLabel(tag)} />
          ))}
        </div>
      ) : null}

      {detections.length ? (
        <div className="mt-4 grid gap-2">
          {detections.slice(0, 4).map((item: any, index: number) => (
            <div key={`${item.label || "objeto"}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-black/60 px-3 py-2">
              <span className="truncate text-xs font-bold text-foreground">{humanVisualLabel(item.label || "objeto detectado")}</span>
              <span className="shrink-0 text-xs font-black text-primary">{Math.round(Number(item.confidence || 0) * 100)}%</span>
            </div>
          ))}
        </div>
      ) : null}

      {warning ? (
        <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
          {String(warning)}
        </p>
      ) : null}
    </div>
  );
}

function normalizeFaceResult(payload: any, selectedFace?: any) {
  const face = payload?.faceSearch || payload?.faceResult || {};
  const isFaceSearch = Boolean(payload?.faceSearch || payload?.faceResult || payload?.jobId);
  const matches = Array.isArray(face.matches)
    ? face.matches
    : Array.isArray(payload?.matches)
      ? payload.matches
      : [];
  const profiles = normalizeFaceProfiles(face.socialProfiles || payload?.socialProfiles);

  return {
    searchId: payload?.searchId || payload?.jobId || "",
    status: String(payload?.status || (payload?.searchId ? "procesando" : "sin búsqueda")),
    mode: payload?.modeProfile || (isFaceSearch ? "rostro" : payload?.searchId ? "imagen" : "rostro"),
    originalImageUrl: face.originalImageUrl || payload?.originalImageUrl || selectedFace?.original?.imageUrl || payload?.enhancedImageUrl,
    croppedFaceUrl: face.croppedFaceUrl || payload?.croppedFaceUrl || selectedFace?.imageUrl || selectedFace?.thumbnailUrl,
    facesDetected: face.facesDetected ?? payload?.facesDetected ?? (selectedFace ? 1 : undefined),
    analysis: face.faceAnalysis || payload?.faceAnalysis,
    matches,
    totalMatches: Number(face.totalMatches ?? payload?.totalMatches ?? matches.length ?? 0),
    profiles,
    engines: Array.isArray(face.searchEnginesUsed) ? face.searchEnginesUsed : Array.isArray(payload?.searchEnginesUsed) ? payload.searchEnginesUsed : [],
    processingTime: face.processingTime || payload?.processingTime,
    datasec: payload?.datasec || face.datasec,
    controls: face.controls || payload?.controls,
    discovery: face.discovery || payload?.discovery,
    socialScraper: face.socialScraper || payload?.socialScraper,
    visualContext: face.visualContext || payload?.visualContext,
  };
}

function commercialFaceStatus(status?: any) {
  const value = String(status || "").toLowerCase();
  if (value === "queued") return "en cola";
  if (value === "processing") return "buscando";
  if (value === "completed") return "finalizado";
  if (value === "failed") return "falló";
  if (value === "cancelled") return "cancelado";
  return value || "nuevo";
}

function faceStageTitle(stage?: any) {
  const value = String(stage || "").toLowerCase();
  const titles: Record<string, string> = {
    queued: "Esperando turno",
    starting: "Preparando búsqueda",
    analyzing_image: "Leyendo el rostro",
    visual_context: "Analizando escena",
    visual_context_done: "Contexto visual listo",
    open_visual_search: "Buscando coincidencias",
    social_discovery: "Revisando redes",
    social_discovery_done: "Redes revisadas",
    social_url_expansion: "Ampliando perfiles",
    background_osint: "Validando candidatos",
    completed_with_candidates: "Candidatos listos",
    completed_without_candidates: "Sin coincidencias fuertes",
    completed: "Investigación finalizada",
    failed: "Revisión requerida",
    cancelled: "Búsqueda cancelada",
    time_limit_reached: "Tiempo máximo alcanzado",
  };
  return titles[value] || String(stage || "").replace(/_/g, " ");
}

function faceStageMessage(stage?: any, fallback?: any) {
  const value = String(stage || "").toLowerCase();
  const messages: Record<string, string> = {
    queued: "El caso fue recibido. En cuanto el worker quede libre empezará a buscar.",
    starting: "Preparando imagen, Datasec, motores visuales y memoria social.",
    analyzing_image: "Analizando el recorte seleccionado antes de abrir fuentes públicas.",
    visual_context: "Buscando señales de entorno, objetos y personas visibles para enriquecer la investigación.",
    visual_context_done: "Contexto visual agregado al caso para priorizar candidatos.",
    open_visual_search: "Comparando el rostro contra imagen inversa y fuentes abiertas.",
    social_discovery: "Usando nombre, username o perfiles conocidos para priorizar redes.",
    social_url_expansion: "Abriendo perfiles detectados y capturando nuevas señales visuales.",
    background_osint: "Filtrando candidatos por score y guardando evidencias revisables.",
    completed: "La investigación terminó. Revisa candidatos, evidencias y Datasec.",
    failed: "La búsqueda necesita revisión técnica. Mira logs del micro para el error exacto.",
    cancelled: "El usuario canceló la investigación.",
    time_limit_reached: "El sistema cerró la investigación de forma controlada y conservó los resultados parciales.",
  };
  return messages[value] || String(fallback || "Procesando investigación facial.");
}

function normalizeFaceProfiles(input: any) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];

  return Object.entries(input).flatMap(([platform, value]) => {
    const list = Array.isArray(value) ? value : value ? [value] : [];
    return list
      .map((item: any) => {
        if (typeof item === "string") {
          return {
            platform,
            username: extractUsernameFromUrl(item),
            url: item,
          };
        }
        return {
          platform: item.platform || platform,
          username: item.username || item.name || extractUsernameFromUrl(item.url),
          name: item.name,
          url: item.url || item.profileUrl,
          source: item.source,
          confidence: item.confidence,
        };
      })
      .filter((item: any) => item.url || item.username);
  });
}

function humanVisualLabel(label?: any) {
  const value = String(label || "").trim();
  const known: Record<string, string> = {
    person: "persona",
    car: "vehículo",
    truck: "camión",
    bus: "bus",
    motorcycle: "moto",
    bicycle: "bicicleta",
    backpack: "morral",
    handbag: "bolso",
    tie: "corbata",
    cell_phone: "teléfono",
    "cell phone": "teléfono",
    laptop: "laptop",
    dog: "perro",
    cat: "gato",
  };
  return known[value.toLowerCase()] || value.replace(/_/g, " ");
}

function detectFaceToolResultType(result?: any) {
  if (!result) return "empty";
  if ("isSamePerson" in result || "reasoning" in result) return "compare";
  if ("ageRange" in result || "facialGeometry" in result || "professionalSummary" in result) return "analyze";
  if ("enhancedImageUrl" in result || "enhancedImageBase64" in result || "leftProfileImageUrl" in result) return "enhance";
  return "analyze";
}

function formatFaceScore(match: any) {
  const raw = match.similarity ?? match.score ?? match.confidence;
  const value = Number(raw);
  if (!Number.isFinite(value)) return "-";
  if (value <= 1) return `${Math.round(value * 100)}%`;
  return `${Math.round(value)}%`;
}

function groupFaceCandidates(matches: any[]) {
  const unique = dedupeCandidates(Array.isArray(matches) ? matches : []);
  const high = unique.filter((match) => numericFaceScore(match) >= 0.9);
  const profiles = unique.filter((match) => isProfileCandidate(match));
  const sources = unique.filter((match) => candidateSourceUrl(match) && !isProfileCandidate(match));
  const imageOnly = unique.filter((match) => !candidateSourceUrl(match));

  return {
    high,
    profiles,
    sources,
    imageOnly,
  };
}

function dedupeCandidates(matches: any[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = String(candidateSourceUrl(match) || candidateImageSrc(match) || match.url || match.title || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function numericFaceScore(match: any) {
  const value = Number(match.similarity ?? match.score ?? match.confidence ?? 0);
  if (!Number.isFinite(value)) return 0;
  return value > 1 ? value / 100 : value;
}

function isProfileCandidate(match: any) {
  const url = candidateSourceUrl(match);
  if (!url) return false;
  const domain = domainFromUrl(url).toLowerCase();
  return [
    "facebook.com",
    "instagram.com",
    "x.com",
    "twitter.com",
    "linkedin.com",
    "tiktok.com",
    "youtube.com",
    "threads.net",
    "bsky.app",
  ].some((item) => domain === item || domain.endsWith(`.${item}`));
}

function candidateImageSrc(match: any) {
  return match.imageUrl || match.thumbnailUrl || match.thumbnail || "";
}

function candidateSourceUrl(match: any) {
  const url = String(match.pageUrl || match.sourceUrl || match.url || "").trim();
  if (!url || isYandexCacheUrl(url) || isBareImageUrl(url)) return "";
  return url;
}

function isImageOnlyCandidate(match: any) {
  const url = String(match.pageUrl || match.sourceUrl || match.url || "").trim();
  return !candidateSourceUrl(match) || isYandexCacheUrl(url);
}

function candidateSourceLabel(match: any) {
  const source = match.source || match.engine || "fuente visual";
  const url = String(match.pageUrl || match.sourceUrl || match.url || "").trim();
  if (isYandexCacheUrl(url)) return `${source} · imagen cache Yandex`;
  return `${source} · ${match.domain || domainFromUrl(url) || "fuente abierta"}`;
}

function cleanFaceCandidateTitle(title?: any) {
  return String(title || "")
    .replace(/^\[FACE\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isYandexCacheUrl(url: string) {
  return /(^https?:\/\/)?avatars\.mds\.yandex\.net\//i.test(url) || /(^https?:\/\/)?[^/]*yandex\.net\/get-images-cbir\//i.test(url);
}

function isBareImageUrl(url: string) {
  if (!url) return false;
  if (isYandexCacheUrl(url)) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg)([?#]|$)/i.test(url);
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function formatEventTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function extractUsernameFromUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.pathname.split("/").filter(Boolean)[0] || url.hostname;
  } catch {
    return value.replace(/^https?:\/\//, "").split("/").filter(Boolean)[1] || value;
  }
}

function imageDisplaySrc(src?: string) {
  if (!src) return "";
  if (/^https?:\/\//i.test(src) || src.startsWith("data:image/")) return src;
  if (/^[A-Za-z0-9+/=]+$/.test(src.slice(0, 80))) return `data:image/jpeg;base64,${src}`;
  return src;
}

function SocialView(props: { data: DashboardData; onInstagram: (form: FormData) => void; onMeta: (form: FormData) => void; onFacebook: (form: FormData) => void }) {
  const social = normalizeSocialResult(props.data.socialResult);
  const health = normalizeSocialHealth(props.data.socialHealth);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SocialResultFilter>("all");
  const [photoPage, setPhotoPage] = useState(1);
  const [postPage, setPostPage] = useState(1);
  const [linkPage, setLinkPage] = useState(1);
  const filteredPhotos = useMemo(() => filterSocialItems(social.photos, query, ["src", "url", "id"]), [social.photos, query]);
  const filteredPosts = useMemo(() => filterSocialItems(social.posts, query, ["text", "url", "date", "stats"]), [social.posts, query]);
  const filteredLinks = useMemo(() => filterSocialItems(social.links, query, ["label", "url"]), [social.links, query]);

  useEffect(() => {
    setPhotoPage(1);
    setPostPage(1);
    setLinkPage(1);
  }, [query, filter, props.data.socialResult]);

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="overflow-hidden xl:col-span-12">
        <div className="rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 sm:p-6">
          <div className="dashboard-hero-layout">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={health.instagram.available ? "ok" : "warn"} label={health.instagram.label} />
                <StatusPill tone={health.meta.available ? "ok" : "warn"} label={health.meta.label} />
                <StatusPill tone="info" label="perfiles + publicaciones" />
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-normal sm:text-3xl text-foreground">Explora señales sociales públicas</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Busca usuarios, perfiles, fotos, publicaciones y enlaces relacionados sin mostrar detalles técnicos del proveedor.
              </p>
            </div>
            <div className="dashboard-hero-metrics">
              <HeroMetric label="Perfil" value={social.profile ? "encontrado" : "nuevo"} />
              <HeroMetric label="Fotos" value={String(social.photos.length)} />
              <HeroMetric label="Posts" value={String(social.posts.length)} />
              <HeroMetric label="Links" value={String(social.links.length)} />
            </div>
          </div>
        </div>
      </Card>

      <div className="xl:col-span-4">
        <div className="grid gap-4 xl:grid-cols-1">
          <SocialForms onInstagram={props.onInstagram} onMeta={props.onMeta} onFacebook={props.onFacebook} />
        </div>
      </div>

      <div className="grid gap-4 xl:col-span-8">
        <SocialProfileCard social={social} />
        <SocialHealthCard health={health} />
      </div>

      <SocialResultsToolbar
        query={query}
        filter={filter}
        totals={{ photos: social.photos.length, posts: social.posts.length, links: social.links.length }}
        filteredTotals={{ photos: filteredPhotos.length, posts: filteredPosts.length, links: filteredLinks.length }}
        onQuery={setQuery}
        onFilter={setFilter}
      />
      {filter === "all" || filter === "photos" ? (
        <SocialGallery photos={filteredPhotos} page={photoPage} pageSize={8} onPageChange={setPhotoPage} />
      ) : null}
      {filter === "all" || filter === "posts" ? (
        <SocialPosts posts={filteredPosts} page={postPage} pageSize={5} onPageChange={setPostPage} />
      ) : null}
      {filter === "all" || filter === "links" ? (
        <SocialLinksPanel links={filteredLinks} page={linkPage} pageSize={6} onPageChange={setLinkPage} />
      ) : null}
    </div>
  );
}

function SocialResultsToolbar({
  query,
  filter,
  totals,
  filteredTotals,
  onQuery,
  onFilter,
}: {
  query: string;
  filter: SocialResultFilter;
  totals: { photos: number; posts: number; links: number };
  filteredTotals: { photos: number; posts: number; links: number };
  onQuery: (value: string) => void;
  onFilter: (value: SocialResultFilter) => void;
}) {
  const filters: Array<{ value: SocialResultFilter; label: string; count: number }> = [
    { value: "all", label: "Todo", count: totals.photos + totals.posts + totals.links },
    { value: "photos", label: "Fotos", count: totals.photos },
    { value: "posts", label: "Posts", count: totals.posts },
    { value: "links", label: "Links", count: totals.links },
  ];
  const visibleCount = filteredTotals.photos + filteredTotals.posts + filteredTotals.links;

  return (
    <Card className="xl:col-span-12">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="metric-label">Resultados sociales</p>
            <StatusPill tone="info" label={`${visibleCount} visibles`} />
          </div>
          <div className="relative">
            <FileSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="control-input pl-10"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              placeholder="Filtrar por texto, fecha, enlace o fuente"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onFilter(item.value)}
              className={`min-h-11 rounded-xl border px-3 text-left text-xs font-black transition ${
                filter === item.value
                  ? "border-primary/70 bg-primary/10 text-primary"
                  : "border-border bg-secondary/35 text-muted-foreground hover:border-muted-foreground/60"
              }`}
            >
              <span className="block">{item.label}</span>
              <span className="mt-0.5 block text-[10px] font-semibold opacity-75">{item.count}</span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function SocialProfileCard({ social }: { social: ReturnType<typeof normalizeSocialResult> }) {
  const hasProfile = Boolean(social.name || social.username || social.url || social.avatar || social.intro);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={hasProfile ? "Perfil encontrado" : "Resultado social"}
        eyebrow={social.platform || "perfil público"}
        action={<StatusBadge value={hasProfile ? "señales visibles" : "sin consulta"} />}
      />
      {hasProfile ? (
        <div className="grid gap-4">
          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            <div className="relative h-28 bg-secondary/50">
              {social.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={social.cover} alt="cover social" className="h-full w-full object-cover opacity-80" />
              ) : (
                <div className="grid h-full place-items-center text-primary/70">
                  <Globe2 className="h-9 w-9" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
              <div className="-mt-14 grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-black text-primary shadow-xl">
                {social.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={social.avatar} alt={social.name || "perfil social"} className="h-full w-full object-cover" />
                ) : (
                  <Link2 className="h-8 w-8" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-xl font-black text-foreground">{social.name || social.username || "Perfil social"}</p>
                  {social.verified ? <StatusPill tone="ok" label="verificado" /> : null}
                  {social.typeName ? <StatusPill tone="info" label={social.typeName} /> : null}
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-primary">{social.username || social.url || "señal pública"}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {social.intro || "Perfil detectado. Revisa fotos, publicaciones y enlaces públicos asociados a esta búsqueda."}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Signal label="Fotos públicas" value={String(social.photos.length)} />
            <Signal label="Publicaciones" value={String(social.posts.length)} />
            <Signal label="Enlaces" value={String(social.links.length)} />
          </div>

          {social.links.length ? (
            <div className="flex flex-wrap gap-2">
              {social.links.slice(0, 8).map((link) => (
                <a
                  key={`${link.label}-${link.url}`}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-black px-3 py-2 text-xs font-bold text-foreground hover:border-primary/50 hover:text-primary"
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{link.label}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-black p-5">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
              <Globe2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-base font-black text-foreground">Busca un usuario o palabra clave</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Cuando el micro responda, aquí verás perfil, foto, enlaces, galería y publicaciones en formato comercial.
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function SocialHealthCard({ health }: { health: ReturnType<typeof normalizeSocialHealth> }) {
  return (
    <Card>
      <CardHeader title="Canales disponibles" eyebrow="estado comercial" />
      <div className="grid gap-3 md:grid-cols-2">
        <SocialChannelStatus
          title="Instagram"
          available={health.instagram.available}
          detail={health.instagram.detail}
          caption={health.instagram.available ? "Listo para perfiles, métricas y actividad pública." : "Pendiente de credenciales o sesión válida."}
        />
        <SocialChannelStatus
          title="Meta / Facebook"
          available={health.meta.available}
          detail={health.meta.detail}
          caption={health.meta.available ? "Listo para perfiles, fotos, páginas y búsqueda pública." : "Pendiente de API key o proveedor externo."}
        />
      </div>
    </Card>
  );
}

function SocialChannelStatus({ title, available, detail, caption }: { title: string; available: boolean; detail: string; caption: string }) {
  return (
    <div className="rounded-2xl border border-border bg-black p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{caption}</p>
        </div>
        <StatusPill tone={available ? "ok" : "warn"} label={available ? "listo" : "pendiente"} />
      </div>
      <p className="mt-4 rounded-xl border border-border bg-secondary/25 px-3 py-2 text-xs font-semibold text-muted-foreground">{detail}</p>
    </div>
  );
}

function SocialGallery({
  photos,
  page,
  pageSize,
  onPageChange,
}: {
  photos: Array<{ id: string; src: string; url?: string }>;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const pageItems = paginateItems(photos, page, pageSize);

  return (
    <Card className="xl:col-span-7">
      <CardHeader title="Galería pública" eyebrow="fotos detectadas" action={<StatusBadge value={`${photos.length} fotos`} />} />
      {photos.length ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {pageItems.map((photo) => (
              <a
                key={photo.id}
                className="group overflow-hidden rounded-2xl border border-border bg-black"
                href={photo.url || photo.src}
                target="_blank"
                rel="noreferrer"
              >
                <div className="aspect-square overflow-hidden bg-secondary/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.src} alt="foto pública" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                </div>
              </a>
            ))}
          </div>
          <PaginationControls total={photos.length} page={page} pageSize={pageSize} onPageChange={onPageChange} />
        </div>
      ) : (
        <EmptyBlock text="Sin fotos para este filtro. Ajusta la búsqueda o ejecuta una consulta con fotos públicas activadas." />
      )}
    </Card>
  );
}

function SocialPosts({
  posts,
  page,
  pageSize,
  onPageChange,
}: {
  posts: Array<{ id: string; text: string; url?: string; date?: string; stats: string }>;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const pageItems = paginateItems(posts, page, pageSize);

  return (
    <Card className="xl:col-span-5">
      <CardHeader title="Publicaciones recientes" eyebrow="actividad pública" action={<StatusBadge value={`${posts.length} posts`} />} />
      {posts.length ? (
        <div className="grid gap-3">
          {pageItems.map((post) => (
            <div key={post.id} className="rounded-2xl border border-border bg-black p-4">
              <p className="line-clamp-4 text-sm leading-relaxed text-foreground">{post.text || "Publicación sin texto visible."}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{post.date || "fecha no disponible"}</span>
                <span>{post.stats}</span>
              </div>
              {post.url ? (
                <a className="mt-3 inline-flex max-w-full items-center gap-2 text-xs font-bold text-primary hover:underline" href={post.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Abrir publicación</span>
                </a>
              ) : null}
            </div>
          ))}
          <PaginationControls total={posts.length} page={page} pageSize={pageSize} onPageChange={onPageChange} />
        </div>
      ) : (
        <EmptyBlock text="Sin publicaciones para este filtro. Prueba otro texto o activa publicaciones en la consulta." />
      )}
    </Card>
  );
}

function SocialLinksPanel({
  links,
  page,
  pageSize,
  onPageChange,
}: {
  links: Array<{ label: string; url: string }>;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const pageItems = paginateItems(links, page, pageSize);

  return (
    <Card className="xl:col-span-12">
      <CardHeader title="Enlaces públicos" eyebrow="rutas revisables" action={<StatusBadge value={`${links.length} links`} />} />
      {links.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pageItems.map((link) => (
            <a
              key={`${link.label}-${link.url}`}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-black p-4 hover:border-primary/50"
              href={link.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                <ExternalLink className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-foreground">{link.label}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{link.url}</span>
              </span>
            </a>
          ))}
          <div className="md:col-span-2 xl:col-span-3">
            <PaginationControls total={links.length} page={page} pageSize={pageSize} onPageChange={onPageChange} />
          </div>
        </div>
      ) : (
        <EmptyBlock text="Sin enlaces para este filtro. Cuando el perfil traiga links externos, aparecerán aquí." />
      )}
    </Card>
  );
}

function PaginationControls({
  total,
  page,
  pageSize,
  onPageChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(safePage * pageSize, total);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-secondary/25 p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs font-semibold text-muted-foreground">
        Mostrando {start}-{end} de {total}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
          Anterior
        </Button>
        <span className="min-w-16 text-center text-xs font-black text-foreground">
          {safePage}/{totalPages}
        </span>
        <Button type="button" variant="secondary" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}

function normalizeSocialHealth(payload: any) {
  const instagram = payload?.instagram?.instagram || payload?.instagram || {};
  const meta = payload?.meta?.meta || payload?.meta || {};
  const instagramAvailable = Boolean(instagram.available || instagram.rapidApiConfigured || instagram.directApiEndpoint);
  const metaAvailable = Boolean(meta.available || meta.apiKeyConfigured || meta.primaryEndpoint);

  return {
    instagram: {
      available: instagramAvailable,
      label: instagramAvailable ? "Instagram listo" : "Instagram pendiente",
      detail: instagramAvailable
        ? instagram.rapidApiConfigured
          ? "Conector activo con proveedor externo configurado."
          : "Conector disponible para perfil público."
        : "Requiere JWT, sesión o proveedor configurado.",
    },
    meta: {
      available: metaAvailable,
      label: metaAvailable ? "Meta listo" : "Meta pendiente",
      detail: metaAvailable
        ? meta.apiKeyConfigured
          ? "Conector activo con API key configurada."
          : "Conector disponible para consulta pública."
        : "Requiere API key o proveedor configurado.",
    },
  };
}

function normalizeSocialResult(payload: any) {
  const root = payload?.data || payload?.result || payload || {};
  const searchResults = Array.isArray(root.search?.results) ? root.search.results : [];
  const profile =
    root.profile ||
    root.user ||
    root.instagram?.profile ||
    root.meta?.profile ||
    root.facebook?.profile ||
    (root.found && !root.search ? root : null) ||
    {};
  const photos = uniqueSocialPhotos([
    ...normalizeSocialPhotos(root.photos || root.profile?.photos || root.media || root.images),
    ...normalizeSocialPhotos(profile.photos),
    ...normalizeSocialPhotos(root.posts),
    ...normalizeSocialPhotos(searchResults),
  ]);
  const posts = normalizeSocialPosts(root.posts || root.profile?.posts || root.items || root.results || searchResults);
  const links = normalizeSocialLinks(profile, root);
  searchResults.forEach((item: any, index: number) => {
    const url = firstString(item.url, item.link, item.profileUrl, item.facebookUrl, item.externalUrl);
    if (url && !links.some((link) => link.url === url)) {
      links.push({ label: firstString(item.name, item.title, item.username, item.text) || `Resultado ${index + 1}`, url });
    }
  });
  const avatar = firstString(profile.profilePicture, profile.profile_pic_url, profile.profilePicUrl, profile.profilePicUrlHd, profile.avatar, profile.picture, profile.image, root.profilePicture);
  const cover = firstString(profile.coverPhoto, profile.cover, profile.banner, root.coverPhoto);
  const url = firstString(profile.url, profile.facebookUrl, profile.profileUrl, profile.externalUrl, root.facebookUrl, root.instagramUrl, root.url);
  const username = firstString(profile.username, profile.handle, profile.userName, root.username, root.query);
  const name = firstString(profile.name, profile.fullName, profile.title, profile.displayName, root.name);
  const intro = firstString(profile.intro, profile.bio, profile.biography, profile.description, root.description);
  const platform = root.platform || root.source || (root.facebookUrl || profile.facebookUrl || root.search ? "Facebook" : root.instagramUrl || profile.biography ? "Instagram" : "Social Intel");

  return {
    profile: payload ? profile : null,
    platform: String(platform || "Social Intel"),
    name,
    username,
    url,
    avatar,
    cover,
    intro,
    verified: Boolean(profile.verified || profile.isVerified || profile.is_verified),
    typeName: firstString(profile.typeName, profile.category, profile.accountType, root.searchType),
    links,
    photos,
    posts,
  };
}

function normalizeSocialPhotos(input: any): Array<{ id: string; src: string; url?: string }> {
  const list = Array.isArray(input) ? input : [];
  return list
    .map((item: any, index: number) => {
      const attachment = Array.isArray(item.attachments) ? item.attachments.find((entry: any) => firstString(entry.uri, entry.url, entry.thumbnail)) : null;
      const src = firstString(
        item.src,
        item.uri,
        item.imageUrl,
        item.thumbnail,
        item.thumbnailUrl,
        item.displayUrl,
        item.mediaUrl,
        item.profilePicture,
        item.profilePicUrl,
        item.picture,
        item.image,
        attachment?.uri,
        attachment?.url,
        attachment?.thumbnail,
      );
      if (!src || !looksLikeImage(src)) return null;
      return {
        id: String(item.id || item.photoId || item.postId || item.shortcode || src || index),
        src,
        url: firstString(item.url, item.uri, item.link, item.postUrl) || src,
      };
    })
    .filter(Boolean) as Array<{ id: string; src: string; url?: string }>;
}

function normalizeSocialPosts(input: any): Array<{ id: string; text: string; url?: string; date?: string; stats: string }> {
  const list = Array.isArray(input) ? input : [];
  return list.map((item: any, index: number) => {
    const reactions = item.reactionCount ?? item.reactionsCount ?? item.reactions ?? item.likes ?? item.likeCount ?? 0;
    const comments = item.commentsCount ?? item.comments ?? item.commentCount ?? 0;
    const shares = item.sharesCount ?? item.shares ?? item.shareCount ?? item.reshareCount ?? 0;
    const timestamp = item.timestamp && !Number.isNaN(Number(item.timestamp))
      ? new Date(Number(item.timestamp) * 1000).toISOString()
      : "";
    return {
      id: String(item.id || item.postId || item.shortcode || item.url || index),
      text: String(firstString(item.text, item.message, item.caption, item.description, item.title, item.name, item.username) || "Resultado social público detectado."),
      url: firstString(item.url, item.postUrl, item.permalink, item.link),
      date: firstString(item.createdAt, item.date, timestamp, item.time),
      stats: `${formatCount(reactions)} reacciones · ${formatCount(comments)} comentarios · ${formatCount(shares)} compartidos`,
    };
  });
}

function normalizeSocialLinks(profile: any, root: any): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  const add = (label: string, url?: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (links.some((item) => item.url === url)) return;
    links.push({ label, url });
  };

  add("Perfil", firstString(profile.url, profile.facebookUrl, profile.profileUrl, profile.externalUrl, root.facebookUrl, root.instagramUrl, root.url));
  add("Link externo", firstString(profile.externalUrl, profile.external_url));
  const introCards = Array.isArray(profile.introCards) ? profile.introCards : [];
  introCards.forEach((card: any) => {
    add(firstString(card.title, card.label, card.text, card.value, card.type) || "Enlace", firstString(card.externalUrl, card.external_url, card.url, card.link));
  });
  const rawLinks = Array.isArray(profile.links) ? profile.links : [];
  rawLinks.forEach((item: any, index: number) => {
    if (typeof item === "string") add(`Link ${index + 1}`, item);
    else add(firstString(item.title, item.label, item.text) || `Link ${index + 1}`, firstString(item.url, item.href, item.externalUrl));
  });

  return links;
}

function uniqueSocialPhotos(items: Array<{ id: string; src: string; url?: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.src || item.url || item.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterSocialItems<T extends Record<string, any>>(items: T[], query: string, fields: string[]) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items;

  return items.filter((item) =>
    fields.some((field) =>
      String(item[field] || "")
        .toLowerCase()
        .includes(normalizedQuery),
    ),
  );
}

function paginateItems<T>(items: T[], page: number, pageSize: number) {
  const safePage = Math.max(page, 1);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function looksLikeImage(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("data:image/");
}

function FaceToolsPanel({
  onEnhance,
  onAnalyze,
  onCompare,
}: {
  onEnhance: (form: FormData) => void;
  onAnalyze: (form: FormData) => void;
  onCompare: (form: FormData) => void;
}) {
  return (
    <Card className="xl:col-span-12">
      <CardHeader title="Herramientas faciales IA" eyebrow="mejorar + analizar + comparar" />
      <div className="face-tools-grid items-stretch">
        <form onSubmit={(event) => submit(event, onEnhance)} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-black p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="face-tool-copy">
            <p className="text-sm font-black text-foreground">Mejorar imagen</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Optimiza una imagen frontal y genera señales visuales útiles.</p>
          </div>
          <div className="grid gap-3">
            <FaceImageInput prefix="front" label="Imagen frontal" />
            <Field name="description" label="Contexto" placeholder="Rostro frontal, baja luz..." />
          </div>
          <Button className="mt-auto" type="submit">Mejorar</Button>
        </form>
        <form onSubmit={(event) => submit(event, onAnalyze)} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-black p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <ScanFace className="h-4 w-4" />
          </div>
          <div className="face-tool-copy">
            <p className="text-sm font-black text-foreground">Análisis facial</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Extrae rasgos, señales visibles y atributos aproximados.</p>
          </div>
          <div className="grid gap-3">
            <FaceImageInput prefix="analysis" label="Imagen" />
          </div>
          <Button className="mt-auto" type="submit">Analizar rostro</Button>
        </form>
        <form onSubmit={(event) => submit(event, onCompare)} className="face-comparison-card flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-black p-4">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <Activity className="h-4 w-4" />
          </div>
          <div className="face-tool-copy">
            <p className="text-sm font-black text-foreground">Comparar rostros</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Compara dos imágenes y estima si pertenecen a la misma persona.</p>
          </div>
          <div className="face-comparison-inputs">
            <FaceImageInput prefix="first" label="Imagen 1" compact />
            <FaceImageInput prefix="second" label="Imagen 2" compact />
          </div>
          <Button className="mt-auto" type="submit">Comparar</Button>
        </form>
      </div>
    </Card>
  );
}

function FaceImageInput({ prefix, label, compact = false }: { prefix: string; label: string; compact?: boolean }) {
  const [fileName, setFileName] = useState("");
  const fileInputId = `face-tool-${prefix}-file`;

  return (
    <div className="grid min-w-0 gap-2 rounded-xl border border-border bg-secondary/20 p-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-muted-foreground">{label}</span>
        <span className="rounded-full border border-border px-2 py-1 text-[10px] font-bold text-muted-foreground">Subir / URL / Datasec</span>
      </div>
      <label htmlFor={fileInputId} className="group flex min-h-12 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-2xl border border-border bg-black px-3 transition hover:border-primary/50 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-primary">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <Image className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black text-foreground">{fileName ? "Imagen seleccionada" : "Seleccionar imagen"}</span>
            <span className="block truncate text-xs text-muted-foreground">{fileName || "PNG, JPG, WEBP o captura"}</span>
          </span>
        </span>
        <span className="shrink-0 rounded-full border border-primary/30 px-2 py-1 text-xs font-bold text-primary transition group-hover:bg-primary/10">Elegir</span>
      </label>
      <input
        id={fileInputId}
        name={`${prefix}File`}
        type="file"
        accept="image/*"
        onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name || "")}
        className="sr-only"
      />
      <Field name={`${prefix}Url`} label="URL pública" placeholder="https://..." />
      <Field name={`${prefix}DatasecAssetId`} label={compact ? "ID Datasec" : "Imagen guardada en Datasec"} placeholder="assetId / evidencia promovida" />
      {!compact ? <p className="text-[11px] leading-relaxed text-muted-foreground">Puedes usar una imagen subida ahora, una URL pública o una imagen ya guardada en Datasec.</p> : null}
    </div>
  );
}

function DarkwebView({ data, onDarkweb }: { data: DashboardData; onDarkweb: (form: FormData) => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <DarkwebForm onSubmit={onDarkweb} />
      <div className="xl:col-span-7"><JsonPanel title="Resultado darkweb" eyebrow="pipeline response" value={data.darkwebResult || { status: "sin ejecución" }} /></div>
      <div className="xl:col-span-12"><JsonPanel title="Health darkweb" eyebrow="tor + groq + engines" value={data.darkwebHealth || { status: "requiere JWT y refresh" }} /></div>
    </div>
  );
}

function EvidenceView({
  data,
  onLoadCase,
  onPromote,
  onUpdateCase,
  onRerunCase,
  onRefineCase,
  onValidateEvidence,
  onClearCaseEvidences,
  onDeleteCase,
  onDeleteEvidence,
  onRestoreEvidence,
  onEnrichEvidenceImage,
  onReviewIdentityCandidate,
}: {
  data: DashboardData;
  onLoadCase: (form: FormData) => void;
  onPromote: (form: FormData) => void;
  onUpdateCase: (form: FormData) => void;
  onRerunCase: (searchId: string) => void;
  onRefineCase: (form: FormData) => void;
  onValidateEvidence: (evidenceId: string, status: "valid" | "false_positive", searchId?: string) => void;
  onClearCaseEvidences: (searchId: string) => void;
  onDeleteCase: (searchId: string) => void;
  onDeleteEvidence: (evidenceId: string, searchId?: string) => void;
  onRestoreEvidence: (evidenceId: string, searchId?: string) => void;
  onEnrichEvidenceImage: (evidenceId: string, searchId?: string) => void;
  onReviewIdentityCandidate: (candidateId: string, status: "probable" | "rejected", searchId?: string) => void;
}) {
  const evidenceItems = [
    ...extractEvidenceItems(data.evidence),
    ...extractEvidenceItems(data.archivedEvidence),
  ];
  const visualItems = extractVisualItems(data.visualSummary);
  const timelineItems = normalizeTimelineItems(data.timeline);
  const recentCases = normalizeSearchItems(data.searches);
  const scores = (data.caseSummary as any)?.scores?.scores || (data.caseSummary as any)?.scores || {};
  const stats = (data.caseSummary as any)?.evidenceStats || {};
  const search = (data.caseSummary as any)?.search || {};
  const jobStatus = (data.caseSummary as any)?.jobStatus || {};
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filteredEvidence = filterEvidenceItems(evidenceItems, filter, query);
  const evidencePage = paginateItems(filteredEvidence, page, 6);
  const caseStatus = data.caseSummary ? statusLabel(search.status) : "sin caso";
  const totalEvidence = stats.total ?? search.evidenceCount ?? evidenceItems.length;
  const overallScore = scores.overall ?? search.scores?.overall ?? "-";
  const loadedSearchId = String(search.searchId || search._id || search.id || "");

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="overflow-hidden xl:col-span-12">
        <div className="rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.20),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 sm:p-6">
          <div className="dashboard-hero-layout">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={data.caseSummary ? "ok" : "warn"} label={data.caseSummary ? "Caso cargado" : "Carga un caso"} />
                <StatusPill tone="info" label="Evidencias" />
                <StatusPill tone="info" label="Timeline visual" />
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-normal sm:text-3xl text-foreground">Revisa hallazgos, fuentes y señales visuales</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Carga un caso para validar evidencias, guardar señales útiles en Datasec y leer la actividad del caso sin JSON técnico.
              </p>
            </div>
            <div className="dashboard-hero-metrics">
              <HeroMetric label="Estado" value={caseStatus} />
              <HeroMetric label="Evidencias" value={String(totalEvidence || 0)} />
              <HeroMetric label="Visuales" value={String(visualItems.length)} />
              <HeroMetric label="Cola" value={statusLabel(jobStatus.status || "sin job")} />
            </div>
          </div>
        </div>
      </Card>
      <Card className="xl:col-span-4">
        <CardHeader title="Abrir expediente" eyebrow="caso OSINT" />
        <form onSubmit={(event) => submit(event, onLoadCase)} className="grid gap-3">
          <Field name="searchId" label="ID del caso" placeholder="Pega el ID o abre uno reciente" required />
          <Button className="h-11">
            <FileSearch className="h-4 w-4" />
            Cargar caso
          </Button>
        </form>
        <RecentCaseShortcuts items={recentCases} onLoadCase={onLoadCase} onDeleteCase={onDeleteCase} />
      </Card>
      <Card className="xl:col-span-8">
        <CardHeader title="Resumen ejecutivo" eyebrow="estado + confianza + volumen" action={loadedSearchId ? <StatusBadge value={`ID ${compactId(loadedSearchId)}`} /> : null} />
        {data.caseSummary ? (
          <div className="grid gap-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-black uppercase text-primary">Lectura rápida</p>
              <p className="mt-2 text-lg font-black text-foreground">{String(search.query || search.fullName || "Caso OSINT cargado")}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {buildCaseSummaryText(caseStatus, totalEvidence, visualItems.length, overallScore)}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Signal label="Estado" value={caseStatus} />
              <Signal label="Hallazgos" value={String(totalEvidence || 0)} />
              <Signal label="Imágenes" value={String(visualItems.length)} />
              <Signal label="Cola" value={statusLabel(jobStatus.status || "sin job")} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <ScoreTile label="Identidad" value={scores.identity} />
              <ScoreTile label="Legal" value={scores.legal} />
              <ScoreTile label="Financiero" value={scores.financial} />
              <ScoreTile label="General" value={overallScore} />
            </div>
          </div>
        ) : (
          <EmptyBlock text="Carga un searchId para ver estado, confianza, evidencias, visuales y timeline del caso." />
        )}
      </Card>
      <Card className="xl:col-span-12">
        <CardHeader title="Gestión del expediente" eyebrow="curar + relanzar + social" action={<StatusBadge value={loadedSearchId ? "operativo" : "sin caso"} />} />
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <form onSubmit={(event) => submit(event, onUpdateCase)} className="grid gap-3 rounded-2xl border border-border bg-black p-4">
            <input type="hidden" name="searchId" value={loadedSearchId} />
            <div>
              <p className="text-base font-black text-foreground">Nombre comercial del caso</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Cambia “unknown person search” por un nombre útil para seguimiento, reportes y búsquedas futuras.</p>
            </div>
            <Field name="query" label="Nombre del caso" placeholder="Ej: sujeto-desconocido-mexico-01" defaultValue={String(search.query || "")} />
            <Field name="description" label="Nota operativa" placeholder="Contexto corto del caso" defaultValue={String(search.description || "")} />
            <Field name="tags" label="Tags" placeholder="cliente, rostro, positivo" defaultValue={Array.isArray(search.tags) ? search.tags.join(", ") : ""} />
            <Button className="h-11" disabled={!loadedSearchId}>
              <FileText className="h-4 w-4" />
              Guardar cambios
            </Button>
          </form>
          <form onSubmit={(event) => submit(event, onRefineCase)} className="grid gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
            <input type="hidden" name="searchId" value={loadedSearchId} />
            <div>
              <p className="text-base font-black text-foreground">Buscar de nuevo con positivos</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Marca evidencias como positivas y crea una investigación refinada con social scraper, fuentes sociales, buscadores y contexto validado.</p>
            </div>
            <Field name="query" label="Nuevo foco de búsqueda" placeholder={String(search.query || "Nombre, alias o username")} defaultValue={String(search.query || "")} />
            <Field name="note" label="Pista adicional" placeholder="Qué debe priorizar el investigador OSINT" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="secondary" className="h-11" disabled={!loadedSearchId} onClick={() => onRerunCase(loadedSearchId)}>
                <Activity className="h-4 w-4" />
                Reintentar este caso
              </Button>
              <Button className="h-11" disabled={!loadedSearchId}>
                <SearchCheck className="h-4 w-4" />
                Crear refinada
              </Button>
            </div>
          </form>
          <div className="grid gap-3 rounded-2xl border border-danger/35 bg-danger/5 p-4 xl:col-span-2">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-base font-black text-foreground">Zona de limpieza</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Borra ruido del expediente o elimina el caso completo cuando ya no debe aparecer en recientes.
                </p>
              </div>
              <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 min-w-[210px]"
                  disabled={!loadedSearchId}
                  onClick={() => onClearCaseEvidences(loadedSearchId)}
                >
                  <Trash2 className="h-4 w-4" />
                  Limpiar evidencias
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 min-w-[210px]"
                  disabled={!loadedSearchId}
                  onClick={() => onDeleteCase(loadedSearchId)}
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar expediente
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>
      <Card className="xl:col-span-8">
        <CardHeader title="Evidencias" eyebrow="hallazgos revisables" action={<StatusBadge value={filteredEvidence.length ? `${filteredEvidence.length} visibles` : "sin datos"} />} />
        <div className="mb-4 grid min-w-0 gap-3">
          <Field name="evidenceFilterQuery" label="Filtrar evidencias" placeholder="Buscar título, fuente, link o resumen" value={query} onChange={(event) => { setQuery(event.currentTarget.value); setPage(1); }} />
          <div className="evidence-filter-options">
            {[
              ["all", "Todo"],
              ["visual", "Visual"],
              ["valid", "Válidas"],
              ["pending", "Pendientes"],
              ["false_positive", "Descartadas"],
              ["archived", "Archivadas"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setFilter(value); setPage(1); }}
                className={`min-h-10 rounded-xl border px-3 text-xs font-bold transition ${filter === value ? "border-primary/70 bg-primary/10 text-primary" : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/40"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {filteredEvidence.length ? (
          <div className="grid gap-3">
            {evidencePage.map((item: any) => (
              <EvidenceItemCard
                key={item.evidenceId || item.url || item.title}
                item={item}
                searchId={loadedSearchId}
                onPromote={onPromote}
                onValidate={onValidateEvidence}
                onDelete={onDeleteEvidence}
                onRestore={onRestoreEvidence}
                onEnrichImage={onEnrichEvidenceImage}
              />
            ))}
            <PaginationControls total={filteredEvidence.length} page={page} pageSize={6} onPageChange={setPage} />
          </div>
        ) : (
          <EmptyBlock text={evidenceItems.length ? "No hay evidencias para este filtro." : "Todavía no hay evidencias visibles para este caso."} />
        )}
      </Card>
      <IdentityMemoryPanel memory={data.identityMemory} searchId={loadedSearchId} onReview={onReviewIdentityCandidate} />
      <VisualEvidencePanel items={visualItems} />
      <TimelinePanel items={timelineItems} />
    </div>
  );
}

function ScoreTile({ label, value }: { label: string; value: any }) {
  const numeric = Number(value);
  const percent = Number.isFinite(numeric) ? Math.min(Math.max(numeric <= 1 ? numeric * 100 : numeric, 0), 100) : 0;
  return (
    <div className="rounded-2xl border border-border bg-black p-4">
      <p className="metric-label">{label}</p>
      <p className="mt-2 text-2xl font-black text-foreground">{Number.isFinite(numeric) ? `${Math.round(percent)}%` : "-"}</p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function RecentCaseShortcuts({
  items,
  onLoadCase,
  onDeleteCase,
}: {
  items: any[];
  onLoadCase: (form: FormData) => void;
  onDeleteCase: (searchId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 4;
  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1);
  const currentPage = Math.min(page, totalPages);
  const visibleItems = paginateItems(items, currentPage, pageSize);

  if (!items.length) {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-black p-4">
        <p className="text-sm font-black text-foreground">Sin casos recientes</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Cuando crees una investigación, aparecerá aquí para abrirla sin copiar el ID.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase text-muted-foreground">Casos recientes</p>
        <span className="rounded-full border border-border px-2 py-1 text-[10px] font-black text-muted-foreground">{items.length} casos</span>
      </div>
      {visibleItems.map((item: any) => {
        const searchId = String(item.searchId || item._id || item.id || "");
        return (
          <form key={searchId || item.query} onSubmit={(event) => submit(event, onLoadCase)} className="rounded-2xl border border-border bg-black p-4 transition hover:border-primary/30">
            <input type="hidden" name="searchId" value={searchId} />
            <div className="min-w-0">
              <p className="truncate text-base font-black text-foreground">{String(item.query || item.fullName || "Investigación OSINT")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                <span className="rounded-full border border-border bg-secondary/30 px-2 py-1">{statusLabel(item.status)}</span>
                <span>ID {compactId(searchId)}</span>
              </div>
            </div>
            <div className="mt-4 grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
              <Button type="submit" variant="secondary" className="h-10 w-full min-w-0" disabled={!searchId}>
                <FileSearch className="h-4 w-4 shrink-0" />
                <span className="truncate">Abrir</span>
              </Button>
              <button
                type="button"
                className="inline-flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-2xl border border-red-500/45 bg-black px-3 text-sm font-black text-red-300 transition hover:bg-red-950/35 hover:text-red-100 disabled:pointer-events-none disabled:opacity-50"
                disabled={!searchId}
                onClick={() => onDeleteCase(searchId)}
                aria-label={`Eliminar ${String(item.query || "expediente")}`}
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                <span className="truncate">Eliminar</span>
              </button>
            </div>
          </form>
        );
      })}
      {items.length > pageSize ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl border border-border bg-black p-2">
          <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(value - 1, 1))}>
            Anterior
          </Button>
          <span className="text-xs font-black text-foreground">{currentPage}/{totalPages}</span>
          <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(value + 1, totalPages))}>
            Siguiente
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function buildCaseSummaryText(status: string, evidenceCount: any, visualCount: number, score: any) {
  const evidence = Number(evidenceCount || 0);
  const scoreText = score === "-" || score === undefined || score === null ? "sin score calculado" : `score ${score}`;
  if (!evidence) return `El expediente está ${status} y todavía no tiene hallazgos visibles. Revisa si la búsqueda terminó o vuelve a actualizar.`;
  return `El expediente está ${status}, reúne ${evidence} hallazgos, ${visualCount} señales visuales y ${scoreText}. Puedes revisar fuentes, guardar evidencia útil en Datasec y seguir la línea de tiempo.`;
}

function compactId(value: string) {
  if (!value) return "sin ID";
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function evidenceScoreLabel(item: any) {
  const scoreType = String(item?.extractedData?.scoreType || "").toLowerCase();
  const score = item?.matchConfidence ?? item?.confidence ?? item?.reliability;
  const formatted = typeof score === "number"
    ? `${Math.round((score <= 1 ? score * 100 : score) * 10) / 10}%`
    : String(score ?? "sin score");

  if (scoreType === "face_similarity" && item?.extractedData?.identityVerified === true) {
    return `similitud facial verificada ${formatted}`;
  }
  if (scoreType === "visual_candidate") return `puntaje visual ${formatted}`;
  if (scoreType === "reverse_image_relevance") return `relevancia de imagen inversa ${formatted}`;
  if (String(item?.source || "").includes("social_scraper")) return `confianza de perfil ${formatted}`;
  return `confiabilidad de fuente ${formatted}`;
}

function evidenceDisplayTitle(item: any) {
  const title = String(item?.title || "Evidencia sin título");
  const verifiedFace = item?.extractedData?.scoreType === "face_similarity" && item?.extractedData?.identityVerified === true;
  if (!verifiedFace && String(item?.source || "").startsWith("face_search_")) {
    return title.replace(/^\[FACE\]/i, "[PISTA VISUAL]");
  }
  return title;
}

function EvidenceItemCard({
  item,
  searchId,
  onPromote,
  onValidate,
  onDelete,
  onRestore,
  onEnrichImage,
}: {
  item: any;
  searchId?: string;
  onPromote: (form: FormData) => void;
  onValidate: (evidenceId: string, status: "valid" | "false_positive", searchId?: string) => void;
  onDelete: (evidenceId: string, searchId?: string) => void;
  onRestore: (evidenceId: string, searchId?: string) => void;
  onEnrichImage: (evidenceId: string, searchId?: string) => void;
}) {
  const [datasecOpen, setDatasecOpen] = useState(false);
  const imageSrc = visualImageSrc(item);
  const sourceUrl = firstString(item.url, item.pageUrl, item.sourceUrl);
  const evidenceId = String(item.evidenceId || "");
  const source = String(item.source || "fuente desconocida");
  const category = String(item.category || "evidencia");
  const archived = item.isArchived === true;
  return (
    <div className="rounded-2xl border border-border bg-black p-4">
      <div className="grid gap-4 md:grid-cols-[120px_1fr]">
        <EvidenceImageFrame src={imageSrc} title={item.title} source={source} category={category} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="line-clamp-2 text-sm font-black text-foreground">{evidenceDisplayTitle(item)}</p>
            <StatusBadge value={String(item.validationStatus || item.category || item.source || "evidence")} />
            {archived ? <StatusPill tone="warn" label="archivada" /> : null}
            {!imageSrc ? <StatusPill tone="info" label="sin foto" /> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {source} · {evidenceScoreLabel(item)} · {item.fetchedAt || item.createdAt || "sin fecha"}
          </p>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{item.summary || item.description || "Sin resumen disponible."}</p>
          {sourceUrl ? (
            <a className="mt-3 inline-flex max-w-full items-center gap-2 text-xs font-bold text-primary hover:underline" href={sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Abrir fuente</span>
            </a>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {archived ? (
              <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={!evidenceId} onClick={() => onRestore(evidenceId, searchId)}>
                <Activity className="h-3.5 w-3.5" />
                Restaurar evidencia
              </Button>
            ) : null}
            {!archived ? <>
            {!imageSrc && sourceUrl ? (
              <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={!evidenceId} onClick={() => onEnrichImage(evidenceId, searchId)}>
                <Image className="h-3.5 w-3.5" />
                Buscar imagen pública
              </Button>
            ) : null}
            <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={!evidenceId} onClick={() => onValidate(evidenceId, "valid", searchId)}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Positivo
            </Button>
            <Button type="button" variant="secondary" className="h-9 px-3 text-xs" disabled={!evidenceId} onClick={() => onValidate(evidenceId, "false_positive", searchId)}>
              <XCircle className="h-3.5 w-3.5" />
              Falso positivo
            </Button>
            <Button type="button" variant="secondary" className="h-9 border-danger/35 px-3 text-xs text-danger hover:bg-danger/10" disabled={!evidenceId} onClick={() => onDelete(evidenceId, searchId)}>
              <Trash2 className="h-3.5 w-3.5" />
              Archivar
            </Button>
            </> : null}
          </div>
        </div>
      </div>
      {!archived ? <div className="mt-3 rounded-2xl border border-border bg-secondary/20 p-3">
        <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setDatasecOpen((value) => !value)}>
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Database className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-black text-foreground">Guardar en memoria Datasec</span>
              <span className="block truncate text-xs text-muted-foreground">Guarda este hallazgo para comparaciones futuras.</span>
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition ${datasecOpen ? "rotate-180" : ""}`} />
        </button>
        {datasecOpen ? (
          <form onSubmit={(event) => submit(event, onPromote)} className="mt-4 grid gap-3 border-t border-border pt-4">
            <input type="hidden" name="evidenceId" value={evidenceId} />
            <div className="grid gap-3 lg:grid-cols-2">
              <Field name="personId" label="Vincular persona existente" placeholder="ID Datasec (opción avanzada)" />
              <div>
                <label className="field-label">Estado de curación</label>
                <select name="curationStatus" className="control-input h-11" defaultValue={item.validationStatus === "valid" ? "validated" : "candidate"}>
                  <option value="candidate">Persona candidata</option>
                  <option value="validated">Validado por analista</option>
                  <option value="discarded">Descartado</option>
                </select>
              </div>
            </div>
            <Field name="tags" label="Etiquetas" placeholder="rostro, perfil, fuente" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">Sin persona vinculada se guardará como candidato independiente.</p>
              <Button className="h-11 w-full sm:w-auto sm:min-w-[210px]" type="submit" disabled={!evidenceId}>
                <Database className="h-4 w-4" />
                Guardar en Datasec
              </Button>
            </div>
            {!evidenceId ? <p className="text-xs font-semibold text-danger">Esta evidencia no trae identificador curable.</p> : null}
          </form>
        ) : null}
      </div> : null}
    </div>
  );
}

function EvidenceImageFrame({ src, title, source, category }: { src?: string; title?: string; source: string; category: string }) {
  const [broken, setBroken] = useState(false);
  const displaySrc = src && !broken ? imageDisplaySrc(src) : "";

  return (
    <div className="aspect-square overflow-hidden rounded-2xl border border-border bg-secondary/25">
      {displaySrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={displaySrc}
          alt={title || "evidencia visual"}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="grid h-full place-items-center p-3 text-center">
          <div>
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
              {category === "social" || source.includes("social") ? <Globe2 className="h-5 w-5" /> : <FileSearch className="h-5 w-5" />}
            </div>
            <p className="mt-3 text-[11px] font-black uppercase text-foreground">{category === "social" || source.includes("social") ? "Perfil / fuente" : "Fuente OSINT"}</p>
            <p className="mt-1 line-clamp-2 text-[10px] font-semibold text-muted-foreground">{source}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function IdentityMemoryPanel({
  memory,
  searchId,
  onReview,
}: {
  memory?: any;
  searchId?: string;
  onReview: (candidateId: string, status: "probable" | "rejected", searchId?: string) => void;
}) {
  const candidates = Array.isArray(memory?.candidates) ? memory.candidates : [];
  const biometricCounts = candidates.reduce((counts: Record<string, number>, candidate: any) => {
    const key = String(candidate.biometricStatus || "not_evaluated");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const sourceCount = new Set(candidates.flatMap((candidate: any) =>
    (Array.isArray(candidate.profiles) ? candidate.profiles : []).map((profile: any) => String(profile.url || "")).filter(Boolean),
  )).size;
  const contradictionCount = candidates.filter((candidate: any) =>
    candidate.status === "rejected" || ["unlikely", "no_face", "unavailable"].includes(String(candidate.biometricStatus || "")),
  ).length;
  const confirmedCount = candidates.filter((candidate: any) => candidate.status === "confirmed").length;
  const probableCount = candidates.filter((candidate: any) => candidate.status === "probable").length;
  const decision = confirmedCount
    ? "Identidad confirmada por un analista autorizado"
    : probableCount
      ? "Hay candidatos probables pendientes de confirmación final"
      : candidates.length
        ? "Hay candidatos, pero todavía no existe identidad confirmada"
        : "La búsqueda aún no produjo candidatos de identidad";
  if (!memory?.subject) return null;
  return (
    <Card className="xl:col-span-12">
      <CardHeader
        title="Resultado ejecutivo facial"
        eyebrow="decisión + candidatos + fuentes + contradicciones"
        action={<StatusBadge value={`${candidates.length} candidatos`} />}
      />
      <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <p className="text-base font-black text-foreground">{decision}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Sujeto {memory.subject.subjectKey}. Los valores biométricos expresan similitud técnica, no probabilidad de identidad. La decisión final siempre pertenece al analista autorizado.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Signal label="Confirmados" value={String(confirmedCount)} />
          <Signal label="Probables" value={String(probableCount)} />
          <Signal label="Fuentes" value={String(sourceCount)} />
          <Signal label="Contradicciones" value={String(contradictionCount)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
          <span className="rounded-full border border-emerald-500/30 px-2 py-1 text-emerald-400">probables {biometricCounts.probable || 0}</span>
          <span className="rounded-full border border-amber-500/30 px-2 py-1 text-amber-400">por revisar {biometricCounts.candidate || 0}</span>
          <span className="rounded-full border border-border px-2 py-1 text-muted-foreground">sin rostro {biometricCounts.no_face || 0}</span>
          <span className="rounded-full border border-danger/30 px-2 py-1 text-danger">no coincide {biometricCounts.unlikely || 0}</span>
          <span className="rounded-full border border-border px-2 py-1 text-muted-foreground">no evaluados {(biometricCounts.not_evaluated || 0) + (biometricCounts.unavailable || 0)}</span>
        </div>
      </div>
      {candidates.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {candidates.slice(0, 12).map((candidate: any) => {
            const image = candidate.metadata?.storedImageUrl || candidate.imageUrls?.[0];
            const profile = candidate.profiles?.[0];
            const custody = candidate.metadata?.custodyStatus || "external_reference_only";
            const biometricStatus = String(candidate.biometricStatus || "not_evaluated");
            const biometricLabels: Record<string, string> = {
              probable: "coincidencia facial probable",
              candidate: "similitud facial para revisar",
              unlikely: "rostro no coincidente",
              no_face: "sin rostro detectable",
              unavailable: "imagen no disponible",
              not_evaluated: "comparación no realizada",
            };
            const faceScore = Number(candidate.scores?.face);
            const lastReview = Array.isArray(candidate.reviewHistory) ? candidate.reviewHistory.at(-1) : undefined;
            return (
              <div key={candidate._id} className="overflow-hidden rounded-2xl border border-border bg-black">
                <div className="aspect-video bg-secondary/25">
                  {image ? <img src={imageDisplaySrc(image)} alt="candidato visual" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><ScanFace className="h-8 w-8 text-primary" /></div>}
                </div>
                <div className="grid gap-3 p-4">
                  <div>
                    <p className="line-clamp-2 text-sm font-black text-foreground">{candidate.displayName || "Candidato visual sin nombre"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">puntaje de descubrimiento {Math.round(Number(candidate.scores?.discovery || 0) * 100)}% · {custody === "preserved" ? "imagen preservada" : "referencia externa"}</p>
                    <p className={`mt-2 text-xs font-black ${biometricStatus === "probable" ? "text-emerald-400" : biometricStatus === "unlikely" ? "text-danger" : "text-amber-400"}`}>
                      {biometricLabels[biometricStatus] || biometricStatus}{Number.isFinite(faceScore) ? ` · similitud biométrica ${faceScore.toFixed(3)}` : ""}
                    </p>
                    {lastReview ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        Última decisión: {lastReview.nextStatus} · {lastReview.actorId || "analista"} · {lastReview.reason || "sin motivo"}
                      </p>
                    ) : null}
                  </div>
                  {profile?.url ? <a href={profile.url} target="_blank" rel="noreferrer" className="truncate text-xs font-bold text-primary hover:underline">Ver fuente candidata</a> : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="secondary" className="h-9 px-2 text-xs" disabled={candidate.status === "probable"} onClick={() => onReview(candidate._id, "probable", searchId)}>
                      Marcar probable
                    </Button>
                    <Button type="button" variant="secondary" className="h-9 border-danger/35 px-2 text-xs text-danger" disabled={candidate.status === "rejected"} onClick={() => onReview(candidate._id, "rejected", searchId)}>
                      Descartar
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : <EmptyBlock text="La investigación todavía no produjo candidatos visuales persistentes." />}
    </Card>
  );
}

function VisualEvidencePanel({ items }: { items: any[] }) {
  return (
    <Card className="xl:col-span-4">
      <CardHeader title="Activos visuales" eyebrow="imágenes + señales" action={<StatusBadge value={`${items.length} visuales`} />} />
      {items.length ? (
        <div className="grid grid-cols-2 gap-3">
          {items.slice(0, 8).map((item: any, index: number) => {
            const src = visualImageSrc(item);
            return (
              <a key={item.evidenceId || src || index} href={src || "#"} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-2xl border border-border bg-black">
                <div className="aspect-square overflow-hidden bg-secondary/25">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={item.title || "activo visual"} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                  ) : (
                    <div className="grid h-full place-items-center text-primary"><Image className="h-7 w-7" /></div>
                  )}
                </div>
                <div className="p-3">
                  <p className="line-clamp-1 text-xs font-black text-foreground">{item.title || "Activo visual"}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{item.source || "fuente"} · {item.matchConfidence ?? item.reliability ?? "-"}</p>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <EmptyBlock text="Cuando el caso tenga imágenes o thumbnails, aparecerán aquí como galería revisable." />
      )}
    </Card>
  );
}

function TimelinePanel({ items }: { items: any[] }) {
  return (
    <Card className="xl:col-span-12">
      <CardHeader title="Línea de tiempo" eyebrow="actividad del caso" action={<StatusBadge value={`${items.length} eventos`} />} />
      {items.length ? (
        <div className="relative grid gap-3 pl-5 before:absolute before:left-2 before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
          {items.slice(0, 12).map((item: any, index: number) => (
            <div key={`${item.date}-${item.title}-${index}`} className="relative rounded-2xl border border-border bg-black p-4">
              <span className="absolute -left-[1.05rem] top-5 h-3 w-3 rounded-full border-2 border-primary bg-background" />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-black text-foreground">{item.title}</p>
                <StatusPill tone="info" label={item.source || "evento"} />
              </div>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">{item.date || "fecha no disponible"}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyBlock text="Carga un caso para ver los eventos relevantes ordenados por fecha." />
      )}
    </Card>
  );
}

function NetworkView({ data, loading, onProfile }: { data: DashboardData; loading: boolean; onProfile: (form: FormData) => void }) {
  const rows = visibleAuditRows(data.audit?.auditRows);
  const rateServices = data.network?.rateLimits?.services || [];
  const groqPool = data.network?.groqPool || {};
  const jobStats = data.network?.jobStats || {};
  const globalNetwork = data.network?.networkStats?._global || {};
  const summary = data.diagnostics?._summary || data.audit?.diagnostics?._summary || {};
  const workingEngines = summary.workingEngines || [];
  const configuredEngines = summary.configuredEngines || [];
  const failedEngines = summary.failedEngines || [];
  const auditOk = rows.filter((row: any) => ["ok", "configured"].includes(String(row.status).toLowerCase())).length;
  const auditAttention = Math.max(rows.length - auditOk, 0);
  const socialScraperRow = rows.find((row: any) => row.service === "social.scraper");
  const socialScraperStatus = String(socialScraperRow?.status || data.audit?.diagnostics?.socialScraper?.status || "not_configured");
  const socialScraperReady = ["ok", "configured"].includes(socialScraperStatus.toLowerCase());
  const groqTextUsed = Number(groqPool.totalTextUsed || 0);
  const groqTextCapacity = Number(groqPool.totalTextCapacity || 0);
  const groqVisionUsed = Number(groqPool.totalVisionUsed || 0);
  const groqVisionCapacity = Number(groqPool.totalVisionCapacity || 0);
  const hasOperationalData = !!data.network || !!data.audit || !!data.diagnostics;

  if (!hasOperationalData) {
    return <NetworkBootState loading={loading} />;
  }

  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="xl:col-span-12">
        <CardHeader title="Centro operativo" eyebrow="conectores + límites + ia" />
        {data.network ? (
          <div className="grid gap-5">
            <div className="overflow-hidden rounded-2xl border border-primary/25 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.22),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-5">
              <div className="dashboard-hero-layout">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone="ok" label="Sistema conectado" />
                    <StatusPill tone={auditAttention ? "warn" : "ok"} label={`${auditAttention} alertas`} />
                  </div>
                  <h3 className="mt-4 text-2xl font-black tracking-normal text-foreground">OSINT stack listo para operar</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    Scheduler, límites, auditoría y pool IA consolidados en tiempo real para ejecutar investigaciones sin perder trazabilidad.
                  </p>
                </div>
                <div className="dashboard-hero-metrics">
                  <HeroMetric label="Motores OK" value={String(workingEngines.length || summary.totalWorking || 0)} />
                  <HeroMetric label="Groq vivo" value={`${groqPool.aliveKeys ?? 0}/${groqPool.totalKeys ?? 0}`} />
                  <HeroMetric label="RPM" value={String(globalNetwork.ratePerMin ?? "-")} />
                  <HeroMetric label="Perfil" value={String(globalNetwork.caseProfile || "n/a")} />
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <OpsStat icon={Gauge} label="Concurrencia" value={String(globalNetwork.maxConcurrent ?? "-")} caption={`${globalNetwork.active ?? 0} activos`} />
              <OpsStat icon={Zap} label="Ejecuciones" value={String(globalNetwork.totalExecuted ?? 0)} caption={`${globalNetwork.recentPerMin ?? 0}/min recientes`} />
              <OpsStat icon={Activity} label="Cola OSINT" value={String(jobStats.queued ?? 0)} caption={`${jobStats.processing ?? 0} procesando · ${jobStats.delayed ?? 0} retry`} />
              <OpsStat icon={KeyRound} label="Texto IA" value={formatCount(groqPool.totalTextRemaining ?? 0)} caption={`${formatCount(groqPool.totalTextCapacity ?? 0)} capacidad`} />
              <OpsStat icon={ShieldCheck} label="Auditoría" value={`${auditOk}/${rows.length || 0}`} caption={`jobs x${jobStats.maxAttempts ?? 3}`} />
            </div>

            <div className="rounded-2xl border border-border bg-black/70 p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
                    <ScanFace className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="metric-label">Scraper social</p>
                    <h4 className="mt-1 text-lg font-black text-foreground">
                      {socialScraperReady ? "Apoyo social activo para rostros" : "Scraper social pendiente"}
                    </h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      Alimenta búsquedas por username, nombre, perfiles y comparación visual contra memoria social cuando RapidAPI no alcanza.
                    </p>
                  </div>
                </div>
                <div className="grid shrink-0 gap-2 sm:grid-cols-2">
                  <StatusPill tone={socialScraperReady ? "ok" : "warn"} label={socialScraperStatus} />
                  <StatusPill tone="info" label="face-jobs + assets" />
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-border bg-black/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="metric-label">Capacidad Groq</p>
                    <p className="mt-1 text-sm text-muted-foreground">{groqPool.resetIn ? `Reset en ${groqPool.resetIn}` : "Pool IA operativo"}</p>
                  </div>
                  <StatusPill tone={(groqPool.aliveKeys || 0) > 0 ? "ok" : "bad"} label={`${groqPool.aliveKeys ?? 0} alive`} />
                </div>
                <div className="mt-4 grid gap-4">
                  <CapacityBar label="Texto" used={groqTextUsed} total={groqTextCapacity} />
                  <CapacityBar label="Visión" used={groqVisionUsed} total={groqVisionCapacity} />
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-black/70 p-4">
                <p className="metric-label">Motores y señales</p>
                <div className="mt-4 grid gap-2">
                  <EngineStrip title="Activos" items={workingEngines} tone="ok" empty="Sin motores activos" />
                  <EngineStrip title="Configurados" items={configuredEngines} tone="info" empty="Sin señales configuradas" />
                  <EngineStrip title="Atención" items={failedEngines} tone="warn" empty="Sin incidencias" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-black/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="metric-label">Rate limits</p>
                  <p className="mt-1 text-sm text-muted-foreground">Consumo diario por proveedor operativo.</p>
                </div>
                <StatusPill tone="info" label={`${rateServices.length} servicios`} />
              </div>
              {rateServices.length ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {rateServices.map((item: any) => (
                    <LimitRow key={item.service} service={item.service} usage={item.usage} />
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Sin métricas de rate limit todavía.</p>
              )}
            </div>
          </div>
        ) : (
          <EmptyBlock text="Actualiza para cargar límites, estado de red, Groq y ledger técnico." />
        )}
      </Card>
      <Card className="xl:col-span-4">
        <CardHeader title="Perfil de red" eyebrow="scheduler" />
        <form onSubmit={(event) => submit(event, onProfile)} className="grid gap-3">
          <label className="grid gap-2">
            <span className="text-xs font-medium text-muted-foreground">Perfil</span>
            <select name="profile" className="control-input" defaultValue="standard">
              <option value="silent">silent</option>
              <option value="stealth">stealth</option>
              <option value="standard">standard</option>
              <option value="aggressive">aggressive</option>
            </select>
          </label>
          <Button>Aplicar perfil</Button>
        </form>
        <div className="mt-4 rounded-2xl border border-border bg-black/60 p-4">
          <p className="metric-label">Perfil activo</p>
          <p className="mt-2 text-2xl font-black text-foreground">{String(globalNetwork.caseProfile || "standard")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajusta frecuencia, concurrencia y espera entre motores.
          </p>
        </div>
      </Card>
      <Card className="xl:col-span-8">
        <CardHeader title="Auditoría de conectores" eyebrow="detalle técnico" />
        <div tabIndex={0} role="region" aria-label="Tabla de conectores" className="overflow-auto rounded-2xl border border-border bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-secondary/60 text-foreground">
              <tr>
                <th className="p-3">Conector</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Prioridad</th>
                <th className="p-3">Acción sugerida</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row: any) => (
                <tr key={row.service} className="border-t border-border text-muted-foreground transition-colors hover:bg-secondary/25">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <ConnectorIcon status={row.status} />
                      <span className="font-semibold text-foreground">{row.service}</span>
                    </div>
                  </td>
                  <td className="p-3"><StatusBadge value={row.status} /></td>
                  <td className="p-3"><PriorityBadge value={row.priority} /></td>
                  <td className="p-3">{row.action}</td>
                </tr>
              )) : (
                <tr><td className="p-5 text-muted-foreground" colSpan={4}>Sin auditoría cargada. Usa Actualizar para reintentar.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="xl:col-span-12"><JsonPanel title="Resultado profile" eyebrow="case-profile" value={data.profileResult || { status: "sin cambio aplicado" }} /></div>
    </div>
  );
}

function Metric({
  title,
  value,
  icon: Icon,
  className = "xl:col-span-3",
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="metric-label">{title}</p>
          <p className="mt-3 text-3xl font-black">{value}</p>
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-full border border-border bg-black text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function Footer() {
  return (
    <footer className="mt-8 flex flex-wrap justify-between gap-3 border-t border-border py-5 text-xs text-muted-foreground md:text-sm">
      <span>By: deco31416.com</span>
      <span>Versión v0.4.0</span>
    </footer>
  );
}

function DashboardAlerts({ data }: { data: DashboardData }) {
  const latestError = data.errors[0];
  const degraded = String(data.apiStatus || "").toLowerCase() === "degraded";
  const disconnected = !data.health && !!latestError;

  if (!latestError && !degraded) return null;

  return (
    <Card className="mb-4 border-amber-500/30">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black text-foreground">
            {degraded ? "Micro conectado con dependencias degradadas" : "No se pudo completar la conexión con el micro"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {degraded
              ? "El backend respondió, pero reportó problemas en alguna dependencia como MongoDB, Redis o un proveedor externo."
              : latestError?.message || "Revisa el micro, las variables de entorno y reinicia el dashboard después de cambiar .env.local."}
          </p>
          {disconnected ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Si acabas de editar variables, reinicia `pnpm dev` en el dashboard para recargar `OSINT_API_BASE`, `OSINT_AUTH_USERNAME` y `OSINT_AUTH_PASSWORD`.
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/30 p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 text-base font-black">{value}</p>
    </div>
  );
}

function QuickAction({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-black p-4">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="rounded-2xl border border-border bg-black p-4 text-sm text-muted-foreground">{text}</div>;
}

function FaceImageCard({ title, src }: { title: string; src?: string }) {
  const displaySrc = imageDisplaySrc(src);
  const canLink = Boolean(src && /^https?:\/\//i.test(src));

  return (
    <div className="rounded-2xl border border-border bg-black p-3">
      <p className="metric-label mb-3">{title}</p>
      <div className="aspect-video overflow-hidden rounded-xl border border-border bg-secondary/30">
        {displaySrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={displaySrc} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">Sin imagen</div>
        )}
      </div>
      {canLink ? (
        <a className="mt-2 block truncate text-xs font-semibold text-primary hover:underline" href={src} target="_blank" rel="noreferrer">
          {src}
        </a>
      ) : null}
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-2xl border border-border bg-black p-4">
      <p className="metric-label mb-2">{label}</p>
      <pre className="max-h-[240px] overflow-auto text-[11px] leading-relaxed text-slate-200 md:text-xs">
        {JSON.stringify(value ?? null, null, 2)}
      </pre>
    </div>
  );
}

function NetworkBootState({ loading }: { loading: boolean }) {
  return (
    <div className="grid gap-4 xl:grid-cols-12">
      <Card className="overflow-hidden xl:col-span-12">
        <div className="rounded-2xl border border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 sm:p-6">
          <div className="dashboard-hero-layout">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="info" label={loading ? "Verificando" : "Preparando"} />
                <StatusPill tone="ok" label="micro 7105" />
              </div>
              <h3 className="mt-4 text-2xl font-black tracking-normal sm:text-3xl text-foreground">Sincronizando centro operativo</h3>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Validando salud del micro, conectores, límites, auditoría y pool IA antes de pintar el tablero final.
              </p>
            </div>
            <div className="dashboard-hero-metrics">
              <HeroMetric label="Health" value="check" />
              <HeroMetric label="Conectores" value="scan" />
              <HeroMetric label="Groq" value="pool" />
              <HeroMetric label="Rate limits" value="sync" />
            </div>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-4">
            {["Mongo + Redis", "Scheduler", "Auditoría", "IA + motores"].map((item) => (
              <div key={item} className="rounded-2xl border border-border bg-black/50 p-4">
                <div className="mb-3 h-2 w-16 rounded-full bg-primary/50" />
                <p className="text-sm font-black text-foreground">{item}</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full w-2/3 rounded-full bg-primary/80" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
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

function OpsStat({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-black/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <p className="mt-2 truncate text-2xl font-black text-foreground">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{caption}</p>
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function CapacityBar({ label, used, total }: { label: string; used: number; total: number }) {
  const safeTotal = total > 0 ? total : 0;
  const percentage = safeTotal ? Math.min(Math.round((used / safeTotal) * 100), 100) : 0;
  const remaining = Math.max(safeTotal - used, 0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{formatCount(remaining)} restantes</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{formatCount(used)} usados de {formatCount(safeTotal)}</p>
    </div>
  );
}

function LimitRow({ service, usage }: { service: string; usage?: any }) {
  const used = Number(usage?.todayUsage || 0);
  const limit = Number(usage?.dailyLimit || 0);
  const percentage = limit ? Math.min(Math.round((used / limit) * 100), 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-black text-foreground">{service}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{formatCount(used)} / {formatCount(limit)}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{usage?.resetIn ? `Reset ${usage.resetIn}` : `${percentage}% usado`}</p>
    </div>
  );
}

function EngineStrip({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: string[];
  tone: "ok" | "warn" | "info";
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-black uppercase text-muted-foreground">{title}</span>
        <StatusPill tone={tone} label={String(items.length)} />
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length ? items.slice(0, 5).map((item) => (
          <span key={item} className="max-w-full truncate rounded-full border border-border bg-black px-2.5 py-1 text-xs font-semibold text-foreground">
            {item}
          </span>
        )) : (
          <span className="text-xs text-muted-foreground">{empty}</span>
        )}
      </div>
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

function ConnectorIcon({ status }: { status: string }) {
  const normalized = String(status).toLowerCase();
  const ok = ["ok", "configured", "up", "available"].includes(normalized);
  const Icon = ok ? CheckCircle2 : XCircle;
  const className = ok
    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
    : "border-amber-400/30 bg-amber-400/10 text-amber-300";

  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border ${className}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

function PriorityBadge({ value }: { value: string }) {
  const normalized = String(value).toLowerCase();
  const tone = normalized === "critical" ? "bad" : normalized === "high" ? "warn" : "info";
  return <StatusPill tone={tone} label={value || "n/a"} />;
}

function formatCount(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("es-CO", { notation: number >= 10000 ? "compact" : "standard" }).format(number);
}

function valueOf(result: PromiseSettledResult<any>) {
  return result.status === "fulfilled" ? result.value : null;
}

function parseNetwork(result: PromiseSettledResult<any>[] | null) {
  if (!result) return null;
  const [rateLimits, auditStats, groqPool, networkStats, networkLedger, jobStats] = result;
  return {
    rateLimits: valueOf(rateLimits),
    auditStats: valueOf(auditStats),
    groqPool: valueOf(groqPool),
    networkStats: valueOf(networkStats),
    networkLedger: valueOf(networkLedger),
    jobStats: valueOf(jobStats),
  };
}

function parseSocialHealth(result: PromiseSettledResult<any>[] | null) {
  if (!result) return null;
  const [instagram, meta] = result;
  return {
    instagram: valueOf(instagram),
    meta: valueOf(meta),
  };
}

function parseDatasecBundle(result: PromiseSettledResult<any>[] | null) {
  if (!result) return null;
  const [stats, persons, assets] = result;
  return {
    stats: valueOf(stats),
    persons: valueOf(persons),
    assets: valueOf(assets),
  };
}

function buildDashboardNotifications(data: DashboardData) {
  const items: Array<{ title: string; detail: string; tone?: "ok" | "warn" | "bad" | "info" }> = [];
  const status = String(data.apiStatus || data.health?.status || "").toLowerCase();
  const lastSearch: any = data.lastSearch || {};
  const evidenceCount = extractEvidenceItems(data.evidence).length;

  if (data.errors?.length) {
    items.push({
      title: "Atención requerida",
      detail: data.errors[0]?.message || "Hay un evento pendiente de revisar.",
      tone: "bad",
    });
  }

  if (lastSearch.searchId || lastSearch._id || lastSearch.id) {
    items.push({
      title: "Investigación generada",
      detail: String(lastSearch.query || lastSearch.searchId || lastSearch._id || "Caso creado correctamente."),
      tone: "ok",
    });
  }

  if (evidenceCount) {
    items.push({
      title: "Evidencias cargadas",
      detail: `${evidenceCount} hallazgos disponibles para revisar y guardar en Datasec.`,
      tone: "info",
    });
  }

  if ((data.datasec as any)?.lastPromoted) {
    items.push({
      title: "Datasec actualizado",
      detail: "Una evidencia fue guardada o vinculada a la memoria interna.",
      tone: "ok",
    });
  }

  if (["ok", "up", "healthy"].includes(status)) {
    items.push({
      title: "Microservicio conectado",
      detail: "El dashboard puede consultar investigaciones, evidencias y conectores.",
      tone: "ok",
    });
  } else if (status) {
    items.push({
      title: "Conexión en revisión",
      detail: "El dashboard está verificando el estado del microservicio.",
      tone: "warn",
    });
  }

  return items;
}

function splitList(value: FormDataEntryValue | null) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function submit(event: React.FormEvent<HTMLFormElement>, handler: (form: FormData) => void) {
  event.preventDefault();
  handler(new FormData(event.currentTarget));
}

async function facePayload(form: FormData) {
  const imageSource = String(form.get("imageSource") || "upload");
  const imageUrlRaw = String(form.get("imageUrl") || "").trim();
  const imageBase64Raw = String(form.get("imageBase64") || "").trim();
  const imageFile = form.get("imageFile");
  const fileBase64 = imageFile instanceof File && imageFile.size > 0 ? await fileToBase64(imageFile) : "";
  const imageBase64RawSelected = (fileBase64 || imageBase64Raw).replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  const datasecImageIdRaw = String(form.get("datasecImageId") || "").trim();
  const imageUrl = imageSource === "url" ? imageUrlRaw : "";
  const imageBase64 = imageSource === "upload" ? imageBase64RawSelected : "";
  const datasecImageId = imageSource === "datasec" ? datasecImageIdRaw : "";
  const datasecCameraId = String(form.get("datasecCameraId") || "").trim();
  const datasecPersonId = String(form.get("datasecPersonId") || "").trim();
  const mode = String(form.get("faceJobMode") || "standard");
  const maxRuntimeMinutes = Number(form.get("maxRuntimeMinutes") || 15);
  const maxCandidates = Number(form.get("maxCandidates") || 25);
  const minCandidateScorePercent = Number(form.get("minCandidateScore") || 40);
  const platforms = form.getAll("platforms").map((item) => String(item)).filter(Boolean);
  const profileUrls = String(form.get("profileUrls") || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("http"));

  return compact({
    imageUrl,
    imageBase64,
    datasecImageId,
    datasecCameraId,
    datasecPersonId,
    searchDatasec: form.has("searchDatasec"),
    userId: form.get("userId") || "reverse-image-engine-dashboard",
    firstName: String(form.get("firstName") || "").trim(),
    lastName: String(form.get("lastName") || "").trim(),
    username: String(form.get("username") || "").trim(),
    profileUrls,
    mode,
    maxRuntimeMs: Math.max(maxRuntimeMinutes, 1) * 60 * 1000,
    maxCandidates,
    minCandidateScore: Math.max(Math.min(minCandidateScorePercent, 100), 0) / 100,
    platforms,
  });
}

async function faceToolImageSource(form: FormData, prefix: string) {
  const imageFile = form.get(`${prefix}File`);
  const imageFromFile = imageFile instanceof File && imageFile.size > 0 ? await fileToBase64(imageFile) : "";
  const imageFromUrl = String(form.get(`${prefix}Url`) || "").trim();
  const datasecAssetId = String(form.get(`${prefix}DatasecAssetId`) || "").trim();

  if (!imageFromFile && !imageFromUrl && !datasecAssetId) {
    throw new Error("Sube una imagen, pega una URL o indica un ID de Datasec.");
  }

  return {
    image: imageFromFile || imageFromUrl,
    datasecAssetId,
  };
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

function extractEvidenceItems(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.evidences)) return payload.evidences;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function extractVisualItems(payload: any) {
  if (Array.isArray(payload?.topImages)) return payload.topImages;
  if (Array.isArray(payload?.images)) return payload.images;
  if (Array.isArray(payload?.items)) return payload.items.filter((item: any) => visualImageSrc(item));
  return [];
}

function filterEvidenceItems(items: any[], filter: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item: any) => {
    const isVisual = Boolean(visualImageSrc(item) || item.category === "image" || item.category === "google_vision");
    const status = String(item.validationStatus || item.curationStatus || "").toLowerCase();
    const matchesFilter =
      filter === "all" ||
      (filter === "visual" && isVisual) ||
      (filter === "valid" && ["valid", "validated"].includes(status)) ||
      (filter === "pending" && ["", "pending", "candidate"].includes(status)) ||
      (filter === "false_positive" && ["false_positive", "discarded"].includes(status)) ||
      (filter === "archived" && item.isArchived === true);

    if (filter !== "archived" && item.isArchived === true) return false;

    if (!matchesFilter) return false;
    if (!normalizedQuery) return true;

    return [item.title, item.summary, item.description, item.source, item.url, item.imageUrl, item.thumbnailUrl]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
  });
}

function visualImageSrc(item: any) {
  return firstString(item?.thumbnailUrl, item?.imageUrl);
}

function normalizeTimelineItems(payload: any) {
  const entries = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.entries)
      ? payload.entries
      : Array.isArray(payload?.timeline)
        ? payload.timeline
        : Array.isArray(payload?.events)
          ? payload.events
          : [];

  return entries.map((item: any, index: number) => ({
    title: firstString(item.title, item.event, item.type, item.source) || `Evento ${index + 1}`,
    description: firstString(item.description, item.summary, item.text, item.details) || "Evento detectado en el caso.",
    date: firstString(item.date, item.timestamp, item.createdAt, item.fetchedAt) || "",
    source: firstString(item.source, item.category, item.kind) || "caso",
  }));
}

function visibleAuditRows(rows: any[] | undefined) {
  return (rows || []).filter((row: any) => row?.service !== "darkweb.tor");
}
