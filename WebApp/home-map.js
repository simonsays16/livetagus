/* ============================================================================
 * home-map.js  ·  LiveTagus
 * Mini-mapa ao vivo (display-only) para a homepage.
 *
 * <script src="/home-map.js" defer></script>   (CSP: script-src 'self')
 *
 * - Não bloqueante: mostra skeleton e só carrega o MapLibre quando o cartão
 *   entra no ecrã (IntersectionObserver) — biblioteca via /maplibre-gl.js
 *   (mesma origem, já permitido pela CSP).
 * - Sem zoom/pan: o mapa é apenas visual (interactive:false + pointer-events
 *   none); clicar/tocar no cartão leva a /mapa.
 * - Posições reais: fetch a cada 10s a /v2/fertagus/vehicle-positions, com
 *   marcadores HTML/CSS (bolinha + seta que roda pelo bearing) e glide suave.
 *
 * Markup esperado (ver snippet no fim do ficheiro):
 *   #home-map-card  → o <a href="/mapa"> contentor
 *   #home-map       → a <div> do mapa
 *   #home-map-skeleton → estado de carregamento
 * ========================================================================== */
(function () {
  "use strict";

  const CFG = {
    cardSel: "#home-map-card",
    mapSel: "#home-map",
    skeletonSel: "#home-map-skeleton",
    positionsURL: "https://api.livetagus.pt/v2/fertagus/vehicle-positions",
    lineURL: "/json/fertagus_line.json", // opcional (desenha a linha)
    tileURL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    pollMs: 10000,
    glideMs: 1200,
    // enquadramento da Linha Fertagus (fallback se o GeoJSON não carregar)
    bounds: [
      [-9.18, 38.5],
      [-8.85, 38.78],
    ],
    brand: "#10b981",
    glow: "rgba(16,185,129,.55)",
    frontSrc: "/imagens/front_fertagus.svg", // frente do comboio (igual ao mapa)
    markerSize: 34, // px — tamanho do disco (40 no mapa; um pouco menor no card)
    redirect: "/mapa",
  };

  const card = document.querySelector(CFG.cardSel);
  const mapEl = document.querySelector(CFG.mapSel);
  if (!card || !mapEl) return; // markup não presente → não faz nada

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // geometria do marcador (proporções do mapa real: 40px disco, seta a 30px)
  const MK = CFG.markerSize;
  const MK_FRONT = Math.round(MK * 0.15); // inset da frente
  const MK_ARROW = Math.round(MK * 0.55); // tamanho da seta
  const MK_OUT = Math.round(MK * 0.72); // distância da seta ao centro
  let map = null;
  let started = false;
  let pollT = null;
  const markers = new Map(); // id → { marker, arrow, cur, target, raf, bearing }

  /* ----------------------- CSS dos marcadores ----------------------------- */
  function injectCSS() {
    if (document.getElementById("lt-hm-style")) return;
    const s = document.createElement("style");
    s.id = "lt-hm-style";
    s.textContent = `
      ${CFG.mapSel}{ pointer-events:none; } /* mapa só visual → clique vai p/ o cartão */
      ${CFG.mapSel} .maplibregl-canvas{ outline:none; }

      /* marcador igual ao do mapa: disco com anel verde + frente + seta */
      .lt-hm-mk{ position:relative; width:${MK}px; height:${MK}px; will-change:transform; }
      .lt-hm-disc{ position:absolute; inset:0; }
      .lt-hm-ring{
        position:absolute; inset:0; border-radius:50%;
        border:2.5px solid ${CFG.brand}; background:#fff;
        box-shadow:0 0 0 2px rgba(255,255,255,.85), 0 0 14px ${CFG.glow}, 0 1px 4px rgba(0,0,0,.2);
      }
      html.dark .lt-hm-ring{
        background:#09090b;
        box-shadow:0 0 0 2px rgba(9,9,11,.85), 0 0 16px ${CFG.glow}, 0 1px 6px rgba(0,0,0,.5);
      }
      .lt-hm-front{ position:absolute; inset:${MK_FRONT}px; display:flex; align-items:center; justify-content:center; }
      .lt-hm-front-img{ width:100%; height:100%; object-fit:contain; display:block; }
      /* fallback (igual ao mapa) se o svg não carregar */
      .lt-hm-fallback{
        width:${Math.round(MK * 0.5)}px; height:${Math.round(MK * 0.5)}px; display:block; position:relative;
        background:linear-gradient(180deg,#3b82f6 0%,#1e40af 100%); border-radius:4px 4px 6px 6px;
      }
      .lt-hm-fallback::before, .lt-hm-fallback::after{
        content:""; position:absolute; top:3px; width:4px; height:3px; background:#e0f2fe; border-radius:1px;
      }
      .lt-hm-fallback::before{ left:3px; } .lt-hm-fallback::after{ right:3px; }

      /* seta de direção — orbita o disco e roda pelo bearing (como no mapa) */
      .lt-hm-arrow{
        position:absolute; left:50%; top:50%;
        width:${MK_ARROW}px; height:${MK_ARROW}px; transform-origin:center center;
        transform:translate(-50%,-50%) rotate(-90deg) translateX(${MK_OUT}px);
        transition:transform .45s cubic-bezier(.22,.61,.36,1);
        filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));
      }
      .lt-hm-arrow svg{ width:100%; height:100%; display:block; }
      @media (prefers-reduced-motion: reduce){ .lt-hm-arrow{ transition:none; } }
      .lt-hm-credit{
        position:absolute; right:6px; bottom:6px; z-index:3;
        font:500 9px/1 ui-monospace,monospace; letter-spacing:.02em;
        color:rgba(255,255,255,.9); background:rgba(0,0,0,.42);
        padding:2px 6px; border-radius:999px; pointer-events:auto; text-decoration:none;
        backdrop-filter:blur(4px);
      }
      @media (prefers-reduced-motion: reduce){ .lt-hm-mk-arrow{ transition:none; } }
    `;
    document.head.appendChild(s);
  }

  /* ------------------------- lazy-load MapLibre --------------------------- */
  function loadMapLibre() {
    return new Promise((resolve, reject) => {
      if (window.maplibregl) return resolve();
      if (!document.querySelector("link[data-mlgl]")) {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = "/maplibre-gl.css";
        l.setAttribute("data-mlgl", "1");
        document.head.appendChild(l);
      }
      let s = document.querySelector("script[data-mlgl]");
      if (!s) {
        s = document.createElement("script");
        s.src = "/maplibre-gl.js";
        s.defer = true;
        s.setAttribute("data-mlgl", "1");
        document.head.appendChild(s);
      }
      const done = () =>
        window.maplibregl ? resolve() : reject(new Error("maplibre"));
      if (window.maplibregl) return resolve();
      s.addEventListener("load", done, { once: true });
      s.addEventListener("error", () => reject(new Error("maplibre load")), {
        once: true,
      });
    });
  }

  /* ----------------------------- marcador --------------------------------- */
  function makeMarkerEl() {
    const el = document.createElement("div");
    el.className = "lt-hm-mk";
    el.innerHTML =
      '<div class="lt-hm-disc">' +
      '<div class="lt-hm-ring"></div>' +
      '<div class="lt-hm-front"><img class="lt-hm-front-img" src="' +
      CFG.frontSrc +
      '" alt="" aria-hidden="true"></div>' +
      "</div>" +
      '<div class="lt-hm-arrow">' +
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<polygon points="6,3 21,12 6,21" fill="' +
      CFG.brand +
      '" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"></polygon>' +
      "</svg></div>";
    const arrow = el.querySelector(".lt-hm-arrow");
    const img = el.querySelector(".lt-hm-front-img");
    img.addEventListener("error", () => {
      img.remove();
      const fb = document.createElement("span");
      fb.className = "lt-hm-fallback";
      el.querySelector(".lt-hm-front").appendChild(fb);
    });
    return { el, arrow };
  }

  /* ------------------------- glide (movimento suave) ---------------------- */
  function glide(entry, target) {
    if (reduce || !entry.cur) {
      entry.cur = target;
      entry.marker.setLngLat([target.lng, target.lat]);
      return;
    }
    cancelAnimationFrame(entry.raf);
    const from = { ...entry.cur };
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / CFG.glideMs);
      const e = ease(k);
      const lng = from.lng + (target.lng - from.lng) * e;
      const lat = from.lat + (target.lat - from.lat) * e;
      entry.marker.setLngLat([lng, lat]);
      entry.cur = { lng, lat };
      if (k < 1) entry.raf = requestAnimationFrame(tick);
    };
    entry.raf = requestAnimationFrame(tick);
  }

  function upsert(id, d) {
    let entry = markers.get(id);
    if (!entry) {
      const { el, arrow } = makeMarkerEl();
      const marker = new window.maplibregl.Marker({ element: el })
        .setLngLat([d.lng, d.lat])
        .addTo(map);
      entry = {
        marker,
        arrow,
        cur: { lng: d.lng, lat: d.lat },
        bearing: null,
        raf: 0,
      };
      markers.set(id, entry);
    } else {
      glide(entry, { lng: d.lng, lat: d.lat });
    }
    if (typeof d.bearing === "number" && d.bearing !== entry.bearing) {
      entry.bearing = d.bearing;
      entry.arrow.style.transform =
        "translate(-50%,-50%) rotate(" +
        (d.bearing - 90) +
        "deg) translateX(" +
        MK_OUT +
        "px)";
    }
  }

  /* ------------------------------- fetch ---------------------------------- */
  async function fetchPositions() {
    try {
      const res = await fetch(CFG.positionsURL, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || typeof data !== "object") return;
      const seen = new Set();
      for (const id in data) {
        const d = data[id];
        if (!d || typeof d.lat !== "number" || typeof d.lng !== "number")
          continue;
        seen.add(id);
        upsert(id, d);
      }
      // remover comboios que já não vêm na resposta
      for (const [id, entry] of markers) {
        if (!seen.has(id)) {
          cancelAnimationFrame(entry.raf);
          entry.marker.remove();
          markers.delete(id);
        }
      }

      const liveBadge = document.querySelector(".lt-map-live");
      if (liveBadge) {
        liveBadge.innerHTML = '<span class="o"></span> Em direto: ' + seen.size;
      }
    } catch (_) {
      /* silencioso — tenta de novo no próximo ciclo */
    }
  }

  function startPolling() {
    stopPolling();
    fetchPositions();
    pollT = setInterval(() => {
      if (document.visibilityState === "visible") fetchPositions();
    }, CFG.pollMs);
  }
  function stopPolling() {
    if (pollT) clearInterval(pollT);
    pollT = null;
  }

  /* ----------------------- desenhar a linha (opcional) -------------------- */
  async function drawLine() {
    try {
      const res = await fetch(CFG.lineURL, { cache: "force-cache" });
      if (!res.ok) return null;
      const geo = await res.json();
      map.addSource("ft-line", { type: "geojson", data: geo });
      map.addLayer({
        id: "ft-line-casing",
        type: "line",
        source: "ft-line",
        paint: { "line-color": "#fff", "line-width": 5, "line-opacity": 0.9 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "ft-line",
        type: "line",
        source: "ft-line",
        paint: { "line-color": "#18181b", "line-width": 2.4 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      // bbox p/ enquadrar
      let minX = 180,
        minY = 90,
        maxX = -180,
        maxY = -90;
      const walk = (c) => {
        if (typeof c[0] === "number") {
          minX = Math.min(minX, c[0]);
          maxX = Math.max(maxX, c[0]);
          minY = Math.min(minY, c[1]);
          maxY = Math.max(maxY, c[1]);
        } else c.forEach(walk);
      };
      (geo.features || []).forEach(
        (f) => f.geometry && walk(f.geometry.coordinates),
      );
      if (maxX > minX)
        return [
          [minX, minY],
          [maxX, maxY],
        ];
    } catch (_) {}
    return null;
  }

  /* ------------------------------- init ----------------------------------- */
  async function init() {
    if (started) return;
    started = true;
    injectCSS();

    try {
      await loadMapLibre();
    } catch (_) {
      fail();
      return;
    }

    map = new window.maplibregl.Map({
      container: mapEl,
      interactive: false, // sem zoom/pan/rotação
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [CFG.tileURL],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      bounds: CFG.bounds,
      fitBoundsOptions: { padding: 16, maxZoom: 11 },
    });

    map.on("load", async () => {
      const b = await drawLine();
      if (b)
        map.fitBounds(b, {
          padding: 18,
          maxZoom: 11,
          duration: 0,
          animate: false,
        });

      // crédito OSM (clicável, sem disparar a navegação do cartão)
      const credit = document.createElement("a");
      credit.className = "lt-hm-credit";
      credit.href = "https://www.openstreetmap.org/copyright";
      credit.target = "_blank";
      credit.rel = "noopener";
      credit.textContent = "© OSM";
      credit.addEventListener("click", (e) => e.stopPropagation());
      card.appendChild(credit);

      hideSkeleton();
      startPolling();
    });

    map.on("error", () => {
      /* tiles falhados não devem partir o cartão */
    });

    // pausa/retoma o polling com a visibilidade da página
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (!pollT && map) startPolling();
      } else {
        stopPolling();
      }
    });
  }

  function hideSkeleton() {
    const sk = document.querySelector(CFG.skeletonSel);
    if (sk) {
      sk.style.opacity = "0";
      setTimeout(() => sk.remove(), 400);
    }
  }
  function fail() {
    const sk = document.querySelector(CFG.skeletonSel);
    if (sk) sk.textContent = "Mapa indisponível";
  }

  /* ---------------- arranque: só quando o cartão entra no ecrã ------------ */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            io.disconnect();
            init();
          }
        });
      },
      { rootMargin: "200px" },
    );
    io.observe(card);
  } else {
    init();
  }
})();
