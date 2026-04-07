/**
 * paragens.js
 * Gestão de paragens favoritas (Max 10), filtros de carreiras, ordenação e mapa interativo.
 * Expõe window.LT para comunicação com paragens-search.js
 */

document.addEventListener("DOMContentLoaded", () => {
  const CM_API_BASE = "https://api.carrismetropolitana.pt/v2";
  const STOPS_JSON_PATH = "./json/stops_cm.json";
  const STORAGE_KEY = "cm_saved_stops";
  const MAX_STOPS = 10;
  const REFRESH_INTERVAL = 30000;

  const form = document.getElementById("add-stop-form");
  const container = document.getElementById("stops-container");
  const refreshBtn = document.getElementById("refresh-stops-btn");
  const counterEl = document.getElementById("stops-counter");
  const btnOpenMap = document.getElementById("btn-open-map");
  const btnCloseMap = document.getElementById("btn-close-map");
  const mapModal = document.getElementById("map-modal");

  let savedStops = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];

  // Migração de estrutura antiga
  savedStops = savedStops.map((s) => ({
    id: s.id,
    name: s.name,
    addedAt: s.addedAt || Date.now(),
    availableLines: s.availableLines || [],
    hiddenLines: s.hiddenLines || [],
  }));

  let mapInstance = null;
  let cmStopsCache = null;
  let geojsonCache = null;
  let fertagusCache = null;
  let fertagusLineCache = null;

  // ─── NAMESPACE GLOBAL PARTILHADO COM paragens-search.js ───
  window.LT = {
    getMapInstance: () => mapInstance,
    getStopsData: () => cmStopsCache,
    getSavedStops: () => savedStops,
    addStop: (id, name, lines) => addStop(id, name, lines),
    closeMapModal: () => closeMapModal(),
    updateMapStopsColor: () => updateMapStopsColor(),
  };

  // ─── INICIALIZAÇÃO ───
  lucide.createIcons();
  renderStops();
  injectCustomMenuElements();

  // Pré-carregar stops JSON silenciosamente
  fetchAllStops().catch(console.error);

  // Auto-refresh a cada 30s
  setInterval(updateAllStopsData, REFRESH_INTERVAL);

  // Observar mudança de tema
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    document.body.classList.add("is-ios");
  }

  const observer = new MutationObserver(() => {
    if (mapInstance) setMapTheme();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // ─── EVENT LISTENERS ───
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const idInput = document.getElementById("stop-id");
    const stopId = idInput.value.trim();
    if (!stopId) return;

    if (savedStops.length >= MAX_STOPS) {
      alert(`Pode guardar um máximo de ${MAX_STOPS} paragens.`);
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

      const stopName = stopData.n || `Paragem ${stopId}`;
      const lines = stopData.l || [];
      addStop(stopId, stopName, lines);
      idInput.value = "";
    } catch (err) {
      alert(
        "Não foi possível encontrar essa paragem. Verifique o ID de 6 dígitos.",
      );
    } finally {
      btn.innerText = originalText;
      btn.disabled = false;
    }
  });

  refreshBtn.addEventListener("click", () => {
    const icon = refreshBtn.querySelector("i");
    icon.classList.add("animate-spin");
    updateAllStopsData().finally(() => {
      setTimeout(() => icon.classList.remove("animate-spin"), 500);
    });
  });

  // Delegação de eventos no container de paragens
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const index = parseInt(btn.dataset.index, 10);

    if (action === "delete-stop") removeStop(id);
    else if (action === "move-up" && index > 0) swapStops(index, index - 1);
    else if (action === "move-down" && index < savedStops.length - 1)
      swapStops(index, index + 1);
    else if (action === "edit-stop") toggleEditMode(id);
    else if (action === "toggle-line")
      toggleLineVisibility(id, btn.dataset.line);
    else if (action === "hide-all-lines") setAllLinesVisibility(id, false);
    else if (action === "show-all-lines") setAllLinesVisibility(id, true);
  });

  btnOpenMap.addEventListener("click", openMapModal);
  btnCloseMap.addEventListener("click", closeMapModal);

  // Handler para adicionar paragem a partir do popup do mapa
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-map-add]");
    if (!addBtn) return;

    const id = addBtn.dataset.mapAdd;
    const name = addBtn.dataset.mapName;
    const lines = addBtn.dataset.mapLines
      ? addBtn.dataset.mapLines.split(",").filter(Boolean)
      : [];

    if (savedStops.length >= MAX_STOPS) {
      alert(`Limite de ${MAX_STOPS} paragens atingido.`);
      return;
    }

    const success = addStop(id, name, lines);
    if (success) {
      addBtn.innerText = "ADICIONADA ✓";
      addBtn.disabled = true;
      addBtn.classList.remove("bg-zinc-900", "dark:bg-white");
      addBtn.classList.add("bg-green-600", "border-green-600");
      setTimeout(() => closeMapModal(), 700);
    }
  });

  // ─── FERTAGUS ───
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
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            4,
            13,
            9,
            16,
            12,
            19,
            20,
          ],
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
            `
            <div class="text-left flex flex-col font-['Inter'] px-1">
              <h4 class="font-bold text-xs uppercase tracking-wider text-blue-500">${props.name}</h4>
              <span class="text-[9px] tracking-widest text-zinc-500 mt-1">Fertagus</span>
            </div>
          `,
          )
          .addTo(map);
      });

      map.on(
        "mouseenter",
        "fertagus-stations-layer",
        () => (map.getCanvas().style.cursor = "pointer"),
      );
      map.on(
        "mouseleave",
        "fertagus-stations-layer",
        () => (map.getCanvas().style.cursor = ""),
      );
    }
  }

  // ─── LÓGICA CORE ───

  /**
   * Adiciona uma paragem à lista guardada.
   * @returns {boolean} true se adicionou com sucesso, false caso contrário
   */
  function addStop(id, name, lines = []) {
    if (savedStops.find((s) => s.id === id)) {
      alert("Esta paragem já se encontra guardada.");
      return false;
    }
    if (savedStops.length >= MAX_STOPS) {
      alert(`Limite de ${MAX_STOPS} paragens atingido.`);
      return false;
    }
    savedStops.push({
      id,
      name,
      addedAt: Date.now(),
      availableLines: lines,
      hiddenLines: [],
    });
    saveData();
    renderStops();
    updateMapStopsColor();
    return true;
  }

  function removeStop(id) {
    savedStops = savedStops.filter((s) => s.id !== id);
    saveData();
    renderStops();
    updateMapStopsColor();
  }

  function swapStops(idx1, idx2) {
    [savedStops[idx1], savedStops[idx2]] = [savedStops[idx2], savedStops[idx1]];
    saveData();
    renderStops();
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedStops));
  }

  function toggleEditMode(stopId) {
    const titleEl = document.getElementById(`title-${stopId}`);
    const currentName = titleEl.innerText;

    titleEl.innerHTML = `
      <input type="text" id="input-${stopId}" value="${currentName}"
        class="w-full bg-transparent border-b border-zinc-900 dark:border-white text-sm font-semibold uppercase focus:outline-none px-1"
        maxlength="30" />
    `;

    const input = document.getElementById(`input-${stopId}`);
    input.focus();
    input.select();

    const saveTitle = () => {
      const newName = input.value.trim() || currentName;
      const stopIndex = savedStops.findIndex((s) => s.id === stopId);
      if (stopIndex > -1) {
        savedStops[stopIndex].name = newName;
        saveData();
      }
      renderStops();
    };

    input.addEventListener("blur", saveTitle);
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") input.blur();
    });
  }

  function toggleLineVisibility(stopId, lineId) {
    const stop = savedStops.find((s) => s.id === stopId);
    if (!stop) return;
    if (stop.hiddenLines.includes(lineId)) {
      stop.hiddenLines = stop.hiddenLines.filter((l) => l !== lineId);
    } else {
      stop.hiddenLines.push(lineId);
    }
    saveData();
    renderStops();
  }

  function setAllLinesVisibility(stopId, showAll) {
    const stop = savedStops.find((s) => s.id === stopId);
    if (!stop) return;
    stop.hiddenLines = showAll ? [] : [...stop.availableLines];
    saveData();
    renderStops();
  }

  // ─── RENDERIZAÇÃO DA UI ───

  function renderStops() {
    container.innerHTML = "";
    counterEl.innerText = `${savedStops.length}/${MAX_STOPS} paragens`;

    if (savedStops.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 rounded-sm">
          <i data-lucide="bus" class="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-4"></i>
          <p class="text-[10px] uppercase tracking-widest text-zinc-500 font-medium mb-1">Ainda não guardou nenhuma paragem.</p>
          <p class="text-[10px] text-zinc-400 tracking-wide">Use o botão abaixo para começar.</p>
        </div>
      `;
      lucide.createIcons();
      return;
    }

    savedStops.forEach((stop, index) => {
      const stopEl = document.createElement("div");
      stopEl.className =
        "border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090b] relative flex flex-col rounded-sm shadow-sm transition-all";

      // ── Pills de Linhas (sempre visíveis) ──
      let linesStripHtml = "";
      if (stop.availableLines && stop.availableLines.length > 0) {
        const linePills = stop.availableLines
          .map((line) => {
            const isHidden = stop.hiddenLines.includes(line);
            const pillCls = isHidden
              ? "bg-transparent border-zinc-200 dark:border-zinc-700 text-zinc-300 dark:text-zinc-600 line-through"
              : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white";
            return `<button
              data-action="toggle-line"
              data-id="${stop.id}"
              data-line="${line}"
              class="px-1.5 py-0.5 text-[9px] font-bold tracking-widest border transition-all duration-150 ${pillCls}"
              title="${isHidden ? "Clique para mostrar" : "Clique para ocultar"}"
            >${line}</button>`;
          })
          .join("");

        linesStripHtml = `
          <div class="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 flex items-start gap-3">
            <div class="flex flex-wrap gap-1.5 flex-1 min-w-0 pt-0.5">${linePills}</div>
            <div class="flex flex-col items-end gap-1 shrink-0 pl-2 border-l border-zinc-100 dark:border-zinc-800">
              <button
                data-action="show-all-lines"
                data-id="${stop.id}"
                class="text-[8px] uppercase tracking-widest font-semibold text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors whitespace-nowrap"
              >Todas</button>
              <button
                data-action="hide-all-lines"
                data-id="${stop.id}"
                class="text-[8px] uppercase tracking-widest font-semibold text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors whitespace-nowrap"
              >Nenhuma</button>
            </div>
          </div>
        `;
      }

      stopEl.innerHTML = `
        <div class="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-4 bg-zinc-50/50 dark:bg-zinc-900/30">
          <div class="flex flex-col gap-1 shrink-0">
            <button
              data-action="move-up"
              data-index="${index}"
              class="text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-20 transition-colors"
              ${index === 0 ? "disabled" : ""}
            ><i data-lucide="chevron-up" class="w-4 h-4"></i></button>
            <button
              data-action="move-down"
              data-index="${index}"
              class="text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-20 transition-colors"
              ${index === savedStops.length - 1 ? "disabled" : ""}
            ><i data-lucide="chevron-down" class="w-4 h-4"></i></button>
          </div>
          <div class="flex-grow min-w-0">
            <h3 id="title-${stop.id}" class="text-sm font-semibold text-zinc-900 dark:text-white uppercase tracking-wider truncate">${stop.name}</h3>
            <p class="text-[10px] text-zinc-500 tracking-widest mt-0.5">ID: ${stop.id}</p>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              data-action="edit-stop"
              data-id="${stop.id}"
              class="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
              title="Renomear"
            ><i data-lucide="pencil" class="w-4 h-4"></i></button>
            <button
              data-action="delete-stop"
              data-id="${stop.id}"
              class="p-2 text-zinc-400 hover:text-red-500 transition-colors"
              title="Remover"
            ><i data-lucide="trash-2" class="w-4 h-4"></i></button>
          </div>
        </div>
        ${linesStripHtml}
        <div id="results-${stop.id}" class="flex flex-col min-h-[80px]">
          <div class="p-6 flex justify-center">
            <div class="w-4 h-4 border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-white rounded-full animate-spin"></div>
          </div>
        </div>
      `;

      container.appendChild(stopEl);
    });

    lucide.createIcons();
    updateAllStopsData();
  }

  // ─── FETCHING E PROCESSAMENTO TEMPO REAL ───

  async function updateAllStopsData() {
    const promises = savedStops.map((stop) =>
      fetchArrivalsForStop(stop.id, stop.hiddenLines),
    );
    await Promise.allSettled(promises);
  }

  async function fetchArrivalsForStop(stopId, hiddenLines) {
    const resultsContainer = document.getElementById(`results-${stopId}`);
    if (!resultsContainer) return;

    try {
      const res = await fetch(`${CM_API_BASE}/arrivals/by_stop/${stopId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("API Indisponível");

      const data = await res.json();
      const nowUnix = Math.floor(Date.now() / 1000);

      const futureBuses = data
        .map((bus) => ({
          ...bus,
          timeUnix: bus.estimated_arrival_unix || bus.scheduled_arrival_unix,
          live: !!bus.estimated_arrival_unix,
        }))
        .filter((bus) => bus.timeUnix >= nowUnix - 30)
        .filter((bus) => !hiddenLines.includes(bus.line_id))
        .sort((a, b) => a.timeUnix - b.timeUnix)
        .slice(0, 5);

      drawResults(resultsContainer, futureBuses, hiddenLines.length > 0);
    } catch (error) {
      resultsContainer.innerHTML = `
        <div class="p-5 flex items-center gap-3 text-red-500/80">
          <i data-lucide="wifi-off" class="w-4 h-4 shrink-0"></i>
          <p class="text-[10px] uppercase tracking-wider font-semibold">Sem ligação aos servidores.</p>
        </div>`;
      lucide.createIcons();
    }
  }

  function drawResults(container, buses, isFiltered) {
    if (buses.length === 0) {
      const msg = isFiltered
        ? "Sem autocarros nas carreiras selecionadas."
        : "Sem previsões para as próximas horas.";
      container.innerHTML = `
        <div class="p-6 text-center">
          <p class="text-xs text-zinc-400 font-medium">${msg}</p>
        </div>`;
      return;
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    let html = "";

    buses.forEach((bus, index) => {
      const diffMins = Math.floor((bus.timeUnix - nowUnix) / 60);
      let timeStr = "";
      let timeClass = "text-zinc-900 dark:text-white font-bold";
      let pulseHtml = "";

      if (diffMins <= 0) {
        timeStr = "A CHEGAR";
        timeClass = "text-green-600 dark:text-green-500 font-extrabold";
        pulseHtml = `<span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse mr-1.5 shrink-0"></span>`;
      } else if (diffMins < 60) {
        timeStr = `${diffMins} min`;
      } else {
        const d = new Date(bus.timeUnix * 1000);
        timeStr = d.toLocaleTimeString("pt-PT", {
          hour: "2-digit",
          minute: "2-digit",
        });
        timeClass = "text-zinc-500 font-medium";
      }

      const borderClass =
        index === buses.length - 1
          ? ""
          : "border-b border-zinc-100 dark:border-zinc-800";

      html += `
        <div class="px-5 py-3.5 flex items-center justify-between ${borderClass} hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
          <div class="flex items-center gap-4 truncate pr-4">
            <div class="bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-2 py-1 min-w-[3rem] text-center shrink-0 shadow-sm">
              <span class="text-[10px] font-bold tracking-widest">${bus.line_id}</span>
            </div>
            <p class="text-xs sm:text-sm text-zinc-700 dark:text-zinc-300 truncate font-medium">${bus.headsign}</p>
          </div>
          <div class="flex items-center shrink-0 text-right">
            ${bus.live ? '<span class="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse mr-1.5 shrink-0"></span>' : ""}
            <p class="text-[10px] sm:text-xs uppercase tracking-widest ${timeClass}">
              <span class="text-zinc-400 font-normal text-[9px] mr-1 ${bus.live ? "hidden" : ""}">(prog.)</span>${timeStr}
            </p>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  // ─── MAPA MAPLIBRE GL ───

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
    cmStopsCache = await res.json();
    return cmStopsCache;
  }

  function setMapTheme() {
    if (!mapInstance) return;
    const tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

    mapInstance.setStyle({
      version: 8,
      sources: {
        basemap: {
          type: "raster",
          tiles: [tileUrl],
          tileSize: 256,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
        },
      },
      layers: [
        {
          id: "basemap-layer",
          type: "raster",
          source: "basemap",
          minzoom: 0,
          maxzoom: 22,
        },
      ],
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
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            2,
            13,
            6,
            16,
            9,
            19,
            15,
          ],
          "circle-color": "#FFDD00",
          "circle-stroke-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            1,
            14,
            2,
            18,
            3,
          ],
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

      const features = stopsData.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.c[1], s.c[0]] },
        properties: { id: s.id, name: s.n, lines: s.l ? s.l.join(",") : "" },
      }));

      geojsonCache = { type: "FeatureCollection", features };

      const initialTile = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

      mapInstance = new maplibregl.Map({
        container: "map",
        style: {
          version: 8,
          sources: {
            basemap: {
              type: "raster",
              tiles: [initialTile],
              tileSize: 256,
              attribution:
                '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> | Dados: Carris Metropolitana · Infraestruturas de Portugal',
            },
          },
          layers: [
            {
              id: "basemap-layer",
              type: "raster",
              source: "basemap",
              minzoom: 0,
              maxzoom: 22,
            },
          ],
        },
        center: [-9.01, 38.65],
        zoom: 11,
        minZoom: 6,
        maxBounds: [
          [-10.5, 36.8],
          [-6.0, 42.3],
        ],
      });

      mapInstance.addControl(
        new maplibregl.NavigationControl(),
        "bottom-right",
      );

      mapInstance.on("load", async () => {
        document
          .getElementById("map-loading")
          ?.classList.add("opacity-0", "pointer-events-none");

        drawStopsLayer();

        const [stationsData, lineData] = await Promise.all([
          fetchFertagusStops(),
          fetchFertagusLine(),
        ]);

        drawFertagusRoute(mapInstance, lineData);
        drawFertagusStations(mapInstance, stationsData);
      });

      // Click numa paragem CM
      mapInstance.on("click", "stops-layer", (e) => {
        const props = e.features[0].properties;
        const coords = e.features[0].geometry.coordinates.slice();

        let linesHtml =
          '<p class="text-[9px] text-zinc-400 mt-1 mb-2">Sem carreiras disp.</p>';
        if (props.lines) {
          const linePills = props.lines
            .split(",")
            .filter(Boolean)
            .map(
              (l) =>
                `<span class="font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white px-1.5 py-0.5 text-[11px] font-bold tracking-widest mr-1 mb-1 inline-block border border-zinc-200 dark:border-zinc-700">${l}</span>`,
            )
            .join("");
          linesHtml = `<div class="mb-4 mt-2 leading-tight">${linePills}</div>`;
        }

        const isSaved = savedStops.find((s) => s.id === props.id);

        new maplibregl.Popup({ closeButton: false, maxWidth: "240px" })
          .setLngLat(coords)
          .setHTML(
            `
            <div class="text-left flex flex-col font-['Inter']">
              <h4 class="font-semibold text-xs uppercase tracking-wider text-zinc-900 dark:text-white">${props.name}</h4>
              <span class="text-[9px] tracking-widest text-zinc-500 mt-0.5">ID: ${props.id}</span>
              ${linesHtml}
              <button
                data-map-add="${props.id}"
                data-map-name="${props.name}"
                data-map-lines="${props.lines}"
                class="w-full text-[9px] ${isSaved ? "bg-green-600 border-green-600 cursor-default" : "bg-zinc-900 dark:bg-white hover:bg-zinc-800"} text-white dark:text-zinc-900 px-4 py-2.5 font-bold uppercase tracking-[0.2em] transition-colors border border-zinc-900 dark:border-white"
                ${isSaved ? "disabled" : ""}
              >${isSaved ? "✓ Já Adicionada" : "Adicionar Paragem"}</button>
            </div>
          `,
          )
          .addTo(mapInstance);
      });

      mapInstance.on(
        "mouseenter",
        "stops-layer",
        () => (mapInstance.getCanvas().style.cursor = "pointer"),
      );
      mapInstance.on(
        "mouseleave",
        "stops-layer",
        () => (mapInstance.getCanvas().style.cursor = ""),
      );
    } catch (error) {
      console.error("Erro ao carregar mapa:", error);
      const loadingEl = document.getElementById("map-loading");
      if (loadingEl) {
        loadingEl.innerHTML =
          '<p class="text-xs uppercase text-zinc-500 tracking-widest">Erro ao carregar mapa.</p>';
      }
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

  const header = document.querySelector("#global-nav header");
  const trigger = document.getElementById("menu-trigger");

  if (header && trigger && !document.getElementById("menu-controls-wrapper")) {
    const wrapper = document.createElement("div");
    wrapper.id = "menu-controls-wrapper";
    wrapper.className = "flex items-center gap-1";
    header.insertBefore(wrapper, trigger);

    const mobilityBtn = document.createElement("button");
    mobilityBtn.id = "mobility-trigger";
    mobilityBtn.className =
      "p-2 rounded-full transition-colors text-zinc-900 dark:text-white group relative";
    mobilityBtn.setAttribute("aria-label", "Ferramentas Inteligentes");
    mobilityBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 transition-transform group-active:scale-90">
        <path d="m10.586 5.414-5.172 5.172"/><path d="m18.586 13.414-5.172 5.172"/><path d="M6 12h12"/><circle cx="12" cy="20" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="4" cy="12" r="2"/>
      </svg>
      <span id="mobility-badge-ping" class="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full animate-ping"></span>
      <span id="mobility-badge" class="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-500 rounded-full"></span>
    `;
    wrapper.appendChild(mobilityBtn);
    wrapper.appendChild(trigger);

    const popover = document.createElement("div");
    popover.id = "mobility-popover";
    popover.className =
      "absolute top-16 right-4 w-64 bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl hidden origin-top-right transition-all duration-300 transform scale-95 opacity-0 z-50 overflow-hidden";
    popover.innerHTML = `
      <div class="px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-100 dark:border-zinc-800">
        <p class="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">Funcionalidades</p>
      </div>
      <div class="flex flex-col">
        <a href="./app" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left group/btn">
          <i data-lucide="train-track" class="w-4 h-4 text-zinc-900 dark:text-white group-hover/btn:scale-110 transition-transform duration-300"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Fertagus tempo real</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Verifica a circulação da Fertagus</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover/btn:translate-x-1 transition-transform"></i>
        </a>
        <div class="h-px w-full bg-zinc-100 dark:bg-zinc-800"></div>
        <a href="./sudoku" class="w-full flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-left group/btn">
          <i data-lucide="gamepad-2" class="w-4 h-4 text-zinc-900 dark:text-white group-hover/btn:scale-110 transition-transform duration-300"></i>
          <div class="flex-1">
            <p class="text-sm font-medium text-zinc-900 dark:text-white leading-none">Jogo de Sudoku</p>
            <p class="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 font-light tracking-wide">Tempo extra? Joga Sudoku</p>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 group-hover/btn:translate-x-1 transition-transform"></i>
        </a>
      </div>
    `;

    document.getElementById("global-nav").appendChild(popover);

    mobilityBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = popover.classList.contains("hidden");
      const badgePing = document.getElementById("mobility-badge-ping");
      const badgeSolid = document.getElementById("mobility-badge");
      if (badgePing) badgePing.remove();
      if (badgeSolid) badgeSolid.remove();

      if (isHidden) {
        popover.classList.remove("hidden");
        requestAnimationFrame(() => {
          popover.classList.remove("scale-95", "opacity-0");
          popover.classList.add("scale-100", "opacity-100");
        });
      } else {
        popover.classList.remove("scale-100", "opacity-100");
        popover.classList.add("scale-95", "opacity-0");
        setTimeout(() => popover.classList.add("hidden"), 200);
      }
    });

    document.addEventListener("click", (e) => {
      if (
        !popover.classList.contains("hidden") &&
        !popover.contains(e.target) &&
        !mobilityBtn.contains(e.target)
      ) {
        popover.classList.remove("scale-100", "opacity-100");
        popover.classList.add("scale-95", "opacity-0");
        setTimeout(() => popover.classList.add("hidden"), 200);
      }
    });

    if (window.lucide) lucide.createIcons();
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
