/* Filename: dev.js */

const CLIENT_API_KEY = "KoKi30rVWuwkF9lqKL6j4mb0VMg3dIXWs6QDHZ3de0G8lC5qvu";
const API_URL = "https://api.livetagus.pt/fertagus";

document.addEventListener("DOMContentLoaded", () => {
  // 1. Ligar o botão de atualizar
  const btnRefresh = document.getElementById("btn-refresh");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", fetchData);
  }

  // 2. Delegação de eventos para os botões de copiar (pois são gerados dinamicamente)
  const trainsList = document.getElementById("trains-list");
  if (trainsList) {
    trainsList.addEventListener("click", (event) => {
      // Verifica se o clique foi num botão de copiar ou dentro dele
      const btn = event.target.closest(".btn-copy");
      if (btn) {
        const key = btn.getAttribute("data-key");
        copySnippet(key, btn);
      }
    });
  }

  // 3. Fazer o primeiro fetch ao carregar a página
  fetchData();
});

async function fetchData() {
  const loader = document.getElementById("loader");
  const statusBadge = document.getElementById("status-badge");
  const errorBox = document.getElementById("error-box");
  const timestamp = document.getElementById("timestamp");

  loader.classList.remove("hidden");
  errorBox.classList.add("hidden");
  statusBadge.innerText = "FETCHING";
  statusBadge.className =
    "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400";

  try {
    const res = await fetch(API_URL + "?t=" + Date.now(), {
      method: "GET",
      headers: {
        "x-api-key": CLIENT_API_KEY,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    renderTrains(data);

    statusBadge.innerText = "ONLINE";
    statusBadge.className =
      "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400";
    if (timestamp) timestamp.innerText = new Date().toLocaleTimeString("pt-PT");
  } catch (err) {
    errorBox.classList.remove("hidden");
    document.getElementById("error-message").innerText =
      `CRITICAL_ERROR: ${err.message}`;
    statusBadge.innerText = "ERROR";
    statusBadge.className =
      "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400";
  } finally {
    loader.classList.add("hidden");
  }
}

function renderTrains(data) {
  const listContainer = document.getElementById("trains-list");
  if (!listContainer) return;
  listContainer.innerHTML = "";

  const keys = Object.keys(data);

  if (keys.length === 0) {
    listContainer.innerHTML =
      '<div class="p-12 text-center text-zinc-600 text-[10px] uppercase tracking-widest">Nenhum payload recebido.</div>';
    return;
  }

  keys.forEach((key) => {
    const train = data[key];
    const isFuture = key === "futureTrains";

    const details = document.createElement("details");
    details.className = "group transition-all hover:bg-white/[0.02]";

    let summaryTitle = "";
    if (isFuture) {
      summaryTitle = `<span class="text-amber-500 font-bold font-mono text-xs tracking-tighter">FUTURE_TRAINS_ARRAY</span>`;
    } else {
      const route =
        train.Origem && train.Destino
          ? `${train.Origem} → ${train.Destino}`
          : "SYSTEM_LOG";
      summaryTitle = `
        <div class="flex items-center gap-3 min-w-0">
            <span class="text-blue-500 font-mono font-bold text-xs">#${key}</span>
            <span class="text-zinc-300 text-xs font-semibold truncate uppercase tracking-tight">${route}</span>
        </div>
        <div class="ml-auto flex items-center gap-2">
            ${train.Live ? '<span class="text-[8px] font-bold bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded border border-blue-500/20 uppercase tracking-widest">LIVE</span>' : ""}
            <svg class="w-3 h-3 text-zinc-700 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      `;
    }

    // Removido o onclick e adicionada a classe 'btn-copy' e 'data-key'
    details.innerHTML = `
      <summary class="flex items-center p-5 outline-none">
          ${summaryTitle}
      </summary>
      <div class="bg-black/40 px-5 pb-5 border-t border-white/[0.03]">
          <div class="flex justify-between items-center py-3">
              <span class="text-[9px] text-zinc-600 font-bold uppercase tracking-[0.2em]">JSON_STRUCT_DATA</span>
              <button data-key="${key}" class="btn-copy text-[9px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1 rounded-md transition-all uppercase font-bold tracking-widest cursor-pointer">Copiar</button>
          </div>
          <pre id="code-${key}" class="text-blue-400/80 text-[11px] leading-relaxed overflow-auto custom-scrollbar p-4 bg-[#050505] border border-white/5 rounded-xl">${JSON.stringify(train, null, 2)}</pre>
      </div>
    `;

    listContainer.appendChild(details);
  });
}

async function copySnippet(id, btn) {
  const codeEl = document.getElementById(`code-${id}`);
  if (!codeEl) return;

  const text = codeEl.innerText;

  try {
    // Método mais moderno de cópia (navegadores atuais)
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback para navegadores antigos
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    const originalText = btn.innerText;
    const originalClass = btn.className;

    btn.innerText = "COPIADO";
    btn.className = btn.className.replace(
      "bg-zinc-800",
      "bg-blue-600 text-white",
    );
    btn.className = btn.className.replace("text-zinc-300", ""); // remover a cor do texto antigo

    setTimeout(() => {
      btn.innerText = originalText;
      btn.className = originalClass;
    }, 1500);
  } catch (err) {
    console.error("Copy failed", err);
  }
}
