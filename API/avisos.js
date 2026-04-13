const fs = require("fs");
const path = require("path");

const avisosPath = path.join(__dirname, "avisos.json");
let avisosCache = {};

function ensureFileExists() {
  if (!fs.existsSync(avisosPath)) {
    console.log(
      "Ficheiro avisos.json não encontrado. A criar ficheiro vazio para binding do watcher...",
    );
    try {
      fs.writeFileSync(avisosPath, JSON.stringify({}), "utf8");
    } catch (e) {
      console.error("Erro ao tentar criar avisos.json:", e.message);
    }
  }
}

function updateAvisos() {
  try {
    if (fs.existsSync(avisosPath)) {
      const data = fs.readFileSync(avisosPath, "utf8");
      avisosCache = data.trim() === "" ? {} : JSON.parse(data);
    } else {
      avisosCache = {};
    }
  } catch (error) {
    console.error("Erro ao ler avisos.json local:", error.message);
  }
}

// init
ensureFileExists();
updateAvisos();

try {
  if (fs.existsSync(avisosPath)) {
    fs.watch(avisosPath, (eventType) => {
      if (eventType === "change") {
        updateAvisos();
      }
    });
  }
} catch (e) {
  console.warn(
    "Aviso: Não foi possível configurar o fs.watch para o avisos.json.",
    e.message,
  );
}

setInterval(updateAvisos, 60000);

module.exports = {
  getAvisos: () => avisosCache,
};
