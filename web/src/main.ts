import "./style.css";
import { t, STATUS_KEY, EXPLAIN_KEY, type Lang } from "./i18n";
import { classifyFromHealthBp, simulateHealthAfterDrop, pctDropToLiquidation } from "./sim";
import type { ScanSummary, HistoryEntry, PositionRecord } from "./types";
import { renderHero, wireHero } from "./hero";

// GitHub Pages has no server-side routing, so the per-position view lives in the hash.
const POSITION_ROUTE = "#/posicion/";

function routeTxid(): string | null {
  const hash = location.hash;
  return hash.startsWith(POSITION_ROUTE) ? decodeURIComponent(hash.slice(POSITION_ROUTE.length)) : null;
}

function positionHref(p: PositionRecord): string {
  return `${POSITION_ROUTE}${encodeURIComponent(p.txidDisplay)}`;
}

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

function fmtPctBp(bp: number): string {
  return `${(bp / 100).toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
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
              <a href="${positionHref(p)}" title="${t(lang, "viewPositionTitle")}">${esc(p.txidDisplay.slice(0, 10))}...</a>
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

  const cards = rows
    .map((p) => {
      const drop = p.pctDropToLiquidation === null ? "-" : `${esc(p.pctDropToLiquidation)}%`;
      return `
      <li class="panel position-card">
        <div class="pc-head">
          <a class="mono" href="${positionHref(p)}">${esc(p.txidDisplay.slice(0, 10))}...</a>
          <span class="status-pill status-${esc(p.status)}">${t(lang, STATUS_KEY[p.status] ?? p.status)}</span>
        </div>
        <div class="health-bar wide"><span style="width:${healthBarPct(p.healthBp)}%;background:${healthColor(p.status)}"></span></div>
        <dl class="pc-facts">
          <div><dt>${t(lang, "colHealth")}</dt><dd>${esc(healthText(p))}</dd></div>
          <div><dt>${t(lang, "colBtc")}</dt><dd>${fmtBtc(p.btcSatoshis)}</dd></div>
          <div><dt>${t(lang, "detailDebt")}</dt><dd>${fmtUsdc(p.usdcDebt)} USDC</dd></div>
          <div><dt>${t(lang, "colDrop")}</dt><dd>${drop}</dd></div>
          <div><dt>${t(lang, "colTimelock")}</dt><dd>${p.blocksUntilLiquidationCutoff.toLocaleString(lang)}${p.timelockNear ? ` <span class="near-tag">${t(lang, "timelockNearShort")}</span>` : ""}</dd></div>
        </dl>
        <div class="pc-actions">
          <a class="pc-detail" href="${positionHref(p)}">${t(lang, "viewDetail")} →</a>
          <button class="subscribe-btn" data-topic="${esc(p.ntfyTopic)}" type="button">${t(lang, "subscribeBtn")}</button>
        </div>
      </li>`;
    })
    .join("");

  return `
    <section id="positions">
      <h2>${t(lang, "positionsTitle")}</h2>
      <ul class="position-cards">${cards || `<li class="panel text-dim">${t(lang, "noPositions")}</li>`}</ul>
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

function renderGauge(p: PositionRecord): string {
  return `
    <div class="gauge" role="img" aria-label="${t(lang, "detailHealth")}: ${esc(healthText(p))}">
      <div class="gauge-track">
        <span class="gauge-fill" style="width:${healthBarPct(p.healthBp)}%;background:${healthColor(p.status)}"></span>
        <span class="gauge-mark mark-liq" style="left:60%"></span>
        <span class="gauge-mark mark-warn" style="left:67.5%"></span>
        <span class="gauge-mark mark-min" style="left:75%"></span>
      </div>
      <ul class="gauge-legend">
        <li class="mark-liq">${t(lang, "gaugeLiq")}</li>
        <li class="mark-warn">${t(lang, "gaugeWarn")}</li>
        <li class="mark-min">${t(lang, "gaugeMin")}</li>
      </ul>
    </div>`;
}

function renderPositionDetail(txid: string): string {
  const p = positions?.positions.find((x) => x.txidDisplay === txid || x.txidInternal === txid);
  const back = `<p class="back"><a href="#positions">${t(lang, "backToPositions")}</a></p>`;
  if (!p) {
    return `<section id="position">${back}<div class="panel"><p>${t(lang, "detailNotFound")}</p></div></section>`;
  }

  const statusKey = STATUS_KEY[p.status] ?? p.status;
  const blocks = p.blocksUntilLiquidationCutoff;
  const days = Math.round((blocks * 10) / (60 * 24));
  const cutoffNote =
    blocks <= 0
      ? `<p class="small cutoff-passed">${t(lang, "detailCutoffPassed")}</p>`
      : `<span class="text-dim small">${t(lang, "detailDaysApprox").replace("{n}", days.toLocaleString(lang))}</span>`;
  const changes = history.filter((h) => h.txidDisplay === p.txidDisplay).reverse();

  return `
    <section id="position">
      ${back}
      <div class="detail-head">
        <h2>${t(lang, "positionTitle")} <span class="mono">${esc(p.txidDisplay.slice(0, 8))}...${esc(p.txidDisplay.slice(-6))}</span></h2>
        <span class="status-pill status-${esc(p.status)}">${t(lang, statusKey)}</span>
      </div>
      <p class="status-explain">${t(lang, EXPLAIN_KEY[p.status] ?? "")}</p>

      <div class="panel">
        <dl class="facts">
          <div><dt>${t(lang, "detailHealth")}</dt><dd class="big" style="color:${healthColor(p.status)}">${esc(healthText(p))}</dd></div>
          <div><dt>${t(lang, "detailDrop")}</dt><dd>${p.pctDropToLiquidation === null ? `<span class="text-dim small">${t(lang, "detailDropNone")}</span>` : `<span class="big">${esc(p.pctDropToLiquidation)}%</span>`}</dd></div>
          <div><dt>${t(lang, "detailBtc")}</dt><dd>${fmtBtc(p.btcSatoshis)} BTC <span class="text-dim small">(${Number(p.btcSatoshis).toLocaleString(lang)} sats)</span></dd></div>
          <div><dt>${t(lang, "detailDebt")}</dt><dd>${fmtUsdc(p.usdcDebt)} USDC</dd></div>
        </dl>
        ${renderGauge(p)}
      </div>

      <h3>${t(lang, "detailTimelockTitle")}</h3>
      <div class="panel">
        <dl class="facts">
          <div><dt>${t(lang, "detailBlocksToCutoff")}</dt><dd><span class="big">${blocks.toLocaleString(lang)}</span>${p.timelockNear ? ` <span class="near-tag">${t(lang, "timelockNearShort")}</span>` : ""}<br>${cutoffNote}</dd></div>
          <div><dt>${t(lang, "detailTimelockHeight")}</dt><dd>${p.timelockHeight.toLocaleString(lang)}</dd></div>
          <div><dt>${t(lang, "detailTipHeight")}</dt><dd>${p.tipHeight.toLocaleString(lang)}</dd></div>
        </dl>
        <p class="small text-dim">${t(lang, "detailTimelockExplain")}${p.timelockNear ? ` <strong>${t(lang, "detailTimelockNear")}</strong>` : ""}</p>
      </div>

      <h3>${t(lang, "detailAlertsTitle")}</h3>
      <div class="panel">
        <ol class="steps">
          <li>${t(lang, "detailAlertsStep1")}</li>
          <li>${t(lang, "detailAlertsStep2")}
            <div class="topic-row">
              <input class="mono topic-input" id="topic-input" type="text" readonly value="${esc(p.ntfyTopic)}" aria-label="ntfy" />
              <button class="copy-btn" id="copy-topic" type="button">${t(lang, "copyTopic")}</button>
              <button class="subscribe-btn" data-topic="${esc(p.ntfyTopic)}" type="button">${t(lang, "subscribeBtn")}</button>
            </div>
          </li>
          <li>${t(lang, "detailAlertsStep3")}</li>
        </ol>
      </div>

      ${renderSimulator(p.txidInternal)}

      <h3>${t(lang, "detailHistoryTitle")}</h3>
      <div class="panel"><ul class="log-list">${changes.length ? changes.map(renderLogItem).join("") : `<li class="text-dim">${t(lang, "logEmpty")}</li>`}</ul></div>

      <h3>${t(lang, "detailTxid")}</h3>
      <p class="mono small"><a href="https://mempool.space/signet/tx/${esc(p.txidDisplay)}" target="_blank" rel="noopener">${esc(p.txidDisplay)}</a></p>
      <h3>${t(lang, "detailDepositor")}</h3>
      <p class="mono small"><a href="https://stellar.expert/explorer/testnet/account/${esc(p.depositor)}" target="_blank" rel="noopener">${esc(p.depositor)}</a></p>
      <p class="small text-dim">${t(lang, "detailUpdated")}: ${esc(new Date(p.updatedAt).toLocaleString(lang))} · ledger ${esc(p.lastUpdateLedger)}</p>
    </section>`;
}

const HYPO = "__hypothetical";
const SIM_MAX_DROP = 95;

function isSimulatable(p: PositionRecord): boolean {
  return p.healthBp !== "max" && p.status !== "closed" && p.status !== "liquidated";
}

function renderSimulator(preselect?: string): string {
  const rows = positions?.positions ?? [];
  // With no real position carrying debt, start on the labeled hypothetical so the slider shows something.
  const selected = preselect ?? rows.find(isSimulatable)?.txidInternal ?? HYPO;
  const options = rows
    .map((p) => `<option value="${esc(p.txidInternal)}"${p.txidInternal === selected ? " selected" : ""}>${esc(p.txidDisplay.slice(0, 14))}... (${esc(t(lang, STATUS_KEY[p.status] ?? p.status))}, ${esc(healthText(p))})</option>`)
    .join("");
  return `
    <section id="simulator">
      <h2><span class="sim-label-sim">SIM</span> ${t(lang, "simulatorTitle")}</h2>
      <p class="sim-subtitle">${t(lang, "simulatorSubtitle")}</p>
      <div class="panel sim-grid">
        <div>
          <div class="sim-field">
            <label for="sim-position">${t(lang, "simulatorPick")}</label>
            <select id="sim-position">${options}<option value="${HYPO}"${selected === HYPO ? " selected" : ""}>${t(lang, "simHypothetical")}</option></select>
          </div>
          <div class="sim-field" id="sim-hypo-field" hidden>
            <label for="sim-hypo">${t(lang, "simHypoHealth")}</label>
            <input type="number" id="sim-hypo" min="100" max="1000" step="1" value="180" inputmode="numeric" />
          </div>
          <div class="sim-field">
            <label for="sim-drop">${t(lang, "simulatorDrop")}: <span id="sim-drop-value">0</span>%</label>
            <input type="range" id="sim-drop" min="0" max="${SIM_MAX_DROP}" step="1" value="0" />
            <div class="sim-scale" aria-hidden="true">
              <span class="sim-liq-mark" id="sim-liq-mark" hidden><span>${t(lang, "simLiqMark")}</span></span>
            </div>
            <div class="sim-scale-labels" aria-hidden="true"><span>0%</span><span>${SIM_MAX_DROP}%</span></div>
          </div>
        </div>
        <div class="sim-result" id="sim-result" aria-live="polite"></div>
      </div>
    </section>`;
}

function renderLogItem(h: HistoryEntry): string {
  const from = h.fromStatus ? t(lang, STATUS_KEY[h.fromStatus] ?? h.fromStatus) : "-";
  const to = t(lang, STATUS_KEY[h.toStatus] ?? h.toStatus);
  return `<li><span class="log-time">${esc(new Date(h.atIso).toLocaleString(lang))}</span><a class="mono" href="${POSITION_ROUTE}${encodeURIComponent(h.txidDisplay)}">${esc(h.txidDisplay.slice(0, 10))}...</a><span>${h.fromStatus ? `${t(lang, "logFrom")} <strong>${esc(from)}</strong> ${t(lang, "logTo")}` : t(lang, "logDetected")} <strong>${esc(to)}</strong></span></li>`;
}

function renderLog(): string {
  const items = [...history].reverse().slice(0, 30);
  const body = items.length ? items.map(renderLogItem).join("") : `<li class="text-dim">${t(lang, "logEmpty")}</li>`;
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
  const hypoField = document.getElementById("sim-hypo-field");
  const hypoInput = document.getElementById("sim-hypo") as HTMLInputElement | null;
  const liqMark = document.getElementById("sim-liq-mark");
  if (!select || !slider || !result || !hypoField || !hypoInput || !liqMark) return;

  function blocked(message: string) {
    slider!.disabled = true;
    liqMark!.hidden = true;
    result!.innerHTML = `<p class="text-dim">${message}</p><p class="small text-dim">${t(lang, "simCannot")}</p>`;
  }

  function update() {
    const isHypo = select!.value === HYPO;
    hypoField!.hidden = !isHypo;
    const dropPct = Number(slider!.value);
    if (valueLabel) valueLabel.textContent = String(dropPct);

    let startBp: number;
    if (isHypo) {
      const pct = Number(hypoInput!.value);
      startBp = Math.round(Math.min(1000, Math.max(1, Number.isFinite(pct) && pct > 0 ? pct : 100)) * 100);
    } else {
      const pos = positions?.positions.find((p) => p.txidInternal === select!.value);
      if (!pos) {
        result!.innerHTML = "";
        return;
      }
      if (pos.status === "closed") return blocked(t(lang, "explainClosed"));
      if (pos.status === "liquidated") return blocked(t(lang, "explainLiquidated"));
      if (pos.healthBp === "max") return blocked(t(lang, "simulatorNoDebt"));
      startBp = Number(pos.healthBp);
    }
    slider!.disabled = false;

    const liqDrop = pctDropToLiquidation(startBp);
    liqMark!.hidden = liqDrop <= 0 || liqDrop > SIM_MAX_DROP;
    liqMark!.style.left = `${(liqDrop / SIM_MAX_DROP) * 100}%`;

    const newHealthBp = simulateHealthAfterDrop(startBp, dropPct);
    const newStatus = classifyFromHealthBp(newHealthBp);
    const startStatus = classifyFromHealthBp(startBp);
    const liqLine = liqDrop <= 0 ? t(lang, "simAlreadyLiq") : t(lang, "simLiqAt").replace("{n}", liqDrop.toLocaleString(lang));
    result!.innerHTML = `
      <div class="sim-compare">
        <div>
          <div class="small text-dim">${t(lang, "simCurrent")}</div>
          <div class="big" style="color:${healthColor(startStatus)}">${fmtPctBp(startBp)}</div>
        </div>
        <div class="sim-arrow" aria-hidden="true">→</div>
        <div>
          <div class="small text-dim">${t(lang, "simulatorResultHealth")}</div>
          <div class="big" style="color:${healthColor(newStatus)}">${fmtPctBp(newHealthBp)}</div>
        </div>
      </div>
      <div>
        <div class="small text-dim">${t(lang, "simulatorResultStatus")}</div>
        <span class="status-pill status-${newStatus}">${t(lang, STATUS_KEY[newStatus] ?? newStatus)}</span>
        <p class="small sim-explain">${t(lang, EXPLAIN_KEY[newStatus] ?? "")}</p>
      </div>
      <p class="small"><strong>${liqLine}</strong></p>
      ${isHypo ? `<p class="small sim-hypo-note">${t(lang, "simHypoNote")}</p>` : ""}`;
  }

  select.addEventListener("change", () => {
    slider.value = "0";
    update();
  });
  slider.addEventListener("input", update);
  hypoInput.addEventListener("input", update);
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

function wireCopyTopic() {
  const btn = document.getElementById("copy-topic");
  const input = document.getElementById("topic-input") as HTMLInputElement | null;
  if (!btn || !input) return;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      btn.textContent = t(lang, "copied");
    } catch {
      input.select();
    }
  });
}

let renderedView = "";

function render() {
  const app = document.getElementById("app");
  if (!app) return;
  const txid = routeTxid();
  renderedView = txid ?? "home";
  const body = txid
    ? renderPositionDetail(txid)
    : `
      ${renderProblem()}
      ${renderHow()}
      ${renderPositionsTable()}
      ${renderSimulator()}
      ${renderLog()}
      ${renderFaq()}
      ${renderLimits()}`;
  app.innerHTML = `
    ${renderHeader()}
    ${txid ? "" : renderHero(positions, lang)}
    <main class="wrap">${body}</main>
    ${renderFooter()}`;
  wireLangToggle();
  wireSubscribeButtons();
  wireCopyTopic();
  wireSimulator();
  if (!txid) wireHero(lang);
}

window.addEventListener("hashchange", () => {
  if ((routeTxid() ?? "home") === renderedView) return;
  render();
  const section = location.hash.slice(1);
  if (renderedView === "home" && section && !section.startsWith("/")) {
    document.getElementById(section)?.scrollIntoView();
  } else {
    window.scrollTo(0, 0);
  }
});

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
