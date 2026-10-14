// Utilidades compartidas por la app y el panel.
(function () {
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });
  const dateTimeFmt = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtDate = (s) => (s ? dateFmt.format(new Date(s)) : "");
  const fmtDateTime = (s) => (s ? dateTimeFmt.format(new Date(s)) : "");

  function youtubeId(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\.|^m\./, "");
      if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
      if (host === "youtube.com" || host === "youtube-nocookie.com") {
        if (u.searchParams.get("v")) return u.searchParams.get("v");
        const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/?#]+)/);
        if (m) return m[2];
      }
    } catch (e) {}
    return null;
  }

  let toastTimer;
  function toast(msg, kind) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = "toast"), 3200);
  }

  // Bloquea un botón mientras dura una operación.
  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    try { return await fn(); }
    finally { if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); } }
  }

  window.HF = { store, esc, fmtDate, fmtDateTime, youtubeId, toast, busy };
})();
