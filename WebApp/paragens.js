/**
 * paragens.js · LiveTagus
 * Página "A Minha Paragem": gerir as paragens da Carris Metropolitana
 * guardadas (as mesmas que aparecem no mapa) e ver as próximas partidas.
 *
 * - A lista e os dados vivem no paragens-guardadas.js (window.LTParagens):
 *   máximo de 25, com as linhas e cores de cada paragem, comprimidas.
 * - Ao abrir a página, todas as guardadas são verificadas e as que precisam
 *   são atualizadas com a API (/stops + /lines).
 * - As partidas só são pedidas quando se abre o desdobrável de uma paragem,
 *   e só se atualizam (a cada 30 s) enquanto ele estiver aberto.
 *
 * Expõe window.LT para o paragens-search.js (pesquisa e mapa do modal).
 */

document.addEventListener("DOMContentLoaded", () => {
  const P = window.LTParagens;
  const CM_API_BASE = "https://api.carrismetropolitana.pt/v2";
  const STOPS_JSON_PATH = "/data/json/stops_cm.json";
  const REFRESH_INTERVAL = 30000;
  const ARRIVALS_LIMIT = 6;

  const form = document.getElementById("add-stop-form");
  const container = document.getElementById("stops-container");
  const refreshBtn = document.getElementById("refresh-stops-btn");
  const counterEl = document.getElementById("stops-counter");
  const syncEl = document.getElementById("stops-sync");
  const btnOpenMap = document.getElementById("btn-open-map");
  const btnCloseMap = document.getElementById("btn-close-map");
  const mapModal = document.getElementById("map-modal");
  const toastEl = document.getElementById("pg-toast");

  let savedStops = P.list();
  let detalhes = new Map(); // id → dados da API (LTParagens)
  const abertas = new Set(); // ids com o desdobrável aberto
  const ultimas = new Map(); // id → HTML das últimas partidas (sem piscar)
  const pedidos = new Map(); // id → AbortController
  let renomear = null; // id em edição

  let mapInstance = null;
  let cmStopsCache = null;
  let geojsonCache = null;
  let fertagusCache = null;
  let fertagusLineCache = null;

  // ─── NAMESPACE PARTILHADO COM paragens-search.js ───
  window.LT = {
    getMapInstance: () => mapInstance,
    getStopsData: () => cmStopsCache,
    getSavedStops: () => savedStops,
    addStop: (id, name, lines) => addStop(id, name, lines),
    closeMapModal: () => closeMapModal(),
    updateMapStopsColor: () => updateMapStopsColor(),
  };

  // ─── UTILITÁRIOS ───
  const esc = (v) =>
    String(v == null ? "" : v).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  function luminancia(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contraste(a, b) {
    const la = luminancia(a);
    const lb = luminancia(b);
    if (la == null || lb == null) return 0;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // Texto da pill: o da Carris se tiver contraste, senão preto ou branco.
  function corTexto(bg, preferida) {
    if (preferida && contraste(bg, preferida) >= 4.5) return preferida;
    return contraste(bg, "#09090b") >= contraste(bg, "#ffffff") ? "#09090b" : "#ffffff";
  }

  function linhaInfo(stopId, lineId) {
    const d = detalhes.get(stopId);
    return (d && d.lines.find((l) => l.id === lineId)) || null;
  }

  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return alert(msg);
    toastEl.textContent = msg;
    toastEl.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 2800);
  }

  function setSync(txt) {
    if (syncEl) syncEl.textContent = txt || "";
  }

  // ─── INICIALIZAÇÃO ───
  lucide.createIcons();
  injectCustomMenuElements();
  renderStops();
  carregarDetalhes().then(verificarTodas);

  // Pré-carregar o catálogo da pesquisa em silêncio
  fetchAllStops().catch(console.error);

  // Só as abertas se atualizam, e só com a página visível.
  setInterval(() => {
    if (!document.hidden) abertas.forEach((id) => fetchArrivals(id));
  }, REFRESH_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) abertas.forEach((id) => fetchArrivals(id));
  });

  // Mudanças vindas de outro lado (mapa noutro separador, sync da API).
  window.addEventListener(P.EVENTO, onListaMudou);
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key.startsWith("cm_saved_stops")) onListaMudou();
  });

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) document.body.classList.add("is-ios");

  new MutationObserver(() => {
    if (mapInstance) setMapTheme();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  async function carregarDetalhes() {
    try {
      detalhes = await P.details();
    } catch (_) {
      detalhes = new Map();
    }
    renderStops();
  }

  // 1.3 — ao abrir a página, verifica todas e atualiza as que precisam.
  async function verificarTodas(force) {
    if (!savedStops.length) return setSync("");
    setSync("A verificar as paragens…");
    try {
      const feitas = await P.sync({ force: !!force });
      setSync(
        feitas.length
          ? `${feitas.length} ${feitas.length === 1 ? "paragem atualizada" : "paragens atualizadas"}`
          : "Paragens verificadas",
      );
    } catch (e) {
      setSync("Sem ligação à Carris: dados das paragens por atualizar");
    }
    setTimeout(() => setSync(""), 4000);
  }

  let onListaTimer = null;
  function onListaMudou() {
    clearTimeout(onListaTimer);
    onListaTimer = setTimeout(async () => {
      savedStops = P.list();
      for (const id of [...abertas])
        if (!savedStops.some((s) => s.id === id)) fecharPartidas(id);
      try {
        detalhes = await P.details();
      } catch (_) {}
      if (!renomear) renderStops();
      updateMapStopsColor();
    }, 30);
  }

  // ─── EVENT LISTENERS ───
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const idInput = document.getElementById("stop-id");
    const stopId = idInput.value.trim();
    if (!stopId) return;

    if (savedStops.length >= P.MAX) {
      toast(`Pode guardar no máximo ${P.MAX} paragens.`);
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerText;
    btn.innerText = "A PROCURAR...";
    btn.disabled = true;

    try {
      const stopsData = await fetchAllStops();
      const stopData = stopsData.find((s) => s.id === stopId);
      if (!stopData) throw new Error("Paragem não encontrada");
      if (addStop(stopId, stopData.n || `Paragem ${stopId}`, stopData.l || []))
        idInput.value = "";
    } catch (err) {
      toast("Paragem não encontrada. Verifique o ID de 6 dígitos.");
    } finally {
      btn.innerText = originalText;
      btn.disabled = false;
    }
  });

  refreshBtn.addEventListener("click", () => {
    const icon = refreshBtn.querySelector("svg, i");
    if (icon) icon.classList.add("animate-spin");
    Promise.allSettled([
      verificarTodas(true),
      ...[...abertas].map((id) => fetchArrivals(id)),
    ]).finally(() => {
      setTimeout(() => icon && icon.classList.remove("animate-spin"), 500);
    });
  });

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    const index = savedStops.findIndex((s) => s.id === id);

    if (action === "toggle-departures") alternarPartidas(id);
    else if (action === "delete-stop") removeStop(id);
    else if (action === "move-up" && index > 0) P.move(index, index - 1);
    else if (action === "move-down" && index > -1 && index < savedStops.length - 1)
      P.move(index, index + 1);
    else if (action === "edit-stop") toggleEditMode(id);
    else if (action === "toggle-line") toggleLineVisibility(id, btn.dataset.line);
    else if (action === "hide-all-lines") setAllLinesVisibility(id, false);
    else if (action === "show-all-lines") setAllLinesVisibility(id, true);
  });

  btnOpenMap.addEventListener("click", openMapModal);
  btnCloseMap.addEventListener("click", closeMapModal);

  // Adicionar a partir do popup do mapa do modal
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-map-add]");
    if (!addBtn) return;
    const id = addBtn.dataset.mapAdd;
    const name = addBtn.dataset.mapName;
    const lines = addBtn.dataset.mapLines
      ? addBtn.dataset.mapLines.split(",").filter(Boolean)
      : [];
    if (addStop(id, name, lines)) {
      addBtn.innerText = "ADICIONADA ✓";
      addBtn.disabled = true;
      addBtn.classList.remove("bg-zinc-900", "dark:bg-white");
      addBtn.classList.add("bg-green-600", "border-green-600");
      setTimeout(() => closeMapModal(), 700);
    }
  });

  // ─── LÓGICA CORE ───

  /** @returns {boolean} true se adicionou */
  function addStop(id, name, lines = []) {
    const r = P.add({ id, name, lines });
    if (!r.ok) {
      if (r.motivo === "existe") toast("Esta paragem já está guardada.");
      else if (r.motivo === "limite")
        toast(`Limite de ${P.MAX} paragens atingido.`);
      else toast("Não foi possível guardar a paragem.");
      return false;
    }
    savedStops = P.list();
    renderStops();
    updateMapStopsColor();
    toast("Paragem guardada");
    return true;
  }

  function removeStop(id) {
    const s = savedStops.find((x) => x.id === id);
    if (s && !confirm(`Remover "${s.name}" das paragens guardadas?`)) return;
    fecharPartidas(id);
    ultimas.delete(id);
    P.remove(id);
  }

  function toggleEditMode(stopId) {
    const titleEl = document.getElementById(`title-${stopId}`);
    if (!titleEl) return;
    const stop = savedStops.find((s) => s.id === stopId);
    const currentName = stop ? stop.name : titleEl.innerText;
    renomear = stopId;
    titleEl.innerHTML = `<input type="text" id="input-${esc(stopId)}" value="${esc(currentName)}"
      class="pg-rename" maxlength="40" aria-label="Novo nome da paragem" />`;
    const input = document.getElementById(`input-${stopId}`);
    input.focus();
    input.select();
    let feito = false;
    const save = (guardar) => {
      if (feito) return;
      feito = true;
      renomear = null;
      if (guardar) P.rename(stopId, input.value.trim() || currentName);
      else renderStops();
    };
    input.addEventListener("blur", () => save(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") save(false);
    });
  }

  function toggleLineVisibility(stopId, lineId) {
    const stop = savedStops.find((s) => s.id === stopId);
    if (!stop) return;
    const hidden = stop.hiddenLines.includes(lineId)
      ? stop.hiddenLines.filter((l) => l !== lineId)
      : [...stop.hiddenLines, lineId];
    P.setHidden(stopId, hidden);
    if (abertas.has(stopId)) setTimeout(() => fetchArrivals(stopId), 40);
  }

  function setAllLinesVisibility(stopId, showAll) {
    const stop = savedStops.find((s) => s.id === stopId);
    if (!stop) return;
    P.setHidden(stopId, showAll ? [] : [...linhasDe(stop)]);
    if (abertas.has(stopId)) setTimeout(() => fetchArrivals(stopId), 40);
  }

  function linhasDe(stop) {
    const d = detalhes.get(stop.id);
    if (d && d.lines.length) return d.lines.map((l) => l.id);
    return stop.availableLines || [];
  }

  // ─── RENDERIZAÇÃO ───

  function renderStops() {
    counterEl.textContent = `${savedStops.length}/${P.MAX} paragens`;

    if (savedStops.length === 0) {
      container.innerHTML = `
        <div class="pg-empty">
          <i data-lucide="bus" class="w-7 h-7"></i>
          <p class="pg-empty-t">Ainda não guardou nenhuma paragem.</p>
          <p class="pg-empty-s">Procure uma paragem acima para começar. As que guardar aparecem também no mapa.</p>
        </div>`;
      lucide.createIcons();
      return;
    }

    container.innerHTML = savedStops
      .map((stop, index) => cartaoHtml(stop, index))
      .join("");
    lucide.createIcons();
  }

  function cartaoHtml(stop, index) {
    const id = esc(stop.id);
    const d = detalhes.get(stop.id);
    const oficial = d && d.name && d.name.toUpperCase() !== stop.name.toUpperCase() ? d.name : "";
    const linhas = linhasDe(stop);
    const aberta = abertas.has(stop.id);

    const pills = linhas
      .map((lid) => {
        const li = linhaInfo(stop.id, lid);
        const off = stop.hiddenLines.includes(lid);
        const bg = (li && li.color) || "#18181b";
        const style = off
          ? ""
          : `background:${bg};border-color:${bg};color:${corTexto(bg, li && li.text)}`;
        const titulo = li && li.long ? `${lid} · ${li.long}` : lid;
        return `<button type="button" data-action="toggle-line" data-id="${id}" data-line="${esc(lid)}"
          class="pg-pill${off ? " is-off" : ""}" style="${style}" aria-pressed="${off ? "false" : "true"}"
          title="${esc(titulo)}${off ? " (oculta)" : ""}">${esc((li && li.short) || lid)}</button>`;
      })
      .join("");

    const linhasHtml = linhas.length
      ? `<div class="pg-lines">
          <div class="pg-lines-list">${pills}</div>
          <div class="pg-lines-all">
            <button type="button" data-action="show-all-lines" data-id="${id}">Todas</button>
            <button type="button" data-action="hide-all-lines" data-id="${id}">Nenhuma</button>
          </div>
        </div>`
      : `<p class="pg-lines-none">${d ? "Sem carreiras conhecidas nesta paragem." : "A obter as carreiras desta paragem…"}</p>`;

    return `
      <article class="pg-card" data-stop="${id}">
        <div class="pg-head">
          <div class="pg-order">
            <button type="button" data-action="move-up" data-id="${id}" aria-label="Subir" ${index === 0 ? "disabled" : ""}>
              <i data-lucide="chevron-up" class="w-4 h-4"></i></button>
            <button type="button" data-action="move-down" data-id="${id}" aria-label="Descer" ${index === savedStops.length - 1 ? "disabled" : ""}>
              <i data-lucide="chevron-down" class="w-4 h-4"></i></button>
          </div>
          <div class="pg-title">
            <h3 id="title-${id}">${esc(stop.name)}</h3>
            <p>ID ${id}${oficial ? ` · ${esc(oficial)}` : ""}</p>
          </div>
          <div class="pg-actions">
            <a href="/mapa#paragem=${encodeURIComponent(stop.id)}" class="pg-icon" title="Ver no mapa" aria-label="Ver no mapa">
              <i data-lucide="map-pin" class="w-4 h-4"></i></a>
            <button type="button" data-action="edit-stop" data-id="${id}" class="pg-icon" title="Renomear" aria-label="Renomear">
              <i data-lucide="pencil" class="w-4 h-4"></i></button>
            <button type="button" data-action="delete-stop" data-id="${id}" class="pg-icon is-danger" title="Remover" aria-label="Remover">
              <i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </div>
        ${linhasHtml}
        <button type="button" class="pg-toggle" data-action="toggle-departures" data-id="${id}"
          aria-expanded="${aberta}" aria-controls="results-${id}">
          <span>Próximas partidas</span>
          <i data-lucide="chevron-down" class="w-4 h-4 pg-chev"></i>
        </button>
        <div id="results-${id}" class="pg-results" ${aberta ? "" : "hidden"}>${aberta ? ultimas.get(stop.id) || spinnerHtml() : ""}</div>
      </article>`;
  }

  const spinnerHtml = () => `<div class="pg-loading"><span class="pg-spin"></span></div>`;

  // ─── PARTIDAS (só com o desdobrável aberto) ───

  function alternarPartidas(id) {
    if (abertas.has(id)) fecharPartidas(id);
    else abrirPartidas(id);
  }

  function abrirPartidas(id) {
    abertas.add(id);
    const box = document.getElementById(`results-${id}`);
    const btn = container.querySelector(`[data-action="toggle-departures"][data-id="${CSS.escape(id)}"]`);
    if (btn) btn.setAttribute("aria-expanded", "true");
    if (box) {
      box.hidden = false;
      box.innerHTML = ultimas.get(id) || spinnerHtml();
    }
    fetchArrivals(id);
  }

  function fecharPartidas(id) {
    abertas.delete(id);
    const c = pedidos.get(id);
    if (c) c.abort();
    pedidos.delete(id);
    const box = document.getElementById(`results-${id}`);
    const btn = container.querySelector(`[data-action="toggle-departures"][data-id="${CSS.escape(id)}"]`);
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
  }

  async function fetchArrivals(stopId) {
    if (!abertas.has(stopId)) return;
    const stop = savedStops.find((s) => s.id === stopId);
    if (!stop) return;
    const prev = pedidos.get(stopId);
    if (prev) prev.abort();
    const ctrl = new AbortController();
    pedidos.set(stopId, ctrl);

    let html;
    try {
      const res = await fetch(
        `${CM_API_BASE}/arrivals/by_stop/${encodeURIComponent(stopId)}`,
        // Sem cookies: não envia nenhum e ignora os Set-Cookie da Carris.
        { credentials: "omit", cache: "no-store", signal: ctrl.signal },
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = P.limparChegadas(await res.json());
      const nowUnix = Math.floor(Date.now() / 1000);
      const hidden = stop.hiddenLines;
      const buses = data
        .map((bus) => ({
          ...bus,
          timeUnix: bus.estimated_arrival_unix || bus.scheduled_arrival_unix,
          live: !!bus.estimated_arrival_unix,
        }))
        .filter((bus) => bus.timeUnix && bus.timeUnix >= nowUnix - 30)
        .filter((bus) => !hidden.includes(String(bus.line_id)))
        .sort((a, b) => a.timeUnix - b.timeUnix)
        .slice(0, ARRIVALS_LIMIT);
      html = resultadosHtml(stopId, buses, hidden.length > 0);
    } catch (error) {
      if (ctrl.signal.aborted) return;
      html = `<div class="pg-msg is-error"><i data-lucide="wifi-off" class="w-4 h-4"></i>
        <span>Sem ligação aos servidores da Carris.</span></div>`;
    }
    if (pedidos.get(stopId) === ctrl) pedidos.delete(stopId);
    if (!abertas.has(stopId)) return;
    ultimas.set(stopId, html);
    const box = document.getElementById(`results-${stopId}`);
    if (box) {
      box.innerHTML = html;
      lucide.createIcons();
    }
  }

  function resultadosHtml(stopId, buses, isFiltered) {
    if (buses.length === 0) {
      return `<div class="pg-msg">${
        isFiltered
          ? "Sem autocarros nas carreiras selecionadas."
          : "Sem previsões para as próximas horas."
      }</div>`;
    }
    const nowUnix = Math.floor(Date.now() / 1000);
    return buses
      .map((bus) => {
        const diffMins = Math.floor((bus.timeUnix - nowUnix) / 60);
        let timeStr;
        let cls = "";
        if (diffMins <= 0) {
          timeStr = "A chegar";
          cls = " is-now";
        } else if (diffMins < 60) {
          timeStr = `${diffMins} min`;
        } else {
          timeStr = new Date(bus.timeUnix * 1000).toLocaleTimeString("pt-PT", {
            hour: "2-digit",
            minute: "2-digit",
          });
          cls = " is-later";
        }
        const li = linhaInfo(stopId, String(bus.line_id));
        const bg = (li && li.color) || "#18181b";
        return `
          <div class="pg-row">
            <span class="pg-line" style="background:${bg};color:${corTexto(bg, li && li.text)}">${esc(bus.line_id)}</span>
            <span class="pg-dest">${esc(bus.headsign || "—")}</span>
            <span class="pg-time${cls}">
              ${bus.live ? '<span class="pg-live" aria-hidden="true"></span>' : '<span class="pg-prog">prog.</span>'}${timeStr}
            </span>
          </div>`;
      })
      .join("");
  }

  // ─── FERTAGUS (mapa do modal) ───
  async function fetchFertagusStops() {
    if (fertagusCache) return fertagusCache;
    try {
      const res = await fetch("./json/stops_ft.json");
      if (!res.ok) throw new Error("stops_ft.json não encontrado");
      fertagusCache = await res.json();
      return fertagusCache;
    } catch (error) {
      console.error("Erro a carregar Fertagus:", error);
      return null;
    }
  }

  async function fetchFertagusLine() {
    if (fertagusLineCache) return fertagusLineCache;
    try {
      const res = await fetch("./json/fertagus_line.json");
      if (!res.ok) throw new Error("fertagus_line.json não encontrado");
      fertagusLineCache = await res.json();
      return fertagusLineCache;
    } catch (error) {
      console.error("Erro a carregar linha Fertagus:", error);
      return null;
    }
  }

  function drawFertagusRoute(map, geojsonData) {
    if (!geojsonData) return;
    if (!map.getSource("fertagus-route")) {
      map.addSource("fertagus-route", { type: "geojson", data: geojsonData });
    }
    if (!map.getLayer("fertagus-line-layer")) {
      map.addLayer({
        id: "fertagus-line-layer",
        type: "line",
        source: "fertagus-route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#3b82f6",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
          "line-opacity": 0.8,
        },
      });
    }
  }

  function drawFertagusStations(map, stationsData) {
    if (!stationsData) return;
    const features = stationsData.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.c[1], s.c[0]] },
      properties: { id: s.id, name: s.n },
    }));

    if (!map.getSource("fertagus-stations")) {
      map.addSource("fertagus-stations", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
    }

    if (!map.getLayer("fertagus-stations-layer")) {
      map.addLayer({
        id: "fertagus-stations-layer",
        type: "circle",
        source: "fertagus-stations",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 13, 9, 16, 12, 19, 20],
          "circle-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#000000",
        },
      });

      map.on("click", "fertagus-stations-layer", (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        new maplibregl.Popup({ closeButton: false, maxWidth: "240px" })
          .setLngLat(coords)
          .setHTML(
            `<div class="text-left flex flex-col font-['Inter'] px-1">
              <h4 class="font-bold text-xs uppercase tracking-wider text-blue-500">${esc(props.name)}</h4>
              <span class="text-[9px] tracking-widest text-zinc-500 mt-1">Fertagus</span>
            </div>`,
          )
          .addTo(map);
      });
      map.on("mouseenter", "fertagus-stations-layer", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "fertagus-stations-layer", () => (map.getCanvas().style.cursor = ""));
    }
  }

  // ─── MAPA DO MODAL ───

  async function openMapModal() {
    mapModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      mapModal.classList.remove("opacity-0");
      mapModal.classList.add("opacity-100");
    });
    if (!mapInstance) await initializeMap();
    else mapInstance.resize();
  }

  function closeMapModal() {
    mapModal.classList.remove("opacity-100");
    mapModal.classList.add("opacity-0");
    setTimeout(() => mapModal.classList.add("hidden"), 300);
  }

  async function fetchAllStops() {
    if (cmStopsCache) return cmStopsCache;
    const res = await fetch(STOPS_JSON_PATH);
    if (!res.ok) throw new Error("stops_cm.json não encontrado");
    const arr = await res.json();
    // Ids de linha limpos também no catálogo local (ver LTParagens.limparId).
    for (const s of arr) if (Array.isArray(s.l)) s.l = s.l.map((l) => P.limparId(l));
    cmStopsCache = arr;
    return cmStopsCache;
  }

  function setMapTheme() {
    if (!mapInstance) return;
    mapInstance.setStyle({
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
        },
      },
      layers: [{ id: "basemap-layer", type: "raster", source: "basemap", minzoom: 0, maxzoom: 22 }],
    });
    mapInstance.once("styledata", () => {
      if (geojsonCache) drawStopsLayer();
      if (fertagusCache && fertagusLineCache) {
        drawFertagusRoute(mapInstance, fertagusLineCache);
        drawFertagusStations(mapInstance, fertagusCache);
      }
    });
  }

  function drawStopsLayer() {
    if (!mapInstance.getSource("stops")) {
      mapInstance.addSource("stops", { type: "geojson", data: geojsonCache });
    }
    if (!mapInstance.getLayer("stops-layer")) {
      mapInstance.addLayer({
        id: "stops-layer",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 13, 6, 16, 9, 19, 15],
          "circle-color": "#FFDD00",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2, 18, 3],
          "circle-stroke-color": "#000000",
        },
      });
    }
    updateMapStopsColor();
  }

  function updateMapStopsColor() {
    if (!mapInstance || !mapInstance.getLayer("stops-layer")) return;
    const savedIds = savedStops.map((s) => s.id);
    mapInstance.setPaintProperty("stops-layer", "circle-color", [
      "case",
      ["in", ["get", "id"], ["literal", savedIds]],
      "#22C55E",
      "#FFDD00",
    ]);
  }

  async function initializeMap() {
    try {
      const stopsData = await fetchAllStops();
      geojsonCache = {
        type: "FeatureCollection",
        features: stopsData.map((s) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.c[1], s.c[0]] },
          properties: { id: s.id, name: s.n, lines: s.l ? s.l.join(",") : "" },
        })),
      };

      mapInstance = new maplibregl.Map({
        container: "map",
        style: {
          version: 8,
          sources: {
            basemap: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution:
                '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> | Dados: Carris Metropolitana · Infraestruturas de Portugal',
            },
          },
          layers: [{ id: "basemap-layer", type: "raster", source: "basemap", minzoom: 0, maxzoom: 22 }],
        },
        center: [-9.01, 38.65],
        zoom: 11,
        minZoom: 6,
        maxBounds: [
          [-10.5, 36.8],
          [-6.0, 42.3],
        ],
      });

      mapInstance.addControl(new maplibregl.NavigationControl(), "bottom-right");

      mapInstance.on("load", async () => {
        document.getElementById("map-loading")?.classList.add("opacity-0", "pointer-events-none");
        drawStopsLayer();
        const [stationsData, lineData] = await Promise.all([fetchFertagusStops(), fetchFertagusLine()]);
        drawFertagusRoute(mapInstance, lineData);
        drawFertagusStations(mapInstance, stationsData);
      });

      mapInstance.on("click", "stops-layer", (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();
        let linesHtml = '<p class="text-[9px] text-zinc-500 mt-1 mb-2">Sem carreiras disp.</p>';
        if (props.lines) {
          const linePills = props.lines
            .split(",")
            .filter(Boolean)
            .map(
              (l) =>
                `<span class="font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white px-1.5 py-0.5 text-[11px] font-bold tracking-widest mr-1 mb-1 inline-block border border-zinc-200 dark:border-zinc-700">${esc(l)}</span>`,
            )
            .join("");
          linesHtml = `<div class="mb-4 mt-2 leading-tight">${linePills}</div>`;
        }
        const isSaved = savedStops.find((s) => s.id === props.id);
        new maplibregl.Popup({ closeButton: false, maxWidth: "240px" })
          .setLngLat(coords)
          .setHTML(
            `<div class="text-left flex flex-col font-['Inter']">
              <h4 class="font-semibold text-xs uppercase tracking-wider text-zinc-900 dark:text-white">${esc(props.name)}</h4>
              <span class="text-[9px] tracking-widest text-zinc-500 mt-0.5">ID: ${esc(props.id)}</span>
              ${linesHtml}
              <button
                data-map-add="${esc(props.id)}"
                data-map-name="${esc(props.name)}"
                data-map-lines="${esc(props.lines)}"
                class="w-full text-[9px] ${isSaved ? "bg-green-600 border-green-600 cursor-default" : "bg-zinc-900 dark:bg-white hover:bg-zinc-800"} text-white dark:text-zinc-900 px-4 py-2.5 font-bold uppercase tracking-[0.2em] transition-colors border border-zinc-900 dark:border-white"
                ${isSaved ? "disabled" : ""}
              >${isSaved ? "✓ Já Adicionada" : "Adicionar Paragem"}</button>
            </div>`,
          )
          .addTo(mapInstance);
      });

      mapInstance.on("mouseenter", "stops-layer", () => (mapInstance.getCanvas().style.cursor = "pointer"));
      mapInstance.on("mouseleave", "stops-layer", () => (mapInstance.getCanvas().style.cursor = ""));
    } catch (error) {
      console.error("Erro ao carregar mapa:", error);
      const loadingEl = document.getElementById("map-loading");
      if (loadingEl)
        loadingEl.innerHTML =
          '<p class="text-xs uppercase text-zinc-500 tracking-widest">Erro ao carregar mapa.</p>';
    }
  }
});

// ─── INJEÇÃO DE ELEMENTOS DO MENU GLOBAL ───
function injectCustomMenuElements() {
  const menuOverlay = document.getElementById("menu-overlay");
  const settingsTemplate = document.getElementById("menu-settings-template");

  if (menuOverlay && settingsTemplate) {
    const nav = menuOverlay.querySelector("nav");
    if (nav) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = settingsTemplate.innerHTML;
      nav.parentNode.insertBefore(wrapper, nav.nextSibling);
      settingsTemplate.remove();
    }
  }

  const footer = document.getElementById("global-footer");
  if (footer && !document.getElementById("footer-warning")) {
    const p = document.createElement("p");
    p.id = "footer-warning";
    p.className =
      "text-[0.6rem] text-center text-zinc-500 dark:text-zinc-400 mb-6 opacity-60 block w-full px-4 uppercase tracking-widest";
    p.innerText =
      "Atenção: Os horários e estado de circulação podem sofrer alterações sem aviso prévio. Esteja na paragem à hora programada.";
    footer.insertBefore(p, footer.firstChild);
  }
}
