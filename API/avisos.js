const fetch = require("node-fetch");

let avisosCache = {};

async function updateAvisos() {
  try {
    const response = await fetch("https://api.npoint.io/fe6b8c687169feff5f87", {
      method: "GET",
      timeout: 5000,
    });

    if (response.ok) {
      avisosCache = await response.json();
    } else {
      console.error("Erro ao obter avisos do npoint. Status:", response.status);
    }
  } catch (error) {
    console.error("Erro de rede ao atualizar avisos:", error.message);
  }
}

updateAvisos();
setInterval(updateAvisos, 60000);

module.exports = {
  getAvisos: () => avisosCache,
};
