/* Filename: horarios.js */

const stationsMap = {
  setubal: "Setúbal",
  palmela: "Palmela",
  venda_do_alcaide: "Venda do Alcaide",
  pinhal_novo: "Pinhal Novo",
  penalva: "Penalva",
  coina: "Coina",
  fogueteiro: "Fogueteiro",
  foros_de_amora: "Foros de Amora",
  corroios: "Corroios",
  pragal: "Pragal",
  campolide: "Campolide",
  sete_rios: "Sete Rios",
  entrecampos: "Entrecampos",
  roma_areeiro: "Roma-Areeiro",
};

const orderNorth = [
  "setubal",
  "palmela",
  "venda_do_alcaide",
  "pinhal_novo",
  "penalva",
  "coina",
  "fogueteiro",
  "foros_de_amora",
  "corroios",
  "pragal",
  "campolide",
  "sete_rios",
  "entrecampos",
  "roma_areeiro",
];

const orderSouth = [...orderNorth].reverse();

let currentDirection = "lisboa";
let currentDay = "semana";
let cachedData = {};

document.addEventListener("DOMContentLoaded", async () => {
  // Configurar Event Listeners dos botões (substitui os onclicks do HTML)
  const btnLisboa = document.getElementById("btn-lisboa");
  const btnMargem = document.getElementById("btn-margem");
  const btnSemana = document.getElementById("btn-semana");
  const btnFimDeSemana = document.getElementById("btn-fimdesemana");

  if (btnLisboa)
    btnLisboa.addEventListener("click", () => changeDirection("lisboa"));
  if (btnMargem)
    btnMargem.addEventListener("click", () => changeDirection("margem"));
  if (btnSemana) btnSemana.addEventListener("click", () => changeDay("semana"));
  if (btnFimDeSemana)
    btnFimDeSemana.addEventListener("click", () => changeDay("fimdesemana"));

  await loadSchedules();
  detectInitialDay();

  if (window.lucide) lucide.createIcons();
});

function detectInitialDay() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const todayStr = `${year}-${month}-${day}`;

  if (cachedData.feriados && cachedData.feriados[todayStr]) {
    changeDay("fimdesemana");
  } else {
    changeDay("semana");
  }
}

async function loadSchedules() {
  const loader = document.getElementById("loader");
  const tableWrapper = document.getElementById("table-wrapper");

  if (loader) loader.classList.remove("hidden");

  try {
    const [lisboaRes, margemRes, feriadosRes] = await Promise.all([
      fetch("./json/fertagus_sentido_lisboa.json"),
      fetch("./json/fertagus_sentido_margem.json"),
      fetch("./json/feriados.json"),
    ]);
    cachedData.lisboa = await lisboaRes.json();
    cachedData.margem = await margemRes.json();
    cachedData.feriados = await feriadosRes.json();
    render();
  } catch (error) {
    console.error("Erro:", error);
    if (tableWrapper) {
      tableWrapper.innerHTML = `<div class="p-8 text-center text-red-500">Erro de carregamento.</div>`;
    }
  } finally {
    if (loader) loader.classList.add("hidden");
  }
}

function changeDirection(dir) {
  if (currentDirection === dir) return;
  currentDirection = dir;
  updateButtonState("btn-lisboa", dir === "lisboa");
  updateButtonState("btn-margem", dir === "margem");
  render();

  const tableWrapper = document.getElementById("table-wrapper");
  if (tableWrapper) {
    tableWrapper.scrollTop = 0;
    tableWrapper.scrollLeft = 0;
  }
}

function changeDay(day) {
  currentDay = day;
  updateButtonState("btn-semana", day === "semana");
  updateButtonState("btn-fimdesemana", day === "fimdesemana");
  render();
}

function updateButtonState(id, isActive) {
  const el = document.getElementById(id);
  if (!el) return;

  if (isActive) {
    el.classList.remove(
      "text-zinc-500",
      "hover:text-zinc-700",
      "dark:hover:text-zinc-300",
    );
    el.classList.add(
      "bg-white",
      "dark:bg-zinc-800",
      "text-zinc-900",
      "dark:text-white",
      "shadow-sm",
    );
  } else {
    el.classList.add(
      "text-zinc-500",
      "hover:text-zinc-700",
      "dark:hover:text-zinc-300",
    );
    el.classList.remove(
      "bg-white",
      "dark:bg-zinc-800",
      "text-zinc-900",
      "dark:text-white",
      "shadow-sm",
    );
  }
}

function render() {
  const tableWrapper = document.getElementById("table-wrapper");
  const noTrains = document.getElementById("no-trains");

  if (!tableWrapper || !noTrains) return;
  if (!cachedData.lisboa || !cachedData.margem) return;

  const data =
    currentDirection === "lisboa" ? cachedData.lisboa : cachedData.margem;
  const stationsOrder = currentDirection === "lisboa" ? orderNorth : orderSouth;

  const filteredTrips = data.trips.filter((trip) => {
    if (currentDay === "semana") {
      return trip.horario === 0 || trip.horario === 1;
    } else {
      return trip.horario === 1 || trip.horario === 2;
    }
  });

  if (filteredTrips.length === 0) {
    tableWrapper.classList.add("hidden");
    noTrains.classList.remove("hidden");
    return;
  }

  tableWrapper.classList.remove("hidden");
  noTrains.classList.add("hidden");

  let html = `
      <table class="schedule-table">
          <thead>
              <tr>
                  <th class="details-col font-bold uppercase tracking-wider text-xs">Destino</th>
                  ${stationsOrder.map((key) => `<th class="station-col font-bold uppercase tracking-wider text-xs">${stationsMap[key]}</th>`).join("")}
              </tr>
          </thead>
          <tbody>
  `;

  filteredTrips.forEach((trip, index) => {
    const isEven = index % 2 === 0;
    const rowBgClass = isEven
      ? "bg-zinc-50 dark:bg-[#18181b]"
      : "bg-white dark:bg-[#09090b]";
    const isSetubal = trip.service === 1;
    const textClass = !isSetubal
      ? "text-blue-700 dark:text-blue-400 font-bold"
      : "text-zinc-900 dark:text-white font-medium";

    // LÓGICA DE CARRUAGENS: Forçar 4 em Fim de Semana / Feriados
    let carruagensNum = trip.carruagens;
    if (currentDay === "fimdesemana") {
      carruagensNum = 4;
    }

    const isDouble = carruagensNum === 8;
    const underlineClass = isDouble ? "train-underline" : "";
    const badgeClass = isDouble
      ? "bg-zinc-900 text-white dark:bg-white dark:text-black border-transparent"
      : "bg-transparent text-zinc-400 border-zinc-300 dark:border-zinc-700 border";

    const trainBadge = `<span class="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ml-2 ${badgeClass}" title="${carruagensNum} Carruagens">${carruagensNum}</span>`;
    const destText = isSetubal ? "Setúbal" : "Coina";

    html += `
          <tr class="${rowBgClass} hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors" data-train-id="${trip.id}">
              <td class="details-col">
                  <div class="flex items-center justify-between">
                      <span class="text-xs uppercase tracking-tight ${textClass}">${destText}</span>
                      ${trainBadge}
                  </div>
              </td>
              ${stationsOrder
                .map((station) => {
                  const time = trip[station];
                  return `
                    <td class="station-col ${textClass} ${underlineClass}">
                        ${time || '<span class="opacity-20 font-light">—</span>'}
                    </td>`;
                })
                .join("")}
          </tr>
      `;
  });

  html += `</tbody></table>`;
  tableWrapper.innerHTML = html;
}
