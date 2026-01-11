if (typeof chrome === "undefined" || !chrome.runtime) {
  alert("Open options using chrome://extensions → Details → Options (not like file:///).");
}

console.log("options.js loaded");

let ALL = [];
let selected = null;

function fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function groupByDomain(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.domain)) map.set(r.domain, []);
    map.get(r.domain).push(r);
  }
  return map;
}

function badge(type) {
  return `<span class="badge">${type}</span>`;
}

function api(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          console.warn("api error:", chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(res);
        }
      });
    } catch (e) {
      console.error("api exception:", e);
      resolve(null);
    }
  });
}

function yn(v){ return v ? "YES" : "NO"; }

function setText(id, val) {
const el = document.getElementById(id);
if (el) el.textContent = val;
}

function checkIncognitoAllowed() {
return new Promise((resolve) => {
try {
if (!chrome?.extension?.isAllowedIncognitoAccess) return resolve(null);
chrome.extension.isAllowedIncognitoAccess((allowed) => resolve(!!allowed));
} catch { resolve(null); }
});
}

function checkFileAllowed() {
return new Promise((resolve) => {
try {
if (!chrome?.extension?.isAllowedFileSchemeAccess) return resolve(null);
chrome.extension.isAllowedFileSchemeAccess((allowed) => resolve(!!allowed));
} catch { resolve(null); }
});
}

async function pingWorker() {
const res = await api({ kind: "PI_PING" });
return !!(res && res.ok);
}

async function updateEnv() {
setText("envContext", location.href.startsWith("chrome-extension://") ? "chrome-extension://" : "unknown");
setText("envIncNow", yn(!!chrome?.extension?.inIncognitoContext));

const incAllowed = await checkIncognitoAllowed();
setText("envIncAllowed", incAllowed === null ? "N/A" : yn(incAllowed));

const fileAllowed = await checkFileAllowed();
setText("envFileAllowed", fileAllowed === null ? "N/A" : yn(fileAllowed));

const workerOk = await pingWorker();
setText("envWorker", workerOk ? "OK" : "NOT RESPONDING");

setText("envRecords", String(ALL.length));
}

async function checkPublicIp() {
setText("envIp", "Checking...");
try {
// ipify radi preko https. Ako ne radi, fallback poruka.
const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), 5000);

const r = await fetch("https://api.ipify.org?format=json", { signal: ctrl.signal, cache: "no-store" });
clearTimeout(t);

if (!r.ok) throw new Error("HTTP " + r.status);
const j = await r.json();
const ip = (j && j.ip) ? String(j.ip) : "";
setText("envIp", ip ? ip : "Unknown");


} catch (e) {
setText("envIp", "Blocked / unavailable");
}
}
function applyFilters() {
  const q = (document.getElementById("search").value || "").trim().toLowerCase();
  const f = document.getElementById("filter").value;

  let filtered = ALL;

  if (f !== "ALL") filtered = filtered.filter(r => r.type === f);
  if (q) filtered = filtered.filter(r => r.domain.includes(q));

  render(filtered);
}

