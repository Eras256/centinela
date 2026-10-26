import "./style.css";
import { t, STATUS_KEY, type Lang } from "./i18n";
import { classifyFromHealthBp, simulateHealthAfterDrop } from "./sim";
import type { ScanSummary, HistoryEntry } from "./types";

const REPO_RAW_BASE = "https://raw.githubusercontent.com/Eras256/centinela/main/data";
// Bundled snapshot, copied at build time (see web/README.md). BASE_URL respects
// vite.config.ts's `base` (GitHub Pages serves this from a /centinela/ subpath).
const LOCAL_FALLBACK_BASE = `${import.meta.env.BASE_URL}data`;

function getLang(): Lang {
  try {
    const stored = localStorage.getItem("centinela-lang");
    if (stored === "en" || stored === "es") return stored;
  } catch {
    /* ignore (private mode, blocked storage) */
  }
  return "es";
}

function setLang(lang: Lang) {
  try {
    localStorage.setItem("centinela-lang", lang);
  } catch {
    /* ignore */
  }
}

let lang: Lang = getLang();
let positions: ScanSummary | null = null;
let history: HistoryEntry[] = [];

async function fetchJson<T>(path: string): Promise<T> {
  try {
    const res = await fetch(`${REPO_RAW_BASE}/${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as T;
  } catch {
    const res = await fetch(`${LOCAL_FALLBACK_BASE}/${path}`, { cache: "no-store" });
    return (await res.json()) as T;
  }
}

function healthColor(status: string): string {
  if (status === "healthy" || status === "no-debt") return "var(--green)";
  if (status === "cannot-borrow-more" || status === "warning") return "var(--orange)";
  if (status === "liquidatable" || status === "liquidated") return "var(--red)";
  return "var(--purple)";
}

function healthBarPct(healthBp: string): number {
  if (healthBp === "max") return 100;
  const n = Number(healthBp);
  if (!Number.isFinite(n)) return 0;
  return Math.max(4, Math.min(100, (n / 20_000) * 100)); // 200% fills the bar
}

function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function healthText(p: { healthBp: string; healthDisplay: string }): string {
  return p.healthBp === "max" ? t(lang, "healthNoDebt") : p.healthDisplay;
}

function truncateAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function fmtBtc(sats: string): string {
  return (Number(sats) / 100_000_000).toFixed(6);
}

function fmtUsdc(stroops: string): string {
  return (Number(stroops) / 10_000_000).toFixed(2);
}

function renderHeader(): string {
  return `
    <header class="top">
      <div class="wrap">
        <div class="top-row">
          <div class="brand">
            <h1>${t(lang, "title")}</h1>
            <span class="badge">${t(lang, "badgeTestnet")}</span>
          </div>
          <button class="lang-toggle" id="lang-toggle" type="button">${t(lang, "langToggle")}</button>
        </div>
        <p class="tagline">${t(lang, "tagline")}</p>
        <nav class="toc">
          <a href="#problem">${t(lang, "navProblem")}</a>
          <a href="#how">${t(lang, "navHow")}</a>
          <a href="#positions">${t(lang, "navPositions")}</a>
          <a href="#simulator">${t(lang, "navSimulator")}</a>
          <a href="#log">${t(lang, "navLog")}</a>
          <a href="#faq">${t(lang, "navFaq")}</a>
          <a href="#limits">${t(lang, "navLimits")}</a>
        </nav>
      </div>
    </header>`;
}

function renderProblem(): string {
  return `
    <section id="problem">
      <h2>${t(lang, "problemTitle")}</h2>
      <blockquote class="problem-quote">${t(lang, "problemQuote")}</blockquote>
      <p class="quote-source">
        ${t(lang, "problemQuoteSource")}
        <a href="https://github.com/WritzProtocol/writz/blob/main/docs/design/liquidation-notification-spec.md" target="_blank" rel="noopener">
          docs/design/liquidation-notification-spec.md
        </a>
      </p>
      <p>${t(lang, "problemBody")}</p>
      <p class="small text-dim">${t(lang, "problemNoAffiliation")}</p>
    </section>`;
}

function renderHow(): string {
  return `
    <section id="how">
      <h2>${t(lang, "howTitle")}</h2>
      <p>${t(lang, "howBody")}</p>
      <pre class="ascii">${esc(t(lang, "howDiagram"))}</pre>
      <h3 style="font-size:15px;margin-top:20px;">${t(lang, "primitivesTitle")}</h3>
      <p class="text-dim small">${t(lang, "primitivesBody")}</p>
    </section>`;
}

function renderPositionsTable(): string {
  const rows = positions?.positions ?? [];
  const body = rows.length
    ? rows
        .map((p) => {
          const statusKey = STATUS_KEY[p.status] ?? p.status;
          const drop = p.pctDropToLiquidation === null ? "-" : `${p.pctDropToLiquidation}%`;
          return `
          <tr>
            <td class="mono">
              <a href="https://mempool.space/signet/tx/${p.txidDisplay}" target="_blank" rel="noopener">${p.txidDisplay.slice(0, 10)}...</a>
            </td>
            <td class="mono">${truncateAddr(p.depositor)}</td>
            <td>${fmtBtc(p.btcSatoshis)}</td>
            <td>
              <div class="health-bar"><span style="width:${healthBarPct(p.healthBp)}%;background:${healthColor(p.status)}"></span></div>
              <div class="small text-dim">${esc(healthText(p))} · ${fmtUsdc(p.usdcDebt)} USDC</div>
            </td>
            <td><span class="status-pill status-${p.status}">${t(lang, statusKey)}</span></td>
            <td>${p.blocksUntilLiquidationCutoff.toLocaleString(lang)}${p.timelockNear ? ` <span class="near-tag">${t(lang, "timelockNearShort")}</span>` : ""}</td>
            <td>${drop}</td>
            <td><button class="subscribe-btn" data-topic="${p.ntfyTopic}" type="button">${t(lang, "subscribeBtn")}</button></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="text-dim">${t(lang, "noPositions")}</td></tr>`;

  return `
    <section id="positions">
      <h2>${t(lang, "positionsTitle")}</h2>
      <div class="panel table-scroll">
        <table class="positions">
          <thead>
            <tr>
              <th>${t(lang, "colTxid")}</th>
              <th>${t(lang, "colDepositor")}</th>
              <th>${t(lang, "colBtc")}</th>
              <th>${t(lang, "colHealth")}</th>
              <th>${t(lang, "colStatus")}</th>
              <th>${t(lang, "colTimelock")}</th>
              <th>${t(lang, "colDrop")}</th>
              <th>${t(lang, "colSubscribe")}</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="small text-dim" style="margin-top:8px;">${t(lang, "subscribeHint")}</p>
      ${positions ? `<p class="small text-dim">writz-lend: <span class="mono">${esc(positions.writzLendContractId)}</span> · bitcoin-spv: <span class="mono">${esc(positions.bitcoinSpvContractId)}</span> · ${t(lang, "scannedAt")}: ${esc(new Date(positions.scannedAt).toLocaleString(lang))}</p>` : ""}
    </section>`;
}

function renderSimulator(): string {
  const rows = positions?.positions ?? [];
  const options = rows.map((p) => `<option value="${esc(p.txidInternal)}">${esc(p.txidDisplay.slice(0, 14))}... (${esc(healthText(p))})</option>`).join("");
  return `
    <section id="simulator">
      <h2><span class="sim-label-sim">SIM</span> ${t(lang, "simulatorTitle")}</h2>
      <p class="sim-subtitle">${t(lang, "simulatorSubtitle")}</p>
      <div class="panel sim-grid">
        <div>
          <div class="sim-field">
            <label for="sim-position">${t(lang, "simulatorPick")}</label>
            <select id="sim-position">${options}</select>
          </div>
          <div class="sim-field">
            <label for="sim-drop">${t(lang, "simulatorDrop")}: <span id="sim-drop-value">0</span>%</label>
            <input type="range" id="sim-drop" min="0" max="95" step="1" value="0" />
          </div>
        </div>
        <div class="sim-result" id="sim-result"></div>
      </div>
    </section>`;
}

function renderLog(): string {
  const items = [...history].reverse().slice(0, 30);
  const body = items.length
    ? items
        .map((h) => {
          const from = h.fromStatus ? t(lang, STATUS_KEY[h.fromStatus] ?? h.fromStatus) : "-";
          const to = t(lang, STATUS_KEY[h.toStatus] ?? h.toStatus);
          return `<li><span class="log-time">${new Date(h.atIso).toLocaleString(lang)}</span><span class="mono">${h.txidDisplay.slice(0, 10)}...</span><span>${t(lang, "logFrom")} <strong>${from}</strong> ${t(lang, "logTo")} <strong>${to}</strong></span></li>`;
        })
        .join("")
    : `<li class="text-dim">${t(lang, "logEmpty")}</li>`;
  return `
    <section id="log">
      <h2>${t(lang, "logTitle")}</h2>
      <div class="panel"><ul class="log-list">${body}</ul></div>
    </section>`;
}

function renderFaq(): string {
  const items = [
    ["faqQ1", "faqA1"],
    ["faqQ2", "faqA2"],
    ["faqQ3", "faqA3"],
    ["faqQ4", "faqA4"],
  ];
  return `
    <section id="faq">
      <h2>${t(lang, "faqTitle")}</h2>
      <div class="panel">
        <dl>
          ${items.map(([q, a]) => `<div class="faq-item"><dt>${t(lang, q)}</dt><dd>${t(lang, a)}</dd></div>`).join("")}
        </dl>
      </div>
    </section>`;
}

function renderLimits(): string {
  return `
    <section id="limits">
      <h2>${t(lang, "limitsTitle")}</h2>
      <div class="panel"><p class="small text-dim">${t(lang, "limitsBody")}</p></div>
    </section>`;
}

function renderFooter(): string {
  return `
    <footer class="bottom">
      <div class="wrap">
        <p>${t(lang, "footerAiNote")}</p>
        <p><a href="https://github.com/Eras256/centinela" target="_blank" rel="noopener">github.com/Eras256/centinela</a> · MIT</p>
      </div>
    </footer>`;
}

function wireSimulator() {
  const select = document.getElementById("sim-position") as HTMLSelectElement | null;
  const slider = document.getElementById("sim-drop") as HTMLInputElement | null;
  const valueLabel = document.getElementById("sim-drop-value");
  const result = document.getElementById("sim-result");
  if (!select || !slider || !result) return;

  function update() {
    const pos = positions?.positions.find((p) => p.txidInternal === select!.value);
    const dropPct = Number(slider!.value);
    if (valueLabel) valueLabel.textContent = String(dropPct);
    if (!pos) {
      result!.innerHTML = "";
      return;
    }
    if (pos.healthBp === "max") {
      result!.innerHTML = `<p class="text-dim">${t(lang, "simulatorNoDebt")}</p>`;
      return;
    }
    const newHealthBp = simulateHealthAfterDrop(Number(pos.healthBp), dropPct);
    const newStatus = classifyFromHealthBp(newHealthBp);
    const statusKey = STATUS_KEY[newStatus] ?? newStatus;
    result!.innerHTML = `
      <div>
        <div class="small text-dim">${t(lang, "simulatorResultHealth")}</div>
        <div class="big" style="color:${healthColor(newStatus)}">${(newHealthBp / 100).toFixed(1)}%</div>
      </div>
      <div>
        <div class="small text-dim">${t(lang, "simulatorResultStatus")}</div>
        <span class="status-pill status-${newStatus}">${t(lang, statusKey)}</span>
      </div>`;
  }

  select.addEventListener("change", update);
  slider.addEventListener("input", update);
  update();
}

function wireSubscribeButtons() {
  document.querySelectorAll<HTMLButtonElement>(".subscribe-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const topic = btn.dataset.topic;
      if (topic) window.open(`https://ntfy.sh/${topic}`, "_blank", "noopener");
    });
  });
}

function wireLangToggle() {
  document.getElementById("lang-toggle")?.addEventListener("click", () => {
    lang = lang === "es" ? "en" : "es";
    setLang(lang);
    document.documentElement.lang = lang;
    render();
  });
}

function render() {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `
    ${renderHeader()}
    <main class="wrap">
      ${renderProblem()}
      ${renderHow()}
      ${renderPositionsTable()}
      ${renderSimulator()}
      ${renderLog()}
      ${renderFaq()}
      ${renderLimits()}
    </main>
    ${renderFooter()}`;
  wireLangToggle();
  wireSubscribeButtons();
  wireSimulator();
}

async function boot() {
  document.documentElement.lang = lang;
  try {
    const [p, h] = await Promise.all([
      fetchJson<ScanSummary>("positions.json"),
      fetchJson<HistoryEntry[]>("history.json"),
    ]);
    positions = p;
    history = h;
  } catch (err) {
    console.error("failed to load position data", err);
  }
  render();
}

boot();
