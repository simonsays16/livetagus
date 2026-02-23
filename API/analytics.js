const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "status_db.json");

let stats = {
  totalTrainsAnalyzed: 0,
  stations: {},
};

// --- NOVO: Carregar dados antigos se o servidor reiniciar ---
if (fs.existsSync(DB_PATH)) {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    stats = JSON.parse(raw);
    console.log(
      `[Analytics] Estatísticas carregadas! ${stats.totalTrainsAnalyzed} comboios em memória.`,
    );
  } catch (e) {
    console.error("[Analytics] Erro ao ler status_db.json", e);
  }
}

// --- NOVO: Função para guardar no disco ---
const saveStatsToDisk = () => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(stats, null, 2));
  } catch (e) {
    console.error("[Analytics] Erro ao guardar estatísticas", e);
  }
};

const timeToSeconds = (timeStr) => {
  if (!timeStr || timeStr === "HH:MM:SS") return null;
  const parts = timeStr.split(":");
  // Forçamos a conversão para Número (parseInt) para impedir a concatenação de texto
  return (
    parseInt(parts[0]) * 3600 +
    parseInt(parts[1]) * 60 +
    parseInt(parts[2] || 0)
  );
};

const processCompletedTrain = (nodes, frozenPredictions, history) => {
  stats.totalTrainsAnalyzed++;

  nodes.forEach((node) => {
    const id = node.EstacaoID;
    const nome = node.NomeEstacao;
    const horaRealMs = history[id];
    const frozenStr = frozenPredictions[id];

    if (horaRealMs && frozenStr) {
      const realDate = new Date(horaRealMs);
      const realSecs =
        realDate.getHours() * 3600 +
        realDate.getMinutes() * 60 +
        realDate.getSeconds();
      const frozenSecs = timeToSeconds(frozenStr);

      if (frozenSecs !== null) {
        let diff = Math.abs(realSecs - frozenSecs);

        if (diff > 12 * 3600) diff = Math.abs(diff - 24 * 3600);

        if (!stats.stations[nome]) {
          stats.stations[nome] = { total: 0, hitsUnder30s: 0, sumDiff: 0 };
        }

        stats.stations[nome].total++;
        stats.stations[nome].sumDiff += diff;

        if (diff <= 60) {
          stats.stations[nome].hitsUnder30s++;
        }
      }
    }
  });

  // guardar viagem quando terminar
  saveStatsToDisk();
};

const getStatusReport = () => {
  const report = {
    global: { comboiosAnalisados: stats.totalTrainsAnalyzed },
    estacoes: {},
  };

  for (const [nome, data] of Object.entries(stats.stations)) {
    const accuracy =
      data.total > 0 ? ((data.hitsUnder30s / data.total) * 100).toFixed(1) : 0;
    const avgOffset =
      data.total > 0 ? Math.round(data.sumDiff / data.total) : 0;

    report.estacoes[nome] = {
      amostras: data.total,
      mediaErroSegundos: avgOffset,
      precisaoCerteza: `${accuracy}%`,
    };
  }
  return report;
};

module.exports = { processCompletedTrain, getStatusReport };
