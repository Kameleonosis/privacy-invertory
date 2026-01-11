console.log("PI content loaded:", location.href);
chrome.runtime.sendMessage({ kind: "PI_PING", url: location.href }, () => {});

const COOLDOWN_MS = 2000;
let lastSent = { EMAIL: 0, CARD: 0 };

function now() { return Date.now(); }

function safeLower(v) {
  return ((v || "") + "").toLowerCase();
}

function isInput(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function isLikelyEmailInput(el) {
  if (!isInput(el)) return false;

  const type = safeLower(el.getAttribute("type"));
  const name = safeLower(el.getAttribute("name"));
  const id = safeLower(el.getAttribute("id"));
  const ac = safeLower(el.getAttribute("autocomplete"));
  const placeholder = safeLower(el.getAttribute("placeholder"));

  return (
    type === "email" ||
    ac === "email" ||
    name.includes("email") ||
    id.includes("email") ||
    placeholder.includes("email")
  );
}

function isLikelyCardInput(el) {
  if (!isInput(el)) return false;

  const ac = safeLower(el.getAttribute("autocomplete"));
  const type = safeLower(el.getAttribute("type"));
  const name = safeLower(el.getAttribute("name"));
  const id = safeLower(el.getAttribute("id"));
  const placeholder = safeLower(el.getAttribute("placeholder"));

  if (ac.startsWith("cc-")) return true;

  const s = `${name} ${id} ${placeholder}`;

  // paznja: "cc" ponekad znači country code -> smanjimo false positive
  const hasStrong =
    s.includes("card") || s.includes("cvc") || s.includes("cvv") || s.includes("pan") || s.includes("expiry") || s.includes("exp");

  const hasCCButNotCountryCode =
    s.includes("cc") && !s.includes("country") && !s.includes("calling") && !s.includes("code");

  if (hasStrong || hasCCButNotCountryCode) return true;

  if ((type === "tel" || type === "text" || type === "number") && (hasStrong || hasCCButNotCountryCode)) return true;

  return false;
}

function scanRoot(root) {
  const inputs = Array.from(root.querySelectorAll("input, textarea"));
  const hasEmail = inputs.some(isLikelyEmailInput);
  const hasCard = inputs.some(isLikelyCardInput);
  return { hasEmail, hasCard };
}

function getBestRootFromTarget(target) {
  if (!target) return document;

  // 1) ako klik dolazi iz forme, uzmi form
  const form = target.closest ? target.closest("form") : null;
  if (form) return form;

  // 2) ako nije u formi, uzmi najbliži container (do 5 nivoa)
  let el = target;
  for (let i = 0; i < 5 && el; i++) {
    if (el.querySelectorAll) {
      const { hasEmail, hasCard } = scanRoot(el);
      if (hasEmail || hasCard) return el;
    }
    el = el.parentElement;
  }

  // 3) fallback: ceo dokument
  return document;
}

function shouldSend(type) {
  const t = now();
  if (t - lastSent[type] < COOLDOWN_MS) return false;
  lastSent[type] = t;
  return true;
}

function sendIfDetected(root) {
  const { hasEmail, hasCard } = scanRoot(root);
  const url = window.location.href;

  if (hasEmail && shouldSend("EMAIL")) {
    chrome.runtime.sendMessage({ kind: "PI_ADD_EVENT", type: "EMAIL", url });
  }
  if (hasCard && shouldSend("CARD")) {
    chrome.runtime.sendMessage({ kind: "PI_ADD_EVENT", type: "CARD", url });
  }
}

// 1) Klasični submit (radi za sirotin login)
document.addEventListener("submit", (e) => {
  try {
    const form = e.target;
    if (!form || form.tagName !== "FORM") return;
    sendIfDetected(form);
  } catch {}
}, true);

// 2) Klik na dugme (Register često ide AJAX i ne pali submit)
document.addEventListener("click", (e) => {
  try {
    const t = e.target;
    if (!t) return;

    // hvatamo click na button ili element koji izgleda kao dugme
    const btn = t.closest ? t.closest('button, input[type="submit"], input[type="button"], [role="button"]') : null;
    if (!btn) return;

    // heuristika: ako dugme izgleda kao login/register/continue, skeniraj
    const txt = safeLower(btn.innerText || btn.value || btn.getAttribute("aria-label") || "");
    if (
      txt.includes("register") || txt.includes("sign up") || txt.includes("create") ||
      txt.includes("prijav") || txt.includes("login") || txt.includes("ulog") ||
      txt.includes("registr") || txt.includes("nastavi") || txt.includes("continue") ||
      txt.includes("submit") || txt.includes("confirm") || txt.includes("potvrdi")
    ) {
      const root = getBestRootFromTarget(btn);
      sendIfDetected(root);
      return;
    }

    // i bez teksta, ako je type=submit skeniraj formu
    const type = safeLower(btn.getAttribute("type"));
    if (type === "submit") {
      const root = getBestRootFromTarget(btn);
      sendIfDetected(root);
    }
  } catch {}
}, true);

// 3) Enter (mnogo formi šalje Enter bez submit eventa)
document.addEventListener("keydown", (e) => {
  try {
    if (e.key !== "Enter") return;
    const t = e.target;
    if (!t) return;

    // ako je fokus na input polju, skeniraj njegovu formu ili container
    const root = getBestRootFromTarget(t);
    sendIfDetected(root);
  } catch {}
}, true);