function render(records) {
  const rows = document.getElementById("rows");
  rows.innerHTML = "";

  const map = groupByDomain(records);
  const domains = Array.from(map.keys()).sort();

  let countEmail = 0, countCard = 0;
  for (const r of ALL) {
    if (r.type === "EMAIL") countEmail++;
    if (r.type === "CARD") countCard++;
  }

  document.getElementById("stats").textContent =
    `Records: ${ALL.length} | Email: ${countEmail} | Card: ${countCard} | Sites: ${new Set(ALL.map(x => x.domain)).size}`;

  for (const domain of domains) {
    const items = map.get(domain);
    const types = items.map(x => x.type).sort();
    const lastSeen = Math.max(...items.map(x => x.lastSeen || 0));

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${domain}</strong></td>
      <td>${types.map(badge).join("")}</td>
      <td>${fmt(lastSeen)}</td>
      <td class="actions">
        <button data-domain="${domain}" class="open">Open</button>
      </td>
    `;
    rows.appendChild(tr);
  }

  rows.querySelectorAll("button.open").forEach(btn => {
    btn.addEventListener("click", () => openDrawer(btn.getAttribute("data-domain")));
  });
}

function openDrawer(domain) {
  const items = ALL.filter(r => r.domain === domain);
  if (!items.length) return;

  selected = { domain, items };

  document.getElementById("d_domain").textContent = domain;

  const meta = [];
  const firstSeen = Math.min(...items.map(x => x.firstSeen || x.lastSeen));
  const lastSeen = Math.max(...items.map(x => x.lastSeen));

  meta.push(`First seen: ${fmt(firstSeen)}`);
  meta.push(`Last seen: ${fmt(lastSeen)}`);

  document.getElementById("d_meta").textContent = meta.join(" • ");

  document.getElementById("d_types").innerHTML =
    items
      .map(x => `${badge(x.type)} <span style="opacity:.75">${x.status || "ACTIVE"}</span>`)
      .join("<br/>");

  const paths = new Set();
  items.forEach(x => (x.paths || []).forEach(p => paths.add(p)));

  const pwrap = document.getElementById("d_paths");
  pwrap.innerHTML = Array.from(paths)
    .slice(0, 40)
    .map(p => `<span class="chip">${p}</span>`)
    .join("");

  document.getElementById("d_notes").value = items[0].notes || "";

  document.getElementById("help").classList.add("hidden");
  document.getElementById("drawer").classList.remove("hidden");
}

async function markDeletedOnSite() {
  if (!selected) return;
  for (const it of selected.items) {
    await api({ kind: "PI_UPDATE_RECORD", id: it.id, patch: { status: "USER_DELETED_ON_SITE" } });
  }
  await load();
  openDrawer(selected.domain);
}

async function saveNotes() {
  if (!selected) return;
  const notes = document.getElementById("d_notes").value || "";
  for (const it of selected.items) {
    await api({ kind: "PI_UPDATE_RECORD", id: it.id, patch: { notes } });
  }
  await load();
  openDrawer(selected.domain);
}

async function deleteLocal() {
  if (!selected) return;
  for (const it of selected.items) {
    await api({ kind: "PI_DELETE_RECORD", id: it.id });
  }
  document.getElementById("drawer").classList.add("hidden");
  await load();
}

function openHelp() {
  if (!selected) return;
  const domain = selected.domain;

  const urls = [
    `https://${domain}/account`,
    `https://${domain}/settings`,
    `https://${domain}/privacy`,
    `https://${domain}/security`,
    `https://${domain}/profile`
  ];

  const types = new Set(selected.items.map(x => x.type));

  const steps = [];
  steps.push(`<strong>Goal:</strong> remove your personal data from this site.`);
  steps.push(`<ol>
    <li>Open the site and log in.</li>
    <li>Check Account/Settings/Privacy pages.</li>
    <li>Remove saved email/phone where possible.</li>
    <li>If CARD is present: remove saved payment methods and delete billing profile if you no longer use it.</li>
    <li>If the site allows: request account deletion (GDPR/Privacy).</li>
    <li>After you do it, click “Mark as deleted on site”.</li>
  </ol>`);

  const extra = [];
  if (types.has("CARD")) {
    extra.push(`<div style="margin-top:8px; opacity:.95">
      <strong>Card note:</strong> This extension never stores card numbers. If you saved a payment method on the site, remove it there. If you suspect compromise, consider contacting your bank.
    </div>`);
  }

  const linksHtml = urls
    .map(u => `<div><a href="${u}" target="_blank" style="color:#9ad;">${u}</a></div>`)
    .join("");

  const help = document.getElementById("help");
  help.innerHTML = `<div>${steps.join("")}</div>
    <div style="margin-top:10px"><strong>Quick links:</strong>${linksHtml}</div>
    ${extra.join("")}`;
  help.classList.remove("hidden");
}

/* =========================
   IMPORT / EXPORT / CLEAR
========================= */

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line) {
  // minimal CSV parser (handles quotes)
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' ) {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(x => x.trim());
}

