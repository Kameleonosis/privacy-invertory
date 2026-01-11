const STORAGE_KEY = "pi_records_v1";

function normalizeDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

async function getAllRecords() {
  const res = await chrome.storage.local.get([STORAGE_KEY]);
  return Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
}

async function saveAllRecords(records) {
  await chrome.storage.local.set({ [STORAGE_KEY]: records });
}

function upsertRecord(records, record) {
  // record: { domain, type, path, ts }
  const idx = records.findIndex(r => r.domain === record.domain && r.type === record.type);

  if (idx >= 0) {
    const existing = records[idx];
    const paths = new Set([...(existing.paths || []), record.path].filter(Boolean));

    records[idx] = {
      ...existing,
      lastSeen: record.ts,
      paths: Array.from(paths).slice(-20)
    };
  } else {
    records.push({
      id: crypto.randomUUID(),
      domain: record.domain,
      type: record.type, // "EMAIL" | "CARD"
      firstSeen: record.ts,
      lastSeen: record.ts,
      paths: record.path ? [record.path] : [],
      status: "ACTIVE", // ACTIVE | USER_DELETED_ON_SITE
      notes: ""
    });
  }

  return records;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.kind === "PI_PING") {
      return sendResponse({ ok: true });
      }
      // 1) Add event from content script
      if (msg?.kind === "PI_ADD_EVENT") {
        const url = msg.url || sender?.tab?.url || "";
        const domain = normalizeDomain(url);
        if (!domain) return sendResponse({ ok: false });

        const path = (() => {
          try { return new URL(url).pathname; } catch { return ""; }
        })();

        const type = msg.type === "CARD" ? "CARD" : "EMAIL";
        const ts = Date.now();

        let records = await getAllRecords();
        records = upsertRecord(records, { domain, type, path, ts });
        await saveAllRecords(records);

        return sendResponse({ ok: true });
      }

      // 2) Read all for dashboard
      if (msg?.kind === "PI_GET_ALL") {
        const records = await getAllRecords();
        return sendResponse({ ok: true, records });
      }

      // 3) Delete one record
      if (msg?.kind === "PI_DELETE_RECORD") {
        const id = msg?.id;
        if (!id) return sendResponse({ ok: false });

        let records = await getAllRecords();
        records = records.filter(r => r.id !== id);
        await saveAllRecords(records);

        return sendResponse({ ok: true });
      }

      // 4) Update one record
      if (msg?.kind === "PI_UPDATE_RECORD") {
        const id = msg?.id;
        const patch = msg?.patch && typeof msg.patch === "object" ? msg.patch : null;
        if (!id || !patch) return sendResponse({ ok: false });

        let records = await getAllRecords();
        records = records.map(r => (r.id === id ? { ...r, ...patch } : r));
        await saveAllRecords(records);

        return sendResponse({ ok: true });
      }

      // 5) Import records (CSV import -> EMAIL entries)
      if (msg?.kind === "PI_IMPORT_RECORDS") {
        const incoming = Array.isArray(msg.records) ? msg.records : [];
        let records = await getAllRecords();

        for (const inc of incoming) {
          const domain = (inc.domain || "").toLowerCase().replace(/^www\./, "");
          const type = inc.type === "CARD" ? "CARD" : "EMAIL";
          if (!domain) continue;

          const ts = inc.lastSeen || inc.firstSeen || Date.now();
          const path = (Array.isArray(inc.paths) && inc.paths[0]) ? inc.paths[0] : "";

          records = upsertRecord(records, { domain, type, path, ts });

          const idx = records.findIndex(r => r.domain === domain && r.type === type);
          if (idx >= 0) {
            if (inc.status) records[idx].status = inc.status;
            if (inc.notes) records[idx].notes = inc.notes;
          }
        }

        await saveAllRecords(records);
        return sendResponse({ ok: true });
      }

      // 6) Clear all
      if (msg?.kind === "PI_CLEAR_ALL") {
        await saveAllRecords([]);
        return sendResponse({ ok: true });
      }

      return sendResponse({ ok: false });
    } catch (e) {
      return sendResponse({ ok: false, error: String(e) });
    }
  })();

  return true;
});
