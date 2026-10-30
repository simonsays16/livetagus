/**
 * paragens-guardadas.js · LiveTagus
 * ─────────────────────────────────────────────────────────────────────────────
 * Fonte única das paragens da Carris Metropolitana guardadas pelo utilizador.
 * Usada pela página /paragens, pelo mapa (mapa-guardadas.js) e pela pesquisa
 * do mapa (mapa-search.js), para os três verem sempre a mesma lista.
 *
 * Dois registos no localStorage:
 *
 *   "cm_saved_stops"  — as ESCOLHAS do utilizador, em JSON simples e com a
 *     forma de sempre (compatível com versões anteriores):
 *       [{ id, name, addedAt, availableLines, hiddenLines }]
 *     O "name" é o nome que o utilizador lhe deu (pode ser editado).
 *
 *   "cm_saved_stops_info" — os DADOS da paragem que vêm da API da Carris
 *     (/stops e /lines, como no bootup.js): nome oficial, coordenadas e as
 *     linhas que lá param, com nome e cores. Comprimido:
 *       "d1:" + base64(deflate-raw(JSON))   (CompressionStream nativo)
 *       "j1:" + JSON                        (browsers sem CompressionStream)
 *     JSON compacto, com as linhas num dicionário partilhado (paragens
 *     vizinhas têm quase sempre as mesmas carreiras):
 *       { v: 1,
 *         s: { "<id>": [t, nomeOficial, lat, lon, [i, i, …]] },
 *         l: [[id, nomeCurto, nomeLongo, cor, corTexto], …] }
 *     t = quando foi atualizada (ms).
 *
 * Atualização: ao guardar, a paragem é completada logo a seguir. Ao abrir a
 * página /paragens, sync() verifica TODAS as guardadas e só vai à API se
 * alguma não tiver dados ou se os dados tiverem mais de TTL_MS. Um único
 * download de /stops + /lines serve todas as que precisarem.
 *
 * Eventos: dispara "lt:saved-stops-changed" na window a cada alteração.
 *
 * API: window.LTParagens
 *   MAX, list(), has(id), add({id,name,lines}), remove(id), move(de, para),
 *   rename(id, nome), setHidden(id, linhas), details(), detail(id),
 *   sync({ force, ids }), asLigacao(id), limparId(s), limparChegadas(arr)
 *   (limparChegadas não mexe no trip_id, que a TML precisa com o código)
 */

