import axios, { AxiosInstance } from "axios";

export const DEFAULT_API_BASE = "/api/osint";

export type ClientState = {
  apiBase: string;
};

export class OsintApi {
  private http: AxiosInstance;

  constructor(private state: ClientState) {
    this.http = axios.create({
      baseURL: state.apiBase,
      timeout: 60000,
    });
  }

  update(state: ClientState) {
    this.state = state;
    this.http = axios.create({
      baseURL: state.apiBase,
      timeout: 60000,
    });
  }

  async get(path: string) {
    const { data } = await this.http.get("", { params: { path } });
    return data;
  }

  async post(path: string, body: unknown) {
    const { data } = await this.http.post("", body, { params: { path } });
    return data;
  }

  async patch(path: string, body: unknown) {
    const { data } = await this.http.patch("", body, { params: { path } });
    return data;
  }

  async delete(path: string) {
    const { data } = await this.http.delete("", { params: { path } });
    return data;
  }

  health() {
    return this.get("/osint/health");
  }

  serviceAudit(query = "test") {
    return this.get(`/osint/service-audit?q=${encodeURIComponent(query)}`);
  }

  diagnostics(query = "test") {
    return this.get(`/osint/diagnostics?q=${encodeURIComponent(query)}`);
  }

  searches(limit = 50) {
    return this.get(`/osint/searches?limit=${encodeURIComponent(String(limit))}`);
  }

  stats() {
    return this.get("/osint/stats");
  }

  createSearch(body: unknown) {
    return this.post("/osint/search", body);
  }

  updateSearch(searchId: string, body: unknown) {
    return this.patch(`/osint/search/${encodeURIComponent(searchId)}`, body);
  }

  reExecuteSearch(searchId: string) {
    return this.post(`/osint/search/${encodeURIComponent(searchId)}/re-execute`, {});
  }

  refineSearchFromPositives(searchId: string, body: unknown) {
    return this.post(`/osint/search/${encodeURIComponent(searchId)}/refine-from-positives`, body);
  }

  validateEvidence(evidenceId: string, body: unknown) {
    return this.patch(`/osint/evidence/${encodeURIComponent(evidenceId)}/validate`, body);
  }

  enrichEvidenceImage(evidenceId: string) {
    return this.post(`/osint/evidence/${encodeURIComponent(evidenceId)}/enrich-image`, {});
  }

  deleteSearch(searchId: string) {
    return this.delete(`/osint/search/${encodeURIComponent(searchId)}`);
  }

  caseCleanupPreview(searchId: string) {
    return this.get(`/osint/search/${encodeURIComponent(searchId)}/cleanup-preview`);
  }

  clearSearchEvidences(searchId: string) {
    return this.delete(`/osint/search/${encodeURIComponent(searchId)}/evidences`);
  }

  deleteEvidence(evidenceId: string) {
    return this.delete(`/osint/evidence/${encodeURIComponent(evidenceId)}`);
  }

  archivedEvidence(searchId: string) {
    return this.get(`/osint/evidence/${encodeURIComponent(searchId)}/archived`);
  }

  restoreEvidence(evidenceId: string) {
    return this.patch(`/osint/evidence/${encodeURIComponent(evidenceId)}/restore`, {});
  }

  faceSearch(body: unknown) {
    return this.post("/osint/search/face", body);
  }

  createFaceJob(body: unknown) {
    return this.post("/osint/face-jobs", body);
  }

  detectFaces(body: unknown) {
    return this.post("/osint/visual/detect-faces", body);
  }

  getFaceJob(jobId: string) {
    return this.get(`/osint/face-jobs/${encodeURIComponent(jobId)}`);
  }

  cancelFaceJob(jobId: string) {
    return this.post(`/osint/face-jobs/${encodeURIComponent(jobId)}/cancel`, {});
  }

  identityMemorySubject(searchId: string) {
    return this.get(`/osint/identity-memory/subjects/${encodeURIComponent(searchId)}`);
  }

