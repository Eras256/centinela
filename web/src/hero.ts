// "El vigía": a watchtower/radar hero with a drag gesture ("baja el precio").
// Rings = the real liquidation thresholds from sim.ts (not retyped here).
// Real positions with debt are placed by actual health; a no-debt/closed
// position is shown dim, outside the radar, per the design brief. The drag
// handle moves a clearly-labeled hypothetical blip, driven by the same
// simulateHealthAfterDrop/classifyFromHealthBp used by the simulator below.

import { t, STATUS_KEY, type Lang } from "./i18n";
import {
  classifyFromHealthBp,
  simulateHealthAfterDrop,
  LIQUIDATION_THRESHOLD_BP,
  WARNING_THRESHOLD_BP,
  MIN_COLLATERAL_RATIO_BP,
} from "./sim";
import type { ScanSummary, PositionStatus } from "./types";

const HERO_MAX_DROP = 95;
// Comfortably healthy starting point for the hypothetical blip, chosen only
// so dragging the full range visibly crosses all three thresholds.
const HERO_START_BP = 20_000;

const CENTER = 200;
const R_OUTER = 178;
const R_150 = 128;
const R_135 = 84;
const R_120 = 40;
const R_CENTER_MIN = 14;
const R_CLOSED = 195;
const DISPLAY_CAP_BP = 22_000;
const HYPO_ANGLE_DEG = -25;
const CLOSED_BASE_ANGLE_DEG = 165;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function healthBpToRadius(bp: number): number {
  if (bp >= MIN_COLLATERAL_RATIO_BP) {
    const f = clamp((bp - MIN_COLLATERAL_RATIO_BP) / (DISPLAY_CAP_BP - MIN_COLLATERAL_RATIO_BP), 0, 1);
    return R_150 + f * (R_OUTER - R_150);
  }
  if (bp >= WARNING_THRESHOLD_BP) {
    const f = (bp - WARNING_THRESHOLD_BP) / (MIN_COLLATERAL_RATIO_BP - WARNING_THRESHOLD_BP);
    return R_135 + f * (R_150 - R_135);
  }
  if (bp >= LIQUIDATION_THRESHOLD_BP) {
    const f = (bp - LIQUIDATION_THRESHOLD_BP) / (WARNING_THRESHOLD_BP - LIQUIDATION_THRESHOLD_BP);
    return R_120 + f * (R_135 - R_120);
  }
  const f = clamp(bp / LIQUIDATION_THRESHOLD_BP, 0, 1);
  return R_CENTER_MIN + f * (R_120 - R_CENTER_MIN);
}

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
}

function fmtPctBp(bp: number): string {
  return `${(bp / 100).toFixed(1)}%`;
}

function getSoundPref(): boolean {
  try {
    return localStorage.getItem("centinela-sound") === "on";
  } catch {
    return false;
  }
}

function setSoundPref(on: boolean) {
  try {
    localStorage.setItem("centinela-sound", on ? "on" : "off");
  } catch {
    /* ignore (private mode, blocked storage) */
  }
}

function renderRealBlips(positions: ScanSummary | null, lang: Lang): string {
  const rows = positions?.positions ?? [];
  const withDebt = rows.filter((p) => p.healthBp !== "max");
  const noDebt = rows.filter((p) => p.healthBp === "max");

  const debtBlips = withDebt
    .map((p, i) => {
      const angle = (360 / withDebt.length) * i - 90;
      const r = healthBpToRadius(Number(p.healthBp));
      const pos = polar(angle, r);
      const statusKey = STATUS_KEY[p.status] ?? p.status;
      return `<circle class="blip status-${p.status}" cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="6"><title>${p.txidDisplay.slice(0, 10)}... (${t(lang, statusKey)})</title></circle>`;
    })
    .join("");

  const closedBlips = noDebt
    .map((p, i) => {
      const spread = Math.min(noDebt.length, 4);
      const angle = CLOSED_BASE_ANGLE_DEG + (i % spread) * 18;
      const pos = polar(angle, R_CLOSED);
      return `<circle class="blip blip-closed" cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="5"><title>${p.txidDisplay.slice(0, 10)}... (${t(lang, "heroClosedLabel")})</title></circle>`;
    })
    .join("");

  return debtBlips + closedBlips;
}

