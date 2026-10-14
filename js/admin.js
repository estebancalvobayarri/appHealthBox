// Hora Fit · panel de administración
(function () {
  const { store, esc, fmtDate, fmtDateTime, toast, busy } = window.HF;
  const api = window.HoraFitApi;
  const $ = (id) => document.getElementById(id);
  const K_ADMIN = "hf.admin";

  let companies = [];
  let adminVideos = [];
  let usersByCompany = {};
  let selectedCompany = null;
  let viewRows = [];
  let grouped = false;

  if (api.DEMO) $("demo-banner").hidden = false;

  const token = () => (store.get(K_ADMIN) || {}).token;
  async function call(fn, args) {
    try {
      return await api.rpc(fn, { p_token: token(), ...args });
    } catch (err) {
      if (err.expired) { store.del(K_ADMIN); toast("La sesión ha caducado. Vuelve a entrar.", "error"); route(); }
      throw err;
    }
  }
  function formError(form, msg) {
    const el = form.querySelector(".form-error");
    el.textContent = msg || ""; el.hidden = !msg;
  }

  // ---------------------------------------------------------------
  function route() {
    const logged = !!token();
    $("screen-login").hidden = logged;
    $("screen-admin").hidden = !logged;
    if (logged) loadAll();
    else setTimeout(() => $("form-login").username.focus(), 50);
  }

  $("form-login").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.username.value.trim() || !f.password.value) return formError(f, "Escribe tu usuario y tu contraseña.");
    formError(f, "");
    busy(f.querySelector("button"), async () => {
      try {
        const r = await api.rpc("hf_admin_login", { p_username: f.username.value.trim(), p_password: f.password.value });
        store.set(K_ADMIN, { token: r.token, username: r.username });
        f.reset(); route();
      } catch (err) { formError(f, err.message); }
    });
  });

  $("btn-logout").addEventListener("click", () => {
    const t = token();
    if (t) api.rpc("hf_logout", { p_token: t }).catch(() => {});
    store.del(K_ADMIN); route();
  });

  // Pestañas
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab"); if (!b) return;
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t === b;
      t.setAttribute("aria-selected", on);
      $("tab-" + t.dataset.tab).hidden = !on;
    });
  });

  async function loadAll() {
    try {
      const [ov, cs, vs] = await Promise.all([call("hf_admin_overview"), call("hf_admin_companies"), call("hf_admin_videos")]);
      companies = cs; adminVideos = vs;
      renderStats(ov);
      renderFilters();
      renderCompanies();
      renderVideos();
      await loadViews();
    } catch (err) { if (!err.expired) toast(err.message, "error"); }
  }

  function renderStats(o) {
    const items = [[o.views_7d, "vídeos completados esta semana"], [o.views_total, "vídeos completados en total"],
      [o.companies, o.companies === 1 ? "empresa" : "empresas"], [o.users, o.users === 1 ? "usuario" : "usuarios"],
      [o.videos, "vídeos publicados"]];
    $("stats").innerHTML = items.map(([n, l]) => `<div class="stat"><b>${Number(n).toLocaleString("es-ES")}</b><span>${l}</span></div>`).join("");
  }
  async function refreshStats() { try { renderStats(await call("hf_admin_overview")); } catch (e) {} }

  // ---------------------------------------------------------------
  //  Registro de visualizaciones
  // ---------------------------------------------------------------
  function options(list, all, val, label) {
    return `<option value="">${all}</option>` + list.map((x) => `<option value="${esc(x.id)}"${x.id === val ? " selected" : ""}>${esc(label(x))}</option>`).join("");
  }
  function renderFilters() {
    const cv = $("f-company").value, vv = $("f-video").value;
    $("f-company").innerHTML = options(companies, "Todas", cv, (c) => c.name);
    $("f-video").innerHTML = options(adminVideos, "Todos", vv, (v) => v.title);
    renderUserFilter();
  }
  async function renderUserFilter() {
    const cid = $("f-company").value, uv = $("f-user").value;
    if (!cid) { $("f-user").innerHTML = '<option value="">Elige antes una empresa</option>'; $("f-user").disabled = true; return; }
    $("f-user").disabled = false;
    const users = await getUsers(cid);
    $("f-user").innerHTML = options(users, "Todos", uv, (u) => u.display_name ? `${u.display_name} (${u.username})` : u.username);
  }
  async function getUsers(cid, force) {
    if (force || !usersByCompany[cid]) usersByCompany[cid] = await call("hf_admin_users", { p_company_id: cid });
    return usersByCompany[cid];
  }

  $("f-company").addEventListener("change", async () => { $("f-user").value = ""; await renderUserFilter(); loadViews(); });
  ["f-user", "f-video", "f-from", "f-to"].forEach((id) => $(id).addEventListener("change", loadViews));

  async function loadViews() {
    $("views-table").innerHTML = '<p class="muted">Cargando…</p>';
    try {
      viewRows = await call("hf_admin_views", {
        p_company_id: $("f-company").value || null, p_user_id: $("f-user").value || null,
        p_video_id: $("f-video").value || null, p_from: $("f-from").value || null, p_to: $("f-to").value || null, p_limit: 5000,
      });
      renderViews();
    } catch (err) { if (!err.expired) $("views-table").innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
  }

  const person = (r) => r.display_name ? `${r.display_name} <span class="sub">${esc(r.username)}</span>` : esc(r.username);

  function renderViews() {
    $("btn-group").setAttribute("aria-pressed", grouped);
    $("btn-group").textContent = grouped ? "Ver lista completa" : "Ver resumen por persona";
    if (!viewRows.length) {
      $("views-title").textContent = "Visualizaciones completas";
      $("views-table").innerHTML = '<p class="empty"><strong>No hay visualizaciones con estos filtros</strong>Aparecerán aquí cuando alguien vea un vídeo hasta el final.</p>';
      return;
    }
    $("views-title").textContent = `${viewRows.length.toLocaleString("es-ES")} ${viewRows.length === 1 ? "visualización completa" : "visualizaciones completas"}`;
    if (!grouped) {
      $("views-table").innerHTML = `<table><thead><tr><th>Fecha y hora</th><th>Empresa</th><th>Usuario</th><th>Vídeo</th></tr></thead><tbody>` +
        viewRows.map((r) => `<tr><td>${esc(fmtDateTime(r.completed_at))}</td><td>${esc(r.company_name)}</td><td>${person(r)}</td><td>${esc(r.video_title)}</td></tr>`).join("") +
        `</tbody></table>`;
    } else {
      const map = new Map();
      viewRows.forEach((r) => {
        const k = r.user_id;
        if (!map.has(k)) map.set(k, { ...r, total: 0, videos: new Set(), last: r.completed_at });
        const g = map.get(k); g.total++; g.videos.add(r.video_title);
        if (r.completed_at > g.last) g.last = r.completed_at;
      });
      const rows = [...map.values()].sort((a, b) => b.total - a.total);
      $("views-table").innerHTML = `<table><thead><tr><th>Usuario</th><th>Empresa</th><th class="num">Vídeos completados</th><th class="num">Vídeos distintos</th><th>Último</th></tr></thead><tbody>` +
        rows.map((g) => `<tr><td>${person(g)}</td><td>${esc(g.company_name)}</td><td class="num">${g.total}</td><td class="num">${g.videos.size}</td><td>${esc(fmtDateTime(g.last))}</td></tr>`).join("") +
        `</tbody></table>`;
    }
  }
  $("btn-group").addEventListener("click", () => { grouped = !grouped; renderViews(); });

  $("btn-csv").addEventListener("click", () => {
    if (!viewRows.length) return toast("No hay datos que descargar con estos filtros.");
    const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const head = ["Fecha", "Hora", "Empresa", "Usuario", "Nombre", "Vídeo", "Segundos vistos", "Duración (s)"];
    const lines = viewRows.map((r) => {
      const d = new Date(r.completed_at);
      return [d.toLocaleDateString("es-ES"), d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), r.company_name,
        r.username, r.display_name || "", r.video_title, String(r.watched_seconds ?? "").replace(".", ","), String(r.duration_seconds ?? "").replace(".", ",")].map(cell).join(";");
    });
    const blob = new Blob(["﻿" + [head.map(cell).join(";"), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `horafit-registro-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  // ---------------------------------------------------------------
  //  Diálogos de edición
  // ---------------------------------------------------------------
  function editDialog(dlg, { title, values, passwordHint, onSave }) {
    const f = dlg.querySelector("form");
    f.reset(); formError(f, "");
    dlg.querySelector("h2").textContent = title;
    Object.entries(values).forEach(([k, v]) => {
      const el = f.elements[k]; if (!el) return;
      if (el.type === "checkbox") el.checked = !!v; else el.value = v == null ? "" : v;
    });
    const hint = f.password && f.password.parentElement.querySelector("small");
    if (hint) hint.textContent = passwordHint || "";
    f.onsubmit = (e) => {
      if (e.submitter && e.submitter.value === "cancel") return;
      e.preventDefault();
      const data = {};
      [...f.elements].forEach((el) => { if (el.name) data[el.name] = el.type === "checkbox" ? el.checked : el.value; });
      busy(e.submitter, async () => {
        try { await onSave(data); dlg.close(); }
        catch (err) { formError(f, err.message); }
      });
    };
    dlg.showModal();
    const first = f.querySelector("input"); if (first) first.focus();
  }

  // ---------------------------------------------------------------
  //  Empresas y usuarios
  // ---------------------------------------------------------------
  function renderCompanies() {
    if (!companies.length) {
      $("company-list").innerHTML = '<li class="empty"><strong>Aún no hay empresas</strong>Crea la primera para dar acceso a sus empleados.</li>';
      $("company-detail").innerHTML = '<p class="muted">Crea una empresa y después añade sus usuarios.</p>';
      return;
    }
    if (!companies.some((c) => c.id === selectedCompany)) selectedCompany = companies[0].id;
    $("company-list").innerHTML = companies.map((c) => `<li><button type="button" data-id="${esc(c.id)}" aria-current="${c.id === selectedCompany}">
        <span><strong>${esc(c.name)}</strong><span class="sub muted" style="display:block;font-size:13px">${c.users} ${c.users === 1 ? "usuario" : "usuarios"} · ${c.views} vídeos completados</span></span>
        ${c.active ? "" : '<span class="pill">Desactivada</span>'}</button></li>`).join("");
    renderCompanyDetail();
  }

  $("company-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]"); if (!b) return;
    selectedCompany = b.dataset.id; renderCompanies();
  });

  async function renderCompanyDetail() {
    const c = companies.find((x) => x.id === selectedCompany); if (!c) return;
    const box = $("company-detail");
    box.innerHTML = `<div class="panel-head"><h2>${esc(c.name)}</h2>
      <div class="row-actions"><button class="btn small quiet" type="button" data-act="edit-company">Editar empresa</button>
      <button class="btn small" type="button" data-act="new-user">Nuevo usuario</button></div></div>
      <div class="table-scroll" id="user-table"><p class="muted">Cargando…</p></div>
      <p style="margin-top:22px"><button class="btn small danger" type="button" data-act="delete-company">Borrar empresa</button></p>`;
    try {
      const users = await getUsers(c.id, true);
      if (selectedCompany !== c.id) return;
      $("user-table").innerHTML = users.length
        ? `<table><thead><tr><th>Usuario</th><th class="num">Completados</th><th>Último vídeo</th><th></th></tr></thead><tbody>` +
          users.map((u) => `<tr class="${u.active ? "" : "off"}"><td>${u.display_name ? `${esc(u.display_name)}<span class="sub">${esc(u.username)}</span>` : esc(u.username)}
              ${u.active ? "" : ' <span class="pill">Desactivado</span>'}</td>
            <td class="num">${u.views}</td><td>${u.last_view_at ? esc(fmtDate(u.last_view_at)) : '<span class="muted">Nunca</span>'}</td>
            <td><div class="row-actions"><button class="btn small quiet" type="button" data-act="edit-user" data-id="${esc(u.id)}">Editar</button>
              <button class="btn small danger" type="button" data-act="delete-user" data-id="${esc(u.id)}">Borrar</button></div></td></tr>`).join("") +
          `</tbody></table>`
        : '<p class="empty"><strong>Esta empresa no tiene usuarios</strong>Añade uno con «Nuevo usuario».</p>';
    } catch (err) { if (!err.expired) $("user-table").innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
  }

  async function afterCompanyChange() {
    companies = await call("hf_admin_companies");
    renderCompanies(); renderFilters(); refreshStats();
  }

  $("btn-new-company").addEventListener("click", () => editDialog($("dlg-company"), {
    title: "Nueva empresa", values: { active: true },
    passwordHint: "Al menos 6 caracteres. Se la darás a los empleados junto con el nombre.",
    onSave: async (d) => {
      const r = await call("hf_admin_save_company", { p_id: null, p_name: d.name, p_password: d.password, p_active: d.active });
      selectedCompany = r.id; await afterCompanyChange(); toast("Empresa creada.", "ok");
    },
  }));

  $("company-detail").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const c = companies.find((x) => x.id === selectedCompany);
    const users = usersByCompany[selectedCompany] || [];
    const u = users.find((x) => x.id === b.dataset.id);
    switch (b.dataset.act) {
      case "edit-company":
        return editDialog($("dlg-company"), {
          title: "Editar empresa", values: { name: c.name, active: c.active },
          passwordHint: "Déjala vacía para no cambiarla. Si la cambias, todos los dispositivos de esta empresa tendrán que volver a entrar.",
          onSave: async (d) => {
            await call("hf_admin_save_company", { p_id: c.id, p_name: d.name, p_password: d.password || null, p_active: d.active });
            await afterCompanyChange(); toast("Empresa guardada.", "ok");
          },
        });
      case "delete-company":
        if (!confirm(`¿Borrar «${c.name}»?\n\nSe borrarán también sus ${c.users} usuarios y todo su registro de visualizaciones. No se puede deshacer.\n\nSi solo quieres impedir el acceso, edita la empresa y desactívala.`)) return;
        try { await call("hf_admin_delete_company", { p_id: c.id }); delete usersByCompany[c.id]; await afterCompanyChange(); loadViews(); toast("Empresa borrada.", "ok"); }
        catch (err) { if (!err.expired) toast(err.message, "error"); }
        return;
      case "new-user":
        return editDialog($("dlg-user"), {
          title: `Nuevo usuario en ${c.name}`, values: { active: true }, passwordHint: "Al menos 6 caracteres.",
          onSave: async (d) => {
            await call("hf_admin_save_user", { p_id: null, p_company_id: c.id, p_username: d.username, p_display_name: d.display_name, p_password: d.password, p_active: d.active });
            await afterCompanyChange(); toast("Usuario creado.", "ok");
          },
        });
      case "edit-user":
        return editDialog($("dlg-user"), {
          title: "Editar usuario", values: { username: u.username, display_name: u.display_name, active: u.active },
          passwordHint: "Déjala vacía para no cambiarla.",
          onSave: async (d) => {
            await call("hf_admin_save_user", { p_id: u.id, p_company_id: c.id, p_username: d.username, p_display_name: d.display_name, p_password: d.password || null, p_active: d.active });
            await afterCompanyChange(); toast("Usuario guardado.", "ok");
          },
        });
      case "delete-user":
        if (!confirm(`¿Borrar el usuario «${u.username}»?\n\nSe borrará también su registro de visualizaciones. No se puede deshacer.\n\nSi solo quieres impedir el acceso, edítalo y desactívalo.`)) return;
        try { await call("hf_admin_delete_user", { p_id: u.id }); await afterCompanyChange(); loadViews(); toast("Usuario borrado.", "ok"); }
        catch (err) { if (!err.expired) toast(err.message, "error"); }
        return;
    }
  });

  // ---------------------------------------------------------------
  //  Vídeos
  // ---------------------------------------------------------------
  function renderVideos() {
    $("cat-options").innerHTML = [...new Set(adminVideos.map((v) => v.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
    $("video-table").innerHTML = adminVideos.length
      ? `<table><thead><tr><th class="num">Orden</th><th>Título</th><th>Tipo</th><th class="num">Completados</th><th>Estado</th><th></th></tr></thead><tbody>` +
        adminVideos.map((v) => `<tr class="${v.active ? "" : "off"}"><td class="num">${v.sort_order}</td>
          <td>${esc(v.title)}<span class="sub"><a href="${esc(v.url)}" target="_blank" rel="noopener">Abrir enlace</a></span></td>
          <td>${esc(v.category || "")}</td><td class="num">${v.views}</td>
          <td>${v.active ? '<span class="pill on">Visible</span>' : '<span class="pill">Oculto</span>'}</td>
          <td><div class="row-actions"><button class="btn small quiet" type="button" data-act="edit" data-id="${esc(v.id)}">Editar</button>
            <button class="btn small danger" type="button" data-act="delete" data-id="${esc(v.id)}">Borrar</button></div></td></tr>`).join("") +
        `</tbody></table>`
      : '<p class="empty"><strong>No hay vídeos</strong>Añade el primero con «Añadir vídeo».</p>';
  }

  async function afterVideoChange() {
    adminVideos = await call("hf_admin_videos");
    renderVideos(); renderFilters(); refreshStats();
  }

  const saveVideo = (id) => async (d) => {
    await call("hf_admin_save_video", { p_id: id, p_title: d.title, p_description: d.description, p_url: d.url,
      p_category: d.category, p_sort_order: d.sort_order === "" ? null : parseInt(d.sort_order, 10), p_active: d.active });
    await afterVideoChange(); toast(id ? "Vídeo guardado." : "Vídeo añadido.", "ok");
  };

  $("btn-new-video").addEventListener("click", () => {
    const next = adminVideos.reduce((m, v) => Math.max(m, v.sort_order), 0) + 10;
    editDialog($("dlg-video"), { title: "Añadir vídeo", values: { active: true, sort_order: next }, onSave: saveVideo(null) });
  });

  $("video-table").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const v = adminVideos.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === "edit") {
      editDialog($("dlg-video"), { title: "Editar vídeo", values: v, onSave: saveVideo(v.id) });
    } else if (b.dataset.act === "delete") {
      if (!confirm(`¿Borrar «${v.title}»?\n\nEl registro de quién lo vio se conserva. Si solo quieres quitarlo de la app, edítalo y desmarca «Visible».`)) return;
      try { await call("hf_admin_delete_video", { p_id: v.id }); await afterVideoChange(); toast("Vídeo borrado.", "ok"); }
      catch (err) { if (!err.expired) toast(err.message, "error"); }
    }
  });

  // ---------------------------------------------------------------
  //  Mi cuenta
  // ---------------------------------------------------------------
  $("form-password").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target; formError(f, "");
    busy(f.querySelector("button"), async () => {
      try { await call("hf_admin_change_password", { p_old: f.old.value, p_new: f.new.value }); f.reset(); toast("Contraseña cambiada.", "ok"); }
      catch (err) { if (!err.expired) formError(f, err.message); }
    });
  });

  route();
})();