  reviewIdentityCandidate(candidateId: string, body: unknown) {
    return this.patch(`/osint/identity-memory/candidates/${encodeURIComponent(candidateId)}/review`, body);
  }

  imageSearch(body: unknown) {
    return this.post("/osint/search/by-image", body);
  }

  analyzeFace(body: unknown) {
    return this.post("/osint/ai/analyze-face", body);
  }

  enhanceImage(body: unknown) {
    return this.post("/osint/ai/enhance-image", body);
  }

  compareFaces(body: unknown) {
    return this.post("/osint/ai/compare-faces", body);
  }

  getCase(searchId: string) {
    return Promise.all([
      this.get(`/osint/search/${searchId}`),
      this.get(`/osint/evidence/${searchId}`),
      this.get(`/osint/evidence/${searchId}/stats`),
      this.get(`/osint/scores/${searchId}`),
      this.get(`/osint/timeline/${searchId}`),
      this.get(`/osint/evidence/${searchId}/visual-summary`),
      this.get(`/osint/search/${searchId}/job`),
    ]);
  }

  instagram(body: unknown) {
    return this.post("/osint/instagram/search", body);
  }

  meta(body: unknown) {
    return this.post("/osint/meta/search", body);
  }

  facebookSearch(body: unknown) {
    return this.post("/osint/meta/search-fb", body);
  }

  darkweb(body: unknown) {
    return this.post("/osint/darkweb/search", body);
  }

  socialHealthBundle() {
    return Promise.allSettled([
      this.get("/osint/instagram/health"),
      this.get("/osint/meta/health"),
    ]);
  }

  darkwebHealth() {
    return this.get("/osint/darkweb/health");
  }

  networkBundle() {
    return Promise.allSettled([
      this.get("/osint/rate-limits"),
      this.get("/osint/audit-logs/stats"),
      this.get("/osint/groq-pool"),
      this.get("/osint/internal/network-stats"),
      this.get("/osint/internal/network-ledger"),
      this.get("/osint/jobs/stats"),
    ]);
  }

  profile(profile: string) {
    return this.post("/osint/internal/case-profile", { profile });
  }

  datasecBundle() {
    return Promise.allSettled([
      this.get("/osint/datasec/stats"),
      this.get("/osint/datasec/persons?limit=12"),
      this.get("/osint/datasec/assets?limit=24"),
    ]);
  }

  listDatasecPersons(params: Record<string, string | number | undefined>) {
    return this.get(`/osint/datasec/persons${queryString(params)}`);
  }

  listDatasecAssets(params: Record<string, string | number | undefined>) {
    return this.get(`/osint/datasec/assets${queryString(params)}`);
  }

  getDatasecPerson(personId: string) {
    return this.get(`/osint/datasec/persons/${encodeURIComponent(personId)}`);
  }

  createDatasecPerson(body: unknown) {
    return this.post("/osint/datasec/persons", body);
  }

  createDatasecAsset(body: unknown) {
    return this.post("/osint/datasec/assets", body);
  }

  uploadDatasecImage(body: unknown) {
    return this.post("/osint/datasec/upload", body);
  }

  promoteEvidenceToDatasec(body: unknown) {
    return this.post("/osint/datasec/promote-evidence", body);
  }

  listSocialAssets(params: Record<string, string | number | undefined>) {
    return this.get(`/osint/social-assets${queryString(params)}`);
  }

  markSocialAssetStatus(assetId: string, body: unknown) {
    return this.patch(`/osint/social-assets/${encodeURIComponent(assetId)}/status`, body);
  }

  promoteSocialAssetToDatasec(assetId: string, body: unknown) {
    return this.post(`/osint/social-assets/${encodeURIComponent(assetId)}/promote-datasec`, body);
  }

}

function queryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const value = search.toString();
  return value ? `?${value}` : "";
}