export function renderHero(positions: ScanSummary | null, lang: Lang): string {
  const soundOn = getSoundPref();
  const startStatus = classifyFromHealthBp(HERO_START_BP);
  const startRadius = healthBpToRadius(HERO_START_BP);
  const startPos = polar(HYPO_ANGLE_DEG, startRadius);

  return `
    <section id="hero" class="hero" data-mood="${startStatus}">
      <div class="wrap hero-wrap">
        <div class="hero-grid">
          <div class="hero-copy">
            <span class="badge">${t(lang, "badgeTestnet")}</span>
            <h1 class="hero-title">${t(lang, "heroTitle")}</h1>
            <p class="hero-tagline">${t(lang, "heroTagline")}</p>
          </div>
          <div class="radar-col">
            <svg class="radar" viewBox="0 0 400 400" role="img" aria-label="${t(lang, "heroRadarAria")}">
              <circle class="ring ring-outer" cx="200" cy="200" r="${R_OUTER}"></circle>
              <circle class="ring ring-150" cx="200" cy="200" r="${R_150}"></circle>
              <circle class="ring ring-135" cx="200" cy="200" r="${R_135}"></circle>
              <circle class="ring ring-120" cx="200" cy="200" r="${R_120}"></circle>
              <g class="sweep status-${startStatus}" id="hero-sweep">
                <line x1="200" y1="200" x2="200" y2="22"></line>
              </g>
              <g id="hero-real-blips">${renderRealBlips(positions, lang)}</g>
              <circle id="hero-hypo-blip" class="blip blip-hypo status-${startStatus}" r="8" cx="${startPos.x.toFixed(1)}" cy="${startPos.y.toFixed(1)}"></circle>
            </svg>
            <div class="radar-rings-legend" aria-hidden="true">
              <span><i class="dot dot-healthy"></i>${t(lang, "heroLegendHealthy")}</span>
              <span><i class="dot dot-warn"></i>${t(lang, "heroLegend135")}</span>
              <span><i class="dot dot-liq"></i>${t(lang, "heroLegend120")}</span>
            </div>
          </div>
        </div>

        <div class="drag-zone">
          <div class="drag-zone-head">
            <span class="drag-label">${t(lang, "heroDragLabel")}</span>
            <button class="sound-toggle" id="hero-sound-toggle" type="button" aria-pressed="${soundOn}">${soundOn ? t(lang, "heroSoundOn") : t(lang, "heroSoundOff")}</button>
          </div>
          <div class="drag-track" id="hero-drag-track">
            <div
              class="drag-handle"
              id="hero-drag-handle"
              role="slider"
              tabindex="0"
              aria-orientation="vertical"
              aria-valuemin="0"
              aria-valuemax="${HERO_MAX_DROP}"
              aria-valuenow="0"
              aria-label="${t(lang, "heroDragAria")}"
              aria-valuetext="0%, ${t(lang, "simulatorResultHealth")} ${fmtPctBp(HERO_START_BP)}, ${t(lang, STATUS_KEY[startStatus] ?? startStatus)}"
            ><span class="drag-handle-grip" aria-hidden="true"></span></div>
          </div>
          <p class="drag-readout"><span id="hero-drop-pct">0</span>% <span class="text-dim small">(${t(lang, "heroDragHint")})</span></p>
          <p class="sim-active-label" id="hero-sim-active" hidden>${t(lang, "heroSimActive")}</p>
        </div>

        <p class="hero-notify" id="hero-notify" role="status" aria-live="polite"></p>
      </div>
    </section>`;
}

