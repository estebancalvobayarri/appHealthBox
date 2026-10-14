// Hora Fit · app de empleados
(function () {
  const { store, esc, fmtDate, youtubeId, toast, busy } = window.HF;
  const api = window.HoraFitApi;
  const $ = (id) => document.getElementById(id);

  const K_COMPANY = "hf.company";
  const K_USER = "hf.user";
  const K_PENDING = "hf.pending";

  let videos = [];
  let filter = null;

  if (api.DEMO) $("demo-banner").hidden = false;

  // ---------------------------------------------------------------
  //  Navegación entre pantallas
  // ---------------------------------------------------------------
  function show(id) {
    ["screen-company", "screen-user", "screen-home"].forEach((s) => ($(s).hidden = s !== id));
    window.scrollTo(0, 0);
    const first = $(id).querySelector("input");
    if (first && id !== "screen-home") setTimeout(() => first.focus({ preventScroll: true }), 50);
  }

  function route() {
    const company = store.get(K_COMPANY);
    const user = store.get(K_USER);
    if (!company) return show("screen-company");
    if (!user) {
      $("user-company-name").textContent = company.name;
      return show("screen-user");
    }
    show("screen-home");
    loadHome();
  }

  function onExpired(kind) {
    if (kind === "company") { store.del(K_COMPANY); store.del(K_USER); }
    else store.del(K_USER);
    toast("La sesión ha caducado. Vuelve a entrar.", "error");
    closePlayer(true);
    route();
  }

  function formError(form, msg) {
    const el = form.querySelector(".form-error");
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  // ---------------------------------------------------------------
  //  Acceso
  // ---------------------------------------------------------------
  $("form-company").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.name.value.trim(), password = f.password.value;
    if (!name || !password) return formError(f, "Escribe el nombre de la empresa y la contraseña.");
    formError(f, "");
    busy(f.querySelector("button"), async () => {
      try {
        const r = await api.rpc("hf_company_login", { p_name: name, p_password: password });
        store.set(K_COMPANY, { token: r.token, name: r.company_name });
        f.reset();
        route();
      } catch (err) { formError(f, err.message); }
    });
  });

  $("form-user").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const company = store.get(K_COMPANY);
    const username = f.username.value.trim(), password = f.password.value;
    if (!username || !password) return formError(f, "Escribe tu usuario y tu contraseña.");
    formError(f, "");
    busy(f.querySelector("button"), async () => {
      try {
        const r = await api.rpc("hf_user_login", { p_company_token: company.token, p_username: username, p_password: password });
        store.set(K_USER, { token: r.token, username: r.username, display_name: r.display_name });
        f.reset();
        route();
        flushPending();
      } catch (err) {
        if (err.expired) return onExpired("company");
        formError(f, err.message);
      }
    });
  });

  $("btn-change-company").addEventListener("click", () => {
    const c = store.get(K_COMPANY);
    if (c) api.rpc("hf_logout", { p_token: c.token }).catch(() => {});
    store.del(K_COMPANY);
    route();
  });

  $("btn-logout").addEventListener("click", () => {
    const u = store.get(K_USER);
    if (u) api.rpc("hf_logout", { p_token: u.token }).catch(() => {});
    store.del(K_USER);
    route();
  });

  // ---------------------------------------------------------------
  //  Lista de vídeos
  // ---------------------------------------------------------------
  async function loadHome() {
    const company = store.get(K_COMPANY), user = store.get(K_USER);
    $("home-user").textContent = user.display_name || user.username;
    $("home-company").textContent = company.name;
    $("home-hello").textContent = "Hola, " + (user.display_name || user.username).split(" ")[0];
    if (!videos.length) $("video-list").innerHTML = '<li class="empty">Cargando vídeos…</li>';
    try {
      videos = await api.rpc("hf_list_videos", { p_user_token: user.token });
      renderHome();
    } catch (err) {
      if (err.expired) return onExpired("user");
      $("video-list").innerHTML = '<li class="empty"><strong>No se han podido cargar los vídeos</strong>' + esc(err.message) +
        '<br><button class="btn small quiet" type="button" id="btn-retry" style="margin-top:14px">Reintentar</button></li>';
      $("btn-retry").onclick = loadHome;
    }
    renderInstallTip();
  }

  function renderHome() {
    const done = videos.filter((v) => v.times_completed > 0).length;
    $("home-progress-text").textContent = videos.length
      ? (done === videos.length ? "Has completado todos los vídeos. ¡Muy bien!" : `Has completado ${done} de ${videos.length} vídeos.`)
      : "";
    $("home-progress-bar").style.width = videos.length ? (done / videos.length) * 100 + "%" : "0";

    const cats = [...new Set(videos.map((v) => v.category).filter(Boolean))];
    if (filter && !cats.includes(filter)) filter = null;
    $("chips").hidden = cats.length < 2;
    $("chips").innerHTML = [null, ...cats].map((c) =>
      `<button type="button" class="chip" aria-pressed="${c === filter}" data-cat="${esc(c || "")}">${esc(c || "Todos")}</button>`).join("");

    const list = videos.filter((v) => !filter || v.category === filter);
    if (!list.length) {
      $("video-list").innerHTML = '<li class="empty"><strong>Todavía no hay vídeos</strong>Tu responsable los añadirá pronto.</li>';
      return;
    }
    $("video-list").innerHTML = list.map((v) => {
      const yt = youtubeId(v.url);
      const thumb = yt
        ? `<img src="https://i.ytimg.com/vi/${esc(yt)}/hqdefault.jpg" alt="" loading="lazy">`
        : `<video src="${esc(v.url)}#t=1" preload="metadata" muted playsinline tabindex="-1" aria-hidden="true"></video>`;
      const status = v.times_completed > 0
        ? `<span class="status done"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>${v.times_completed === 1 ? "Completado" : "Completado " + v.times_completed + " veces"}</span>`
        : `<span class="status todo">Sin ver</span>`;
      return `<li><button type="button" class="video-item" data-id="${esc(v.id)}">
          <span class="thumb">${thumb}<span class="play"></span></span>
          <span class="meta">${v.category ? `<span class="cat">${esc(v.category)}</span>` : ""}
            <h3>${esc(v.title)}</h3>${status}</span>
        </button></li>`;
    }).join("");
  }

  $("chips").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    filter = b.dataset.cat || null;
    renderHome();
  });

  $("video-list").addEventListener("click", (e) => {
    const b = e.target.closest(".video-item");
    if (b) openPlayer(videos.find((v) => v.id === b.dataset.id));
  });

  // ---------------------------------------------------------------
  //  Seguimiento de lo visto
  //  Se marca cada segundo del vídeo que se reproduce de verdad.
  //  Saltar hacia delante no cuenta; volver a ver un trozo no suma dos veces.
  //  El vídeo cuenta como completado al llegar al final con al menos
  //  el 90 % de sus segundos vistos.
  // ---------------------------------------------------------------
  function makeTracker(onProgress) {
    let seen = null, duration = 0, last = null, covered = 0;
    return {
      tick(t, dur, playing) {
        if (dur > 0 && isFinite(dur) && !seen) { duration = dur; seen = new Uint8Array(Math.ceil(dur) + 1); }
        if (!seen) return;
        if (playing && last != null) {
          const d = t - last;
          if (d > 0 && d <= 1.6) {
            for (let s = Math.floor(last); s <= Math.floor(t); s++) if (!seen[s]) { seen[s] = 1; covered++; }
          }
        }
        last = t;
        onProgress(this.ratio());
      },
      reset() { last = null; },
      ratio() { return seen ? Math.min(covered / Math.ceil(duration), 1) : 0; },
      watchedSeconds() { return Math.min(covered, duration); },
      duration() { return duration; },
    };
  }

  let current = null; // { video, tracker, cleanup, recorded }

  function openPlayer(video) {
    if (!video) return;
    closePlayer(true);
    $("player-title").textContent = video.title;
    $("player-desc").textContent = video.description || "";
    $("player-desc").hidden = !video.description;
    $("done-card").hidden = true;
    setMeter(0);
    $("player").hidden = false;
    document.body.style.overflow = "hidden";
    history.pushState({ player: true }, "");

    const tracker = makeTracker(setMeter);
    current = { video, tracker, recorded: false, cleanup: () => {} };
    const yt = youtubeId(video.url);
    if (yt) mountYouTube(yt, tracker); else mountHtml5(video.url, tracker);
    $("btn-close-player").focus({ preventScroll: true });
  }

  function setMeter(r) {
    const pct = Math.round(r * 100);
    $("watch-bar").style.width = pct + "%";
    if (!current || !current.recorded) {
      $("watch-text").textContent = pct ? `Visto ${pct} %. Míralo hasta el final para que cuente.` : "Míralo hasta el final para que cuente.";
    }
  }

  function mountHtml5(url, tracker) {
    const v = document.createElement("video");
    v.src = url;
    v.controls = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("controlslist", "nodownload noplaybackrate");
    v.disablePictureInPicture = true;
    $("stage").replaceChildren(v);
    v.addEventListener("timeupdate", () => tracker.tick(v.currentTime, v.duration, !v.paused && !v.seeking));
    v.addEventListener("seeking", () => tracker.reset());
    v.addEventListener("ended", () => { tracker.tick(v.duration, v.duration, true); onEnded(); });
    v.addEventListener("error", () => toast("No se puede reproducir este vídeo. Avisa a tu responsable.", "error"));
    v.play().catch(() => {});
    current.cleanup = () => { v.pause(); v.removeAttribute("src"); v.load(); };
  }

  let ytReady;
  function loadYouTubeApi() {
    if (!ytReady) ytReady = new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve();
      window.onYouTubeIframeAPIReady = resolve;
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
    return ytReady;
  }

  function mountYouTube(id, tracker) {
    const holder = document.createElement("div");
    $("stage").replaceChildren(holder);
    let timer = null, player = null, closed = false;
    current.cleanup = () => { closed = true; clearInterval(timer); try { player && player.destroy(); } catch (e) {} };
    loadYouTubeApi().then(() => {
      if (closed) return;
      player = new YT.Player(holder, {
        videoId: id,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 1 },
        events: {
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.ENDED) {
              tracker.tick(player.getDuration(), player.getDuration(), true);
              onEnded();
            }
          },
        },
      });
      timer = setInterval(() => {
        if (!player || !player.getCurrentTime) return;
        const playing = player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING;
        tracker.tick(player.getCurrentTime(), player.getDuration(), playing);
      }, 500);
    });
  }

  function onEnded() {
    if (!current || current.recorded) return;
    const t = current.tracker;
    if (t.ratio() < 0.9) {
      $("watch-text").textContent = "Te has saltado partes del vídeo. Vuelve a reproducirlo y míralo entero para que cuente.";
      return;
    }
    current.recorded = true;
    recordView({ video_id: current.video.id, watched: t.watchedSeconds(), duration: t.duration() });
  }

  async function recordView(view) {
    const user = store.get(K_USER);
    if (!user) return;
    $("watch-text").textContent = "Registrando…";
    try {
      const r = await api.rpc("hf_record_view", {
        p_user_token: user.token, p_video_id: view.video_id,
        p_watched_seconds: view.watched, p_duration_seconds: view.duration,
      });
      markDone(view.video_id, r.times_completed, "Queda registrado.");
    } catch (err) {
      if (err.expired) return onExpired("user");
      if (err.network) {
        const q = store.get(K_PENDING) || [];
        q.push({ ...view, token: user.token, at: Date.now() });
        store.set(K_PENDING, q);
        markDone(view.video_id, null, "No hay conexión: se registrará en cuanto vuelva.");
        return;
      }
      if (current) current.recorded = false;
      $("watch-text").textContent = err.message;
      toast(err.message, "error");
    }
  }

  function markDone(videoId, times, text) {
    const v = videos.find((x) => x.id === videoId);
    if (v) v.times_completed = times != null ? times : (v.times_completed || 0) + 1;
    if (current && current.video.id === videoId) {
      $("done-text").textContent = text;
      $("done-card").hidden = false;
      $("watch-text").textContent = "Visto completo.";
    }
    renderHome();
  }

  // Envía los registros que quedaron pendientes por falta de conexión.
  async function flushPending() {
    const q = store.get(K_PENDING) || [];
    if (!q.length) return;
    const rest = [];
    for (const item of q) {
      try {
        await api.rpc("hf_record_view", { p_user_token: item.token, p_video_id: item.video_id,
          p_watched_seconds: item.watched, p_duration_seconds: item.duration });
      } catch (err) {
        if (err.network) rest.push(item); // se reintenta más tarde; el resto de errores se descarta
      }
    }
    store.set(K_PENDING, rest);
    if (rest.length < q.length && store.get(K_USER)) loadHome();
  }
  window.addEventListener("online", flushPending);

  function closePlayer(silent) {
    if (current) { current.cleanup(); current = null; }
    $("stage").replaceChildren();
    $("player").hidden = true;
    document.body.style.overflow = "";
    if (!silent && history.state && history.state.player) history.back();
  }
  $("btn-close-player").addEventListener("click", () => closePlayer(false));
  window.addEventListener("popstate", () => { if (!$("player").hidden) closePlayer(true); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("player").hidden) closePlayer(false); });

  // ---------------------------------------------------------------
  //  Instalar en la pantalla de inicio
  // ---------------------------------------------------------------
  let installEvent = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; renderInstallTip(); });
  window.addEventListener("appinstalled", () => { installEvent = null; renderInstallTip(); });

  function renderInstallTip() {
    const tip = $("install-tip");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (standalone) { tip.hidden = true; return; }
    if (installEvent) {
      tip.innerHTML = '<strong>Ten Hora Fit a mano.</strong> Instálala en tu pantalla de inicio y ábrela como una app.' +
        '<div style="margin-top:10px"><button class="btn small" type="button" id="btn-install">Instalar Hora Fit</button></div>';
      $("btn-install").onclick = async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; renderInstallTip(); };
      tip.hidden = false;
    } else if (ios) {
      tip.innerHTML = '<strong>Ten Hora Fit a mano.</strong> En Safari, pulsa el botón Compartir y elige «Añadir a pantalla de inicio».';
      tip.hidden = false;
    } else {
      tip.hidden = true;
    }
  }

  // ---------------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  route();
  if (store.get(K_USER)) flushPending();
})();
