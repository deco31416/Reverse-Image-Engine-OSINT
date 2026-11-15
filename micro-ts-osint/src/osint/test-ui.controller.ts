// @ts-nocheck
import { Controller, Get, Res, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Test UI')
@Controller('test-ui')
export class TestUiController {
  private readonly logger = new Logger(TestUiController.name);

  constructor(private readonly configService: ConfigService) {}

  @Get()
  @Public()
  @ApiExcludeEndpoint()
  getTestUi(@Res() res: Response) {
    if (!this.isEnabled()) {
      throw new NotFoundException('Test UI disabled');
    }
    this.logger.log('🧪 Test UI accessed');
    res.header('Content-Type', 'text/html');
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    res.send(this.getHtmlContent());
  }

  private isEnabled() {
    const nodeEnv = this.configService.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
    return nodeEnv !== 'production' && this.configService.get<string>('ENABLE_TEST_UI') === 'true';
  }

  private getHtmlContent(): string {
    // @ts-ignore - Template literals inside HTML are for client-side JavaScript
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OSINT Microservice v2.2 - Test UI PRO</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@200;400;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#030406;--bg0:#030406;--panel:#0a0b10;--bg1:#0a0b10;--bg2:#05070d;--card:rgba(255,255,255,0.06);--card2:rgba(255,255,255,0.08);--border:#1a1c26;--text:#fff;--text-dim:#64748b;--muted:#64748b;--muted2:rgba(255,255,255,0.50);--shadow:0 20px 60px rgba(0,0,0,0.65);--ok:#22c55e;--warn:#f59e0b;--err:#ef4444;--accent:#d4af37;--accent-dim:rgba(212,175,55,0.2);--cyan:#22d3ee;--magenta:#a78bfa;--radius:0px;--radius-sm:4px;--ring:0 0 0 3px rgba(212,175,55,0.25);--font-main:'Plus Jakarta Sans',ui-sans-serif,system-ui,-apple-system,sans-serif;--font-mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace}*{box-sizing:border-box}html,body{height:100%}html{font-size:16px}@media(max-width:768px){html{font-size:15px}}@media(max-width:640px){html{font-size:14px}}body{position:relative;margin:0;color:var(--text);background-color:var(--bg0);font-family:var(--font-main);line-height:1.5;overflow-x:hidden;cursor:default}body::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:0.5;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:50px 50px;mask-image:radial-gradient(circle at 50% 50%,black,transparent 80%);z-index:-1}body::after{content:"";position:fixed;inset:0;pointer-events:none;opacity:0.07;background:repeating-linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.08) 1px,transparent 1px,transparent 6px);mix-blend-mode:overlay;z-index:-1;animation:scanLines 7s linear infinite}@media(prefers-reduced-motion:reduce){body::after{animation:none}}@keyframes scanLines{0%{transform:translateY(0)}100%{transform:translateY(24px)}}@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}:focus-visible{outline:none;box-shadow:var(--ring)}input,select,textarea{cursor:text}button,.btn{cursor:pointer}a{cursor:pointer}.mono{font-family:var(--font-mono)}.container{max-width:1300px;margin:0 auto;padding:0 40px}@media(max-width:768px){.container{padding:0 24px}}@media(max-width:640px){.container{padding:0 20px}}.topBar{display:flex;align-items:center;justify-content:space-between;gap:16px;height:80px;padding:0 40px;border-bottom:1px solid var(--border);background:rgba(3,4,6,0.8);backdrop-filter:blur(10px);position:sticky;top:0;z-index:100;margin:0 -40px 40px}@media(max-width:768px){.topBar{height:70px;gap:12px;padding:0 24px;margin:0 -24px 24px}}@media(max-width:640px){.topBar{height:auto;min-height:60px;padding:12px 20px;margin:0 -20px 20px;flex-wrap:wrap}}.brand{display:flex;align-items:center;gap:15px}.brandMark{display:flex;align-items:center;gap:0;font-weight:800;font-size:1.4rem;letter-spacing:-1px;color:var(--text)}@media(max-width:768px){.brandMark{font-size:1.2rem}}@media(max-width:640px){.brandMark{font-size:1.1rem}}.brandMark span{color:var(--accent);margin-left:8px}.brandTitle{font-size:16px;font-weight:750}@media(max-width:768px){.brandTitle{font-size:15px}}.brandSubtitle{font-size:12px;color:var(--muted);margin-top:2px}@media(max-width:768px){.brandSubtitle{font-size:11px}}.brandSubtitle strong{color:rgba(255,255,255,0.86);font-weight:800}.statusRow{display:flex;align-items:center;gap:10px}@media(max-width:640px){.statusRow{flex-wrap:wrap}}.badge,.system-status{display:inline-flex;align-items:center;gap:8px;padding:4px 12px;border-radius:var(--radius-sm);border:1px solid rgba(34,197,94,0.2);background:transparent;font-family:var(--font-mono);font-size:0.7rem;font-weight:400;letter-spacing:0.05em;color:#22c55e}@media(max-width:768px){.badge,.system-status{font-size:0.65rem;padding:3px 10px}}@media(max-width:640px){.badge,.system-status{font-size:0.6rem;padding:3px 8px}}.badge::before,.system-status::before{content:'';width:8px;height:8px;background:#22c55e;border-radius:50%}.badgeOk{border-color:rgba(34,197,94,0.35);color:rgba(187,247,208,0.95)}.badgeWarn{border-color:rgba(245,158,11,0.35);color:rgba(253,230,138,0.95)}.badgeError{border-color:rgba(239,68,68,0.35);color:rgba(254,202,202,0.95)}.card{border:1px solid var(--border);background:var(--panel);padding:30px;border-radius:var(--radius);overflow:hidden;position:relative;transition:all 0.3s ease}@media(max-width:768px){.card{padding:20px}}@media(max-width:640px){.card{padding:16px}}.card:hover{border-color:var(--accent);box-shadow:0 0 30px rgba(212,175,55,0.1)}.card::after{content:"";position:absolute;top:0;right:0;width:40px;height:40px;background:linear-gradient(45deg,transparent 50%,var(--border) 50%);pointer-events:none}.cardHeader{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.10)}@media(max-width:640px){.cardHeader{padding:10px 12px;flex-direction:column;align-items:flex-start}}.cardTitle{font-weight:750;font-size:1.1rem}@media(max-width:768px){.cardTitle{font-size:1rem}}@media(max-width:640px){.cardTitle{font-size:0.95rem}}.cardHint{font-size:12px;color:var(--muted);margin-top:2px}.buttonRow{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:640px){.buttonRow{flex-direction:column;gap:10px}.buttonRow .btn{width:100%}}.btn{appearance:none;border:1px solid var(--border);background:rgba(255,255,255,0.06);color:var(--text);border-radius:var(--radius);padding:10px 16px;font-weight:700;font-family:var(--font-main);cursor:pointer;transition:all 0.3s ease;text-transform:uppercase;font-size:0.85rem;letter-spacing:0.5px}@media(max-width:768px){.btn{padding:12px 18px;font-size:0.9rem}}@media(max-width:640px){.btn{padding:14px 20px;font-size:0.95rem}}.btn:hover{transform:translateY(-2px);background:rgba(255,255,255,0.09);box-shadow:0 4px 12px rgba(0,0,0,0.3)}.btn:disabled{opacity:0.4;cursor:not-allowed;transform:none}.btnPrimary{border-color:var(--accent);background:var(--accent);color:#000}.btnPrimary:hover{background:var(--accent);opacity:0.9}.btnDanger{border-color:rgba(239,68,68,0.35);color:rgba(254,202,202,0.95)}.btnSecondary{border-color:var(--accent-dim)}.control,input.control,select.control{width:100%;padding:10px 12px;border-radius:var(--radius);border:1px solid var(--border);background:rgba(0,0,0,0.3);color:var(--text);outline:none;font-family:var(--font-main);font-size:14px}@media(max-width:768px){.control,input.control,select.control{padding:12px 14px;font-size:16px}}.control:focus-visible{box-shadow:var(--ring)}select.control{cursor:pointer;appearance:none;background-image:linear-gradient(45deg,transparent 50%,rgba(255,255,255,0.55) 50%),linear-gradient(135deg,rgba(255,255,255,0.55) 50%,transparent 50%);background-position:calc(100% - 18px) calc(1em + 3px),calc(100% - 13px) calc(1em + 3px);background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:36px}.fieldGrid{display:grid;gap:10px}.fieldRow{display:grid;grid-template-columns:90px 1fr;gap:10px;align-items:flex-start}@media(max-width:520px){.fieldRow{grid-template-columns:1fr}}.fieldLabel{padding-top:10px;font-size:12px;color:var(--muted);font-weight:700}.resultsPanel{margin-top:20px}.console{background:#000;border:1px solid var(--border);padding:25px;font-family:var(--font-mono);font-size:0.85rem;color:#a5b4fc;line-height:1.5;border-radius:var(--radius);max-height:700px;overflow-y:auto;overflow-wrap:break-word;word-break:break-word}.gridLayout{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(350px,100%),1fr));gap:16px;margin-top:16px}@media(max-width:768px){.gridLayout{grid-template-columns:1fr}}.resultCard{padding:15px;margin-bottom:10px;background:var(--bg1);border-left:4px solid var(--accent);border-radius:var(--radius-sm);border:1px solid var(--border);overflow-wrap:break-word;word-break:break-word}.resultCard strong{color:var(--accent)}.imageGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:15px;margin-top:15px}.imageItem{position:relative;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:pointer;transition:transform 0.3s}.imageItem:hover{transform:scale(1.05)}.imageItem img{width:100%;height:150px;object-fit:cover}.imageOverlay{position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.7);color:white;padding:5px;font-size:11px}.alert{padding:15px;border-radius:var(--radius-sm);margin-bottom:15px;border-left:4px solid var(--accent);position:relative}.alertSuccess{background:rgba(34,197,94,0.1);color:rgba(187,247,208,0.95);border-color:rgba(34,197,94,0.5)}.alertError{background:rgba(239,68,68,0.1);color:rgba(254,202,202,0.95);border-color:rgba(239,68,68,0.5)}.alertWarning{background:rgba(245,158,11,0.1);color:rgba(253,230,138,0.95);border-color:rgba(245,158,11,0.5)}.alertInfo{background:rgba(59,130,246,0.1);color:rgba(191,219,254,0.95);border-color:rgba(59,130,246,0.5)}.alertDismiss{position:absolute;top:8px;right:10px;background:none;border:none;color:inherit;font-size:18px;cursor:pointer;opacity:0.7;padding:0 4px;line-height:1}.alertDismiss:hover{opacity:1}.loading{text-align:center;padding:20px;color:var(--accent)}.spinner{border:3px solid rgba(255,255,255,0.1);border-top:3px solid var(--accent);border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;margin:20px auto}.tagBadge{display:inline-block;padding:4px 8px;border-radius:12px;font-size:11px;font-weight:600;margin-left:8px}.tagSuccess{background:rgba(34,197,94,0.2);color:rgba(187,247,208,0.95)}.tagError{background:rgba(239,68,68,0.2);color:rgba(254,202,202,0.95)}.tagWarning{background:rgba(245,158,11,0.2);color:rgba(253,230,138,0.95)}.tagInfo{background:rgba(59,130,246,0.2);color:rgba(191,219,254,0.95)}pre{background:#000;color:#10b981;padding:15px;border-radius:var(--radius-sm);overflow-x:auto;font-size:12px;border:1px solid var(--border)}.paginationRow{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;padding:10px 0}.paginationRow .btn{font-size:0.75rem;padding:8px 14px}.paginationInfo{font-size:0.8rem;color:var(--muted);font-weight:600}#imagePreview{max-width:200px;max-height:150px;border-radius:var(--radius-sm);border:1px solid var(--border);margin-top:10px;display:none;object-fit:cover}input[type="file"].control{padding:8px;cursor:pointer}
/* ======== OSINT PRO MODE ======== */
.proToolbar{display:flex;align-items:center;gap:16px;padding:16px 20px;margin-top:20px;border:1px solid var(--border);background:var(--panel);border-radius:var(--radius);flex-wrap:wrap}.proToggle{appearance:none;border:1px solid var(--accent-dim);background:rgba(212,175,55,0.08);color:var(--accent);border-radius:var(--radius);padding:10px 20px;font-weight:700;font-family:var(--font-main);cursor:pointer;transition:all 0.3s ease;text-transform:uppercase;font-size:0.85rem;letter-spacing:0.5px}.proToggle:hover{background:rgba(212,175,55,0.15);box-shadow:0 0 20px rgba(212,175,55,0.15)}.proToggle.active{background:var(--accent);color:#000;box-shadow:0 0 25px rgba(212,175,55,0.3)}.proSliderWrap{display:flex;align-items:center;gap:10px;flex:1;min-width:200px}.proSliderWrap label{font-size:0.8rem;color:var(--muted);white-space:nowrap;font-weight:600}.proSliderWrap input[type=range]{flex:1;accent-color:var(--accent);cursor:pointer;height:6px}.proSliderVal{font-family:var(--font-mono);font-size:0.8rem;color:var(--accent);min-width:32px;text-align:right}.proPanel{margin-top:16px;display:grid;grid-template-columns:1fr;gap:16px;animation:fadeIn 0.4s ease}.proSection{border:1px solid var(--border);background:var(--panel);border-radius:var(--radius);overflow:hidden}.proSectionHeader{padding:14px 20px;border-bottom:1px solid var(--border);font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:8px}.proSectionBody{padding:20px}.scoreRow{display:flex;align-items:center;gap:12px;margin-bottom:12px}.scoreLabel{font-size:0.85rem;color:var(--text);min-width:90px;font-weight:600}.scoreBar{flex:1;height:24px;background:rgba(255,255,255,0.06);border-radius:var(--radius-sm);overflow:hidden;position:relative}.scoreBarFill{height:100%;border-radius:var(--radius-sm);transition:width 0.8s cubic-bezier(0.22,1,0.36,1);display:flex;align-items:center;justify-content:flex-end;padding-right:8px;font-size:0.7rem;font-weight:700;color:#000;min-width:32px}.scoreBarGreen{background:linear-gradient(90deg,#22c55e,#4ade80)}.scoreBarYellow{background:linear-gradient(90deg,#f59e0b,#fbbf24)}.scoreBarRed{background:linear-gradient(90deg,#ef4444,#f87171)}.scoreBarBlue{background:linear-gradient(90deg,#3b82f6,#60a5fa)}.scoreMeta{display:flex;gap:16px;margin-top:16px;flex-wrap:wrap}.scoreMetaItem{padding:10px 16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.8rem}.scoreMetaItem strong{color:var(--accent);margin-right:4px}.clusterCard{border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:10px;overflow:hidden;transition:border-color 0.3s}.clusterCard:hover{border-color:var(--accent)}.clusterCardHeader{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;background:var(--card);user-select:none}.clusterCardHeader:hover{background:var(--card2)}.clusterLetter{font-size:1.2rem;font-weight:800;color:var(--accent);font-family:var(--font-mono)}.clusterCount{font-size:0.75rem;color:var(--muted);font-family:var(--font-mono)}.clusterBody{max-height:0;overflow:hidden;transition:max-height 0.4s ease,padding 0.3s ease;padding:0 16px}.clusterCard.expanded .clusterBody{max-height:600px;padding:12px 16px;overflow-y:auto}.clusterItem{padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.85rem}.clusterItem:last-child{border-bottom:none}.timeline{position:relative;padding-left:28px;margin:0}.timeline::before{content:'';position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--border)}.timelineItem{position:relative;margin-bottom:20px;animation:fadeIn 0.3s ease}.timelineDot{position:absolute;left:-24px;top:4px;width:12px;height:12px;border-radius:50%;border:2px solid var(--accent);background:var(--bg)}.timelineDot.dotOk{border-color:var(--ok);background:rgba(34,197,94,0.2)}.timelineDot.dotWarn{border-color:var(--warn);background:rgba(245,158,11,0.2)}.timelineDot.dotErr{border-color:var(--err);background:rgba(239,68,68,0.2)}.timelineContent{padding:12px 16px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm)}.timelineContent strong{color:var(--accent)}.timelineDate{font-size:0.75rem;color:var(--muted);font-family:var(--font-mono);margin-bottom:4px}.executiveSummary{white-space:pre-wrap;font-family:var(--font-mono);font-size:0.82rem;line-height:1.7;color:var(--text);background:rgba(0,0,0,0.3);border:1px solid var(--border);padding:20px;border-radius:var(--radius-sm);max-height:500px;overflow-y:auto}@media(max-width:768px){.proToolbar{flex-direction:column;align-items:stretch}.proSliderWrap{min-width:unset}}
/* ======== DARK WEB INTELLIGENCE ======== */
.dwBorder{border-color:rgba(139,92,246,0.4)}.dwAccent{color:#a78bfa}.dwTag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:0.7rem;font-weight:600;margin-right:6px;margin-bottom:4px}.dwTagOk{background:rgba(34,197,94,0.2);color:#86efac}.dwTagFail{background:rgba(239,68,68,0.2);color:#fca5a5}.dwTagInfo{background:rgba(139,92,246,0.2);color:#c4b5fd}.dwPipeline{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.dwStep{flex:1;min-width:100px;padding:10px 12px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:var(--radius-sm);font-size:0.75rem;text-align:center;transition:all 0.3s}.dwStep.done{border-color:rgba(34,197,94,0.4);background:rgba(34,197,94,0.08)}.dwStep.fail{border-color:rgba(239,68,68,0.4);background:rgba(239,68,68,0.08)}.dwStepIcon{font-size:1.2rem;display:block;margin-bottom:4px}.dwStepLabel{color:var(--muted);font-weight:600}.dwReport{white-space:pre-wrap;font-family:var(--font-mono);font-size:0.82rem;line-height:1.7;color:#e2e8f0;background:rgba(0,0,0,0.4);border:1px solid rgba(139,92,246,0.2);padding:20px;border-radius:var(--radius-sm);max-height:600px;overflow-y:auto}.dwStatGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:16px 0}.dwStat{background:rgba(15,5,30,0.6);border:1px solid rgba(139,92,246,0.15);border-radius:8px;padding:12px;text-align:center}.dwStatVal{font-size:1.4rem;font-weight:800;color:#a78bfa}.dwStatLbl{font-size:0.7rem;color:var(--muted);margin-top:2px}.dwResultItem{padding:10px 14px;margin-bottom:6px;background:rgba(15,5,30,0.4);border:1px solid rgba(139,92,246,0.1);border-radius:var(--radius-sm);border-left:3px solid #7c3aed;word-break:break-all}.dwResultItem:hover{border-left-color:#a78bfa;background:rgba(15,5,30,0.6)}.dwResultTitle{font-weight:600;color:#e2e8f0;font-size:0.85rem}.dwResultUrl{color:#818cf8;font-size:0.75rem;font-family:var(--font-mono)}.dwResultEngine{font-size:0.7rem;color:var(--muted);margin-top:4px}@media(max-width:640px){.dwPipeline{flex-direction:column}.dwStatGrid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<div class="container">
  <!-- Top Bar -->
  <header class="topBar">
    <div class="brand">
      <div class="brandMark">🔍<span>OSINT</span></div>
      <div>
        <div class="brandTitle">Microservice v2.2 PRO</div>
        <div class="brandSubtitle">Test UI - <strong>Engineering Dashboard</strong></div>
      </div>
    </div>
    <div class="statusRow">
      <div class="badge badgeOk" id="mongoStatus">MongoDB: <span>Checking...</span></div>
      <div class="badge badgeOk" id="redisStatus">Redis: <span>Checking...</span></div>
      <div class="badge badgeOk">Port: <span>7105</span></div>
    </div>
  </header>

  <main>
  <!-- Auth Panel -->
  <section class="card" id="authPanel" style="margin-bottom:30px">
    <div class="cardHeader">
      <div class="cardTitle">🔐 Autenticación JWT</div>
      <div id="authStatus" class="badge badgeWarn">No autenticado</div>
    </div>
    <div id="loginForm" style="padding:20px">
      <div class="fieldGrid">
        <div class="fieldRow">
          <label class="fieldLabel" for="authUsername">Usuario</label>
          <input type="text" id="authUsername" class="control" placeholder="usuario configurado" autocomplete="username">
        </div>
        <div class="fieldRow">
          <label class="fieldLabel" for="authPassword">Password</label>
          <input type="password" id="authPassword" class="control" placeholder="••••••••" autocomplete="current-password">
        </div>
      </div>
      <button id="btnLogin" class="btn btnPrimary" style="width:100%;margin-top:16px">🔑 Login</button>
    </div>
    <div id="loggedInPanel" style="padding:20px;display:none">
      <div class="alert alertSuccess" id="userInfo"></div>
      <button id="btnLogout" class="btn btnDanger" style="width:100%;margin-top:16px">🚪 Logout</button>
    </div>
  </section>

  <!-- Grid Layout -->
  <div class="gridLayout">
    <!-- Crear Búsqueda Persona -->
    <section class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">👤 Crear Búsqueda Persona</div>
          <div class="cardHint">Búsqueda multi-motor con análisis AI</div>
        </div>
      </div>
      <div style="padding:20px">
        <div class="fieldGrid" id="personSearchFields">
          <div class="fieldRow">
            <label class="fieldLabel" for="nombre">Nombre</label>
            <input type="text" id="nombre" class="control" placeholder="Juan" autocomplete="given-name">
          </div>
          <div class="fieldRow">
            <label class="fieldLabel" for="apellido">Apellido</label>
            <input type="text" id="apellido" class="control" placeholder="Pérez" autocomplete="family-name">
          </div>
          <div class="fieldRow">
            <label class="fieldLabel" for="email">Email</label>
            <input type="email" id="email" class="control" placeholder="juan.perez@example.com" autocomplete="email">
          </div>
          <div class="fieldRow">
            <label class="fieldLabel" for="username">Username</label>
            <input type="text" id="username" class="control" placeholder="@juanperez" autocomplete="nickname">
          </div>
          <div class="fieldRow">
            <label class="fieldLabel" for="telefono">Teléfono</label>
            <input type="text" id="telefono" class="control" placeholder="+52 555 123 4567" autocomplete="tel">
          </div>
        </div>
        <button id="btnCreateSearch" class="btn btnPrimary" style="width:100%;margin-top:16px">🚀 Iniciar Búsqueda</button>
      </div>
    </section>

    <!-- Búsqueda por Imagen -->
    <section class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">🖼️ Búsqueda por Imagen</div>
          <div class="cardHint">Reverse image search — Google, Yandex, TinEye</div>
        </div>
      </div>
      <div style="padding:20px">
        <div class="fieldGrid">
          <div class="fieldRow">
            <label class="fieldLabel" for="imageUrl">URL</label>
            <input type="url" id="imageUrl" class="control" placeholder="https://example.com/person.jpg" autocomplete="url">
          </div>
          <div class="fieldRow">
            <label class="fieldLabel" for="imageFile">Archivo</label>
            <input type="file" id="imageFile" class="control" accept="image/jpeg,image/png,image/webp">
          </div>
        </div>
        <img id="imagePreview" alt="Preview">
        <div class="alert alertInfo" style="margin-top:12px;font-size:0.85rem">
          ℹ️ Pega una URL <strong>o</strong> sube un archivo de imagen (JPEG/PNG/WebP, máx 10MB).<br>
          Si se sube archivo, se prioriza sobre la URL.
        </div>
        <button id="btnSearchByImage" class="btn btnPrimary" style="width:100%;margin-top:16px">🔍 Buscar por Imagen</button>
        <button id="btnFaceSearch" class="btn" style="width:100%;margin-top:8px;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;font-weight:700;letter-spacing:0.5px">🧠 Face Search (PimEyes)</button>
      </div>
    </section>

    <!-- Face Search Results Panel -->
    <section class="card" id="faceSearchPanel" style="display:none;border:2px solid #7c3aed">
      <div class="cardHeader" style="background:linear-gradient(135deg,#7c3aed 0%,#ec4899 100%)">
        <div>
          <div class="cardTitle" style="color:#fff">🧠 Face Search Results</div>
          <div class="cardHint" style="color:rgba(255,255,255,0.8)">Pipeline: Detect → Crop → Upload → Search → Match</div>
        </div>
      </div>
      <div style="padding:20px" id="faceSearchContent">
        <!-- Populated by JS -->
      </div>
    </section>

    <!-- Lista de Búsquedas -->
    <section class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">📋 Mis Búsquedas</div>
          <div class="cardHint">Historial de búsquedas OSINT</div>
        </div>
      </div>
      <div style="padding:20px">
        <div class="fieldGrid">
          <div class="fieldRow">
            <label class="fieldLabel" for="filterStatus">Estado</label>
            <select id="filterStatus" class="control">
              <option value="">Todos</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
        <div class="buttonRow" style="margin-top:16px">
          <button class="btn btnPrimary" id="btnListSearches">📥 Cargar</button>
          <button class="btn btnSecondary" id="btnGetStats">📊 Stats</button>
        </div>
      </div>
    </section>

    <!-- Ver Evidencias -->
    <section class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">🔎 Ver Evidencias</div>
          <div class="cardHint">Explorar resultados de búsqueda</div>
        </div>
      </div>
      <div style="padding:20px">
        <div class="fieldGrid">
          <div class="fieldRow">
            <label class="fieldLabel" for="searchIdEvidence">Search ID</label>
            <input type="text" id="searchIdEvidence" class="control" placeholder="Pegar ID" autocomplete="off">
          </div>
          <div class="fieldRow">
            <label class="fieldLabel" for="filterSource">Fuente</label>
            <select id="filterSource" class="control">
              <option value="">Todas</option>
              <option value="bing">Bing</option>
              <option value="serper">Serper</option>
              <option value="searxng">SearXNG</option>
              <option value="tavily">Tavily</option>
              <option value="duckduckgo">DuckDuckGo</option>
              <option value="youtube">YouTube</option>
              <option value="google_vision">Google Vision</option>
              <option value="reverse_image">Reverse Image</option>
              <option value="web_archive">Web Archive</option>
            </select>
          </div>
        </div>
        <div class="buttonRow" style="margin-top:16px">
          <button class="btn btnPrimary" id="btnGetEvidences">📂 Evidencias</button>
          <button class="btn btnSecondary" id="btnGetImages">🖼️ Galería</button>
        </div>
      </div>
    </section>

    <!-- Dark Web Intelligence 🕷️ -->
    <section class="card dwBorder" style="grid-column:1/-1">
      <div class="cardHeader" style="background:linear-gradient(135deg,#1a0533,#2d1b69)">
        <div>
          <div class="cardTitle" style="color:#c4b5fd">🕷️ Dark Web Intelligence <span style="font-size:0.65rem;opacity:0.7">v2.1 Evidence-Based + SERP Filter</span></div>
          <div class="cardHint" style="color:rgba(196,181,253,0.7)">Pipeline: Refine [det] → Search 16 Engines → Pre-gate [det] → Scrape .onion → 🔐 Evidence Gate (+ SERP filter) → Report</div>
        </div>
        <button class="btn" id="btnDarkWebHealth" style="border-color:rgba(139,92,246,0.4);color:#a78bfa;font-size:0.75rem;padding:6px 12px">🧅 Tor Health</button>
      </div>
      <div style="padding:20px">
        <div class="fieldGrid">
          <div class="fieldRow">
            <label class="fieldLabel" style="color:#a78bfa">Query</label>
            <input type="text" id="dwQuery" class="control" placeholder="e.g. ransomware group targeting financial sector" style="border-color:rgba(139,92,246,0.3)">
          </div>
          <div class="fieldRow">
            <label class="fieldLabel" style="color:#a78bfa">Preset</label>
            <select id="dwPreset" class="control" style="border-color:rgba(139,92,246,0.3)">
              <option value="threat_intel">🎯 Threat Intelligence</option>
              <option value="ransomware_malware">🦠 Ransomware & Malware</option>
              <option value="personal_identity">👤 Personal Identity</option>
              <option value="corporate_espionage">🏢 Corporate Espionage</option>
            </select>
          </div>
          <div class="fieldRow">
            <label class="fieldLabel" style="color:#a78bfa">Custom</label>
            <input type="text" id="dwCustom" class="control" placeholder="Instrucciones adicionales para el reporte (opcional)" style="border-color:rgba(139,92,246,0.3)">
          </div>
        </div>
        <div style="display:flex;gap:16px;margin-top:14px;flex-wrap:wrap;font-size:0.8rem;color:var(--muted)">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="dwRefine" checked> 🧠 Refine Query</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="dwFilter" checked> 🎯 AI Filter</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="dwScrape" checked> 📄 Scrape Pages</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="dwReport" checked> 📊 Generate Report</label>
        </div>
        <button id="btnDarkWebSearch" class="btn" style="width:100%;margin-top:16px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-weight:700;letter-spacing:0.5px;border:none;font-size:0.95rem">🕷️ Ejecutar Dark Web Intelligence</button>
      </div>
    </section>
  </div>

  <!-- Meta / Facebook OSINT 📘 v2.0 -->
  <div style="margin-top:16px">
    <section class="card" style="border-color:rgba(59,130,246,0.3)">
      <div class="cardHeader" style="background:linear-gradient(135deg,#0c2d6b,#1e40af)">
        <div>
          <div class="cardTitle" style="color:#93c5fd">📘 Meta / Facebook OSINT <span style="font-size:0.65rem;opacity:0.7">v2.0 facebook-scraper3</span></div>
          <div class="cardHint" style="color:rgba(147,197,253,0.7)">Profile → Posts + Photos (2-phase) · Search: people/pages/posts/global/locations</div>
        </div>
        <button class="btn" id="btnMetaHealth" style="border-color:rgba(59,130,246,0.4);color:#93c5fd;font-size:0.75rem;padding:6px 12px">💙 API Health</button>
      </div>
      <div style="padding:20px">
        <div class="fieldGrid">
          <div class="fieldRow">
            <label class="fieldLabel" style="color:#93c5fd">Username / Page</label>
            <input type="text" id="metaUsername" class="control" placeholder="e.g. nasa, zuck, cocacola" style="border-color:rgba(59,130,246,0.3)">
          </div>
        </div>
        <div style="display:flex;gap:16px;margin-top:14px;flex-wrap:wrap;font-size:0.8rem;color:var(--muted)">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="metaProfile" checked> 👤 Profile</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="metaPosts" checked> 📝 Posts</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="metaPhotos" checked> 📸 Photos</label>
        </div>
        <button id="btnMetaSearch" class="btn" style="width:100%;margin-top:16px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-weight:700;letter-spacing:0.5px;border:none;font-size:0.95rem">📘 Ejecutar Meta OSINT</button>
        <!-- Facebook Search -->
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(59,130,246,0.2)">
          <div class="fieldGrid">
            <div class="fieldRow">
              <label class="fieldLabel" style="color:#93c5fd">🔍 Facebook Search</label>
              <input type="text" id="metaSearchQuery" class="control" placeholder="e.g. pizza, John Smith, New York" style="border-color:rgba(59,130,246,0.3)">
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <select id="metaSearchType" class="control" style="max-width:160px;border-color:rgba(59,130,246,0.3);font-size:0.8rem">
              <option value="global">🌐 Global</option>
              <option value="people">👥 People</option>
              <option value="pages">📄 Pages</option>
              <option value="posts">📝 Posts</option>
              <option value="locations">📍 Locations</option>
            </select>
            <button id="btnMetaFbSearch" class="btn" style="flex:1;background:rgba(59,130,246,0.2);color:#93c5fd;border-color:rgba(59,130,246,0.4);font-weight:600">🔍 Search Facebook</button>
          </div>
        </div>
      </div>
    </section>
  </div>

  <!-- Instagram OSINT 📸 -->
  <div style="margin-top:16px">
    <section class="card" style="border-color:rgba(225,48,108,0.3)">
      <div class="cardHeader" style="background:linear-gradient(135deg,#4a0e2e,#831843)">
        <div>
          <div class="cardTitle" style="color:#f9a8d4">📸 Instagram OSINT <span style="font-size:0.65rem;opacity:0.7">v1.0 Direct API + RapidAPI</span></div>
          <div class="cardHint" style="color:rgba(249,168,212,0.7)">Profile + Posts + Collaborators (Direct API) · Community Stats (RapidAPI)</div>
        </div>
        <button class="btn" id="btnIgHealth" style="border-color:rgba(225,48,108,0.4);color:#f9a8d4;font-size:0.75rem;padding:6px 12px">💗 API Health</button>
      </div>
      <div style="padding:20px">
        <div class="fieldGrid">
          <div class="fieldRow">
            <label class="fieldLabel" style="color:#f9a8d4">Username</label>
            <input type="text" id="igUsername" class="control" placeholder="e.g. therock, nasa, kimkardashian" style="border-color:rgba(225,48,108,0.3)">
          </div>
        </div>
        <div style="display:flex;gap:16px;margin-top:14px;flex-wrap:wrap;font-size:0.8rem;color:var(--muted)">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="igProfile" checked> 👤 Profile</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="igStats" checked> 📊 Stats</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="igPosts" checked> 📝 Posts</label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="igCollabs" checked> 🤝 Collaborators</label>
        </div>
        <button id="btnIgSearch" class="btn" style="width:100%;margin-top:16px;background:linear-gradient(135deg,#be185d,#9d174d);color:#fff;font-weight:700;letter-spacing:0.5px;border:none;font-size:0.95rem">📸 Ejecutar Instagram OSINT</button>
      </div>
    </section>
  </div>

  <!-- Instagram Results Panel -->
  <section class="card" id="igPanel" style="display:none;margin-top:16px;border-width:2px;border-color:rgba(225,48,108,0.4)">
    <div class="cardHeader" style="background:linear-gradient(135deg,#4a0e2e,#831843)">
      <div>
        <div class="cardTitle" style="color:#f9a8d4">📸 Instagram OSINT Results</div>
        <div class="cardHint" style="color:rgba(249,168,212,0.7)" id="igReportHint">Pipeline completo</div>
      </div>
    </div>
    <div style="padding:20px" id="igContent">
    </div>
  </section>

  <!-- Dark Web Results Panel -->
  <section class="card dwBorder" id="darkWebPanel" style="display:none;margin-top:16px;border-width:2px">
    <div class="cardHeader" style="background:linear-gradient(135deg,#1a0533,#2d1b69)">
      <div>
        <div class="cardTitle" style="color:#c4b5fd">🕷️ Dark Web Intelligence Report</div>
        <div class="cardHint" style="color:rgba(196,181,253,0.7)" id="dwReportHint">Pipeline completo</div>
      </div>
    </div>
    <div style="padding:20px" id="darkWebContent">
    </div>
  </section>

  <!-- Results Panel -->
  <div class="resultsPanel" id="results" style="display:none">
    <div class="card">
      <div class="cardHeader">
        <div class="cardTitle" id="resultsTitle">Resultados</div>
      </div>
      <div class="console" id="resultsContent"></div>
    </div>
  </div>

  <!-- OSINT PRO Toolbar -->
  <div class="proToolbar" id="proToolbar">
    <button class="proToggle" id="btnProToggle">🔬 Modo PRO</button>
    <div class="proSliderWrap">
      <label for="scoreSlider">Score mínimo:</label>
      <input type="range" id="scoreSlider" min="0" max="100" value="0" step="5">
      <span class="proSliderVal" id="scoreSliderVal">0%</span>
    </div>
  </div>

  <!-- OSINT PRO Panels -->
  <div id="proPanel" class="proPanel" style="display:none">
    <div class="proSection" id="proScores">
      <div class="proSectionHeader">📊 Score Multi-Dimensional</div>
      <div class="proSectionBody" id="proScoresBody"><span style="color:var(--muted)">Carga una búsqueda completada para ver scores.</span></div>
    </div>
    <div class="proSection" id="proClusters">
      <div class="proSectionHeader">🧩 Clusters Alfabéticos</div>
      <div class="proSectionBody" id="proClustersBody"><span style="color:var(--muted)">Activa PRO para ver clusters.</span></div>
    </div>
    <div class="proSection" id="proTimeline">
      <div class="proSectionHeader">⏱️ Timeline de Investigación</div>
      <div class="proSectionBody" id="proTimelineBody"><span style="color:var(--muted)">Activa PRO para ver timeline.</span></div>
    </div>
    <div class="proSection" id="proSummary">
      <div class="proSectionHeader">📝 Resumen Ejecutivo</div>
      <div class="proSectionBody" id="proSummaryBody"><span style="color:var(--muted)">Activa PRO para ver resumen.</span></div>
    </div>
  </div>

  <!-- Links rápidos -->
  <div style="margin-top:30px;text-align:center;padding-bottom:40px">
    <div class="buttonRow" style="justify-content:center;max-width:600px;margin:0 auto">
      <a href="/api" target="_blank" class="btn btnSecondary">📚 Swagger API</a>
      <a href="/api/v1/osint/health" target="_blank" class="btn btnSecondary">❤️ Health Check</a>
      <button class="btn btnSecondary" id="btnCheckHealth">🔄 Verificar</button>
    </div>
  </div>
  </main>
</div>

<script>
// ========================================
// CONSTANTS & STATE
// ========================================
const API_BASE = window.location.origin + '/api/v1/osint';
const API_AUTH = window.location.origin + '/api/v1/auth';
let currentSearchId = null;
let activePollingInterval = null;
let activePollingSearchId = null;
let evidencePage = 1;
const evidenceLimit = 20;
let _imageBase64 = null;

// ========================================
// PRO MODE STATE
// ========================================
let proModeActive = false;
let _lastEvidences = [];
let _scoreFilterMin = 0;

// ========================================
// UTILITIES
// ========================================

function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function isSafeUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function formatError(data) {
  if (!data) return 'Error desconocido';
  if (typeof data.message === 'string') return data.message;
  if (Array.isArray(data.message)) return data.message.join(', ');
  return JSON.stringify(data.message || data.error || 'Error desconocido');
}

function stopPolling() {
  if (activePollingInterval) {
    clearInterval(activePollingInterval);
    activePollingInterval = null;
    activePollingSearchId = null;
  }
}

async function safeJson(response) {
  try { return await response.json(); }
  catch (e) { return { message: 'Respuesta no válida del servidor (HTTP ' + response.status + ')' }; }
}

// ========================================
// AUTH FUNCTIONS
// ========================================

function getAuthHeaders() {
  const token = localStorage.getItem('jwt_token');
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

function requireManualLogin() {
  showAlert('⚠️ Sesión expirada o no autenticada. Inicia sesión manualmente con credenciales de entorno.', 'warning');
  updateAuthUI();
}

// ── Fetch with timeout; auth is always manual in the Test UI ──
async function safeFetch(url, options, timeoutMs) {
  timeoutMs = timeoutMs || 90000;
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  try {
    options = options || {};
    options.signal = controller.signal;
    var resp = await fetch(url, options);
    if (resp.status === 401) {
      console.warn('[TestUI] 401 detected; manual login required.');
      localStorage.removeItem('jwt_token');
      localStorage.removeItem('user_info');
      requireManualLogin();
    }
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function login() {
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!username || !password) { showAlert('❌ Usuario y password requeridos', 'error'); return; }

  const btn = document.getElementById('btnLogin');
  btn.disabled = true;
  btn.textContent = '⏳ Autenticando...';
  try {
    const response = await fetch(API_AUTH + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await safeJson(response);
    if (!response.ok) { showAlert('❌ Login fallido: ' + formatError(data), 'error'); return; }
    if (!data.accessToken || !data.user) { showAlert('❌ Respuesta de login incompleta', 'error'); return; }
    localStorage.setItem('jwt_token', data.accessToken);
    localStorage.setItem('user_info', JSON.stringify(data.user));
    showAlert('✅ Login exitoso', 'success');
    updateAuthUI();
    checkHealth();
  } catch (error) {
    showAlert('❌ Error de conexión: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔑 Login';
  }
}

function logout() {
  localStorage.removeItem('jwt_token');
  localStorage.removeItem('user_info');
  stopPolling();
  showAlert('✅ Logout exitoso', 'success');
  updateAuthUI();
}

function updateAuthUI() {
  const token = localStorage.getItem('jwt_token');
  const userInfoStr = localStorage.getItem('user_info');
  const authStatus = document.getElementById('authStatus');
  const loginForm = document.getElementById('loginForm');
  const loggedInPanel = document.getElementById('loggedInPanel');
  const userInfoDiv = document.getElementById('userInfo');

  if (token && userInfoStr) {
    try {
      const user = JSON.parse(userInfoStr);
      authStatus.textContent = '✅ Autenticado';
      authStatus.className = 'badge badgeOk';
      loginForm.style.display = 'none';
      loggedInPanel.style.display = 'block';
      userInfoDiv.textContent = '';
      const b = document.createElement('strong');
      b.textContent = '🔐 Sesión activa';
      userInfoDiv.appendChild(b);
      userInfoDiv.appendChild(document.createElement('br'));
      userInfoDiv.appendChild(document.createTextNode('Usuario: ' + (user.username || '')));
      userInfoDiv.appendChild(document.createElement('br'));
      userInfoDiv.appendChild(document.createTextNode('Role: ' + (user.role || '')));
      userInfoDiv.appendChild(document.createElement('br'));
      userInfoDiv.appendChild(document.createTextNode('User ID: ' + (user.userId || '')));
    } catch(e) {
      localStorage.removeItem('user_info');
    }
  } else {
    authStatus.textContent = '⚠️ No autenticado';
    authStatus.className = 'badge badgeWarn';
    loginForm.style.display = 'block';
    loggedInPanel.style.display = 'none';
  }
}

// ========================================
// HEALTH CHECK
// ========================================

async function checkHealth() {
  try {
    const token = localStorage.getItem('jwt_token');
    const fetchOpts = token ? { headers: getAuthHeaders() } : {};
    const response = await fetch(API_BASE + '/health', fetchOpts);
    if (response.status === 401) {
      document.getElementById('mongoStatus').className = 'badge badgeWarn';
      document.getElementById('mongoStatus').innerHTML = 'MongoDB: <span>Login required</span>';
      document.getElementById('redisStatus').className = 'badge badgeWarn';
      document.getElementById('redisStatus').innerHTML = 'Redis: <span>Login required</span>';
      return;
    }
    const data = await safeJson(response);
    const mongoEl = document.getElementById('mongoStatus');
    const redisEl = document.getElementById('redisStatus');
    // Support both old format (dependencies.mongodb) and new (services.mongo)
    const mongoConnected = (data.dependencies?.mongodb?.status === 'connected') ||
                           (data.services?.mongo?.status === 'UP');
    const redisConnected = (data.dependencies?.redis?.status === 'connected') ||
                           (data.services?.redis?.status === 'UP');
    if (mongoConnected) {
      mongoEl.className = 'badge badgeOk';
      mongoEl.innerHTML = 'MongoDB: <span>Connected</span>';
    } else {
      mongoEl.className = 'badge badgeError';
      mongoEl.innerHTML = 'MongoDB: <span>Disconnected</span>';
    }
    if (redisConnected) {
      redisEl.className = 'badge badgeOk';
      redisEl.innerHTML = 'Redis: <span>Connected</span>';
    } else {
      redisEl.className = 'badge badgeError';
      redisEl.innerHTML = 'Redis: <span>Disconnected</span>';
    }
    showAlert('✅ Health check completado', 'success');
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  }
}

// ========================================
// IMAGE FILE HANDLING
// ========================================

function handleImageFileChange(e) {
  const file = e.target.files[0];
  const preview = document.getElementById('imagePreview');
  _imageBase64 = null;
  if (!file) { preview.style.display = 'none'; return; }
  const allowed = ['image/jpeg','image/png','image/webp'];
  if (!allowed.includes(file.type)) {
    showAlert('❌ Tipo no permitido: ' + file.type + '. Solo JPEG, PNG, WebP.', 'error');
    e.target.value = '';
    preview.style.display = 'none';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showAlert('❌ Archivo muy grande (' + (file.size/1024/1024).toFixed(1) + 'MB). Máximo 10MB.', 'error');
    e.target.value = '';
    preview.style.display = 'none';
    return;
  }
  const reader = new FileReader();
  reader.onload = function(ev) {
    _imageBase64 = ev.target.result;
    preview.src = _imageBase64;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

// ========================================
// OSINT API FUNCTIONS
// ========================================

async function createSearch() {
  const nombre = document.getElementById('nombre').value.trim();
  const apellido = document.getElementById('apellido').value.trim();
  if (!nombre && !apellido) { showAlert('⚠️ Ingresa al menos nombre o apellido', 'error'); return; }

  const btn = document.getElementById('btnCreateSearch');
  btn.disabled = true;
  btn.textContent = '⏳ Creando...';

  const payload = {
    personalInfo: {
      nombre: nombre || undefined,
      apellido: apellido || undefined,
      email: document.getElementById('email').value.trim() || undefined,
      username: document.getElementById('username').value.trim() || undefined,
      telefono: document.getElementById('telefono').value.trim() || undefined
    },
    options: {
      searchEngines: ['bing', 'duckduckgo'],
      reverseImageSearch: true,
      enableCrawler: true,
      deepSearch: true,
      youtubeSearch: true,
      webArchiveSearch: true
    }
  };

  showLoading('🔄 Creando búsqueda...');
  try {
    const response = await fetch(API_BASE + '/search', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload)
    });
    const data = await safeJson(response);
    if (response.ok) {
      if (!data.searchId) { showAlert('⚠️ Respuesta sin searchId', 'warning'); return; }
      currentSearchId = data.searchId;
      document.getElementById('searchIdEvidence').value = data.searchId;
      showResult('✅ Búsqueda Creada',
        '<div class="alert alertSuccess"><strong>ID:</strong> ' + esc(data.searchId) + '<br><strong>Query:</strong> ' + esc(data.query) + '<br><strong>Status:</strong> <span class="tagBadge tagInfo">' + esc(data.status) + '</span></div>'
      );
      pollSearchStatus(data.searchId);
    } else {
      showAlert('❌ Error: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Iniciar Búsqueda';
  }
}

async function searchByImage() {
  const imageUrl = document.getElementById('imageUrl').value.trim();
  const hasFile = !!_imageBase64;
  if (!imageUrl && !hasFile) { showAlert('⚠️ Pega una URL o sube un archivo de imagen', 'error'); return; }

  const btn = document.getElementById('btnSearchByImage');
  btn.disabled = true;
  btn.textContent = '⏳ Buscando...';

  const payload = {};
  if (hasFile) {
    payload.imageBase64 = _imageBase64;
  } else {
    if (!isSafeUrl(imageUrl)) { showAlert('❌ URL de imagen inválida. Debe ser http:// o https://', 'error'); btn.disabled = false; btn.textContent = '🔍 Buscar por Imagen'; return; }
    payload.imageUrl = imageUrl;
  }

  showLoading('🔄 Buscando por imagen...');
  try {
    const response = await fetch(API_BASE + '/search/by-image', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload)
    });
    const data = await safeJson(response);
    if (response.ok) {
      if (!data.searchId) { showAlert('⚠️ Respuesta sin searchId', 'warning'); return; }
      currentSearchId = data.searchId;
      document.getElementById('searchIdEvidence').value = data.searchId;
      showResult('✅ Búsqueda por Imagen',
        '<div class="alert alertSuccess"><strong>ID:</strong> ' + esc(data.searchId) + '<br><strong>Status:</strong> <span class="tagBadge tagInfo">' + esc(data.status) + '</span></div>'
      );
      pollSearchStatus(data.searchId);
    } else {
      showAlert('❌ Error: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Buscar por Imagen';
  }
}

// ========================================
// FACE SEARCH (PimEyes-like)
// ========================================

async function faceSearch() {
  const imageUrl = document.getElementById('imageUrl').value.trim();
  const hasFile = !!_imageBase64;
  if (!imageUrl && !hasFile) { showAlert('⚠️ Pega una URL o sube un archivo de imagen para Face Search', 'error'); return; }

  const btn = document.getElementById('btnFaceSearch');
  btn.disabled = true;
  btn.textContent = '🧠 Detectando rostro...';

  const payload = {};
  if (hasFile) {
    payload.imageBase64 = _imageBase64;
  } else {
    if (!isSafeUrl(imageUrl)) { showAlert('❌ URL de imagen inválida', 'error'); btn.disabled = false; btn.textContent = '🧠 Face Search (PimEyes)'; return; }
    payload.imageUrl = imageUrl;
  }

  const panel = document.getElementById('faceSearchPanel');
  const content = document.getElementById('faceSearchContent');
  panel.style.display = 'block';
  content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div><br><strong>🧠 Pipeline en ejecución...</strong><br><small>Detect → Crop → Upload → Search (Yandex, Google, TinEye)</small><br><small style="color:#888">Esto puede tomar 15-30 segundos</small></div>';
  panel.scrollIntoView({ behavior: 'smooth' });

  try {
    const response = await fetch(API_BASE + '/search/face', {
      method: 'POST', headers: getAuthHeaders(), body: JSON.stringify(payload)
    });
    const data = await safeJson(response);

    if (response.ok) {
      currentSearchId = data.searchId;
      document.getElementById('searchIdEvidence').value = data.searchId;
      renderFaceSearchResults(data);
      pollSearchStatus(data.searchId);
    } else {
      content.innerHTML = '<div class="alert alertError">❌ ' + esc(formatError(data)) + '</div>';
    }
  } catch (error) {
    content.innerHTML = '<div class="alert alertError">❌ ' + esc(error.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '🧠 Face Search (PimEyes)';
  }
}

function renderFaceSearchResults(data) {
  const fs = data.faceSearch || {};
  const content = document.getElementById('faceSearchContent');

  var html = '';

  // ── Header stats ──
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px">';
  html += '<div style="background:#1e1b4b;border-radius:12px;padding:14px;text-align:center"><div style="font-size:2rem">👤</div><div style="color:#a78bfa;font-size:0.8rem">Rostros</div><div style="color:#fff;font-size:1.4rem;font-weight:700">' + (fs.facesDetected || 0) + '</div></div>';
  html += '<div style="background:#1e1b4b;border-radius:12px;padding:14px;text-align:center"><div style="font-size:2rem">🔎</div><div style="color:#a78bfa;font-size:0.8rem">Matches</div><div style="color:#fff;font-size:1.4rem;font-weight:700">' + (fs.totalMatches || 0) + '</div></div>';
  html += '<div style="background:#1e1b4b;border-radius:12px;padding:14px;text-align:center"><div style="font-size:2rem">⚡</div><div style="color:#a78bfa;font-size:0.8rem">Motores</div><div style="color:#fff;font-size:1.4rem;font-weight:700">' + (fs.searchEnginesUsed || []).length + '</div></div>';
  html += '<div style="background:#1e1b4b;border-radius:12px;padding:14px;text-align:center"><div style="font-size:2rem">⏱️</div><div style="color:#a78bfa;font-size:0.8rem">Tiempo</div><div style="color:#fff;font-size:1.4rem;font-weight:700">' + ((fs.processingTime || 0) / 1000).toFixed(1) + 's</div></div>';
  html += '</div>';

  // ── Images: original + cropped ──
  if (fs.originalImageUrl || fs.croppedFaceUrl) {
    html += '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap">';
    if (fs.originalImageUrl) {
      html += '<div style="text-align:center"><div style="color:#888;font-size:0.75rem;margin-bottom:4px">ORIGINAL</div><img src="' + esc(fs.originalImageUrl) + '" style="max-width:150px;max-height:150px;border-radius:8px;border:2px solid #333" onerror="this.style.display=\\'none\\'"></div>';
    }
    if (fs.croppedFaceUrl) {
      html += '<div style="text-align:center"><div style="color:#ec4899;font-size:0.75rem;margin-bottom:4px">✂️ ROSTRO RECORTADO</div><img src="' + esc(fs.croppedFaceUrl) + '" style="max-width:150px;max-height:150px;border-radius:8px;border:2px solid #7c3aed" onerror="this.style.display=\\'none\\'"></div>';
    }
    html += '</div>';
  }

  // ── Search engines used ──
  html += '<div style="margin-bottom:16px">';
  (fs.searchEnginesUsed || []).forEach(function(eng) {
    var colors = { yandex: '#f33', google: '#4285f4', tineye: '#0bc', facecheck: '#7c3aed' };
    html += '<span style="display:inline-block;background:' + (colors[eng] || '#555') + ';color:#fff;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:600;margin-right:6px">' + esc(eng.toUpperCase()) + '</span>';
  });
  html += '</div>';

  // ── Social profiles ──
  var sp = fs.socialProfiles || {};
  var hasSocial = Object.values(sp).some(function(arr) { return arr && arr.length > 0; });
  if (hasSocial) {
    html += '<div style="background:#0f172a;border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #1e293b">';
    html += '<div style="font-weight:700;margin-bottom:10px;color:#a78bfa">📱 Redes Sociales Detectadas</div>';
    var icons = { facebook: '📘', instagram: '📸', twitter: '🐦', linkedin: '💼', tiktok: '🎵', vk: '🔵' };
    Object.keys(sp).forEach(function(platform) {
      if (sp[platform] && sp[platform].length > 0) {
        sp[platform].forEach(function(url) {
          html += '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="display:block;padding:6px 8px;color:#60a5fa;text-decoration:none;font-size:0.85rem;word-break:break-all">' + (icons[platform] || '🔗') + ' ' + esc(url) + '</a>';
        });
      }
    });
    html += '</div>';
  }

  // ── Matches list ──
  var matches = fs.matches || [];
  if (matches.length > 0) {
    html += '<div style="font-weight:700;margin-bottom:10px;color:#a78bfa">🎯 Matches (' + matches.length + ')</div>';
    matches.forEach(function(m, i) {
      var simColor = m.similarity >= 0.8 ? '#22c55e' : m.similarity >= 0.5 ? '#eab308' : '#ef4444';
      var simPct = (m.similarity * 100).toFixed(0);
      html += '<div style="background:#0f172a;border-radius:10px;padding:14px;margin-bottom:8px;border:1px solid #1e293b;display:flex;gap:12px;align-items:flex-start">';

      // Thumbnail
      if (m.thumbnailUrl) {
        html += '<img src="' + esc(m.thumbnailUrl) + '" style="width:60px;height:60px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.style.display=\\'none\\'">';
      }

      html += '<div style="flex:1;min-width:0">';
      // Title + similarity badge
      html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
      html += '<span style="background:' + simColor + ';color:#000;padding:2px 8px;border-radius:10px;font-size:0.7rem;font-weight:700">' + simPct + '%</span>';
      html += '<span style="background:#1e293b;color:#94a3b8;padding:2px 8px;border-radius:10px;font-size:0.7rem">' + esc(m.source) + '</span>';
      if (m.isSocialMedia) {
        html += '<span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.7rem">📱 ' + esc(m.socialPlatform || 'social') + '</span>';
      }
      html += '</div>';

      // Title
      html += '<a href="' + esc(m.url) + '" target="_blank" rel="noopener" style="color:#e2e8f0;text-decoration:none;font-weight:600;font-size:0.9rem;display:block;margin-top:4px;word-break:break-word">' + esc(m.title || m.domain) + '</a>';

      // Domain + snippet
      html += '<div style="color:#64748b;font-size:0.75rem;margin-top:2px">' + esc(m.domain) + '</div>';
      if (m.snippet) {
        html += '<div style="color:#94a3b8;font-size:0.8rem;margin-top:4px;line-height:1.4">' + esc(m.snippet.substring(0, 200)) + '</div>';
      }

      html += '</div></div>';
    });
  } else {
    html += '<div class="alert alertInfo">ℹ️ No se encontraron matches faciales. Prueba con una imagen más clara del rostro.</div>';
  }

  // ── Search ID ──
  html += '<div style="margin-top:16px;padding:10px;background:#0f172a;border-radius:8px;font-size:0.8rem;color:#64748b">Search ID: <strong style="color:#a78bfa">' + esc(data.searchId) + '</strong></div>';

  content.innerHTML = html;
}

async function listSearches() {
  var listBtn = document.getElementById('btnListSearches');
  listBtn.disabled = true;
  const status = document.getElementById('filterStatus').value;
  const params = new URLSearchParams({ limit: '20', offset: '0' });
  if (status) params.append('status', status);
  showLoading('📥 Cargando búsquedas...');
  try {
    const response = await fetch(API_BASE + '/searches?' + params, { headers: getAuthHeaders() });
    const data = await safeJson(response);
    if (response.ok) {
      const container = document.createElement('div');
      const info = document.createElement('div');
      info.className = 'alert alertInfo';
      info.textContent = '📊 Total: ' + (data.total || 0) + ' búsquedas';
      container.appendChild(info);

      if (!data.searches || data.searches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'alert alertWarning';
        empty.textContent = 'No se encontraron búsquedas.';
        container.appendChild(empty);
      } else {
        data.searches.forEach(function(search) {
          const card = document.createElement('div');
          card.className = 'resultCard';
          const title = document.createElement('strong');
          title.textContent = search.query || 'Sin query';
          card.appendChild(title);
          card.insertAdjacentHTML('beforeend', ' ' + getStatusBadge(search.status) + '<br>');
          const idLine = document.createElement('small');
          idLine.className = 'mono';
          idLine.style.color = 'var(--muted)';
          idLine.textContent = 'ID: ' + search.id;
          card.appendChild(idLine);
          card.appendChild(document.createElement('br'));
          const dateLine = document.createElement('small');
          dateLine.style.color = 'var(--text-dim)';
          dateLine.textContent = '📅 ' + (search.createdAt ? new Date(search.createdAt).toLocaleString('es-MX') : 'Sin fecha');
          card.appendChild(dateLine);
          card.appendChild(document.createElement('br'));
          const countLine = document.createElement('small');
          countLine.style.color = 'var(--text-dim)';
          countLine.textContent = '📊 Resultados: ' + (search.resultCount || 0);
          card.appendChild(countLine);
          card.appendChild(document.createElement('br'));
          const btnEv = document.createElement('button');
          btnEv.className = 'btn btnSecondary';
          btnEv.style.cssText = 'margin-top:8px;font-size:0.75rem;padding:6px 12px';
          btnEv.textContent = 'Ver Evidencias';
          btnEv.addEventListener('click', function() {
            document.getElementById('searchIdEvidence').value = search.id;
            evidencePage = 1;
            getEvidences();
          });
          card.appendChild(btnEv);
          container.appendChild(card);
        });
      }
      showResultDOM('📋 Mis Búsquedas (' + (data.total || 0) + ')', container);
    } else {
      showAlert('❌ Error: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    listBtn.disabled = false;
  }
}

async function getEvidences() {
  const searchId = document.getElementById('searchIdEvidence').value.trim();
  if (!searchId) { showAlert('⚠️ Ingresa un Search ID', 'error'); return; }
  var evBtn = document.getElementById('btnGetEvidences');
  evBtn.disabled = true;
  const source = document.getElementById('filterSource').value;
  const params = new URLSearchParams({ page: String(evidencePage), limit: String(evidenceLimit) });
  if (source) params.append('source', source);
  showLoading('📂 Cargando evidencias...');
  try {
    const response = await fetch(API_BASE + '/evidence/' + encodeURIComponent(searchId) + '?' + params, { headers: getAuthHeaders() });
    const data = await safeJson(response);
    if (response.ok) {
      const container = document.createElement('div');
      const pagination = data.pagination || {};
      const total = pagination.total || 0;
      const page = pagination.page || evidencePage;
      const totalPages = pagination.totalPages || Math.max(1, Math.ceil(total / evidenceLimit));
      evidencePage = page;

      const info = document.createElement('div');
      info.className = 'alert alertInfo';
      info.textContent = '📊 Total: ' + total + ' evidencias | Página ' + page + '/' + totalPages;
      container.appendChild(info);

      const evidences = data.evidences || [];
      _lastEvidences = evidences;
      if (proModeActive) { loadAllProData(searchId); }
      if (evidences.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'alert alertWarning';
        empty.textContent = evidencePage > 1 ? 'No hay más evidencias en esta página.' : 'No se encontraron evidencias para esta búsqueda.';
        container.appendChild(empty);
      } else {
        evidences.forEach(function(evidence) {
          var isFace = evidence.source && evidence.source.indexOf('face_search') === 0;
          var isImageUrl = /\.(jpe?g|png|gif|webp|bmp|svg)([?#]|$)/i.test(evidence.url || '');
          var previewSrc = evidence.imageUrl || evidence.thumbnailUrl || (isImageUrl ? evidence.url : null);
          // Fix protocol-relative URLs
          if (previewSrc && previewSrc.indexOf('//') === 0) previewSrc = 'https:' + previewSrc;

          const card = document.createElement('div');
          card.className = 'resultCard';
          if (isFace && previewSrc) card.style.cssText += 'display:flex;gap:14px;align-items:flex-start;';

          // Image preview column for face matches
          if (isFace && previewSrc && isSafeUrl(previewSrc)) {
            var imgWrap = document.createElement('a');
            imgWrap.href = evidence.url || previewSrc;
            imgWrap.target = '_blank';
            imgWrap.rel = 'noopener noreferrer';
            imgWrap.style.cssText = 'flex-shrink:0;';
            var img = document.createElement('img');
            img.src = previewSrc;
            img.loading = 'lazy';
            img.alt = 'Face match';
            img.style.cssText = 'width:110px;height:110px;object-fit:cover;border-radius:6px;border:2px solid var(--accent);cursor:pointer;';
            img.onerror = function(){ imgWrap.style.display='none'; };
            imgWrap.appendChild(img);
            card.appendChild(imgWrap);
          }

          // Content column
          var contentCol = document.createElement('div');
          contentCol.style.cssText = 'flex:1;min-width:0;';

          const title = document.createElement('strong');
          title.textContent = evidence.title || 'Sin título';
          contentCol.appendChild(title);
          contentCol.appendChild(document.createElement('br'));
          if (evidence.summary) {
            const summary = document.createElement('small');
            summary.style.color = 'var(--text-dim)';
            summary.textContent = evidence.summary;
            contentCol.appendChild(summary);
            contentCol.appendChild(document.createElement('br'));
          }
          contentCol.insertAdjacentHTML('beforeend',
            '<span class="tagBadge tagInfo">' + esc(evidence.source) + '</span>' +
            '<span class="tagBadge tagWarning">' + esc(evidence.category) + '</span>' +
            '<span class="tagBadge tagSuccess">⭐ ' + ((evidence.reliability || 0) * 100).toFixed(0) + '%</span>' +
            (evidence.matchConfidence ? '<span class="tagBadge" style="border-color:rgba(212,175,55,0.4);color:var(--accent)">🎯 ' + ((evidence.matchConfidence) * 100).toFixed(0) + '% match</span>' : '') +
            '<br>'
          );
          if (evidence.url && isSafeUrl(evidence.url)) {
            const a = document.createElement('a');
            a.href = evidence.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.cssText = 'color:var(--cyan);font-size:0.8rem;word-break:break-all';
            a.textContent = '🔗 ' + evidence.url;
            contentCol.appendChild(a);
            contentCol.appendChild(document.createElement('br'));
          } else if (evidence.url) {
            const urlText = document.createElement('small');
            urlText.style.cssText = 'color:var(--muted);font-size:0.8rem;word-break:break-all';
            urlText.textContent = '🔗 ' + evidence.url;
            contentCol.appendChild(urlText);
            contentCol.appendChild(document.createElement('br'));
          }
          // Non-face evidence: also show imageUrl below content
          if (!isFace && evidence.imageUrl && isSafeUrl(evidence.imageUrl)) {
            var evImg = document.createElement('img');
            evImg.src = evidence.imageUrl;
            evImg.loading = 'lazy';
            evImg.alt = 'Evidence image';
            evImg.style.cssText = 'max-width:200px;margin-top:10px;border-radius:4px';
            evImg.onerror = function(){ this.style.display='none'; };
            contentCol.appendChild(evImg);
            contentCol.appendChild(document.createElement('br'));
          }
          // Domain info for face cards
          if (isFace && evidence.extractedData && evidence.extractedData.socialPlatform) {
            var social = document.createElement('span');
            social.className = 'tagBadge';
            social.style.cssText = 'border-color:rgba(34,211,238,0.4);color:var(--cyan)';
            social.textContent = '🌐 ' + evidence.extractedData.socialPlatform;
            contentCol.appendChild(social);
          }
          const idLine = document.createElement('small');
          idLine.className = 'mono';
          idLine.style.color = 'var(--muted)';
          idLine.textContent = 'ID: ' + (evidence.evidenceId || '');
          contentCol.appendChild(idLine);
          card.appendChild(contentCol);
          container.appendChild(card);
        });
      }

      if (totalPages > 1) {
        const pagRow = document.createElement('div');
        pagRow.className = 'paginationRow';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'btn btnSecondary';
        prevBtn.textContent = '← Anterior';
        prevBtn.disabled = page <= 1;
        prevBtn.addEventListener('click', function() { evidencePage = Math.max(1, evidencePage - 1); getEvidences(); });
        const pageInfo = document.createElement('span');
        pageInfo.className = 'paginationInfo';
        pageInfo.textContent = 'Página ' + page + ' / ' + totalPages;
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btnSecondary';
        nextBtn.textContent = 'Siguiente →';
        nextBtn.disabled = page >= totalPages;
        nextBtn.addEventListener('click', function() { evidencePage = Math.min(totalPages, evidencePage + 1); getEvidences(); });
        pagRow.appendChild(prevBtn);
        pagRow.appendChild(pageInfo);
        pagRow.appendChild(nextBtn);
        container.appendChild(pagRow);
      }

      showResultDOM('📂 Evidencias', container);
    } else {
      showAlert('❌ Error: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    evBtn.disabled = false;
  }
}

async function getImages() {
  const searchId = document.getElementById('searchIdEvidence').value.trim();
  if (!searchId) { showAlert('⚠️ Ingresa un Search ID', 'error'); return; }
  var imgBtn = document.getElementById('btnGetImages');
  imgBtn.disabled = true;
  showLoading('🖼️ Cargando galería...');
  try {
    const response = await fetch(API_BASE + '/evidence/' + encodeURIComponent(searchId) + '/images', { headers: getAuthHeaders() });
    const data = await safeJson(response);
    if (response.ok) {
      const container = document.createElement('div');
      const info = document.createElement('div');
      info.className = 'alert alertInfo';
      info.textContent = '🖼️ Total: ' + (data.total || 0) + ' imágenes';
      container.appendChild(info);

      const images = data.images || [];
      if (images.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'alert alertWarning';
        empty.textContent = 'No se encontraron imágenes para esta búsqueda.';
        container.appendChild(empty);
      } else {
        const grid = document.createElement('div');
        grid.className = 'imageGrid';
        images.forEach(function(img) {
          const imgUrl = img.thumbnailUrl || img.imageUrl;
          const fullUrl = img.imageUrl;
          if (!isSafeUrl(imgUrl)) return;
          const item = document.createElement('div');
          item.className = 'imageItem';
          item.addEventListener('click', function() { if (isSafeUrl(fullUrl)) window.open(fullUrl, '_blank', 'noopener'); });
          const imgEl = document.createElement('img');
          imgEl.src = imgUrl;
          imgEl.alt = 'Evidence image';
          imgEl.loading = 'lazy';
          imgEl.onerror = function(){ this.parentElement.style.display='none'; };
          item.appendChild(imgEl);
          const overlay = document.createElement('div');
          overlay.className = 'imageOverlay';
          overlay.textContent = (img.source || '') + ' • ' + ((img.reliability || 0) * 100).toFixed(0) + '%';
          item.appendChild(overlay);
          grid.appendChild(item);
        });
        container.appendChild(grid);
      }
      showResultDOM('🖼️ Galería', container);
    } else {
      showAlert('❌ Error: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    imgBtn.disabled = false;
  }
}

async function getStats() {
  var statBtn = document.getElementById('btnGetStats');
  statBtn.disabled = true;
  showLoading('📊 Cargando estadísticas...');
  try {
    const response = await fetch(API_BASE + '/stats', { headers: getAuthHeaders() });
    const data = await safeJson(response);
    if (response.ok) {
      const container = document.createElement('div');
      const info = document.createElement('div');
      info.className = 'alert alertSuccess';
      info.innerHTML = '<h4>📊 Estadísticas Generales</h4><strong>Total Búsquedas:</strong> ' + esc(data.totalSearches) + '<br><strong>Búsquedas Activas:</strong> ' + esc(data.activeSearches);
      container.appendChild(info);
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(data, null, 2);
      container.appendChild(pre);
      showResultDOM('📊 Estadísticas', container);
    } else {
      showAlert('❌ Error: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    statBtn.disabled = false;
  }
}

// ========================================
// DARK WEB INTELLIGENCE 🕷️
// ========================================

async function darkWebSearchPipeline() {
  var query = document.getElementById('dwQuery').value.trim();
  if (!query) { showAlert('⚠️ Ingresa una query para Dark Web Intelligence', 'error'); return; }

  var btn = document.getElementById('btnDarkWebSearch');
  btn.disabled = true;
  btn.textContent = '🕷️ Ejecutando pipeline...';

  var payload = {
    query: query,
    preset: document.getElementById('dwPreset').value,
    customInstructions: document.getElementById('dwCustom').value.trim() || undefined,
    refineQuery: document.getElementById('dwRefine').checked,
    aiFilter: document.getElementById('dwFilter').checked,
    scrapeContent: document.getElementById('dwScrape').checked,
    generateReport: document.getElementById('dwReport').checked
  };

  var panel = document.getElementById('darkWebPanel');
  var content = document.getElementById('darkWebContent');
  panel.style.display = 'block';
  content.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner" style="border-top-color:#7c3aed"></div><br><strong style="color:#a78bfa">🕷️ Dark Web Pipeline v2.1 ejecutándose...</strong><br><small style="color:#888">Refine [det] → Search 16 engines via Tor → Pre-gate [det] → Scrape .onion → 🔐 Evidence Gate → Report</small><br><small style="color:#666">0 Groq calls si alias no encontrado · 30-120s vía Tor</small></div>';
  panel.scrollIntoView({ behavior: 'smooth' });

  try {
    var response = await fetch(API_BASE + '/darkweb/search', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    var data = await safeJson(response);
    if (response.ok && data.success) {
      renderDarkWebResults(data);
    } else {
      var errMsg = data.message || formatError(data) || 'Error desconocido';
      content.innerHTML = '<div class="alert alertError">❌ ' + esc(errMsg) + '</div>';
      if (!data.success && data.query) {
        content.innerHTML += '<div style="margin-top:12px;font-size:0.85rem;color:var(--muted)">Query: ' + esc(data.query) + ' | Preset: ' + esc(data.preset) + '</div>';
      }
    }
  } catch (error) {
    content.innerHTML = '<div class="alert alertError">❌ Error de conexión: ' + esc(error.message) + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '🕷️ Ejecutar Dark Web Intelligence';
  }
}

function renderDarkWebResults(data) {
  var content = document.getElementById('darkWebContent');
  var hint = document.getElementById('dwReportHint');
  hint.textContent = 'Query: "' + (data.refinedQuery || data.query) + '" | Preset: ' + data.preset;

  var html = '';

  // ── v2: Alias Found Banner ──
  var aliasFound = data.aliasFound;
  var reportSource = data.reportSource || 'unknown';
  if (aliasFound) {
    html += '<div class="alert alertSuccess" style="border-left:4px solid #22c55e;font-size:0.95rem"><strong>🔐 ALIAS ENCONTRADO</strong> — Evidencia literal detectada en ' + ((data.evidenceGate || {}).totalPassed || 0) + ' página(s)<br><small style="opacity:0.8">Reporte generado por: ' + (reportSource === 'llm' ? '🧠 LLM (Groq AI)' : '📊 Evidence Gate (determinístico)') + '</small></div>';
  } else {
    html += '<div class="alert alertWarning" style="border-left:4px solid #f59e0b;font-size:0.95rem"><strong>🔐 ALIAS NO ENCONTRADO</strong> — No se encontró evidencia literal de "' + esc(data.query) + '" en ninguna página analizada<br><small style="opacity:0.8">Reporte: determinístico (sin llamada a LLM — 0 tokens consumidos)</small></div>';
  }

  // ── v2.1: Confidence Score Bar ──
  var confScore = data.confidenceScore || 0;
  var confLabel = data.confidenceLabel || 'N/A';
  var confColor = confScore >= 60 ? '#22c55e' : confScore >= 30 ? '#eab308' : '#ef4444';
  html += '<div style="margin:12px 0;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
  html += '<span style="font-weight:700;font-size:0.85rem;color:var(--text-dim)">📊 Confidence Score</span>';
  html += '<span style="font-weight:800;font-size:1.1rem;color:' + confColor + '">' + confScore.toFixed(1) + '% — ' + esc(confLabel) + '</span>';
  html += '</div>';
  html += '<div style="width:100%;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">';
  html += '<div style="width:' + Math.min(confScore, 100) + '%;height:100%;background:' + confColor + ';border-radius:4px;transition:width 0.5s"></div>';
  html += '</div>';
  html += '</div>';

  // ── v2.1: Coverage Stats ──
  var cov = data.coverageStats || {};
  if (cov.totalEngines) {
    html += '<div style="margin:8px 0;display:flex;flex-wrap:wrap;gap:8px">';
    html += '<span class="dwTag dwTagInfo" style="font-size:0.72rem">🔍 Engines: ' + (cov.enginesUp || 0) + '/' + (cov.totalEngines || 0) + ' UP (' + (cov.engineCoveragePct || 0).toFixed(0) + '%)</span>';
    if (cov.enginesTimeout > 0) html += '<span class="dwTag dwTagFail" style="font-size:0.72rem">⏱️ Timeout: ' + cov.enginesTimeout + '</span>';
    if (cov.enginesDown > 0) html += '<span class="dwTag dwTagFail" style="font-size:0.72rem">💀 Down: ' + cov.enginesDown + '</span>';
    html += '<span class="dwTag" style="font-size:0.72rem;background:rgba(255,255,255,0.06);color:' + (cov.scrapeSuccessRate >= 70 ? '#22c55e' : cov.scrapeSuccessRate >= 40 ? '#eab308' : '#ef4444') + '">📄 Scrape OK: ' + (cov.scrapeSuccessRate || 0).toFixed(0) + '%</span>';
    html += '<span class="dwTag" style="font-size:0.72rem;background:rgba(255,255,255,0.06);color:#a78bfa">🎯 Pre-gate: ' + (cov.preGatePassed || 0) + ' pass / ' + (cov.preGateDiscarded || 0) + ' disc</span>';
    html += '</div>';
  }

  // ── Pipeline Steps (6 steps for v2.1) ──
  var p = data.pipeline || {};
  html += '<div class="dwPipeline">';
  var step3 = p.step3_pregate || p.step3_filter || {};
  var steps = [
    { key: 'step1_refine', icon: '🧠', label: 'Refine', detail: p.step1_refine ? (p.step1_refine.refinedQuery || data.query) + (p.step1_refine.method === 'deterministic' ? ' [det]' : '') : '' },
    { key: 'step2_search', icon: '🔍', label: 'Search', detail: p.step2_search ? p.step2_search.enginesQueried + ' engines → ' + p.step2_search.totalResults + ' results' : '' },
    { key: 'step3_pregate', icon: '🎯', label: 'Pre-gate', detail: (step3.preGatePassed || step3.filteredCount || 0) + ' passed' + (step3.preGateDiscarded ? ', ' + step3.preGateDiscarded + ' disc' : '') + (step3.method === 'deterministic' ? ' [det]' : '') },
    { key: 'step4_scrape', icon: '📄', label: 'Scrape', detail: p.step4_scrape ? p.step4_scrape.pagesScraped + ' pages, ' + ((p.step4_scrape.totalChars || 0) / 1000).toFixed(1) + 'k chars' : '' },
    { key: 'step5_evidence_gate', icon: '🔐', label: 'Evidence Gate', detail: p.step5_evidence_gate ? p.step5_evidence_gate.passed + '/' + p.step5_evidence_gate.totalProcessed + ' passed' : '' },
    { key: 'step6_report', icon: '📊', label: 'Report', detail: p.step6_report ? ((p.step6_report.reportLength || 0) / 1000).toFixed(1) + 'k chars (' + (p.step6_report.source === 'llm' ? 'LLM' : 'Gate') + ')' : '' }
  ];
  steps.forEach(function(s) {
    var stepData = p[s.key] || (s.key === 'step3_pregate' ? (p.step3_filter || step3) : {});
    var cls = stepData.completed !== undefined ? (stepData.completed ? 'done' : 'fail') : (Object.keys(stepData).length > 0 ? 'done' : 'fail');
    // Special highlight for evidence gate
    if (s.key === 'step5_evidence_gate' && stepData.completed) {
      cls = stepData.aliasFound ? 'done' : 'fail';
    }
    html += '<div class="dwStep ' + cls + '">';
    html += '<span class="dwStepIcon">' + (stepData.completed ? (s.key === 'step5_evidence_gate' ? (stepData.aliasFound ? '✅' : '❌') : '✅') : '⬜') + '</span>';
    html += '<span class="dwStepLabel">' + s.icon + ' ' + s.label + '</span>';
    if (s.detail) html += '<div style="font-size:0.65rem;color:var(--text-dim);margin-top:4px">' + esc(s.detail) + '</div>';
    html += '</div>';
  });
  html += '</div>';

  // ── Stats Grid ──
  var t = data.timing || {};
  var eg = data.evidenceGate || {};
  html += '<div class="dwStatGrid">';
  html += '<div class="dwStat"><div class="dwStatVal">' + (data.totalRawResults || (data.results || []).length) + '</div><div class="dwStatLbl">Raw Results</div></div>';
  html += '<div class="dwStat"><div class="dwStatVal">' + ((data.filteredResults || []).length) + '</div><div class="dwStatLbl">Filtered</div></div>';
  html += '<div class="dwStat"><div class="dwStatVal">' + ((data.scrapedPages || []).length) + '</div><div class="dwStatLbl">Scraped</div></div>';
  html += '<div class="dwStat" style="' + (aliasFound ? 'border-color:rgba(34,197,94,0.4)' : 'border-color:rgba(239,68,68,0.3)') + '"><div class="dwStatVal" style="color:' + (aliasFound ? '#22c55e' : '#ef4444') + '">' + (eg.totalPassed || 0) + '/' + (eg.totalProcessed || 0) + '</div><div class="dwStatLbl">🔐 Evidence Gate</div></div>';
  html += '<div class="dwStat"><div class="dwStatVal" style="color:' + confColor + '">' + confScore.toFixed(1) + '%</div><div class="dwStatLbl">📊 Confidence</div></div>';
  html += '<div class="dwStat"><div class="dwStatVal">' + (data.groqKeysUsed || 0) + '</div><div class="dwStatLbl">Groq Calls</div></div>';
  html += '<div class="dwStat"><div class="dwStatVal">' + ((t.totalMs || 0) / 1000).toFixed(1) + 's</div><div class="dwStatLbl">Total Time</div></div>';
  var engOk = (data.engineStatuses || []).filter(function(e){ return e.status === 'up'; }).length;
  var engTotal = (data.engineStatuses || []).length;
  html += '<div class="dwStat"><div class="dwStatVal">' + engOk + '/' + engTotal + '</div><div class="dwStatLbl">Engines OK</div></div>';
  html += '</div>';

  // ── v2: Literal Evidence (if alias found) ──
  var evidence = data.literalEvidence || [];
  if (evidence.length > 0) {
    html += '<div style="margin-top:20px">';
    html += '<div style="font-weight:700;color:#22c55e;margin-bottom:8px;font-size:1rem">🔐 Evidencia Literal (' + evidence.length + ' fuente' + (evidence.length > 1 ? 's' : '') + ')</div>';
    evidence.forEach(function(ev, idx) {
      html += '<div class="dwResultItem" style="border-left-color:#22c55e;background:rgba(0,30,10,0.4)">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center">';
      html += '<div class="dwResultTitle" style="color:#86efac">Evidencia ' + (idx + 1) + ': ' + esc(ev.title || 'Sin título') + '</div>';
      html += '<span class="dwTag dwTagOk" style="font-size:0.75rem;font-weight:800">Score: ' + ev.score + '</span>';
      html += '</div>';
      html += '<div class="dwResultUrl">' + esc(ev.url) + '</div>';
      // Snippets
      if (ev.snippets && ev.snippets.length > 0) {
        html += '<div style="margin-top:8px">';
        ev.snippets.forEach(function(sn) {
          html += '<div style="margin-bottom:6px">';
          html += '<span class="dwTag dwTagInfo" style="font-size:0.65rem">' + sn.location + ' — match: "' + esc(sn.matchedVariant) + '"</span>';
          html += '<pre style="font-size:0.7rem;max-height:120px;overflow-y:auto;margin-top:4px;padding:8px;background:rgba(0,0,0,0.4);border-radius:4px;white-space:pre-wrap;word-break:break-word;border-left:2px solid #22c55e">' + esc(sn.text.substring(0, 600)) + (sn.text.length > 600 ? '...' : '') + '</pre>';
          html += '</div>';
        });
        html += '</div>';
      }
      // Entities for this evidence
      if (ev.entities && ev.entities.length > 0) {
        html += '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">';
        ev.entities.forEach(function(ent) {
          var entColor = ent.type === 'email' ? '#60a5fa' : ent.type.includes('wallet') ? '#fbbf24' : ent.type === 'telegram' ? '#38bdf8' : ent.type === 'pgp' ? '#c084fc' : '#94a3b8';
          html += '<span class="dwTag" style="background:rgba(255,255,255,0.06);color:' + entColor + ';border:1px solid ' + entColor + '30;font-size:0.65rem">' + ent.type + ': ' + esc(ent.value.substring(0, 40)) + (ent.value.length > 40 ? '...' : '') + '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  // ── v2: Detected Entities Summary ──
  var entities = data.detectedEntities || [];
  if (entities.length > 0) {
    html += '<details style="margin-top:16px" ' + (aliasFound ? 'open' : '') + '><summary style="cursor:pointer;color:#fbbf24;font-weight:700;font-size:0.9rem">🧬 Entidades Detectadas (' + entities.length + ')</summary>';
    html += '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">';
    entities.forEach(function(ent) {
      var entColor = ent.type === 'email' ? '#60a5fa' : ent.type.includes('wallet') ? '#fbbf24' : ent.type === 'telegram' ? '#38bdf8' : ent.type === 'pgp' ? '#c084fc' : ent.type === 'onion' ? '#a78bfa' : '#94a3b8';
      html += '<span class="dwTag" style="background:rgba(255,255,255,0.06);color:' + entColor + ';border:1px solid ' + entColor + '30">' + ent.type + ': ' + esc(ent.value.substring(0, 50)) + '</span>';
    });
    html += '</div></details>';
  }

  // ── v2: Evidence Gate Discard Reasons ──
  var discardReasons = (data.evidenceGate || {}).discardReasons || {};
  if (Object.keys(discardReasons).length > 0) {
    html += '<details style="margin-top:16px"><summary style="cursor:pointer;color:#f87171;font-weight:700;font-size:0.9rem">🚫 Evidence Gate — Razones de Descarte</summary>';
    html += '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">';
    Object.keys(discardReasons).forEach(function(reason) {
      html += '<span class="dwTag dwTagFail">' + esc(reason) + ': ' + discardReasons[reason] + '</span>';
    });
    html += '</div></details>';
  }

  // ── Intelligence Report (main output) ──
  if (data.intelligenceReport) {
    html += '<div style="margin-top:20px">';
    html += '<div style="font-weight:700;color:#a78bfa;margin-bottom:8px;font-size:1rem">';
    html += (reportSource === 'llm' ? '🧠' : '📊') + ' Intelligence Report';
    html += '<span class="dwTag ' + (reportSource === 'llm' ? 'dwTagInfo' : 'dwTagFail') + '" style="margin-left:8px;font-size:0.65rem">' + (reportSource === 'llm' ? 'LLM Generated' : 'Deterministic — No LLM') + '</span>';
    html += '</div>';
    html += '<div class="dwReport">' + esc(data.intelligenceReport) + '</div>';
    html += '</div>';
  }

  // ── Engine Statuses (collapsible) ──
  if (data.engineStatuses && data.engineStatuses.length > 0) {
    html += '<details style="margin-top:20px"><summary style="cursor:pointer;color:#a78bfa;font-weight:700;font-size:0.9rem">🧅 Engine Statuses (' + data.engineStatuses.length + ')</summary>';
    html += '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">';
    data.engineStatuses.forEach(function(eng) {
      var tagCls = eng.status === 'up' ? 'dwTagOk' : 'dwTagFail';
      html += '<span class="dwTag ' + tagCls + '">' + esc(eng.name) + ': ' + (eng.resultsFound || 0) + ' (' + (eng.latencyMs || 0) + 'ms)</span>';
    });
    html += '</div></details>';
  }

  // ── Filtered Results List (collapsible) ──
  var filtered = data.filteredResults || data.results || [];
  if (filtered.length > 0) {
    html += '<details style="margin-top:16px"><summary style="cursor:pointer;color:#a78bfa;font-weight:700;font-size:0.9rem">🔗 Results (' + filtered.length + ')</summary>';
    html += '<div style="margin-top:10px">';
    filtered.forEach(function(r) {
      html += '<div class="dwResultItem">';
      html += '<div class="dwResultTitle">' + esc(r.title || 'No title') + '</div>';
      html += '<div class="dwResultUrl">' + esc(r.url) + '</div>';
      if (r.snippet) html += '<div style="font-size:0.78rem;color:var(--text-dim);margin-top:4px">' + esc(r.snippet.substring(0, 200)) + '</div>';
      html += '<div class="dwResultEngine"><span class="dwTag dwTagInfo">' + esc(r.engine) + '</span></div>';
      html += '</div>';
    });
    html += '</div></details>';
  }

  // ── Scraped Pages (collapsible) ──
  var scraped = data.scrapedPages || [];
  if (scraped.length > 0) {
    html += '<details style="margin-top:16px"><summary style="cursor:pointer;color:#a78bfa;font-weight:700;font-size:0.9rem">📄 Scraped Pages (' + scraped.length + ')</summary>';
    html += '<div style="margin-top:10px">';
    scraped.forEach(function(pg) {
      var pgOk = !pg.error;
      html += '<div class="dwResultItem">';
      html += '<div class="dwResultTitle">' + (pgOk ? '✅' : '❌') + ' ' + esc(pg.title || pg.url) + '</div>';
      html += '<div class="dwResultUrl">' + esc(pg.url) + '</div>';
      html += '<div style="font-size:0.75rem;color:var(--muted);margin-top:2px">' + (pg.content ? pg.content.length : 0) + ' chars' + (pg.truncated ? ' (truncated)' : '') + '</div>';
      if (pg.content && pgOk) {
        html += '<pre style="font-size:0.7rem;max-height:150px;overflow-y:auto;margin-top:4px;padding:10px;background:rgba(0,0,0,0.3);border-radius:4px;white-space:pre-wrap;word-break:break-word">' + esc(pg.content.substring(0, 500)) + (pg.content.length > 500 ? '...' : '') + '</pre>';
      }
      if (pg.error) html += '<div style="color:#fca5a5;font-size:0.75rem;margin-top:2px">Error: ' + esc(pg.error) + '</div>';
      html += '</div>';
    });
    html += '</div></details>';
  }

  // ── Timing Breakdown (collapsible) ──
  html += '<details style="margin-top:16px"><summary style="cursor:pointer;color:#a78bfa;font-weight:700;font-size:0.9rem">⏱️ Timing Breakdown</summary>';
  html += '<div style="margin-top:10px;font-family:var(--font-mono);font-size:0.8rem;color:var(--text-dim)">';
  if (t.refineMs) html += '🧠 Refine: ' + t.refineMs + 'ms<br>';
  if (t.searchMs) html += '🔍 Search: ' + t.searchMs + 'ms<br>';
  if (t.preGateMs) html += '🎯 Pre-gate: ' + t.preGateMs + 'ms [deterministic]<br>';
  if (t.scrapeMs) html += '📄 Scrape: ' + t.scrapeMs + 'ms<br>';
  if (t.evidenceGateMs) html += '🔐 Evidence Gate: ' + t.evidenceGateMs + 'ms<br>';
  if (t.reportMs) html += '📊 Report: ' + t.reportMs + 'ms<br>';
  html += '<strong style="color:#a78bfa">Total: ' + (t.totalMs || 0) + 'ms (' + ((t.totalMs || 0) / 1000).toFixed(1) + 's)</strong>';
  html += '</div></details>';

  content.innerHTML = html;
}

async function darkWebHealthCheck() {
  var btn = document.getElementById('btnDarkWebHealth');
  btn.disabled = true;
  btn.textContent = '⏳ Checking...';
  try {
    var response = await fetch(API_BASE + '/darkweb/health', { headers: getAuthHeaders() });
    var data = await safeJson(response);
    if (response.ok) {
      var dw = data.darkweb || {};
      var panel = document.getElementById('darkWebPanel');
      var content = document.getElementById('darkWebContent');
      panel.style.display = 'block';
      var html = '<div style="padding:10px">';
      html += '<div class="dwStatGrid" style="max-width:500px">';
      html += '<div class="dwStat"><div class="dwStatVal">' + (dw.available ? '✅' : '❌') + '</div><div class="dwStatLbl">Module</div></div>';
      html += '<div class="dwStat"><div class="dwStatVal">' + (dw.tor && dw.tor.torAvailable ? '🧅' : '❌') + '</div><div class="dwStatLbl">Tor Proxy</div></div>';
      html += '<div class="dwStat"><div class="dwStatVal">' + (dw.tor && dw.tor.latencyMs > 0 ? dw.tor.latencyMs + 'ms' : 'N/A') + '</div><div class="dwStatLbl">Tor Latency</div></div>';
      html += '</div>';
      if (dw.groqPool) html += '<div style="margin-top:10px;font-size:0.85rem;color:var(--muted)">🧠 Groq Pool: ' + esc(dw.groqPool) + '</div>';
      if (dw.tor && !dw.tor.torAvailable) {
        html += '<div class="alert alertWarning" style="margin-top:12px">⚠️ Tor no está conectado. Asegúrate de que el servicio Tor esté corriendo en el proxy configurado.<br><code style="font-size:0.8rem">choco install tor</code> o descárgalo de <a href="https://www.torproject.org/" target="_blank" style="color:#a78bfa">torproject.org</a></div>';
      }
      html += '</div>';
      content.innerHTML = html;
      panel.scrollIntoView({ behavior: 'smooth' });
    } else {
      showAlert('❌ Dark Web health check failed: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🧅 Tor Health';
  }
}

// ========================================
// META / FACEBOOK OSINT FUNCTIONS 📘
// ========================================

async function metaSearchPipeline() {
  var username = (document.getElementById('metaUsername').value || '').trim();
  if (!username) { showAlert('⚠️ Ingresa un username o nombre de página de Facebook', 'warning'); return; }

  var btn = document.getElementById('btnMetaSearch');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Pipeline Meta ejecutándose...';

  var panel = document.getElementById('metaPanel');
  var content = document.getElementById('metaContent');
  panel.style.display = 'block';
  content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)"><span class="spinner" style="display:inline-block;margin-right:10px"></span>Consultando RapidAPI para "' + esc(username) + '"...</div>';
  panel.scrollIntoView({ behavior: 'smooth' });

  try {
    if (!localStorage.getItem('jwt_token')) {
      content.innerHTML = '<div class="alert alertWarning">⚠️ Inicia sesión manualmente antes de ejecutar Meta OSINT.</div>';
      requireManualLogin();
      return;
    }
    var body = {
      username: username,
      fetchProfile: document.getElementById('metaProfile').checked,
      fetchPosts: document.getElementById('metaPosts').checked,
      fetchPhotos: document.getElementById('metaPhotos').checked
    };
    console.log('[TestUI] META pipeline →', JSON.stringify(body));
    content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)"><span class="spinner" style="display:inline-block;margin-right:10px"></span>Consultando RapidAPI para "' + esc(username) + '"... (puede tardar 5-10s)</div>';
    var response = await safeFetch(API_BASE + '/meta/search', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 90000);
    console.log('[TestUI] META response status:', response.status);
    var data = await safeJson(response);
    console.log('[TestUI] META data keys:', Object.keys(data));
    if (response.ok && data.success) {
      renderMetaResults(data);
    } else {
      content.innerHTML = '<div class="alert alertError">❌ ' + esc(data.message || 'HTTP ' + response.status + ' — Error desconocido') + '</div>';
    }
  } catch (error) {
    console.error('[TestUI] META error:', error);
    var errMsg = error.name === 'AbortError' ? 'Timeout: la solicitud tardó más de 90 segundos' : error.message;
    content.innerHTML = '<div class="alert alertError">❌ Error: ' + esc(errMsg) + '</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📘 Ejecutar Meta OSINT';
  }
}

function renderMetaResults(data) {
  var content = document.getElementById('metaContent');
  var html = '';

  // ── Header: Found status ──
  var foundBadge = data.found
    ? '<span style="background:#065f46;color:#6ee7b7;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:700">✅ ENCONTRADO</span>'
    : '<span style="background:#7f1d1d;color:#fca5a5;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:700">❌ NO ENCONTRADO</span>';
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">';
  html += foundBadge;
  html += '<span style="color:var(--muted);font-size:0.85rem">facebook.com/<strong style="color:#93c5fd">' + esc(data.username) + '</strong></span>';
  html += '</div>';

  // ── API Status badges ──
  var apiS = data.apiStatus || {};
  html += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
  ['profile', 'posts', 'photos', 'search'].forEach(function(key) {
    if (!apiS[key] || apiS[key] === 'skipped') return;
    var label = key.charAt(0).toUpperCase() + key.slice(1);
    var status = apiS[key] || 'skipped';
    var color = status === 'ok' ? '#065f46' : (status === 'error' ? '#7f1d1d' : '#78350f');
    var textColor = status === 'ok' ? '#6ee7b7' : (status === 'error' ? '#fca5a5' : '#fcd34d');
    var icon = status === 'ok' ? '✅' : (status === 'error' ? '❌' : '⏭️');
    html += '<span style="background:' + color + ';color:' + textColor + ';padding:3px 10px;border-radius:8px;font-size:0.75rem">' + icon + ' ' + label + '</span>';
  });
  html += '</div>';

  // ── Errors (if any) ──
  var errs = data.errors || {};
  var errKeys = Object.keys(errs).filter(function(k) { return errs[k]; });
  if (errKeys.length > 0) {
    html += '<div class="alert alertWarning" style="margin-bottom:16px">⚠️ Errores parciales:<br>';
    errKeys.forEach(function(k) { html += '<code>' + esc(k) + '</code>: ' + esc(errs[k]) + '<br>'; });
    html += '</div>';
  }

  // ── Profile section ──
  if (data.profile) {
    var p = data.profile;
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#93c5fd;font-weight:700;font-size:0.95rem">👤 Profile</summary>';
    html += '<div style="margin-top:12px;display:flex;gap:20px;flex-wrap:wrap">';

    // Avatar + Cover
    if (p.profilePicture) {
      html += '<div style="flex-shrink:0"><img src="' + esc(p.profilePicture) + '" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:3px solid rgba(59,130,246,0.4)" onerror="this.style.display=\\'none\\'"></div>';
    }
    html += '<div style="flex:1;min-width:200px">';
    html += '<div style="font-size:1.1rem;font-weight:700;color:#e2e8f0">' + esc(p.name || 'Sin nombre');
    if (p.verified) html += ' <span style="color:#60a5fa;font-size:0.85rem" title="Verificado">✓</span>';
    html += '</div>';
    html += '<div style="font-size:0.8rem;color:var(--muted);margin-top:4px">ID: ' + esc(p.id || 'N/A') + ' · Tipo: ' + esc(p.typeName || 'N/A') + '</div>';
    if (p.gender) html += '<div style="font-size:0.8rem;color:var(--muted)">Género: ' + esc(p.gender) + '</div>';
    if (p.intro) html += '<div style="font-size:0.85rem;color:#94a3b8;margin-top:8px;white-space:pre-wrap">' + esc(p.intro) + '</div>';
    if (p.url && isSafeUrl(p.url)) html += '<div style="font-size:0.8rem;margin-top:4px"><a href="' + esc(p.url) + '" target="_blank" style="color:#93c5fd">🔗 ' + esc(p.url) + '</a></div>';

    // Intro cards
    if (p.introCards && p.introCards.length > 0) {
      html += '<div style="margin-top:10px">';
      p.introCards.forEach(function(card) {
        html += '<div style="font-size:0.8rem;color:#94a3b8;margin-top:2px">📌 ' + esc(card.label || '') + (card.value ? ' — ' + esc(card.value) : '');
        if (card.externalUrl && isSafeUrl(card.externalUrl)) html += ' <a href="' + esc(card.externalUrl) + '" target="_blank" style="color:#60a5fa;font-size:0.75rem">↗ link</a>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div></div>';

    // Cover photo
    if (p.coverPhoto) {
      html += '<div style="margin-top:12px"><img src="' + esc(p.coverPhoto) + '" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;border:1px solid rgba(59,130,246,0.2)" onerror="this.style.display=\\'none\\'"></div>';
    }

    // Photos
    if (p.photos && p.photos.length > 0) {
      html += '<div style="margin-top:12px"><div style="font-size:0.85rem;color:#93c5fd;font-weight:600;margin-bottom:8px">📸 Fotos (' + p.photos.length + ')</div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
      p.photos.slice(0, 12).forEach(function(photo) {
        html += '<img src="' + esc(photo.uri) + '" style="width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid rgba(59,130,246,0.2)" onerror="this.style.display=\\'none\\'">';
      });
      html += '</div></div>';
    }
    html += '</details>';
  }

  // ── Page Details section ──
  if (data.pageDetails) {
    var pg = data.pageDetails;
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#93c5fd;font-weight:700;font-size:0.95rem">📄 Page Details</summary>';
    html += '<div style="margin-top:12px;background:rgba(0,0,0,0.2);border-radius:8px;padding:16px">';
    html += '<div style="font-size:1rem;font-weight:700;color:#e2e8f0">' + esc(pg.title || 'Sin título') + '</div>';
    if (pg.description) html += '<div style="font-size:0.85rem;color:#94a3b8;margin-top:6px">' + esc(pg.description) + '</div>';
    if (pg.url) html += '<div style="font-size:0.78rem;color:#60a5fa;margin-top:4px"><a href="' + esc(pg.url) + '" target="_blank" style="color:#60a5fa">' + esc(pg.url) + '</a></div>';
    if (pg.userId) html += '<div style="font-size:0.75rem;color:var(--muted);margin-top:4px">User ID: ' + esc(pg.userId) + '</div>';
    if (pg.image) html += '<div style="margin-top:10px"><img src="' + esc(pg.image) + '" style="max-width:200px;border-radius:8px;border:1px solid rgba(59,130,246,0.2)" onerror="this.style.display=\\'none\\'"></div>';
    html += '</div></details>';
  }

  // ── Posts section ──
  if (data.posts && data.posts.length > 0) {
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#93c5fd;font-weight:700;font-size:0.95rem">📝 Posts (' + data.posts.length + ')</summary>';
    html += '<div style="margin-top:12px;display:flex;flex-direction:column;gap:12px">';
    data.posts.forEach(function(post, idx) {
      html += '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:14px;border-left:3px solid rgba(59,130,246,0.4)">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html += '<span style="font-size:0.75rem;color:var(--muted)">';
      html += 'Post #' + (idx + 1);
      if (post.postId) html += ' · ID: ' + esc(post.postId).substring(0, 20);
      if (post.createdAt) html += ' · ' + esc(post.createdAt);
      html += '</span>';
      if (post.url && isSafeUrl(post.url)) html += ' <a href="' + esc(post.url) + '" target="_blank" style="color:#60a5fa;font-size:0.7rem">↗ ver</a>';
      html += '</div>';
      html += '<div style="display:flex;gap:8px;font-size:0.7rem;margin-bottom:6px">';
      html += '<span style="color:#fbbf24">❤️ ' + (post.reactionCount || 0) + '</span>';
      html += '<span style="color:#60a5fa">💬 ' + (post.commentsCount || 0) + '</span>';
      html += '<span style="color:#34d399">🔄 ' + (post.shareCount || 0) + '</span>';
      html += '</div>';
      // Reactions breakdown (from facebook-scraper3)
      if (post.reactions && typeof post.reactions === 'object') {
        var rKeys = Object.keys(post.reactions).filter(function(k){ return post.reactions[k] > 0; });
        if (rKeys.length > 0) {
          html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">';
          var rIcons = { like:'👍', love:'❤️', haha:'😂', wow:'😮', sad:'😢', angry:'😡', care:'🤗' };
          rKeys.forEach(function(k) { html += '<span style="font-size:0.7rem;color:#94a3b8">' + (rIcons[k] || k) + ' ' + post.reactions[k] + '</span>'; });
          html += '</div>';
        }
      }
      if (post.text) {
        var txt = post.text.length > 300 ? post.text.substring(0, 300) + '...' : post.text;
        html += '<div style="font-size:0.85rem;color:#e2e8f0;white-space:pre-wrap;word-break:break-word">' + esc(txt) + '</div>';
      }
      if (post.attachments && post.attachments.length > 0) {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">';
        post.attachments.slice(0, 4).forEach(function(att) {
          if (att.uri && att.type === 'photo') {
            html += '<img src="' + esc(att.uri) + '" style="width:80px;height:80px;object-fit:cover;border-radius:4px" onerror="this.style.display=\\'none\\'">';
          } else if (att.type === 'video') {
            var label = '🎥 Video';
            if (att.thumbnail) html += '<img src="' + esc(att.thumbnail) + '" style="width:80px;height:80px;object-fit:cover;border-radius:4px;opacity:0.8" onerror="this.style.display=\\'none\\'">';
            else html += '<span style="background:#1e3a5f;color:#60a5fa;padding:4px 8px;border-radius:4px;font-size:0.7rem">' + label + '</span>';
          }
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div></details>';
  }

  // ── Photos section (from /profile/photos endpoint) ──
  if (data.photos && data.photos.length > 0) {
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#93c5fd;font-weight:700;font-size:0.95rem">📸 Profile Photos (' + data.photos.length + ')</summary>';
    html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">';
    data.photos.forEach(function(photo) {
      html += '<img src="' + esc(photo.uri) + '" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid rgba(59,130,246,0.2);cursor:pointer" onclick="window.open(this.src)" onerror="this.style.display=\\'none\\'">';
    });
    html += '</div></details>';
  }

  // ── Search results section ──
  if (data.search && data.search.results && data.search.results.length > 0) {
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#93c5fd;font-weight:700;font-size:0.95rem">🔍 Search: ' + esc(data.search.type) + ' (' + data.search.count + ' results)</summary>';
    html += '<div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">';
    data.search.results.forEach(function(item, idx) {
      html += '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:12px;border-left:3px solid rgba(59,130,246,0.4)">';
      html += '<div style="font-size:0.75rem;color:var(--muted);margin-bottom:4px">#' + (idx + 1) + '</div>';
      html += '<pre style="font-size:0.75rem;color:#94a3b8;white-space:pre-wrap;word-break:break-all;margin:0">' + esc(JSON.stringify(item, null, 2)).substring(0, 500) + '</pre>';
      html += '</div>';
    });
    html += '</div></details>';
  }

  // ── Timing ──
  var t = data.timing || {};
  html += '<details style="margin-top:8px"><summary style="cursor:pointer;color:#93c5fd;font-weight:700;font-size:0.9rem">⏱️ Timing</summary>';
  html += '<div style="margin-top:10px;font-family:var(--font-mono);font-size:0.8rem;color:var(--text-dim)">';
  if (t.profileMs) html += '👤 Profile: ' + t.profileMs + 'ms<br>';
  if (t.postsMs) html += '📝 Posts: ' + t.postsMs + 'ms<br>';
  if (t.photosMs) html += '📸 Photos: ' + t.photosMs + 'ms<br>';
  if (t.searchMs) html += '🔍 Search: ' + t.searchMs + 'ms<br>';
  html += '<strong style="color:#93c5fd">Total: ' + (t.totalMs || 0) + 'ms (' + ((t.totalMs || 0) / 1000).toFixed(1) + 's)</strong>';
  html += '</div></details>';

  content.innerHTML = html;
}

async function metaHealthCheck() {
  var btn = document.getElementById('btnMetaHealth');
  btn.disabled = true;
  btn.textContent = '⏳ Checking...';
  try {
    var response = await fetch(API_BASE + '/meta/health', { headers: getAuthHeaders() });
    var data = await safeJson(response);
    if (response.ok) {
      var m = data.meta || {};
      var panel = document.getElementById('metaPanel');
      var content = document.getElementById('metaContent');
      panel.style.display = 'block';
      var html = '<div style="padding:10px">';
      html += '<div class="dwStatGrid" style="max-width:500px">';
      html += '<div class="dwStat"><div class="dwStatVal">' + (m.available ? '✅' : '❌') + '</div><div class="dwStatLbl">Module</div></div>';
      html += '<div class="dwStat"><div class="dwStatVal">' + (m.apiKeyConfigured ? '🔑' : '❌') + '</div><div class="dwStatLbl">API Key</div></div>';
      html += '</div>';
      if (m.primaryEndpoint) html += '<div style="margin-top:10px;font-size:0.78rem;color:var(--muted)">Primary: ' + esc(m.primaryEndpoint) + '</div>';
      if (m.fallbackEndpoint) html += '<div style="font-size:0.78rem;color:var(--muted)">Fallback: ' + esc(m.fallbackEndpoint) + '</div>';
      if (m.endpoints) {
        html += '<div style="margin-top:8px;font-size:0.72rem;color:var(--muted)">';
        Object.keys(m.endpoints).forEach(function(k) { html += k + ': <code>' + esc(m.endpoints[k]) + '</code><br>'; });
        html += '</div>';
      }
      html += '</div>';
      content.innerHTML = html;
      panel.scrollIntoView({ behavior: 'smooth' });
    } else {
      showAlert('❌ Meta health check failed: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💙 API Health';
  }
}

// ========================================
// FACEBOOK SEARCH FUNCTION 🔍
// ========================================

async function metaFbSearch() {
  var query = (document.getElementById('metaSearchQuery').value || '').trim();
  if (!query) { showAlert('⚠️ Ingresa un término de búsqueda para Facebook', 'warning'); return; }

  var searchType = document.getElementById('metaSearchType').value || 'global';
  var btn = document.getElementById('btnMetaFbSearch');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Buscando en FB...';

  var panel = document.getElementById('metaPanel');
  var content = document.getElementById('metaContent');
  panel.style.display = 'block';
  content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)"><span class="spinner" style="display:inline-block;margin-right:10px"></span>Buscando "' + esc(query) + '" en Facebook (' + esc(searchType) + ')...</div>';
  panel.scrollIntoView({ behavior: 'smooth' });

  try {
    console.log('[TestUI] FB search →', query, searchType);
    var response = await safeFetch(API_BASE + '/meta/search-fb', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, searchType: searchType })
    }, 90000);
    console.log('[TestUI] FB search status:', response.status);
    var data = await safeJson(response);
    if (response.ok && data.success) {
      renderMetaResults(data);
    } else {
      content.innerHTML = '<div class="alert alertError">❌ ' + esc(data.message || 'HTTP ' + response.status + ' — Error desconocido') + '</div>';
    }
  } catch (error) {
    console.error('[TestUI] FB search error:', error);
    var errMsg = error.name === 'AbortError' ? 'Timeout: la solicitud tardó más de 90 segundos' : error.message;
    content.innerHTML = '<div class="alert alertError">❌ Error: ' + esc(errMsg) + '</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔍 Search Facebook';
  }
}

// ========================================
// INSTAGRAM OSINT FUNCTIONS 📸
// ========================================

async function igSearchPipeline() {
  var username = (document.getElementById('igUsername').value || '').trim();
  if (!username) { showAlert('⚠️ Ingresa un username de Instagram', 'warning'); return; }

  var btn = document.getElementById('btnIgSearch');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Pipeline Instagram ejecutándose...';

  var panel = document.getElementById('igPanel');
  var content = document.getElementById('igContent');
  panel.style.display = 'block';
  content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)"><span class="spinner" style="display:inline-block;margin-right:10px"></span>Consultando Instagram para "' + esc(username) + '"...</div>';
  panel.scrollIntoView({ behavior: 'smooth' });

  try {
    var body = {
      username: username,
      fetchProfile: document.getElementById('igProfile').checked,
      fetchStats: document.getElementById('igStats').checked,
      fetchPosts: document.getElementById('igPosts').checked,
      detectCollaborators: document.getElementById('igCollabs').checked
    };
    console.log('[TestUI] IG pipeline →', JSON.stringify(body));
    var response = await safeFetch(API_BASE + '/instagram/search', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 90000);
    console.log('[TestUI] IG response status:', response.status);
    var data = await safeJson(response);
    if (response.ok && data.success) {
      renderIgResults(data);
    } else {
      content.innerHTML = '<div class="alert alertError">❌ ' + esc(data.message || 'HTTP ' + response.status + ' — Error desconocido') + '</div>';
    }
  } catch (error) {
    console.error('[TestUI] IG error:', error);
    var errMsg = error.name === 'AbortError' ? 'Timeout: la solicitud tardó más de 90 segundos' : error.message;
    content.innerHTML = '<div class="alert alertError">❌ Error: ' + esc(errMsg) + '</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📸 Ejecutar Instagram OSINT';
  }
}

function renderIgResults(data) {
  var content = document.getElementById('igContent');
  var html = '';

  // ── Header: Found / Private ──
  var foundBadge = data.found
    ? '<span style="background:#065f46;color:#6ee7b7;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:700">✅ ENCONTRADO</span>'
    : '<span style="background:#7f1d1d;color:#fca5a5;padding:4px 12px;border-radius:12px;font-size:0.8rem;font-weight:700">❌ NO ENCONTRADO</span>';
  var privateBadge = data.isPrivate
    ? ' <span style="background:#78350f;color:#fcd34d;padding:4px 10px;border-radius:12px;font-size:0.75rem;font-weight:700">🔒 PRIVADO</span>'
    : ' <span style="background:#064e3b;color:#6ee7b7;padding:4px 10px;border-radius:12px;font-size:0.75rem;font-weight:700">🌐 PÚBLICO</span>';
  html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">';
  html += foundBadge;
  if (data.found) html += privateBadge;
  html += '<span style="color:var(--muted);font-size:0.85rem">instagram.com/<strong style="color:#f9a8d4">' + esc(data.username) + '</strong></span>';
  html += '</div>';

  // ── API Status badges ──
  var apiS = data.apiStatus || {};
  html += '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">';
  Object.keys(apiS).forEach(function(key) {
    var status = apiS[key];
    if (status === 'skipped') return;
    var label = key === 'directApi' ? 'Direct API' : (key === 'rapidApi' ? 'RapidAPI Stats' : key);
    var color = status === 'ok' ? '#065f46' : '#7f1d1d';
    var textColor = status === 'ok' ? '#6ee7b7' : '#fca5a5';
    var icon = status === 'ok' ? '✅' : '❌';
    html += '<span style="background:' + color + ';color:' + textColor + ';padding:3px 10px;border-radius:8px;font-size:0.75rem">' + icon + ' ' + label + '</span>';
  });
  html += '</div>';

  // ── Errors ──
  var errs = data.errors || {};
  var errKeys = Object.keys(errs).filter(function(k) { return errs[k]; });
  if (errKeys.length > 0) {
    html += '<div class="alert alertWarning" style="margin-bottom:16px">⚠️ Errores parciales:<br>';
    errKeys.forEach(function(k) { html += '<code>' + esc(k) + '</code>: ' + esc(errs[k]) + '<br>'; });
    html += '</div>';
  }

  // ── Profile section ──
  if (data.profile) {
    var p = data.profile;
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#f9a8d4;font-weight:700;font-size:0.95rem">👤 Profile</summary>';
    html += '<div style="margin-top:12px;display:flex;gap:20px;flex-wrap:wrap">';
    if (p.profilePicUrlHd || p.profilePicUrl) {
      html += '<div style="flex-shrink:0"><img src="' + esc(p.profilePicUrlHd || p.profilePicUrl) + '" style="width:120px;height:120px;border-radius:50%;object-fit:cover;border:3px solid rgba(225,48,108,0.4)" onerror="this.style.display=\\'none\\'"></div>';
    }
    html += '<div style="flex:1;min-width:200px">';
    html += '<div style="font-size:1.1rem;font-weight:700;color:#e2e8f0">' + esc(p.fullName || p.username) + '</div>';
    html += '<div style="font-size:0.85rem;color:#f9a8d4;margin-top:2px">@' + esc(p.username) + '</div>';
    if (p.isVerified) html += ' <span style="color:#60a5fa;font-size:0.8rem">✓ Verified</span>';
    if (p.biography) html += '<div style="font-size:0.85rem;color:#94a3b8;margin-top:8px;white-space:pre-wrap">' + esc(p.biography) + '</div>';
    if (p.category) html += '<div style="font-size:0.8rem;color:var(--muted);margin-top:4px">📂 ' + esc(p.category) + '</div>';
    if (p.externalUrl) html += '<div style="font-size:0.8rem;margin-top:4px"><a href="' + esc(p.externalUrl) + '" target="_blank" style="color:#f9a8d4">🔗 ' + esc(p.externalUrl) + '</a></div>';
    // Stats
    html += '<div style="display:flex;gap:16px;margin-top:10px;font-size:0.85rem">';
    html += '<span style="color:#e2e8f0"><strong>' + formatNumber(p.followerCount) + '</strong> <span style="color:var(--muted)">followers</span></span>';
    html += '<span style="color:#e2e8f0"><strong>' + formatNumber(p.followingCount) + '</strong> <span style="color:var(--muted)">following</span></span>';
    html += '<span style="color:#e2e8f0"><strong>' + formatNumber(p.postCount) + '</strong> <span style="color:var(--muted)">posts</span></span>';
    html += '</div>';
    html += '</div></div></details>';
  }

  // ── Community Stats (RapidAPI) ──
  if (data.communityStats) {
    var cs = data.communityStats;
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#f9a8d4;font-weight:700;font-size:0.95rem">📊 Community Stats (RapidAPI)</summary>';
    html += '<div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap">';
    if (cs.engagementRate != null) html += '<div style="background:rgba(0,0,0,0.3);padding:12px 16px;border-radius:8px;text-align:center"><div style="font-size:1.2rem;font-weight:800;color:#f9a8d4">' + (cs.engagementRate * 100).toFixed(2) + '%</div><div style="font-size:0.7rem;color:var(--muted)">Engagement</div></div>';
    if (cs.avgLikes != null) html += '<div style="background:rgba(0,0,0,0.3);padding:12px 16px;border-radius:8px;text-align:center"><div style="font-size:1.2rem;font-weight:800;color:#fbbf24">' + formatNumber(cs.avgLikes) + '</div><div style="font-size:0.7rem;color:var(--muted)">Avg Likes</div></div>';
    if (cs.avgComments != null) html += '<div style="background:rgba(0,0,0,0.3);padding:12px 16px;border-radius:8px;text-align:center"><div style="font-size:1.2rem;font-weight:800;color:#60a5fa">' + formatNumber(cs.avgComments) + '</div><div style="font-size:0.7rem;color:var(--muted)">Avg Comments</div></div>';
    if (cs.cid) html += '<div style="background:rgba(0,0,0,0.3);padding:12px 16px;border-radius:8px;text-align:center"><div style="font-size:0.75rem;font-weight:600;color:#94a3b8">' + esc(cs.cid) + '</div><div style="font-size:0.7rem;color:var(--muted)">CID</div></div>';
    html += '</div></details>';
  }

  // ── Posts section ──
  if (data.posts && data.posts.length > 0) {
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#f9a8d4;font-weight:700;font-size:0.95rem">📝 Posts (' + data.posts.length + ')</summary>';
    html += '<div style="margin-top:12px;display:flex;flex-direction:column;gap:12px">';
    data.posts.forEach(function(post, idx) {
      html += '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:14px;border-left:3px solid rgba(225,48,108,0.4)">';
      // Header
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html += '<span style="font-size:0.75rem;color:var(--muted)">';
      html += (post.isVideo ? '🎥' : (post.mediaType === 'carousel' ? '📑' : '🖼️')) + ' ';
      html += '<a href="' + esc(post.postUrl) + '" target="_blank" style="color:#f9a8d4">' + esc(post.shortcode) + '</a>';
      if (post.ownerUsername) html += ' by @' + esc(post.ownerUsername);
      html += '</span>';
      html += '<div style="display:flex;gap:8px;font-size:0.7rem">';
      html += '<span style="color:#fbbf24">❤️ ' + formatNumber(post.likeCount || 0) + '</span>';
      html += '<span style="color:#60a5fa">💬 ' + formatNumber(post.commentCount || 0) + '</span>';
      html += '</div></div>';
      // Caption
      if (post.caption) {
        var cap = post.caption.length > 200 ? post.caption.substring(0, 200) + '...' : post.caption;
        html += '<div style="font-size:0.85rem;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;margin-bottom:8px">' + esc(cap) + '</div>';
      }
      // Image preview
      if (post.displayUrl && !post.isVideo) {
        html += '<img src="' + esc(post.displayUrl) + '" style="max-width:200px;max-height:150px;border-radius:6px;border:1px solid rgba(225,48,108,0.2)" onerror="this.style.display=\\'none\\'">';
      }
      // Collaborators
      if (post.collaborators && post.collaborators.length > 0) {
        html += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">';
        post.collaborators.forEach(function(c) {
          html += '<a href="' + esc(c.profileUrl) + '" target="_blank" style="background:rgba(225,48,108,0.2);color:#f9a8d4;padding:2px 8px;border-radius:12px;font-size:0.7rem;text-decoration:none">🤝 @' + esc(c.username) + '</a>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div></details>';
  }

  // ── All Collaborators summary ──
  if (data.allCollaborators && data.allCollaborators.length > 0) {
    html += '<details open style="margin-bottom:16px"><summary style="cursor:pointer;color:#f9a8d4;font-weight:700;font-size:0.95rem">🤝 All Collaborators (' + data.allCollaborators.length + ')</summary>';
    html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">';
    data.allCollaborators.forEach(function(c) {
      html += '<a href="' + esc(c.profileUrl) + '" target="_blank" style="background:rgba(225,48,108,0.15);color:#f9a8d4;padding:6px 14px;border-radius:20px;font-size:0.8rem;text-decoration:none;border:1px solid rgba(225,48,108,0.3)">@' + esc(c.username) + '</a>';
    });
    html += '</div></details>';
  }

  // ── Timing ──
  var t = data.timing || {};
  html += '<details style="margin-top:8px"><summary style="cursor:pointer;color:#f9a8d4;font-weight:700;font-size:0.9rem">⏱️ Timing</summary>';
  html += '<div style="margin-top:10px;font-family:var(--font-mono);font-size:0.8rem;color:var(--text-dim)">';
  if (t.directApiMs) html += '📸 Direct API: ' + t.directApiMs + 'ms<br>';
  if (t.rapidApiMs) html += '📊 RapidAPI: ' + t.rapidApiMs + 'ms<br>';
  html += '<strong style="color:#f9a8d4">Total: ' + (t.totalMs || 0) + 'ms (' + ((t.totalMs || 0) / 1000).toFixed(1) + 's)</strong>';
  html += '</div></details>';

  content.innerHTML = html;
}

function formatNumber(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

async function igHealthCheck() {
  var btn = document.getElementById('btnIgHealth');
  btn.disabled = true;
  btn.textContent = '⏳ Checking...';
  try {
    var response = await fetch(API_BASE + '/instagram/health', { headers: getAuthHeaders() });
    var data = await safeJson(response);
    if (response.ok) {
      var ig = data.instagram || {};
      var panel = document.getElementById('igPanel');
      var content = document.getElementById('igContent');
      panel.style.display = 'block';
      var html = '<div style="padding:10px">';
      html += '<div class="dwStatGrid" style="max-width:500px">';
      html += '<div class="dwStat"><div class="dwStatVal">' + (ig.available ? '✅' : '❌') + '</div><div class="dwStatLbl">Direct API</div></div>';
      html += '<div class="dwStat"><div class="dwStatVal">' + (ig.rapidApiConfigured ? '🔑' : '❌') + '</div><div class="dwStatLbl">RapidAPI</div></div>';
      html += '</div>';
      if (ig.directApiEndpoint) html += '<div style="margin-top:10px;font-size:0.78rem;color:var(--muted)">Direct: ' + esc(ig.directApiEndpoint) + '</div>';
      if (ig.rapidApiEndpoint) html += '<div style="font-size:0.78rem;color:var(--muted)">RapidAPI: ' + esc(ig.rapidApiEndpoint) + '</div>';
      html += '</div>';
      content.innerHTML = html;
      panel.scrollIntoView({ behavior: 'smooth' });
    } else {
      showAlert('❌ Instagram health check failed: ' + formatError(data), 'error');
    }
  } catch (error) {
    showAlert('❌ Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💗 API Health';
  }
}

// ========================================
// OSINT PRO MODE FUNCTIONS
// ========================================

function getScoreBarClass(val) {
  if (val >= 70) return 'scoreBarGreen';
  if (val >= 40) return 'scoreBarYellow';
  return 'scoreBarRed';
}

async function loadScores(searchId) {
  var body = document.getElementById('proScoresBody');
  body.textContent = '';
  var loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'Cargando scores...';
  body.appendChild(loading);
  try {
    var response = await fetch(API_BASE + '/scores/' + encodeURIComponent(searchId), { headers: getAuthHeaders() });
    var data = await safeJson(response);
    if (!response.ok) { body.textContent = 'No se pudieron cargar scores.'; showAlert('ℹ️ Scores no disponibles: ' + formatError(data), 'info'); return; }
    body.textContent = '';
    var scores = data.scores || {};
    var dims = [
      { label: 'Identity', value: scores.identity || 0 },
      { label: 'Legal', value: scores.legal || 0 },
      { label: 'Financial', value: scores.financial || 0 },
      { label: 'Overall', value: scores.overall || 0 }
    ];
    dims.forEach(function(dim) {
      var row = document.createElement('div');
      row.className = 'scoreRow';
      var lbl = document.createElement('div');
      lbl.className = 'scoreLabel';
      lbl.textContent = dim.label;
      row.appendChild(lbl);
      var bar = document.createElement('div');
      bar.className = 'scoreBar';
      var fill = document.createElement('div');
      fill.className = 'scoreBarFill ' + (dim.label === 'Overall' ? 'scoreBarBlue' : getScoreBarClass(dim.value));
      fill.style.width = '0%';
      fill.textContent = dim.value.toFixed(1);
      bar.appendChild(fill);
      row.appendChild(bar);
      body.appendChild(row);
      setTimeout(function() { fill.style.width = Math.min(dim.value, 100) + '%'; }, 50);
    });
    var meta = document.createElement('div');
    meta.className = 'scoreMeta';
    var conf = document.createElement('div');
    conf.className = 'scoreMetaItem';
    var cs = document.createElement('strong');
    cs.textContent = 'Confianza: ';
    conf.appendChild(cs);
    conf.appendChild(document.createTextNode(esc(scores.confidence || 'N/A')));
    meta.appendChild(conf);
    if (data.description) {
      var desc = document.createElement('div');
      desc.className = 'scoreMetaItem';
      var ds = document.createElement('strong');
      ds.textContent = esc(data.description.emoji || '') + ' ';
      desc.appendChild(ds);
      desc.appendChild(document.createTextNode(esc(data.description.label || '') + ' — ' + esc(data.description.description || '')));
      meta.appendChild(desc);
    }
    if (data.breakdown) {
      var bk = document.createElement('div');
      bk.className = 'scoreMetaItem';
      var bks = document.createElement('strong');
      bks.textContent = 'Evidencias: ';
      bk.appendChild(bks);
      bk.appendChild(document.createTextNode(String(data.breakdown.totalEvidence || 0) + ' total, ' + String(data.breakdown.highReliabilityCount || 0) + ' alta confiabilidad'));
      meta.appendChild(bk);
    }
    body.appendChild(meta);
  } catch(e) {
    body.textContent = 'Error al cargar scores.';
    showAlert('ℹ️ No se pudieron cargar scores: ' + e.message, 'info');
  }
}

async function loadClusters() {
  var body = document.getElementById('proClustersBody');
  body.textContent = '';
  var loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'Cargando clusters...';
  body.appendChild(loading);
  try {
    var response = await fetch(API_BASE + '/clusters', { headers: getAuthHeaders() });
    var data = await safeJson(response);
    if (!response.ok) { body.textContent = 'No se pudieron cargar clusters.'; showAlert('ℹ️ Clusters no disponibles: ' + formatError(data), 'info'); return; }
    body.textContent = '';
    var clusters = Array.isArray(data) ? data : [];
    if (clusters.length === 0) {
      body.textContent = 'No hay clusters disponibles.';
      return;
    }
    clusters.forEach(function(cluster) {
      var card = document.createElement('div');
      card.className = 'clusterCard';
      var header = document.createElement('div');
      header.className = 'clusterCardHeader';
      var letter = document.createElement('span');
      letter.className = 'clusterLetter';
      letter.textContent = esc(cluster.letter || '?');
      header.appendChild(letter);
      var count = document.createElement('span');
      count.className = 'clusterCount';
      count.textContent = (cluster.count || 0) + ' búsquedas';
      header.appendChild(count);
      header.addEventListener('click', function() { card.classList.toggle('expanded'); });
      card.appendChild(header);
      var cbody = document.createElement('div');
      cbody.className = 'clusterBody';
      var searches = cluster.searches || [];
      searches.forEach(function(s) {
        var item = document.createElement('div');
        item.className = 'clusterItem';
        var q = document.createElement('strong');
        q.textContent = esc(s.query || 'Sin query');
        item.appendChild(q);
        item.appendChild(document.createTextNode(' '));
        item.insertAdjacentHTML('beforeend', getStatusBadge(s.status));
        var dateEl = document.createElement('div');
        dateEl.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-top:2px';
        dateEl.textContent = s.createdAt ? new Date(s.createdAt).toLocaleString('es-MX') : '';
        item.appendChild(dateEl);
        cbody.appendChild(item);
      });
      card.appendChild(cbody);
      body.appendChild(card);
    });
  } catch(e) {
    body.textContent = 'Error al cargar clusters.';
    showAlert('ℹ️ No se pudieron cargar clusters: ' + e.message, 'info');
  }
}

async function loadTimeline(searchId) {
  var body = document.getElementById('proTimelineBody');
  body.textContent = '';
  var loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'Cargando timeline...';
  body.appendChild(loading);
  try {
    var response = await fetch(API_BASE + '/timeline/' + encodeURIComponent(searchId) + '?format=json', { headers: getAuthHeaders() });
    var data = await safeJson(response);
    if (!response.ok) { body.textContent = 'Timeline no disponible.'; showAlert('ℹ️ Timeline no disponible: ' + formatError(data), 'info'); return; }
    body.textContent = '';
    var events = Array.isArray(data) ? data : (data.events || data.timeline || []);
    if (events.length === 0) {
      body.textContent = 'No hay eventos en el timeline.';
      return;
    }
    var tl = document.createElement('div');
    tl.className = 'timeline';
    events.forEach(function(ev) {
      var item = document.createElement('div');
      item.className = 'timelineItem';
      var dot = document.createElement('div');
      dot.className = 'timelineDot';
      var evType = String(ev.type || ev.event || '').toLowerCase();
      if (evType.indexOf('error') >= 0 || evType.indexOf('fail') >= 0) dot.classList.add('dotErr');
      else if (evType.indexOf('warn') >= 0) dot.classList.add('dotWarn');
      else dot.classList.add('dotOk');
      item.appendChild(dot);
      var content = document.createElement('div');
      content.className = 'timelineContent';
      var dateDiv = document.createElement('div');
      dateDiv.className = 'timelineDate';
      dateDiv.textContent = ev.timestamp ? new Date(ev.timestamp).toLocaleString('es-MX') : (ev.date || '');
      content.appendChild(dateDiv);
      var title = document.createElement('strong');
      title.textContent = esc(ev.type || ev.event || ev.action || 'Evento');
      content.appendChild(title);
      if (ev.description || ev.message || ev.detail) {
        var desc = document.createElement('div');
        desc.style.cssText = 'font-size:0.82rem;color:var(--text-dim);margin-top:4px';
        desc.textContent = ev.description || ev.message || ev.detail;
        content.appendChild(desc);
      }
      if (ev.source) {
        var src = document.createElement('div');
        src.style.cssText = 'font-size:0.75rem;color:var(--muted);margin-top:2px';
        src.textContent = '📡 ' + esc(ev.source);
        content.appendChild(src);
      }
      item.appendChild(content);
      tl.appendChild(item);
    });
    body.appendChild(tl);
  } catch(e) {
    body.textContent = 'Error al cargar timeline.';
    showAlert('ℹ️ No se pudo cargar timeline: ' + e.message, 'info');
  }
}

async function loadExecutiveSummary(searchId) {
  var body = document.getElementById('proSummaryBody');
  body.textContent = '';
  var loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'Generando resumen ejecutivo...';
  body.appendChild(loading);
  try {
    var response = await fetch(API_BASE + '/report/' + encodeURIComponent(searchId) + '/markdown?includeTimeline=true', { headers: getAuthHeaders() });
    var data = await safeJson(response);
    if (!response.ok) { body.textContent = 'Resumen no disponible.'; showAlert('ℹ️ Resumen no disponible: ' + formatError(data), 'info'); return; }
    body.textContent = '';
    var pre = document.createElement('div');
    pre.className = 'executiveSummary';
    pre.textContent = data.content || data.markdown || JSON.stringify(data, null, 2);
    body.appendChild(pre);
  } catch(e) {
    body.textContent = 'Error al cargar resumen.';
    showAlert('ℹ️ No se pudo cargar resumen: ' + e.message, 'info');
  }
}

function applyScoreFilter(minScore) {
  _scoreFilterMin = minScore;
  if (!_lastEvidences || _lastEvidences.length === 0) return;
  var container = document.createElement('div');
  var filtered = _lastEvidences.filter(function(ev) {
    var rel = (ev.reliability || 0) * 100;
    return rel >= minScore;
  });
  var info = document.createElement('div');
  info.className = 'alert alertInfo';
  info.textContent = '🎯 Filtro: score >= ' + minScore + '% | Mostrando ' + filtered.length + ' de ' + _lastEvidences.length + ' evidencias';
  container.appendChild(info);
  if (filtered.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'alert alertWarning';
    empty.textContent = 'Ninguna evidencia cumple el filtro de score mínimo ' + minScore + '%.';
    container.appendChild(empty);
  } else {
    filtered.forEach(function(evidence) {
      var isFace = evidence.source && evidence.source.indexOf('face_search') === 0;
      var isImageUrl = /\.(jpe?g|png|gif|webp|bmp|svg)([?#]|$)/i.test(evidence.url || '');
      var previewSrc = evidence.imageUrl || evidence.thumbnailUrl || (isImageUrl ? evidence.url : null);
      if (previewSrc && previewSrc.indexOf('//') === 0) previewSrc = 'https:' + previewSrc;

      var card = document.createElement('div');
      card.className = 'resultCard';
      if (isFace && previewSrc) card.style.cssText += 'display:flex;gap:14px;align-items:flex-start;';

      if (isFace && previewSrc && isSafeUrl(previewSrc)) {
        var imgWrap = document.createElement('a');
        imgWrap.href = evidence.url || previewSrc;
        imgWrap.target = '_blank';
        imgWrap.rel = 'noopener noreferrer';
        imgWrap.style.cssText = 'flex-shrink:0;';
        var img = document.createElement('img');
        img.src = previewSrc;
        img.loading = 'lazy';
        img.alt = 'Face match';
        img.style.cssText = 'width:90px;height:90px;object-fit:cover;border-radius:6px;border:2px solid var(--accent);cursor:pointer;';
        img.onerror = function(){ imgWrap.style.display='none'; };
        imgWrap.appendChild(img);
        card.appendChild(imgWrap);
      }

      var contentCol = document.createElement('div');
      contentCol.style.cssText = 'flex:1;min-width:0;';
      var title = document.createElement('strong');
      title.textContent = evidence.title || 'Sin título';
      contentCol.appendChild(title);
      contentCol.appendChild(document.createElement('br'));
      contentCol.insertAdjacentHTML('beforeend',
        '<span class=\"tagBadge tagInfo\">' + esc(evidence.source) + '</span>' +
        '<span class=\"tagBadge tagSuccess\">⭐ ' + ((evidence.reliability || 0) * 100).toFixed(0) + '%</span>'
      );
      if (evidence.url && isSafeUrl(evidence.url)) {
        contentCol.appendChild(document.createElement('br'));
        var a = document.createElement('a');
        a.href = evidence.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.cssText = 'color:var(--cyan);font-size:0.8rem;word-break:break-all';
        a.textContent = '🔗 ' + evidence.url;
        contentCol.appendChild(a);
      }
      card.appendChild(contentCol);
      container.appendChild(card);
    });
  }
  showResultDOM('📂 Evidencias (filtradas)', container);
}

async function loadAllProData(searchId) {
  if (!searchId) return;
  var panel = document.getElementById('proPanel');
  panel.style.display = 'grid';
  await Promise.allSettled([
    loadScores(searchId),
    loadClusters(),
    loadTimeline(searchId),
    loadExecutiveSummary(searchId)
  ]);
}

function toggleProMode() {
  proModeActive = !proModeActive;
  var btn = document.getElementById('btnProToggle');
  var panel = document.getElementById('proPanel');
  if (proModeActive) {
    btn.classList.add('active');
    btn.textContent = '🔬 PRO Activo';
    var sid = document.getElementById('searchIdEvidence').value.trim() || currentSearchId;
    if (sid) {
      loadAllProData(sid);
    } else {
      panel.style.display = 'grid';
    }
  } else {
    btn.classList.remove('active');
    btn.textContent = '🔬 Modo PRO';
    panel.style.display = 'none';
  }
}

// ========================================
// POLLING (with leak protection)
// ========================================

function pollSearchStatus(searchId) {
  stopPolling();
  activePollingSearchId = searchId;
  let attempts = 0;
  const maxAttempts = 60;
  showLoading('🔄 Ejecutando búsqueda en motores...');

  activePollingInterval = setInterval(async function() {
    attempts++;
    if (activePollingSearchId !== searchId) { stopPolling(); return; }
    try {
      const response = await fetch(API_BASE + '/search/' + encodeURIComponent(searchId), { headers: getAuthHeaders() });
      const data = await safeJson(response);
      if (response.ok) {
        const statusBadge = getStatusBadge(data.status);
        document.getElementById('resultsContent').innerHTML =
          '<div class="alert alertInfo">' +
          '<h4>🔄 Búsqueda en progreso...</h4>' +
          '<strong>ID:</strong> ' + esc(searchId) + '<br>' +
          '<strong>Query:</strong> ' + esc(data.query || 'N/A') + '<br>' +
          '<strong>Status:</strong> ' + statusBadge + '<br>' +
          '<strong>Evidencias encontradas:</strong> ' + (data.evidenceCount || 0) + '<br>' +
          '<strong>Poll:</strong> ' + attempts + '/' + maxAttempts +
          '<div class="spinner" style="margin:10px auto;width:25px;height:25px"></div>' +
          '</div>' +
          '<div style="text-align:center;margin-top:10px"><button class="btn btnDanger" id="btnCancelPoll">⛔ Cancelar Polling</button></div>';
        var cancelBtn = document.getElementById('btnCancelPoll');
        if (cancelBtn) cancelBtn.onclick = function() { stopPolling(); showAlert('⚠️ Polling cancelado. Puedes ver resultados parciales.', 'info'); };

        if (data.status === 'completed') {
          stopPolling();
          document.getElementById('searchIdEvidence').value = searchId;
          evidencePage = 1;
          showResult('✅ Búsqueda Completada',
            '<div class="alert alertSuccess">' +
            '<h4>✅ Búsqueda completada en ' + (attempts * 2) + 's</h4>' +
            '<strong>Query:</strong> ' + esc(data.query || searchId) + '<br>' +
            '<strong>Evidencias:</strong> ' + (data.evidenceCount || 0) + '<br>' +
            '<strong>Score general:</strong> ' + ((data.scores?.overall || 0) * 100).toFixed(1) + '%<br>' +
            '<strong>Confianza:</strong> ' + esc(data.scores?.confidence || 'N/A') +
            '</div>'
          );
          var rc = document.getElementById('resultsContent');
          var btns = document.createElement('div');
          btns.className = 'buttonRow';
          btns.style.marginTop = '10px';
          var b1 = document.createElement('button');
          b1.className = 'btn btnPrimary';
          b1.textContent = '📂 Ver Evidencias (' + (data.evidenceCount || 0) + ')';
          b1.addEventListener('click', function() { document.getElementById('searchIdEvidence').value = searchId; evidencePage = 1; getEvidences(); });
          var b2 = document.createElement('button');
          b2.className = 'btn btnSecondary';
          b2.textContent = '🖼️ Galería';
          b2.addEventListener('click', function() { document.getElementById('searchIdEvidence').value = searchId; getImages(); });
          btns.appendChild(b1);
          btns.appendChild(b2);
          rc.appendChild(btns);
          setTimeout(function() { getEvidences(); }, 500);
          if (proModeActive) { setTimeout(function() { loadAllProData(searchId); }, 600); }
        } else if (data.status === 'failed') {
          stopPolling();
          showAlert('❌ Búsqueda falló: ' + (data.error || 'Error desconocido'), 'error');
        }
      } else if (response.status === 401) {
        stopPolling();
        showAlert('⚠️ Sesión expirada. Inicia sesión de nuevo.', 'error');
      }
    } catch (error) {
      stopPolling();
      showAlert('❌ Error de conexión: ' + error.message, 'error');
    }

    if (attempts >= maxAttempts && activePollingInterval) {
      stopPolling();
      showResult('⏱️ Timeout',
        '<div class="alert alertWarning">La búsqueda aún está en proceso. Puedes ver los resultados parciales:</div>'
      );
      var rc2 = document.getElementById('resultsContent');
      var btns2 = document.createElement('div');
      btns2.className = 'buttonRow';
      btns2.style.marginTop = '10px';
      var be = document.createElement('button');
      be.className = 'btn btnPrimary';
      be.textContent = '📂 Ver Evidencias';
      be.addEventListener('click', function() { document.getElementById('searchIdEvidence').value = searchId; evidencePage = 1; getEvidences(); });
      var br2 = document.createElement('button');
      br2.className = 'btn btnSecondary';
      br2.textContent = '🔄 Reintentar';
      br2.addEventListener('click', function() { pollSearchStatus(searchId); });
      btns2.appendChild(be);
      btns2.appendChild(br2);
      rc2.appendChild(btns2);
    }
  }, 2000);
}

// ========================================
// UI HELPERS
// ========================================

function getStatusBadge(status) {
  const badges = {
    pending: '<span class="tagBadge tagWarning">⏳ Pending</span>',
    processing: '<span class="tagBadge tagInfo">⚙️ Processing</span>',
    completed: '<span class="tagBadge tagSuccess">✅ Completed</span>',
    failed: '<span class="tagBadge tagError">❌ Failed</span>'
  };
  return badges[status] || '<span class="tagBadge">' + esc(status) + '</span>';
}

function showLoading(message) {
  const results = document.getElementById('results');
  results.style.display = 'block';
  document.getElementById('resultsTitle').textContent = message;
  document.getElementById('resultsContent').innerHTML =
    '<div class="loading"><div class="spinner"></div><p style="margin-top:10px;color:var(--accent)">' + esc(message) + '</p></div>';
  results.scrollIntoView({ behavior: 'smooth' });
}

function showResult(title, content) {
  const results = document.getElementById('results');
  results.style.display = 'block';
  document.getElementById('resultsTitle').textContent = title;
  document.getElementById('resultsContent').innerHTML = content;
}

function showResultDOM(title, domElement) {
  const results = document.getElementById('results');
  results.style.display = 'block';
  document.getElementById('resultsTitle').textContent = title;
  const rc = document.getElementById('resultsContent');
  rc.textContent = '';
  rc.appendChild(domElement);
}

function showAlert(message, type) {
  type = type || 'info';
  const results = document.getElementById('results');
  results.style.display = 'block';
  document.getElementById('resultsTitle').textContent = type === 'error' ? '❌ Error' : '✅ Éxito';
  const rc = document.getElementById('resultsContent');
  rc.textContent = '';

  const alertDiv = document.createElement('div');
  const cls = type === 'error' ? 'alertError' : type === 'success' ? 'alertSuccess' : type === 'warning' ? 'alertWarning' : 'alertInfo';
  alertDiv.className = 'alert ' + cls;
  alertDiv.textContent = message;

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'alertDismiss';
  dismissBtn.innerHTML = '&times;';
  dismissBtn.title = 'Cerrar';
  dismissBtn.addEventListener('click', function() { results.style.display = 'none'; });
  alertDiv.appendChild(dismissBtn);

  rc.appendChild(alertDiv);
  results.scrollIntoView({ behavior: 'smooth' });

  if (type !== 'error') {
    setTimeout(function() {
      if (rc.contains(alertDiv)) { results.style.display = 'none'; }
    }, 5000);
  }
}

// ========================================
// EVENT LISTENERS (replaces inline onclick)
// ========================================

document.addEventListener('DOMContentLoaded', async function() {
  updateAuthUI();
  checkHealth();

  // Button handlers
  document.getElementById('btnLogin').addEventListener('click', login);
  document.getElementById('btnLogout').addEventListener('click', logout);
  document.getElementById('btnCreateSearch').addEventListener('click', createSearch);
  document.getElementById('btnSearchByImage').addEventListener('click', searchByImage);
  document.getElementById('btnFaceSearch').addEventListener('click', faceSearch);
  document.getElementById('btnListSearches').addEventListener('click', listSearches);
  document.getElementById('btnGetStats').addEventListener('click', getStats);
  document.getElementById('btnGetEvidences').addEventListener('click', function() { evidencePage = 1; getEvidences(); });
  document.getElementById('btnGetImages').addEventListener('click', getImages);
  document.getElementById('btnCheckHealth').addEventListener('click', checkHealth);
  document.getElementById('imageFile').addEventListener('change', handleImageFileChange);

  // Dark Web Intelligence handlers
  document.getElementById('btnDarkWebSearch').addEventListener('click', darkWebSearchPipeline);
  document.getElementById('btnDarkWebHealth').addEventListener('click', darkWebHealthCheck);
  document.getElementById('dwQuery').addEventListener('keydown', function(e) { if (e.key === 'Enter') darkWebSearchPipeline(); });

  // Meta / Facebook OSINT handlers
  document.getElementById('btnMetaSearch').addEventListener('click', metaSearchPipeline);
  document.getElementById('btnMetaHealth').addEventListener('click', metaHealthCheck);
  document.getElementById('btnMetaFbSearch').addEventListener('click', metaFbSearch);
  document.getElementById('metaUsername').addEventListener('keydown', function(e) { if (e.key === 'Enter') metaSearchPipeline(); });
  document.getElementById('metaSearchQuery').addEventListener('keydown', function(e) { if (e.key === 'Enter') metaFbSearch(); });

  // Instagram OSINT handlers
  document.getElementById('btnIgSearch').addEventListener('click', igSearchPipeline);
  document.getElementById('btnIgHealth').addEventListener('click', igHealthCheck);
  document.getElementById('igUsername').addEventListener('keydown', function(e) { if (e.key === 'Enter') igSearchPipeline(); });

  // Enter key handlers
  document.getElementById('authUsername').addEventListener('keydown', function(e) { if (e.key === 'Enter') login(); });
  document.getElementById('authPassword').addEventListener('keydown', function(e) { if (e.key === 'Enter') login(); });
  var personFields = document.querySelectorAll('#personSearchFields input');
  personFields.forEach(function(el) { el.addEventListener('keydown', function(e) { if (e.key === 'Enter') createSearch(); }); });
  document.getElementById('imageUrl').addEventListener('keydown', function(e) { if (e.key === 'Enter') searchByImage(); });
  document.getElementById('searchIdEvidence').addEventListener('keydown', function(e) { if (e.key === 'Enter') { evidencePage = 1; getEvidences(); } });

  // PRO MODE handlers
  document.getElementById('btnProToggle').addEventListener('click', toggleProMode);
  document.getElementById('scoreSlider').addEventListener('input', function(e) {
    var val = parseInt(e.target.value, 10);
    document.getElementById('scoreSliderVal').textContent = val + '%';
    if (_lastEvidences.length > 0) applyScoreFilter(val);
  });
});
</script>
</body>
</html>`;
  }
}
