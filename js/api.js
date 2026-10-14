// Capa de acceso a datos. Habla con las funciones hf_* de Supabase,
// o con una simulación local cuando no hay configuración (modo demo).
(function () {
  const cfg = window.HORAFIT_CONFIG || {};
  const DEMO = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY;

  class ApiError extends Error {
    constructor(message, { expired = false, network = false } = {}) {
      super(message);
      this.expired = expired;
      this.network = network;
    }
  }

  async function remote(fn, args) {
    let res;
    try {
      res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(args || {}),
      });
    } catch (e) {
      throw new ApiError("No hay conexión. Comprueba internet y vuelve a probar.", { network: true });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const msg = (data && data.message) || "Error del servidor (" + res.status + ").";
      if (msg === "SESSION_EXPIRED") {
        throw new ApiError((data && data.hint) || "La sesión ha caducado. Vuelve a entrar.", { expired: true });
      }
      throw new ApiError(msg);
    }
    if (data && typeof data === "object" && !Array.isArray(data) && data.error) {
      throw new ApiError(data.error);
    }
    return data;
  }

  // ------------------------------------------------------------------
  //  Simulación local (modo demostración)
  // ------------------------------------------------------------------
  const DEMO_KEY = "horafit-demo-db-v1";
  const SAMPLE = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/";
  function seed() {
    const now = new Date().toISOString();
    const c = { id: uid(), name: "Demo", password: "demo123", active: true, created_at: now };
    return {
      companies: [c],
      users: [{ id: uid(), company_id: c.id, username: "ana", display_name: "Ana", password: "demo123", active: true, created_at: now }],
      admins: [{ id: uid(), username: "admin", password: "admin123" }],
      videos: [
        ["Vídeo de prueba 1", "Sustitúyelo por tu calentamiento desde el panel de administración.", "ForBiggerBlazes.mp4", "Calentamiento", 10],
        ["Vídeo de prueba 2", "Sustitúyelo por un ejercicio de movilidad.", "ForBiggerEscapes.mp4", "Movilidad", 20],
        ["Vídeo de prueba 3", "Sustitúyelo por un ejercicio de fuerza.", "ForBiggerJoyrides.mp4", "Fuerza", 30],
        ["Vídeo de prueba 4", "Sustitúyelo por tus estiramientos finales.", "ForBiggerFun.mp4", "Estiramientos", 40],
      ].map(([title, description, file, category, sort_order]) => ({
        id: uid(), title, description, url: SAMPLE + file, category, sort_order, active: true, created_at: now,
      })),
      views: [],
      sessions: [],
    };
  }
  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
  }
  function load() {
    try { const d = JSON.parse(localStorage.getItem(DEMO_KEY)); if (d) return d; } catch (e) {}
    const d = seed(); save(d); return d;
  }
  function save(d) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch (e) {} }
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  function session(d, token, kind) {
    const s = d.sessions.find((x) => x.token === token && x.kind === kind);
    if (!s) throw new ApiError("La sesión ha caducado. Vuelve a entrar.", { expired: true });
    return s;
  }
  function pwRule(p) { if (!p || p.length < 6) throw new ApiError("La contraseña debe tener al menos 6 caracteres."); }
  const sortBy = (arr, f) => arr.slice().sort((a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0));

  const mock = {
    hf_company_login(d, a) {
      const c = d.companies.find((x) => same(x.name, a.p_name) && x.active);
      if (!c || c.password !== a.p_password) throw new ApiError("El nombre de empresa o la contraseña no son correctos.");
      const t = uid(); d.sessions.push({ token: t, kind: "company", company_id: c.id });
      return { token: t, company_name: c.name };
    },
    hf_user_login(d, a) {
      const s = session(d, a.p_company_token, "company");
      const u = d.users.find((x) => x.company_id === s.company_id && same(x.username, a.p_username) && x.active);
      if (!u || u.password !== a.p_password) throw new ApiError("El usuario o la contraseña no son correctos.");
      const t = uid(); d.sessions.push({ token: t, kind: "user", company_id: s.company_id, user_id: u.id });
      return { token: t, username: u.username, display_name: u.display_name || u.username };
    },
    hf_logout(d, a) { d.sessions = d.sessions.filter((x) => x.token !== a.p_token); return null; },
    hf_list_videos(d, a) {
      const s = session(d, a.p_user_token, "user");
      return sortBy(d.videos.filter((v) => v.active), (v) => v.sort_order).map((v) => {
        const mine = d.views.filter((w) => w.user_id === s.user_id && w.video_id === v.id);
        return { id: v.id, title: v.title, description: v.description, url: v.url, category: v.category, sort_order: v.sort_order,
          times_completed: mine.length, last_completed_at: mine.length ? mine[mine.length - 1].completed_at : null };
      });
    },
    hf_record_view(d, a) {
      const s = session(d, a.p_user_token, "user");
      const v = d.videos.find((x) => x.id === a.p_video_id && x.active);
      if (!v) throw new ApiError("Ese vídeo ya no está disponible.");
      if (!(a.p_duration_seconds > 0) || a.p_watched_seconds < a.p_duration_seconds * 0.9) throw new ApiError("El vídeo no se ha visto completo.");
      const recent = d.views.some((w) => w.user_id === s.user_id && w.video_id === v.id && Date.now() - Date.parse(w.completed_at) < 10000);
      if (!recent) d.views.push({ id: d.views.length + 1, user_id: s.user_id, company_id: s.company_id, video_id: v.id, video_title: v.title,
        watched_seconds: Math.round(a.p_watched_seconds * 10) / 10, duration_seconds: Math.round(a.p_duration_seconds * 10) / 10,
        completed_at: new Date().toISOString() });
      return { times_completed: d.views.filter((w) => w.user_id === s.user_id && w.video_id === v.id).length };
    },
    hf_admin_login(d, a) {
      const ad = d.admins.find((x) => same(x.username, a.p_username));
      if (!ad || ad.password !== a.p_password) throw new ApiError("El usuario o la contraseña de administración no son correctos.");
      const t = uid(); d.sessions.push({ token: t, kind: "admin", admin_id: ad.id });
      return { token: t, username: ad.username };
    },
    hf_admin_change_password(d, a) {
      const s = session(d, a.p_token, "admin"); const ad = d.admins.find((x) => x.id === s.admin_id);
      if (ad.password !== a.p_old) throw new ApiError("La contraseña actual no es correcta.");
      pwRule(a.p_new); ad.password = a.p_new; return null;
    },
    hf_admin_overview(d, a) {
      session(d, a.p_token, "admin");
      const week = Date.now() - 7 * 864e5;
      return { companies: d.companies.length, users: d.users.length, videos: d.videos.filter((v) => v.active).length,
        views_total: d.views.length, views_7d: d.views.filter((w) => Date.parse(w.completed_at) > week).length };
    },
    hf_admin_companies(d, a) {
      session(d, a.p_token, "admin");
      return sortBy(d.companies, (c) => c.name.toLowerCase()).map((c) => ({ id: c.id, name: c.name, active: c.active, created_at: c.created_at,
        users: d.users.filter((u) => u.company_id === c.id).length, views: d.views.filter((w) => w.company_id === c.id).length }));
    },
    hf_admin_save_company(d, a) {
      session(d, a.p_token, "admin");
      if (!String(a.p_name || "").trim()) throw new ApiError("Escribe el nombre de la empresa.");
      if (d.companies.some((c) => same(c.name, a.p_name) && c.id !== a.p_id)) throw new ApiError("Ya existe una empresa con ese nombre.");
      if (!a.p_id) {
        pwRule(a.p_password);
        const c = { id: uid(), name: a.p_name.trim(), password: a.p_password, active: a.p_active !== false, created_at: new Date().toISOString() };
        d.companies.push(c); return { id: c.id };
      }
      const c = d.companies.find((x) => x.id === a.p_id); if (!c) throw new ApiError("La empresa no existe.");
      if (a.p_password) { pwRule(a.p_password); c.password = a.p_password; }
      c.name = a.p_name.trim(); if (a.p_active != null) c.active = a.p_active;
      if (a.p_password || a.p_active === false) d.sessions = d.sessions.filter((s) => s.company_id !== c.id);
      return { id: c.id };
    },
    hf_admin_delete_company(d, a) {
      session(d, a.p_token, "admin");
      const uids = d.users.filter((u) => u.company_id === a.p_id).map((u) => u.id);
      d.companies = d.companies.filter((c) => c.id !== a.p_id);
      d.users = d.users.filter((u) => u.company_id !== a.p_id);
      d.views = d.views.filter((w) => w.company_id !== a.p_id);
      d.sessions = d.sessions.filter((s) => s.company_id !== a.p_id && !uids.includes(s.user_id));
      return null;
    },
    hf_admin_users(d, a) {
      session(d, a.p_token, "admin");
      return sortBy(d.users.filter((u) => u.company_id === a.p_company_id), (u) => u.username.toLowerCase()).map((u) => {
        const mine = d.views.filter((w) => w.user_id === u.id);
        return { id: u.id, company_id: u.company_id, username: u.username, display_name: u.display_name, active: u.active,
          created_at: u.created_at, views: mine.length, last_view_at: mine.length ? mine[mine.length - 1].completed_at : null };
      });
    },
    hf_admin_save_user(d, a) {
      session(d, a.p_token, "admin");
      if (!String(a.p_username || "").trim()) throw new ApiError("Escribe el nombre de usuario.");
      if (!a.p_id) {
        if (!d.companies.some((c) => c.id === a.p_company_id)) throw new ApiError("La empresa no existe.");
        if (d.users.some((u) => u.company_id === a.p_company_id && same(u.username, a.p_username))) throw new ApiError("Esa empresa ya tiene un usuario con ese nombre.");
        pwRule(a.p_password);
        const u = { id: uid(), company_id: a.p_company_id, username: a.p_username.trim(), display_name: (a.p_display_name || "").trim() || null,
          password: a.p_password, active: a.p_active !== false, created_at: new Date().toISOString() };
        d.users.push(u); return { id: u.id };
      }
      const u = d.users.find((x) => x.id === a.p_id); if (!u) throw new ApiError("El usuario no existe.");
      if (d.users.some((o) => o.company_id === u.company_id && o.id !== u.id && same(o.username, a.p_username))) throw new ApiError("Esa empresa ya tiene un usuario con ese nombre.");
      if (a.p_password) { pwRule(a.p_password); u.password = a.p_password; }
      u.username = a.p_username.trim(); u.display_name = (a.p_display_name || "").trim() || null; if (a.p_active != null) u.active = a.p_active;
      if (a.p_password || a.p_active === false) d.sessions = d.sessions.filter((s) => s.user_id !== u.id);
      return { id: u.id };
    },
    hf_admin_delete_user(d, a) {
      session(d, a.p_token, "admin");
      d.users = d.users.filter((u) => u.id !== a.p_id);
      d.views = d.views.filter((w) => w.user_id !== a.p_id);
      d.sessions = d.sessions.filter((s) => s.user_id !== a.p_id);
      return null;
    },
    hf_admin_videos(d, a) {
      session(d, a.p_token, "admin");
      return sortBy(d.videos, (v) => v.sort_order).map((v) => ({ ...v, views: d.views.filter((w) => w.video_id === v.id).length }));
    },
    hf_admin_save_video(d, a) {
      session(d, a.p_token, "admin");
      if (!String(a.p_title || "").trim()) throw new ApiError("Escribe el título del vídeo.");
      if (!/^https:\/\//i.test(String(a.p_url || "").trim())) throw new ApiError("El enlace del vídeo debe empezar por https://");
      const fields = { title: a.p_title.trim(), description: (a.p_description || "").trim() || null, url: a.p_url.trim(),
        category: (a.p_category || "").trim() || null, sort_order: a.p_sort_order == null ? 100 : a.p_sort_order };
      if (!a.p_id) { const v = { id: uid(), ...fields, active: a.p_active !== false, created_at: new Date().toISOString() }; d.videos.push(v); return { id: v.id }; }
      const v = d.videos.find((x) => x.id === a.p_id); if (!v) throw new ApiError("El vídeo no existe.");
      Object.assign(v, fields); if (a.p_active != null) v.active = a.p_active; return { id: v.id };
    },
    hf_admin_delete_video(d, a) {
      session(d, a.p_token, "admin");
      d.videos = d.videos.filter((v) => v.id !== a.p_id);
      d.views.forEach((w) => { if (w.video_id === a.p_id) w.video_id = null; });
      return null;
    },
    hf_admin_views(d, a) {
      session(d, a.p_token, "admin");
      const from = a.p_from ? Date.parse(a.p_from + "T00:00:00") : null;
      const to = a.p_to ? Date.parse(a.p_to + "T00:00:00") + 864e5 : null;
      return d.views.filter((w) => (!a.p_company_id || w.company_id === a.p_company_id) && (!a.p_user_id || w.user_id === a.p_user_id)
          && (!a.p_video_id || w.video_id === a.p_video_id) && (from == null || Date.parse(w.completed_at) >= from)
          && (to == null || Date.parse(w.completed_at) < to))
        .slice().reverse().slice(0, Math.min(a.p_limit || 500, 5000))
        .map((w) => {
          const c = d.companies.find((x) => x.id === w.company_id) || {}; const u = d.users.find((x) => x.id === w.user_id) || {};
          return { ...w, company_name: c.name, username: u.username, display_name: u.display_name };
        });
    },
  };

  async function demo(fn, args) {
    await new Promise((r) => setTimeout(r, 150));
    const d = load();
    if (!mock[fn]) throw new ApiError("Función desconocida: " + fn);
    const out = mock[fn](d, args || {});
    save(d);
    return JSON.parse(JSON.stringify(out));
  }

  window.HoraFitApi = {
    DEMO,
    ApiError,
    rpc: (fn, args) => (DEMO ? demo(fn, args) : remote(fn, args)),
    resetDemo: () => { try { localStorage.removeItem(DEMO_KEY); } catch (e) {} },
  };
})();
