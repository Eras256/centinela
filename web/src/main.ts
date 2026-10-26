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

type Route = { kind: "home" } | { kind: "position"; id: string };

function getRoute(): Route {
  const raw = decodeURIComponent(location.hash.slice(1));
  const match = raw.match(/^position\/(.+)$/);
  return match ? { kind: "position", id: match[1] } : { kind: "home" };
}

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

function truncateAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function fmtBtc(sats: string): string {
  return (Number(sats) / 100_000_000).toFixed(6);
}

function fmtUsdc(stroops: string): string {
  return (Number(stroops) / 10_000_000).toFixed(2);
}

function renderHeader(route: Route): string {
  const nav =
    route.kind === "home"
      ? `
        <nav class="toc">
          <a href="#problem">${t(lang, "navProblem")}</a>
          <a href="#how">${t(lang, "navHow")}</a>
          <a href="#positions">${t(lang, "navPositions")}</a>
          <a href="#simulator">${t(lang, "navSimulator")}</a>
          <a href="#log">${t(lang, "navLog")}</a>
          <a href="#faq">${t(lang, "navFaq")}</a>
          <a href="#limits">${t(lang, "navLimits")}</a>
        </nav>`
      : "";
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
        ${nav}
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
      <pre class="ascii">escaner (Node/TS) --&gt; Soroban RPC (get_position, get_health_ratio_bp, get_best_tip)
      |
      v
data/positions.json, data/history.json  --(git push)--&gt;  este repo
      |
      v
pagina estatica (este sitio)  --(fetch)--&gt;  raw.githubusercontent.com
      |
      v
cambio de estado? --&gt; ntfy.sh/&lt;tema-de-la-posicion&gt; --&gt; tu telefono</pre>
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
              <div class="small text-dim">${p.healthDisplay} · ${fmtUsdc(p.usdcDebt)} USDC</div>
            </td>
            <td><span class="status-pill status-${p.status}">${t(lang, statusKey)}</span></td>
            <td>${p.blocksUntilLiquidationCutoff.toLocaleString()}${p.timelockNear ? " ⚠" : ""}</td>
            <td>${drop}</td>
            <td><button class="subscribe-btn" data-topic="${p.ntfyTopic}" type="button">${t(lang, "subscribeBtn")}</button></td>
            <td><a class="detail-link" href="#position/${encodeURIComponent(p.txidInternal)}">${t(lang, "viewDetail")}</a></td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="9" class="text-dim">${t(lang, "noPositions")}</td></tr>`;

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
              <th>${t(lang, "colDetail")}</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="small text-dim" style="margin-top:8px;">${t(lang, "subscribeHint")}</p>
      ${positions ? `<p class="small text-dim">writz-lend: <span class="mono">${positions.writzLendContractId}</span> · bitcoin-spv: <span class="mono">${positions.bitcoinSpvContractId}</span> · scanned: ${new Date(positions.scannedAt).toLocaleString(lang)}</p>` : ""}
    </section>`;
}

function renderPositionDetail(id: string): string {
  const backLink = `<a class="back-link" href="#">${t(lang, "backToPositions")}</a>`;
  const pos = positions?.positions.find((p) => p.txidInternal === id);
  if (!pos) {
    return `
      <section id="detail">
        ${backLink}
        <div class="panel" style="margin-top:16px;">
          <h2>${t(lang, "notFoundTitle")}</h2>
          <p class="text-dim">${t(lang, "notFoundBody")}</p>
        </div>
      </section>`;
  }
  const statusKey = STATUS_KEY[pos.status] ?? pos.status;
  const drop = pos.pctDropToLiquidation === null ? "-" : `${pos.pctDropToLiquidation}%`;
  return `
    <section id="detail">
      ${backLink}
      <div class="detail-head">
        <h2 class="mono">${pos.txidDisplay.slice(0, 18)}...</h2>
        <span class="status-pill status-${pos.status}">${t(lang, statusKey)}</span>
      </div>
      <p class="small text-dim">${t(lang, "detailUpdatedLabel")}: ${new Date(pos.updatedAt).toLocaleString(lang)}</p>
      <div class="panel detail-grid">
        <div class="detail-stat">
          <div class="small text-dim">${t(lang, "colTxid")}</div>
          <div class="mono"><a href="https://mempool.space/signet/tx/${pos.txidDisplay}" target="_blank" rel="noopener">${pos.txidDisplay}</a></div>
        </div>
        <div class="detail-stat">
          <div class="small text-dim">${t(lang, "colDepositor")}</div>
          <div class="mono">${pos.depositor}</div>
        </div>
        <div class="detail-stat">
          <div class="small text-dim">${t(lang, "colBtc")}</div>
          <div>${fmtBtc(pos.btcSatoshis)} BTC</div>
        </div>
        <div class="detail-stat">
          <div class="small text-dim">${t(lang, "detailDebtLabel")}</div>
          <div>${fmtUsdc(pos.usdcDebt)} USDC</div>
        </div>
        <div class="detail-stat">
          <div class="small text-dim">${t(lang, "colHealth")}</div>
          <div>
            <div class="health-bar"><span style="width:${healthBarPct(pos.healthBp)}%;background:${healthColor(pos.status)}"></span></div>
            <div class="small text-dim">${pos.healthDisplay}</div>
          </div>
        </div>
        <div class="detail-stat">
          <div class="small text-dim">${t(lang, "colTimelock")}</div>
          <div>${pos.blocksUntilLiquidationCutoff.toLocaleString()}${pos.timelockNear ? " ⚠" : ""}</div>
        </div>
        <div class="detail-stat">
          <div class="small text-dim">${t(lang, "colDrop")}</div>
          <div>${drop}</div>
        </div>
        <div class="detail-stat">
          <div class="small text-dim">${t(lang, "detailNtfyLabel")}</div>
          <div><button class="subscribe-btn" data-topic="${pos.ntfyTopic}" type="button">${t(lang, "subscribeBtn")}</button></div>
        </div>
      </div>
      <div class="detail-actions">
        <button
          class="copy-link-btn"
          id="copy-link-btn"
          type="button"
          data-default-label="${t(lang, "copyLinkBtn")}"
          data-copied-label="${t(lang, "copyLinkCopied")}"
        >${t(lang, "copyLinkBtn")}</button>
      </div>
      ${renderSimulator(pos.txidInternal)}
    </section>`;
}

