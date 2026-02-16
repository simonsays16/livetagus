/* sudoku-train.js - Gestão da barra de tempo real do Sudoku */

const FERTAGUS_STATIONS_SUDOKU = [
  { id: "9468122", key: "setubal", name: "Setúbal" },
  { id: "9468098", key: "palmela", name: "Palmela" },
  { id: "9468049", key: "venda_do_alcaide", name: "Venda do Alcaide" },
  { id: "9468007", key: "pinhal_novo", name: "Pinhal Novo" },
  { id: "9417095", key: "penalva", name: "Penalva" },
  { id: "9417236", key: "coina", name: "Coina" },
  { id: "9417186", key: "fogueteiro", name: "Fogueteiro" },
  { id: "9417152", key: "foros_de_amora", name: "Foros de Amora" },
  { id: "9417137", key: "corroios", name: "Corroios" },
  { id: "9417087", key: "pragal", name: "Pragal" },
  { id: "9467033", key: "campolide", name: "Campolide" },
  { id: "9466076", key: "sete_rios", name: "Sete Rios" },
  { id: "9466050", key: "entrecampos", name: "Entrecampos" },
  { id: "9466035", key: "roma_areeiro", name: "Roma-Areeiro" },
];

const API_URL = "https://api.livetagus.pt/fertagus/";
const API_KEY = "KoKi30rVWuwkF9lqKL6j4mb0VMg3dIXWs6QDHZ3de0G8lC5qvu";

let liveTargetDate = null;
let uiUpdateInterval = null;
let apiFetchInterval = null;

function parseTime(str) {
  if (!str) return null;
  const [h, m] = str.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d < new Date(Date.now() - 4 * 3600000)) d.setDate(d.getDate() + 1);
  return d;
}

function addMins(str, min) {
  const d = parseTime(str);
  if (!d) return "--:--";
  d.setMinutes(d.getMinutes() + min);
  return d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

async function fetchNextTrainAndSetupBanner() {
  const orgKey = localStorage.getItem("ft_org") || "corroios";
  const dstKey = localStorage.getItem("ft_dst") || "roma_areeiro";

  const orgInfo = FERTAGUS_STATIONS_SUDOKU.find((s) => s.key === orgKey);
  const dstInfo = FERTAGUS_STATIONS_SUDOKU.find((s) => s.key === dstKey);

  if (!orgInfo || !dstInfo) return;

  // 1. ATUALIZA A ORIGEM E DESTINO IMEDIATAMENTE (Garante que aparecem sempre!)
  document.getElementById("train-info-banner").classList.remove("hidden");
  document.getElementById("banner-org").innerText = orgInfo.name;
  document.getElementById("banner-dst").innerText = dstInfo.name;

  try {
    const res = await fetch(API_URL, {
      headers: { "x-api-key": API_KEY, Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Erro na API");
    const data = await res.json();

    const trains = Object.values(data).filter((t) => t && t["id-comboio"]);
    let validTrains = [];

    for (const t of trains) {
      if (!t.NodesPassagemComboio) continue;

      const orgNodeIdx = t.NodesPassagemComboio.findIndex(
        (n) => n.EstacaoID == orgInfo.id,
      );
      const dstNodeIdx = t.NodesPassagemComboio.findIndex(
        (n) => n.NomeEstacao.toUpperCase() === dstInfo.name.toUpperCase(),
      );

      if (orgNodeIdx !== -1 && dstNodeIdx !== -1 && orgNodeIdx < dstNodeIdx) {
        const orgNode = t.NodesPassagemComboio[orgNodeIdx];

        if (!orgNode.ComboioPassou && t.SituacaoComboio !== "SUPRIMIDO") {
          validTrains.push({
            apiTrain: t,
            orgNode: orgNode,
            scheduledTime: parseTime(orgNode.HoraProgramada.substring(0, 5)),
          });
        }
      }
    }

    validTrains.sort((a, b) => a.scheduledTime - b.scheduledTime);

    // 2. LÓGICA DO ESTADO DO COMBOIO
    if (validTrains.length > 0) {
      const nextTrainData = validTrains[0];
      const train = nextTrainData.apiTrain;
      const originNode = nextTrainData.orgNode;

      let diffMin = 0;
      let statusText = "A Horas";
      let dotColor = "bg-emerald-500";

      if (train.SituacaoComboio && /atraso/i.test(train.SituacaoComboio)) {
        const match = train.SituacaoComboio.match(/(\d+)/);
        if (match) {
          diffMin = parseInt(match[1]);
          statusText = `Atraso ${diffMin} min`;
          dotColor = "bg-yellow-500";
        }
      }

      const progStr = originNode.HoraProgramada;
      const prevStr = originNode.HoraPrevista;
      let mainTime = progStr.substring(0, 5);

      if (diffMin > 0) {
        mainTime = addMins(progStr, diffMin);
      } else if (prevStr && prevStr !== progStr) {
        mainTime = prevStr.substring(0, 5);
      }

      liveTargetDate = parseTime(mainTime);

      document.getElementById("banner-status").innerText = statusText;
      document.getElementById("banner-dot").className =
        `w-1.5 h-1.5 rounded-full animate-pulse shrink-0 ${dotColor}`;
    } else {
      // Se não houver comboios, a origem e destino já estão preenchidos!
      document.getElementById("banner-status").innerText = "Fim de serviço";
      document.getElementById("banner-countdown").innerText = "AMANHÃ";
      document.getElementById("banner-dot").className =
        `w-1.5 h-1.5 rounded-full shrink-0 bg-zinc-500`;
      liveTargetDate = null;
    }
  } catch (e) {
    console.error("Erro ao obter comboio para o banner:", e);
  }
}

function updateLiveCountdown() {
  if (!liveTargetDate) return;
  const now = new Date();
  let diff = Math.floor((liveTargetDate - now) / 1000);

  if (diff <= 0) {
    document.getElementById("banner-countdown").innerText = "A Chegar";
    document.getElementById("banner-countdown").classList.add("animate-pulse");
    return;
  }

  const min = Math.floor(diff / 60);
  const sec = Math.floor((diff % 60) / 10) * 10;
  document.getElementById("banner-countdown").innerText =
    `${min} min ${sec.toString().padStart(2, "0")} s`;
  document.getElementById("banner-countdown").classList.remove("animate-pulse");
}

function initSudokuTrainBanner() {
  fetchNextTrainAndSetupBanner();

  if (uiUpdateInterval) clearInterval(uiUpdateInterval);
  if (apiFetchInterval) clearInterval(apiFetchInterval);

  uiUpdateInterval = setInterval(updateLiveCountdown, 1000);
  apiFetchInterval = setInterval(fetchNextTrainAndSetupBanner, 30000);
}