function domainFromUrlOrHost(v) {
  try {
    let s = (v || "").trim();
    if (!s) return "";
    if (!s.startsWith("http")) s = "https://" + s;
    const u = new URL(s);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function importCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return;

  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const idxUri = header.findIndex(h => h === "uri" || h.includes("url") || h.includes("website"));
  const idxName = header.findIndex(h => h === "name" || h.includes("title"));

  const records = [];
  const ts = Date.now();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const uriVal = idxUri >= 0 ? cols[idxUri] : cols[0];
    const domain = domainFromUrlOrHost(uriVal);
    if (!domain) continue;

    // Import kao EMAIL nalog (jer password managers su uglavnom accounts)
    records.push({
      domain,
      type: "EMAIL",
      firstSeen: ts,
      lastSeen: ts,
      paths: [],
      status: "ACTIVE",
      notes: idxName >= 0 ? (cols[idxName] || "") : ""
    });
  }

  await api({ kind: "PI_IMPORT_RECORDS", records });
  await load();
}

async function exportJson() {
  const res = await api({ kind: "PI_GET_ALL" });
  const records = res?.records || [];
  downloadText(`privacy-inventory-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(records, null, 2));
}

async function clearAll() {
  await api({ kind: "PI_CLEAR_ALL" });
  await load();
}

async function load() {
  const res = await api({ kind: "PI_GET_ALL" });
  ALL = (res?.records || []).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  applyFilters();
}

/* =========================
   EVENTS
========================= */

function bindUI() {
  const elSearch = document.getElementById("search");
  const elFilter = document.getElementById("filter");
  const elRefresh = document.getElementById("refresh");
  const elEnvRefresh = document.getElementById("btnEnvRefresh");
  const elCheckIp = document.getElementById("btnCheckIp");

  if (elEnvRefresh) elEnvRefresh.addEventListener("click", updateEnv);
  if (elCheckIp) elCheckIp.addEventListener("click", checkPublicIp);
  const elCloseDrawer = document.getElementById("closeDrawer");
  const elBtnMarkDeleted = document.getElementById("btnMarkDeleted");
  const elBtnOpenHelp = document.getElementById("btnOpenHelp");
  const elBtnDeleteLocal = document.getElementById("btnDeleteLocal");
  const elBtnSaveNotes = document.getElementById("btnSaveNotes");

  const elExport = document.getElementById("exportJson");
  const elClear = document.getElementById("clearAll");
  const elImport = document.getElementById("importCsv");

  console.log("bindUI", {
    search: !!elSearch, filter: !!elFilter, refresh: !!elRefresh,
    closeDrawer: !!elCloseDrawer,
    markDeleted: !!elBtnMarkDeleted, openHelp: !!elBtnOpenHelp,
    deleteLocal: !!elBtnDeleteLocal, saveNotes: !!elBtnSaveNotes,
    exportJson: !!elExport, clearAll: !!elClear, importCsv: !!elImport
  });

  if (elSearch) elSearch.addEventListener("input", applyFilters);
  if (elFilter) elFilter.addEventListener("change", applyFilters);
  if (elRefresh) elRefresh.addEventListener("click", load);

  if (elCloseDrawer) elCloseDrawer.addEventListener("click", () => {
    document.getElementById("drawer")?.classList.add("hidden");
  });

  if (elBtnMarkDeleted) elBtnMarkDeleted.addEventListener("click", markDeletedOnSite);
  if (elBtnOpenHelp) elBtnOpenHelp.addEventListener("click", openHelp);
  if (elBtnDeleteLocal) elBtnDeleteLocal.addEventListener("click", deleteLocal);
  if (elBtnSaveNotes) elBtnSaveNotes.addEventListener("click", saveNotes);

  if (elExport) elExport.addEventListener("click", exportJson);
  if (elClear) elClear.addEventListener("click", clearAll);

  if (elImport) {
    elImport.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await importCsv(file);
      e.target.value = "";
    });
  }

  load();
  updateEnv();

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindUI);
} else {
  bindUI();
}
async function load() {
  const res = await api({ kind: "PI_GET_ALL" });
  ALL = (res?.records || []).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  applyFilters();
  await updateEnv(); // OVDE SME await
}