(function () {
  "use strict";
  if (window.LTParagens) return;

  const API = "https://api.carrismetropolitana.pt/v2";
  // Pedidos à Carris Metropolitana e à TML sem cookies: credentials "omit"
  // não envia nenhum e faz o browser ignorar os Set-Cookie das respostas.
  const SEM_COOKIES = { credentials: "omit" };
  const KEY = "cm_saved_stops";
  const KEY_INFO = "cm_saved_stops_info";
  const MAX = 25;
  const TTL_MS = 24 * 60 * 60 * 1000; // dados com mais de 1 dia são revistos
  const EVENTO = "lt:saved-stops-changed";

  // ─── IDS DA CARRIS ────────────────────────────────────────────────────
  // A API passou a pôr um código entre parênteses rectos antes do id
  // ("[YA15B]3521", "[YA15B]3521_1_1"). O id verdadeiro é o que fica sem ele.
  function limparId(v) {
    if (v == null) return v;
    return String(v).replace(/\[[^\]]*\]/g, "").trim();
  }
  // O trip_id fica como vem: o ETA da TML (go.tmlmobilidade.pt) precisa do
  // código entre parênteses. Os originais dos outros ficam em b._raw.
  const CAMPOS_ID = ["line_id", "pattern_id", "route_id"];
  function limparChegadas(arr) {
    if (!Array.isArray(arr)) return [];
    for (const b of arr) {
      if (!b || typeof b !== "object") continue;
      b._raw = b._raw || {};
      for (const k of CAMPOS_ID)
        if (b[k] != null) {
          if (b._raw[k] == null) b._raw[k] = b[k];
          b[k] = limparId(b[k]);
        }
    }
    return arr;
  }

  // ─── ESCOLHAS (JSON simples) ──────────────────────────────────────────
  function lerLista() {
    try {
      const raw = localStorage.getItem(KEY);
      const val = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(val)) return [];
      const vistos = new Set();
      const out = [];
      for (const s of val) {
        if (!s || s.id == null) continue;
        const id = String(s.id);
        if (vistos.has(id)) continue;
        vistos.add(id);
        out.push({
          id,
          name: String(s.name || `Paragem ${id}`),
          addedAt: s.addedAt || Date.now(),
          availableLines: (Array.isArray(s.availableLines) ? s.availableLines : [])
            .map((l) => limparId(l))
            .filter(Boolean),
          hiddenLines: (Array.isArray(s.hiddenLines) ? s.hiddenLines : [])
            .map((l) => limparId(l))
            .filter(Boolean),
        });
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function gravarLista(lista) {
    try {
      localStorage.setItem(KEY, JSON.stringify(lista));
      return true;
    } catch (e) {
      console.warn("[LTParagens] não foi possível guardar:", e && e.message);
      return false;
    }
  }

  function avisar() {
    try {
      window.dispatchEvent(new Event(EVENTO));
    } catch (_) {}
  }

  // ─── COMPRESSÃO ───────────────────────────────────────────────────────
  function paraBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function deBase64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function comprimir(texto) {
    if (typeof CompressionStream === "function") {
      try {
        const st = new Blob([texto])
          .stream()
          .pipeThrough(new CompressionStream("deflate-raw"));
        const buf = new Uint8Array(await new Response(st).arrayBuffer());
        return "d1:" + paraBase64(buf);
      } catch (_) {
        /* cai para JSON simples */
      }
    }
    return "j1:" + texto;
  }
  async function descomprimir(raw) {
    if (!raw) return null;
    if (raw.startsWith("j1:")) return raw.slice(3);
    if (raw.startsWith("d1:") && typeof DecompressionStream === "function") {
      const st = new Blob([deBase64(raw.slice(3))])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(st).text();
    }
    return null; // formato desconhecido: os dados voltam a ser pedidos
  }

  // ─── DADOS (comprimidos) ──────────────────────────────────────────────
  // Em memória: Map id → { id, name, lat, lon, t, lines: [{id, short, long, color, text}] }
  let info = null;
  let infoPromise = null;
  let gravacao = Promise.resolve();

  function carregarInfo() {
    if (info) return Promise.resolve(info);
    if (infoPromise) return infoPromise;
    infoPromise = (async () => {
      const m = new Map();
      try {
        const txt = await descomprimir(localStorage.getItem(KEY_INFO));
        const j = txt ? JSON.parse(txt) : null;
        if (j && j.v === 1 && j.s) {
          const L = Array.isArray(j.l) ? j.l : [];
          for (const [id, r] of Object.entries(j.s)) {
            if (!Array.isArray(r)) continue;
            const [t, name, lat, lon, idx] = r;
            m.set(id, {
              id,
              t: t || 0,
              name: name || "",
              lat,
              lon,
              lines: (Array.isArray(idx) ? idx : [])
                .map((i) => L[i])
                .filter(Boolean)
                .map(([lid, short, long, color, text]) => ({
                  id: lid,
                  short: short || lid,
                  long: long || "",
                  color: color || "",
                  text: text || "",
                })),
            });
          }
        }
      } catch (e) {
        console.warn("[LTParagens] dados ilegíveis; vão ser pedidos de novo.");
      }
      info = m;
      return m;
    })();
    return infoPromise;
  }

  function gravarInfo() {
    // Em fila: duas gravações seguidas nunca se cruzam.
    gravacao = gravacao.then(async () => {
      if (!info) return;
      const ids = new Set(lerLista().map((s) => s.id));
      const dic = [];
      const pos = new Map();
      const s = {};
      for (const [id, d] of info) {
        if (!ids.has(id)) continue; // só o que continua guardado
        const idx = d.lines.map((l) => {
          const k = `${l.id}|${l.short}|${l.long}|${l.color}|${l.text}`;
          if (!pos.has(k)) {
            pos.set(k, dic.length);
            dic.push([l.id, l.short, l.long, l.color, l.text]);
          }
          return pos.get(k);
        });
        s[id] = [d.t, d.name, d.lat, d.lon, idx];
      }
      try {
        localStorage.setItem(
          KEY_INFO,
          await comprimir(JSON.stringify({ v: 1, s, l: dic })),
        );
      } catch (e) {
        console.warn("[LTParagens] dados não gravados:", e && e.message);
      }
    });
    return gravacao;
  }

  // ─── API DA CARRIS ────────────────────────────────────────────────────
  // Um download por sessão serve todas as paragens que precisarem.
  let catalogo = null; // Promise<{ stops: Map, lines: Map }>

  function baixarCatalogo() {
    if (catalogo) return catalogo;
    catalogo = Promise.all([
      fetch(`${API}/stops`, { ...SEM_COOKIES, cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error("stops HTTP " + r.status);
        return r.json();
      }),
      fetch(`${API}/lines`, { ...SEM_COOKIES, cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error("lines HTTP " + r.status);
        return r.json();
      }),
    ])
      .then(([stops, lines]) => ({
        stops: new Map(
          (Array.isArray(stops) ? stops : []).map((s) => [limparId(s.id), s]),
        ),
        lines: new Map(
          (Array.isArray(lines) ? lines : []).map((l) => [limparId(l.id), l]),
        ),
      }))
      .catch((e) => {
        catalogo = null; // um erro não fica em cache
        throw e;
      });
    return catalogo;
  }

  function cor(v) {
    if (!v) return "";
    const s = String(v).trim();
    return s.startsWith("#") ? s : `#${s}`;
  }

  function montarDetalhe(id, s, linhas) {
    const lineIds = [];
    for (const lid of Array.isArray(s.line_ids) ? s.line_ids : []) {
      const c = limparId(lid);
      if (c && !lineIds.includes(c)) lineIds.push(c);
    }
    return {
      id,
      t: Date.now(),
      name: s.long_name || s.name || "",
      lat: Number(s.lat),
      lon: Number(s.lon),
      lines: lineIds.map((lid) => {
        const l = linhas.get(lid);
        return {
          id: lid,
          short: (l && limparId(l.short_name)) || lid,
          long: (l && l.long_name) || "",
          color: cor(l && l.color) || "#FDB71A",
          text: cor(l && l.text_color) || "",
        };
      }),
    };
  }

  /**
   * Verifica as paragens guardadas e atualiza as que precisam: sem dados,
   * com dados antigos (TTL_MS) ou todas, com force. Devolve os ids
   * atualizados. Sem rede, fica tudo como estava.
   */
  async function sync(opts) {
    const o = opts || {};
    const m = await carregarInfo();
    const lista = lerLista();
    const alvo = lista.filter((s) => {
      if (o.ids && !o.ids.includes(s.id)) return false;
      if (o.force) return true;
      const d = m.get(s.id);
      return !d || !d.lines || Date.now() - (d.t || 0) > TTL_MS;
    });
    if (!alvo.length) return [];

    const cat = await baixarCatalogo();
    const feitas = [];
    let mudouLista = false;
    for (const s of alvo) {
      const api = cat.stops.get(s.id);
      if (!api) continue; // paragem que já não existe: os dados antigos ficam
      const d = montarDetalhe(s.id, api, cat.lines);
      m.set(s.id, d);
      feitas.push(s.id);
      const novas = d.lines.map((l) => l.id);
      if (novas.join() !== s.availableLines.join()) {
        s.availableLines = novas;
        // Linhas escondidas que deixaram de passar lá saem da lista.
        s.hiddenLines = s.hiddenLines.filter((l) => novas.includes(l));
        mudouLista = true;
      }
    }
    if (mudouLista) {
      // Relê para não pisar uma alteração feita entretanto (outro separador).
      const atual = lerLista();
      for (const s of atual) {
        const n = alvo.find((x) => x.id === s.id);
        if (n) {
          s.availableLines = n.availableLines;
          s.hiddenLines = s.hiddenLines.filter((l) =>
            n.availableLines.includes(l),
          );
        }
      }
      gravarLista(atual);
    }
    if (feitas.length) {
      await gravarInfo();
      avisar();
    }
    return feitas;
  }

  // ─── ALTERAÇÕES ───────────────────────────────────────────────────────
  /** → { ok, motivo?: "existe" | "limite" | "armazenamento" } */
  function add(p) {
    const id = String(p && p.id != null ? p.id : "").trim();
    if (!id) return { ok: false, motivo: "id" };
    const lista = lerLista();
    if (lista.some((s) => s.id === id)) return { ok: false, motivo: "existe" };
    if (lista.length >= MAX) return { ok: false, motivo: "limite" };
    lista.push({
      id,
      name: String((p && p.name) || `Paragem ${id}`),
      addedAt: Date.now(),
      availableLines: ((p && p.lines) || []).map((l) => limparId(l)).filter(Boolean),
      hiddenLines: [],
    });
    if (!gravarLista(lista)) return { ok: false, motivo: "armazenamento" };
    avisar();
    // Completa com a API logo a seguir (nome oficial, coordenadas, linhas).
    sync({ ids: [id], force: true }).catch((e) =>
      console.warn("[LTParagens] sem dados da API para", id, e && e.message),
    );
    return { ok: true };
  }

  function remove(id) {
    id = String(id);
    const lista = lerLista().filter((s) => s.id !== id);
    gravarLista(lista);
    if (info) {
      info.delete(id);
      gravarInfo();
    }
    avisar();
  }

  function move(de, para) {
    const lista = lerLista();
    if (de < 0 || para < 0 || de >= lista.length || para >= lista.length) return;
    const [x] = lista.splice(de, 1);
    lista.splice(para, 0, x);
    gravarLista(lista);
    avisar();
  }

  function rename(id, nome) {
    const lista = lerLista();
    const s = lista.find((x) => x.id === String(id));
    if (!s) return;
    s.name = String(nome || "").trim() || s.name;
    gravarLista(lista);
    avisar();
  }

  function setHidden(id, linhas) {
    const lista = lerLista();
    const s = lista.find((x) => x.id === String(id));
    if (!s) return;
    s.hiddenLines = (linhas || []).map((l) => limparId(l)).filter(Boolean);
    gravarLista(lista);
    avisar();
  }

  // ─── LEITURA ──────────────────────────────────────────────────────────
  async function details() {
    return carregarInfo();
  }
  async function detail(id) {
    return (await carregarInfo()).get(String(id)) || null;
  }

  /** A mesma forma das paragens CM do ligacoes_atualizado.json (bootup.js). */
  async function asLigacao(id) {
    const d = await detail(id);
    if (!d || !Number.isFinite(d.lat) || !Number.isFinite(d.lon)) return null;
    return {
      id: d.id,
      name: d.name,
      location: [d.lat, d.lon],
      gmapslink: `https://www.google.com/maps?q=${d.lat},${d.lon}`,
      lines: d.lines.map((l) => ({
        "line-id": l.id,
        "line-name": l.short,
        "line-long-name": l.long,
        "route-type": 3,
        "route-color": l.color,
      })),
    };
  }

  // Outro separador mudou os dados: a cópia em memória deixa de valer.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY_INFO || e.key === null) {
      info = null;
      infoPromise = null;
    }
  });

  window.LTParagens = {
    MAX,
    EVENTO,
    list: lerLista,
    has: (id) => lerLista().some((s) => s.id === String(id)),
    add,
    remove,
    move,
    rename,
    setHidden,
    details,
    detail,
    sync,
    asLigacao,
    limparId,
    limparChegadas,
  };
})();