function renderSimulator(selectedId?: string): string {
  const rows = positions?.positions ?? [];
  const options = rows
    .map((p) => {
      const selected = selectedId && p.txidInternal === selectedId ? " selected" : "";
      return `<option value="${p.txidInternal}"${selected}>${p.txidDisplay.slice(0, 14)}... (${p.healthDisplay})</option>`;
    })
    .join("");
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

function wireSimulator(opts: { syncHash?: boolean } = {}) {
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
    const currentStatusKey = STATUS_KEY[pos.status] ?? pos.status;
    const currentBlock = `
      <div class="sim-stat">
        <div class="small text-dim">${t(lang, "simulatorCurrentHealth")}</div>
        <div class="big" style="color:${healthColor(pos.status)}">${pos.healthDisplay}</div>
        <span class="status-pill status-${pos.status}">${t(lang, currentStatusKey)}</span>
      </div>`;
    if (pos.healthBp === "max") {
      result!.innerHTML = `
        <div class="sim-compare">${currentBlock}</div>
        <p class="text-dim small" style="margin-top:10px;">${t(lang, "simulatorNoDebt")}</p>`;
      return;
    }
    const newHealthBp = simulateHealthAfterDrop(Number(pos.healthBp), dropPct);
    const newStatus = classifyFromHealthBp(newHealthBp);
    const statusKey = STATUS_KEY[newStatus] ?? newStatus;
    result!.innerHTML = `
      <div class="sim-compare">
        ${currentBlock}
        <div class="sim-arrow" aria-hidden="true">-&gt;</div>
        <div class="sim-stat">
          <div class="small text-dim">${t(lang, "simulatorResultHealth")}</div>
          <div class="big" style="color:${healthColor(newStatus)}">${(newHealthBp / 100).toFixed(1)}%</div>
          <span class="status-pill status-${newStatus}">${t(lang, statusKey)}</span>
        </div>
      </div>`;
  }

  select.addEventListener("change", () => {
    if (opts.syncHash) {
      location.hash = `position/${encodeURIComponent(select!.value)}`;
      return;
    }
    update();
  });
  slider.addEventListener("input", update);
  update();
}

function wireCopyLinkButton() {
  const btn = document.getElementById("copy-link-btn") as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}${location.hash}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard blocked (private mode, insecure context): nothing more to do */
    }
    const defaultLabel = btn.dataset.defaultLabel ?? btn.textContent ?? "";
    btn.textContent = btn.dataset.copiedLabel ?? defaultLabel;
    setTimeout(() => {
      btn.textContent = defaultLabel;
    }, 1500);
  });
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
  const route = getRoute();
  if (route.kind === "position") {
    app.innerHTML = `
      ${renderHeader(route)}
      <main class="wrap">
        ${renderPositionDetail(route.id)}
      </main>
      ${renderFooter()}`;
    wireLangToggle();
    wireSubscribeButtons();
    wireCopyLinkButton();
    wireSimulator({ syncHash: true });
    return;
  }
  app.innerHTML = `
    ${renderHeader(route)}
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

window.addEventListener("hashchange", render);

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