export function wireHero(lang: Lang) {
  const track = document.getElementById("hero-drag-track");
  const handle = document.getElementById("hero-drag-handle");
  const pctLabel = document.getElementById("hero-drop-pct");
  const simActive = document.getElementById("hero-sim-active");
  const notify = document.getElementById("hero-notify");
  const hypoBlip = document.getElementById("hero-hypo-blip");
  const sweep = document.getElementById("hero-sweep");
  const soundBtn = document.getElementById("hero-sound-toggle");
  const heroSection = document.getElementById("hero");
  if (!track || !handle || !pctLabel || !simActive || !notify || !hypoBlip || !sweep || !soundBtn || !heroSection) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) heroSection.classList.add("reduced-motion");

  let dropPct = 0;
  let dragging = false;
  let prevStatus: PositionStatus = classifyFromHealthBp(HERO_START_BP);
  let audioCtx: AudioContext | null = null;

  function playTick() {
    if (!getSoundPref()) return;
    try {
      audioCtx ??= new AudioContext();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.26);
    } catch {
      /* audio blocked (autoplay policy, unsupported): skip silently */
    }
  }

  function setHandlePosition(pct: number, animate: boolean) {
    const trackHeight = track!.clientHeight - handle!.clientHeight;
    const y = trackHeight > 0 ? (pct / HERO_MAX_DROP) * trackHeight : 0;
    handle!.style.transition = animate && !reducedMotion ? "transform 0.4s cubic-bezier(.2,1.4,.4,1)" : "none";
    handle!.style.transform = `translateY(${y}px)`;
  }

  function showNotify(text: string, status: string) {
    notify!.textContent = text;
    notify!.className = `hero-notify is-visible status-${status}`;
  }
  function hideNotify() {
    notify!.classList.remove("is-visible");
  }

  function update(pctInput: number, opts: { spring?: boolean } = {}) {
    dropPct = clamp(Math.round(pctInput), 0, HERO_MAX_DROP);
    const newHealthBp = simulateHealthAfterDrop(HERO_START_BP, dropPct);
    const newStatus = classifyFromHealthBp(newHealthBp);

    pctLabel!.textContent = String(dropPct);
    setHandlePosition(dropPct, !!opts.spring);

    const r = healthBpToRadius(newHealthBp);
    const pos = polar(HYPO_ANGLE_DEG, r);
    (hypoBlip as unknown as SVGElement).style.transition = reducedMotion ? "none" : "cx 0.25s linear, cy 0.25s linear";
    hypoBlip!.setAttribute("cx", pos.x.toFixed(1));
    hypoBlip!.setAttribute("cy", pos.y.toFixed(1));
    hypoBlip!.setAttribute("class", `blip blip-hypo status-${newStatus}`);

    heroSection!.dataset.mood = newStatus;
    sweep!.setAttribute("class", `sweep status-${newStatus}`);

    const statusLabel = t(lang, STATUS_KEY[newStatus] ?? newStatus);
    handle!.setAttribute("aria-valuenow", String(dropPct));
    handle!.setAttribute("aria-valuetext", `${dropPct}%, ${t(lang, "simulatorResultHealth")} ${fmtPctBp(newHealthBp)}, ${statusLabel}`);

    simActive!.hidden = dropPct === 0;

    if (dropPct === 0) {
      hideNotify();
    } else if (newStatus !== prevStatus) {
      if (newStatus === "liquidatable") {
        showNotify(t(lang, "heroNotifyLiquidatable"), newStatus);
        playTick();
      } else if (newStatus === "warning") {
        showNotify(t(lang, "heroNotifyWarning"), newStatus);
        playTick();
      } else {
        hideNotify();
      }
    }
    prevStatus = newStatus;
  }

  function pointerYToPct(clientY: number): number {
    const rect = track!.getBoundingClientRect();
    const handleH = handle!.clientHeight;
    const usable = rect.height - handleH;
    if (usable <= 0) return 0;
    const y = clamp(clientY - rect.top - handleH / 2, 0, usable);
    return (y / usable) * HERO_MAX_DROP;
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    handle!.setPointerCapture(e.pointerId);
    update(pointerYToPct(e.clientY));
    e.preventDefault();
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    update(pointerYToPct(e.clientY));
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    update(0, { spring: true });
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);

  handle.addEventListener("keydown", (e: KeyboardEvent) => {
    const step = 5;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      update(dropPct + step, { spring: true });
      e.preventDefault();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      update(dropPct - step, { spring: true });
      e.preventDefault();
    } else if (e.key === "Home") {
      update(0, { spring: true });
      e.preventDefault();
    } else if (e.key === "End") {
      update(HERO_MAX_DROP, { spring: true });
      e.preventDefault();
    }
  });

  soundBtn.addEventListener("click", () => {
    const next = !getSoundPref();
    setSoundPref(next);
    soundBtn.setAttribute("aria-pressed", String(next));
    soundBtn.textContent = next ? t(lang, "heroSoundOn") : t(lang, "heroSoundOff");
  });

  window.addEventListener("resize", () => setHandlePosition(dropPct, false));

  setHandlePosition(0, false);
  update(0);
}
