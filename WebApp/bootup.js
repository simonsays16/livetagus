#!/usr/bin/env node
/**
 * bootup.js · LiveTagus
 * Preparação dos dados no deploy. Corre no Netlify, antes da publicação.
 *
 * Quatro passos, independentes uns dos outros:
 *   1. Gerar os bundles GTFS (CP, MTS, Metro de Lisboa) com o gtfs-departures.
 *   2. Corrigir o calendário do MTS, que o feed publica sempre a acabar em 2025.
 *   3. Actualizar as paragens da Carris Metropolitana: o stops_cm.json e, no
 *      ligacoes_atualizado.json, APENAS o bloco "cm" de cada estação.
 *   4. Minificar TODO o JavaScript do site, sw.js incluído. O Netlify
 *      descontinuou a optimização de assets, por isso ia tudo para produção
 *      com comentários e espaços.
 *      SÓ corre no Netlify: o site é publicado a partir da raiz, e isto
 *      reescreve os ficheiros de origem — localmente estragava a árvore de
 *      trabalho.
 *
 * Filosofia de falha: um passo que corre mal não impede os outros, porque
 * ficar com dados de ontem é melhor do que não publicar. Mas o resumo final
 * diz o que falhou, e o passo 1 faz o build falhar se rebentar — sem bundles
 * não vale a pena publicar.
 *
 * Uso:
 *   node bootup.js              tudo
 *   node bootup.js --skip-gtfs  só os passos 2 e 3 (útil a testar localmente)
 *   node bootup.js --strict     qualquer falha faz o build falhar
 *   node bootup.js --so-bibliotecas   só o passo 0 (para correr em localhost
 *                               depois de um npm install)
 *   node bootup.js --minify     minifica mesmo fora do Netlify (reescreve os ficheiroS)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

// ─── CAMINHOS ───────────────────────────────────────────────────────────────
const RAIZ = process.cwd();
const DIR_GTFS = path.join(RAIZ, "data/gtfs");
const CAL_MTS = path.join(
  DIR_GTFS,
  "metro-transportes-do-sul-gtfs-departures/calendar.json",
);
// Inicio restruturação da app
const STOPS_CM = path.join(RAIZ, "data/json/stops_cm.json");
const LIGACOES = path.join(RAIZ, "data/json/ligacoes_atualizado.json");

// ─── FONTES ─────────────────────────────────────────────────────────────────
const FEEDS = [
  { nome: "CP", url: "https://publico.cp.pt/gtfs/gtfs.zip" },
  { nome: "MTS", url: "https://mts.pt/imt/MTS-20240129.zip" },
  {
    nome: "Metro de Lisboa",
    url: "https://www.metrolisboa.pt/google_transit/googleTransit.zip",
  },
];

const API_CM = "https://api.carrismetropolitana.pt/v2";
const CSV_LIGACOES =
  "https://raw.githubusercontent.com/carrismetropolitana/datasets/latest/connections/train_stations/train_stations.csv";

// Até que ano estender o calendário do MTS.
const ANO_FIM = 2027;

// As 14 estações da Fertagus, com o id da IP que é a chave do ligacoes.json.
const ESTACOES = [
  { id: "9468122", nome: "Setúbal" },
  { id: "9468098", nome: "Palmela" },
  { id: "9468049", nome: "Venda do Alcaide" },
  { id: "9468007", nome: "Pinhal Novo" },
  { id: "9417095", nome: "Penalva" },
  { id: "9417236", nome: "Coina" },
  { id: "9417186", nome: "Fogueteiro" },
  { id: "9417152", nome: "Foros de Amora" },
  { id: "9417137", nome: "Corroios" },
  { id: "9417087", nome: "Pragal" },
  { id: "9467033", nome: "Campolide" },
  { id: "9466076", nome: "Sete Rios" },
  { id: "9466050", nome: "Entrecampos" },
  { id: "9466035", nome: "Roma-Areeiro" },
];

// O CSV chama "Areeiro" ao que a Fertagus chama "Roma-Areeiro". É a única
// divergência nas 14 — verificada contra o ficheiro, não adivinhada.
const ALIAS_CSV = { "roma areeiro": "areeiro" };

// ─── UTILITÁRIOS ────────────────────────────────────────────────────────────
const falhas = [];
const log = (...a) => console.log(...a);
const aviso = (...a) => console.warn("  aviso:", ...a);

function norm(v) {
  return String(v == null ? "" : v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lerJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function escreverJSON(p, dados, bonito) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(dados, null, bonito ? 4 : 0));
}

async function baixar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r;
}

// Um CSV com aspas e vírgulas dentro dos campos (os nomes de freguesia têm
// ambos). Um split(",") partia essas linhas ao meio.
function lerCSV(texto) {
  const linhas = [];
  let campo = "";
  let linha = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') aspas = true;
    else if (c === ",") {
      linha.push(campo);
      campo = "";
    } else if (c === "\n") {
      linha.push(campo.replace(/\r$/, ""));
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo || linha.length) {
    linha.push(campo.replace(/\r$/, ""));
    linhas.push(linha);
  }
  const cab = linhas.shift() || [];
  return linhas
    .filter((l) => l.length > 1)
    .map((l) => Object.fromEntries(cab.map((h, i) => [h, l[i] ?? ""])));
}

// ─── 0. BIBLIOTECAS ─────────────────────────────────────────────────────────
//
// O MapLibre vinha do unpkg por um proxy do netlify.toml. Passa a vir do
// node_modules, na versão FIXADA no package.json, copiado para /vendor/ com a
// versão no nome. Três ganhos:
//   - o Netlify serve-o com a sua compressão (o proxy chegava maior do que o
//     ficheiro comprimido em Brotli);
//   - com a versão no URL pode ter cache imutável de um ano: quem volta ao
//     mapa não o volta a descarregar, e uma versão nova é um URL novo;
//   - o unpkg sai do caminho em produção.
//
// A versão e o hash SRI tinham de bater certo à mão em três sítios. Agora o
// build CONFIRMA que o HTML aponta para o ficheiro e o hash certos, e FALHA se
// não — com a tag exacta a copiar. Um mapa partido em produção passa a ser um
// build vermelho, e o Netlify mantém o deploy anterior.
//
// O .min.js no nome não é enfeite: o passo 4 salta esses ficheiros. O
// MapLibre já vem minificado, e reminificá-lo ganhava 2 KB e arriscava partir
// o worker, que é construído a partir do texto das próprias funções.
//
// Este passo corre SEMPRE, também em localhost: só escreve em vendor/, que é
// gerado (vai no .gitignore), e nunca toca nos ficheiros de origem.
const BIBLIOTECAS = [
  {
    pacote: "maplibre-gl",
    origem: "dist/maplibre-gl.js",
    destino: (v) => `vendor/maplibre-gl@${v}.min.js`,
  },
  {
    pacote: "maplibre-gl",
    origem: "dist/maplibre-gl.css",
    destino: (v) => `vendor/maplibre-gl@${v}.css`,
  },
];
const PAGINAS_COM_BIBLIOTECAS = ["mapa.html"];

// O source map não vai: sem ele, a última linha fazia quem abrisse as
// ferramentas de programador ver um 404.
function semSourceMap(texto) {
  return texto
    .replace(/\n\/\/# sourceMappingURL=[^\n]*\s*$/, "\n")
    .replace(/\n?\/\*# sourceMappingURL=[^*]*\*\/\s*$/, "\n");
}

function sri(buf) {
  return "sha384-" + crypto.createHash("sha384").update(buf).digest("base64");
}

// A tag (script ou link) que aponta para `caminho`, e o integrity que tem.
function tagQueAponta(html, caminho) {
  const re = /<(script|link)\b[^>]*>/gis;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const url = /\b(?:src|href)\s*=\s*"([^"]+)"/i.exec(tag);
    if (!url || url[1] !== caminho) continue;
    const integ = /\bintegrity\s*=\s*["']([^"']+)["']/i.exec(tag);
    return { tag, integrity: integ ? integ[1] : null };
  }
  return null;
}

function passoBibliotecas() {
  log("\n[0/4] Bibliotecas");
  let ok = true;
  const esperado = [];
  for (const b of BIBLIOTECAS) {
    let versao;
    try {
      versao = lerJSON(
        path.join(RAIZ, "node_modules", b.pacote, "package.json"),
      ).version;
    } catch (_) {
      falhas.push(`${b.pacote} não instalado`);
      aviso(
        `falta o ${b.pacote} no node_modules. No package.json: "dependencies": { "${b.pacote}": "<versão>" }`,
      );
      ok = false;
      continue;
    }
    const origem = path.join(RAIZ, "node_modules", b.pacote, b.origem);
    const destinoRel = b.destino(versao);
    const destino = path.join(RAIZ, destinoRel);
    const buf = Buffer.from(
      semSourceMap(fs.readFileSync(origem, "utf8")),
      "utf8",
    );
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, buf);
    const hash = sri(buf);
    esperado.push({
      caminho: "/" + destinoRel.replace(/\\/g, "/"),
      hash,
      versao,
      pacote: b.pacote,
    });
    log(
      `  ${destinoRel} · ${(buf.length / 1024).toFixed(0)} KB · ${hash.slice(0, 22)}…`,
    );
  }

  // O HTML aponta mesmo para estes ficheiros, com estes hashes?
  for (const pag of PAGINAS_COM_BIBLIOTECAS) {
    let html;
    try {
      html = fs.readFileSync(path.join(RAIZ, pag), "utf8");
    } catch (_) {
      continue;
    }
    for (const e of esperado) {
      const t = tagQueAponta(html, e.caminho);
      const sugestao = e.caminho.endsWith(".css")
        ? `<link rel="stylesheet" href="${e.caminho}" integrity="${e.hash}" />`
        : `<script src="${e.caminho}" integrity="${e.hash}" defer></script>`;
      if (!t) {
        ok = false;
        falhas.push(`${pag} não aponta para ${e.caminho}`);
        console.error(
          `  FALHA ${pag} não carrega ${e.caminho} (o package.json instala o ${e.pacote} ${e.versao}).\n` +
            `        Tag certa:\n        ${sugestao}`,
        );
      } else if (!t.integrity) {
        // Sem integrity: aceite. Para ficheiros servidos pelo próprio site o
        // SRI protege pouco (quem alterasse o /vendor/ alterava o HTML), e a
        // integridade do pacote já é verificada pelo package-lock.json. O que
        // parte o mapa é a VERSÃO não bater, e isso continua a falhar acima.
        // Com integrity o Mozilla Observatory dá +5; sem ele, fica neutro.
        log(`  aviso: ${pag} carrega ${e.caminho} sem integrity (aceite).`);
      } else if (t.integrity !== e.hash) {
        // Com integrity, tem de bater: senão o browser recusa o ficheiro e o
        // mapa não arranca.
        ok = false;
        falhas.push(`${pag}: integrity errado em ${e.caminho}`);
        console.error(
          `  FALHA ${pag}: o integrity de ${e.caminho} não bate — o browser recusava o ficheiro.\n` +
            `        Encontrado: ${t.integrity}\n` +
            `        Esperado:   ${e.hash}\n` +
            `        Tag certa (ou tira o integrity):\n        ${sugestao}`,
        );
      }
    }
  }
  if (ok) log("  o HTML aponta para as versões certas");
  return ok;
}

// ─── 1. BUNDLES GTFS ────────────────────────────────────────────────────────
function passoGtfs() {
  log("\n[1/4] Bundles GTFS");
  if (process.argv.includes("--skip-gtfs")) {
    log("  saltado (--skip-gtfs)");
    return true;
  }
  fs.mkdirSync(DIR_GTFS, { recursive: true });
  let todosOk = true;
  // Um a um, e não encadeados com &&: assim uma fonte em baixo não impede as
  // outras de serem geradas.
  for (const f of FEEDS) {
    try {
      log(`  ${f.nome}…`);
      execSync(
        `npx --yes gtfs-departures --url ${JSON.stringify(f.url)} --out ${JSON.stringify(DIR_GTFS + "/")} --minify`,
        { stdio: "inherit", cwd: RAIZ },
      );
    } catch (e) {
      todosOk = false;
      falhas.push(`GTFS ${f.nome}: ${e.message}`);
      aviso(`${f.nome} falhou; fica o bundle anterior, se existir.`);
    }
  }
  return todosOk;
}

// ─── 2. CALENDÁRIO DO MTS ───────────────────────────────────────────────────
//
// O feed do MTS é um ficheiro fixo de 2024 e o calendário acaba em 2025. Sem
// isto, a app não mostra partida nenhuma do MTS — foi exactamente o que
// aconteceu com o Metro quando o feed passou a começar no dia seguinte.
//
// O que se preserva do original, e é importante:
//   - os feriados já lá estão listados até 2030 (added_dates no DOM,
//     removed_dates nos restantes);
//   - a divisão Verão/Inverno nos dias úteis.
// O que se estende são só os intervalos de validade.
function passoCalendario() {
  log("\n[2/4] Calendário do MTS");
  if (!fs.existsSync(CAL_MTS)) {
    falhas.push("calendário do MTS não encontrado");
    aviso(`não existe: ${CAL_MTS}`);
    return false;
  }
  const cal = lerJSON(CAL_MTS);
  const fim = `${ANO_FIM}1231`;

  // Feriados: a lista de added_dates do serviço de domingo é a fonte.
  const feriados = new Set((cal.DOM && cal.DOM.added_dates) || []);
  if (!feriados.size) aviso("sem lista de feriados no serviço DOM.");

  // A janela de Verão vem do próprio ficheiro, não é inventada aqui: se o MTS
  // mudar as datas da época alta, isto acompanha.
  const verao = cal.DS_verao;
  let mdIni = "0715";
  let mdFim = "0907";
  if (verao && verao.start_date && verao.end_date) {
    mdIni = verao.start_date.slice(4);
    mdFim = verao.end_date.slice(4);
  } else {
    aviso("DS_verao sem datas; a assumir 15/07 a 07/09.");
  }

  const anoIni = Number((cal.DS_inverno || {}).start_date || "20240908").slice
    ? Number(
        String((cal.DS_inverno || {}).start_date || "20240908").slice(0, 4),
      )
    : 2024;

  const juntar = (a, b) => Array.from(new Set([...(a || []), ...b])).sort();

  // Todos os dias úteis de Verão, ano a ano, sem feriados.
  const uteisVerao = [];
  for (let ano = anoIni; ano <= ANO_FIM; ano++) {
    const de = new Date(
      `${ano}-${mdIni.slice(0, 2)}-${mdIni.slice(2)}T12:00:00`,
    );
    const ate = new Date(
      `${ano}-${mdFim.slice(0, 2)}-${mdFim.slice(2)}T12:00:00`,
    );
    for (let d = new Date(de); d <= ate; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // fins-de-semana têm serviço próprio
      const s =
        `${d.getFullYear()}` +
        String(d.getMonth() + 1).padStart(2, "0") +
        String(d.getDate()).padStart(2, "0");
      if (feriados.has(s)) continue; // feriado é serviço de domingo
      uteisVerao.push(s);
    }
  }

  // Domingos e feriados, e sábados: só o fim da validade muda.
  if (cal.DOM) cal.DOM.end_date = fim;
  if (cal.SAB) cal.SAB.end_date = fim;

  // Nos outros serviços, os feriados TÊM de estar removidos — nesses dias
  // corre o horário de domingo.
  //
  // O feed não é consistente nisto: o DS_inverno só exclui os feriados de data
  // fixa e esquece os móveis (Sexta-Feira Santa, Corpo de Deus). Com a
  // validade original isso quase não se via; ao estender para 2027 passavam a
  // existir dias com DOIS serviços activos ao mesmo tempo. A lista do DOM é a
  // fonte de verdade dos feriados, e é dela que se tiram.
  let conflitos = 0;
  for (const sid of ["SAB", "DS_inverno", "DS_verao"]) {
    const v = cal[sid];
    if (!v) continue;
    const antes = new Set(v.removed_dates || []);
    for (const f of feriados) if (!antes.has(f)) conflitos++;
    v.removed_dates = juntar(v.removed_dates, Array.from(feriados));
  }
  if (conflitos) {
    aviso(
      `${conflitos} feriados não estavam excluídos dos serviços de dias úteis/sábado no feed; acrescentados.`,
    );
  }

  // Dias úteis de Inverno: passa a cobrir até ao fim, menos o Verão.
  if (cal.DS_inverno) {
    cal.DS_inverno.end_date = fim;
    cal.DS_inverno.removed_dates = juntar(
      cal.DS_inverno.removed_dates,
      uteisVerao,
    );
  }

  // Dias úteis de Verão: em vez de um intervalo (que só sabe representar uma
  // época), passa a correr nas datas listadas. Os dias da semana vão a zero
  // para as added_dates mandarem sozinhas.
  if (cal.DS_verao) {
    cal.DS_verao.start_date = `${anoIni}0101`;
    cal.DS_verao.end_date = fim;
    for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday"])
      cal.DS_verao[d] = 0;
    cal.DS_verao.added_dates = juntar(cal.DS_verao.added_dates, uteisVerao);
  }

  // "DS_inveno" (sem o "r") não tem dias da semana nem intervalo: nunca corre.
  // É lixo do feed. Não o apago — se alguma viagem lhe apontar, apagá-lo fazia
  // desaparecer partidas em silêncio. Fica o aviso.
  if (cal.DS_inveno) {
    aviso(
      'existe um serviço "DS_inveno" (erro de escrita no feed) sem dias nem datas: nunca corre.',
    );
  }

  // As excepções são avaliadas ANTES do intervalo de validade, por isso um
  // feriado listado para 2028 ainda activava o serviço de domingo depois de o
  // calendário ter expirado — dias soltos com serviço no meio de nada, que é
  // pior do que não haver serviço nenhum. Cortar as excepções à validade faz
  // o calendário acabar mesmo onde diz que acaba.
  let cortadas = 0;
  for (const sid of Object.keys(cal)) {
    const v = cal[sid];
    if (!v || !v.start_date || !v.end_date) continue;
    for (const campo of ["added_dates", "removed_dates"]) {
      const antes = (v[campo] || []).length;
      v[campo] = (v[campo] || []).filter(
        (d) => d >= v.start_date && d <= v.end_date,
      );
      cortadas += antes - v[campo].length;
    }
  }

  escreverJSON(CAL_MTS, cal, false);
  log(
    `  validade estendida até ${fim} · ${uteisVerao.length} dias úteis de Verão marcados · ${feriados.size} feriados na origem · ${cortadas} excepções fora da validade removidas`,
  );
  return true;
}

// ─── 3. CARRIS METROPOLITANA ────────────────────────────────────────────────
async function passoCarris() {
  log("\n[3/4] Carris Metropolitana");
  const [stopsRes, linesRes, csvRes] = await Promise.all([
    baixar(`${API_CM}/stops`),
    baixar(`${API_CM}/lines`),
    baixar(CSV_LIGACOES),
  ]);
  const stops = await stopsRes.json();
  const lines = await linesRes.json();
  const csv = lerCSV(await csvRes.text());

  // ── 3a. stops_cm.json ──
  const daMargem = stops.filter(
    (s) => s.line_ids && s.line_ids.some((id) => /^[1234]/.test(String(id))),
  );
  escreverJSON(
    STOPS_CM,
    daMargem.map((s) => ({
      id: s.id,
      n: s.long_name,
      l: s.line_ids,
      c: [s.lat, s.lon],
    })),
    false,
  );
  log(`  stops_cm.json: ${daMargem.length} paragens`);

  // ── 3b. ligações ──
  if (!fs.existsSync(LIGACOES)) {
    falhas.push("ligacoes_atualizado.json não encontrado");
    aviso(`não existe: ${LIGACOES}`);
    return false;
  }
  const lig = lerJSON(LIGACOES);
  const linhasPorId = new Map(lines.map((l) => [String(l.id), l]));
  const stopsPorId = new Map(stops.map((s) => [String(s.id), s]));

  // O CSV da Carris diz, por estação de comboio, que paragens fazem ligação.
  // Substitui a heurística por nome que o update_cm.js usava — "contém
  // Estação" apanhava paragens erradas e falhava outras.
  const csvPorNome = new Map(csv.map((r) => [norm(r.name), r]));

  let totalParagens = 0;
  let semCorrespondencia = 0;
  for (const est of ESTACOES) {
    const entrada = lig[est.id];
    if (!entrada || !entrada.ligacoes) {
      aviso(`${est.nome}: sem entrada no ligacoes_atualizado.json`);
      continue;
    }
    // O nome da Fertagus primeiro, o alias a seguir: se a Carris um dia
    // passar a chamar "Roma-Areeiro" ao "Areeiro", continua a funcionar.
    const linhaCsv =
      csvPorNome.get(norm(est.nome)) ||
      csvPorNome.get(ALIAS_CSV[norm(est.nome)] || "");
    if (!linhaCsv) {
      semCorrespondencia++;
      aviso(
        `${est.nome}: sem linha no CSV; ligações CM mantidas como estavam.`,
      );
      continue;
    }
    const ids = String(linhaCsv.stops || "")
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);

    const novas = [];
    for (const id of ids) {
      const s = stopsPorId.get(id);
      if (!s) {
        aviso(`${est.nome}: paragem ${id} não existe na API da Carris.`);
        continue;
      }
      novas.push({
        id: s.id,
        name: s.long_name,
        location: [s.lat, s.lon],
        gmapslink: `https://www.google.com/maps?q=${s.lat},${s.lon}`,
        lines: (s.line_ids || []).map((lid) => {
          const l = linhasPorId.get(String(lid));
          return {
            "line-id": lid,
            "line-name": l ? l.short_name : lid,
            "line-long-name": l ? l.long_name : "",
            "route-type": 3,
            "route-color": l ? l.color : "#FDB71A",
          };
        }),
      });
    }

    // Lista vazia não apaga o que lá está: uma resposta incompleta da API não
    // pode fazer desaparecer ligações que existem.
    if (!novas.length) {
      if (ids.length)
        aviso(
          `${est.nome}: nenhuma das ${ids.length} paragens do CSV foi resolvida; mantidas as anteriores.`,
        );
      else log(`  ${est.nome}: 0 paragens no CSV (mantidas as anteriores)`);
      continue;
    }

    // SÓ o bloco "cm". Metro, CP, Carris, TCB e Rede Expressos ficam intactos.
    entrada.ligacoes.cm = novas;
    totalParagens += novas.length;
    log(`  ${est.nome}: ${novas.length} paragens CM`);
  }

  escreverJSON(LIGACOES, lig, true);
  log(
    `  ligacoes_atualizado.json: ${totalParagens} paragens em ${ESTACOES.length - semCorrespondencia} estações`,
  );
  return semCorrespondencia === 0;
}

// ─── 4. MINIFICAÇÃO ─────────────────────────────────────────────────────────
//
// Porquê aqui e não num passo à parte: o site é publicado a partir da raiz
// (publish = "."), portanto não há pasta de saída — minificar é reescrever os
// ficheiros no sítio, no ambiente descartável do build.

// Todos os ficheiros do site são minificados, sw.js incluído. O browser
// detecta um service worker novo comparando bytes, mas com o terser numa
// versão FIXA no package.json a saída é determinista: um sw.js que não mudou
// sai byte a byte igual e não força ninguém a recarregar. Subir a versão do
// terser causa um refresh — uma vez, e de propósito.
//
// De fora ficam só pastas que não são código do site: as dependências (com
// milhares de ficheiros, incluindo o próprio terser), o repositório, a cache
// do Netlify e os dados gerados, que são só JSON.
const MIN_EXCLUIR_PASTAS = new Set([
  "node_modules",
  ".git",
  ".netlify",
  "resources",
]);

function listarJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") && e.name !== ".") {
      if (e.isDirectory()) continue;
    }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!MIN_EXCLUIR_PASTAS.has(e.name)) out.push(...listarJs(p));
      continue;
    }
    // .min.js já vem minificado: correr outra vez não ganha nada.
    if (!e.name.endsWith(".js") || e.name.endsWith(".min.js")) continue;
    out.push(p);
  }
  return out;
}

async function passoMinify() {
  log("\n[4/4] Minificação de JavaScript");
  const noNetlify = process.env.NETLIFY === "true";
  if (!noNetlify && !process.argv.includes("--minify")) {
    log("  saltado fora do Netlify (reescreveria os ficheiros de origem)");
    return true;
  }

  let terser;
  try {
    terser = require("terser");
  } catch (_) {
    falhas.push("terser não instalado; JS publicado sem minificar");
    aviso(
      'falta o terser. Acrescenta ao package.json: "devDependencies": { "terser": "5.51.2" }',
    );
    return false;
  }

  const ficheiros = listarJs(RAIZ);
  let antes = 0;
  let depois = 0;
  let feitos = 0;
  let falhados = 0;
  for (const f of ficheiros) {
    const rel = path.relative(RAIZ, f);
    let src;
    try {
      src = fs.readFileSync(f, "utf8");
    } catch (e) {
      continue;
    }
    try {
      const r = await terser.minify(src, {
        // Scripts clássicos, não módulos: uma função no topo de um ficheiro é
        // global e pode ser chamada por outro script. toplevel:false (o
        // omissão) garante que esses nomes não são encurtados.
        module: false,
        toplevel: false,
        compress: { passes: 2 },
        mangle: true,
        // As licenças de terceiros ficam: /*! … */, @license, @preserve.
        format: { comments: /^!|@license|@preserve/i },
      });
      if (!r || typeof r.code !== "string" || !r.code.length) {
        throw new Error("o minificador não devolveu código");
      }
      // Um ficheiro que não encolhe fica como está: não há nada a ganhar e
      // perdia-se a legibilidade.
      if (r.code.length >= src.length) continue;
      fs.writeFileSync(f, r.code);
      antes += Buffer.byteLength(src);
      depois += Buffer.byteLength(r.code);
      feitos++;
    } catch (e) {
      // O ficheiro fica intacto: só se escreve depois de a minificação correr
      // bem. Um erro aqui nunca estraga o que estava a funcionar.
      falhados++;
      aviso(`${rel}: ${(e && e.message) || e} — publicado sem minificar`);
    }
  }
  const kb = (n) => (n / 1024).toFixed(0) + " KB";
  const pct = antes ? ((1 - depois / antes) * 100).toFixed(0) : "0";
  log(
    `  ${feitos} de ${ficheiros.length} ficheiros · ${kb(antes)} → ${kb(depois)} (−${pct}%)` +
      (falhados ? ` · ${falhados} ficaram por minificar` : ""),
  );
  if (falhados) falhas.push(`${falhados} ficheiro(s) JS não minificado(s)`);
  return falhados === 0;
}

// ─── VERIFICAÇÃO FINAL ──────────────────────────────────────────────────────
//
// O incidente do Metro (feed a começar no dia seguinte, app sem partidas
// nenhumas em produção) só se descobriu com o site já publicado. Isto
// custa uma leitura de ficheiro e apanha-o antes.
function verificarCobertura() {
  log("\nVerificação: os calendários cobrem hoje?");
  const hoje = new Date();
  const s =
    `${hoje.getFullYear()}` +
    String(hoje.getMonth() + 1).padStart(2, "0") +
    String(hoje.getDate()).padStart(2, "0");
  let algumFora = false;
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(DIR_GTFS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (_) {
    aviso("pasta dos bundles não encontrada.");
    return false;
  }
  for (const d of dirs) {
    const p = path.join(DIR_GTFS, d, "calendar.json");
    if (!fs.existsSync(p)) continue;
    let cal;
    try {
      cal = lerJSON(p);
    } catch (_) {
      continue;
    }
    const servicos = Object.values(cal);
    const cobre = servicos.some(
      (v) =>
        (v.added_dates || []).includes(s) ||
        (v.start_date && v.end_date && v.start_date <= s && s <= v.end_date),
    );
    const inicios = servicos
      .map((v) => v.start_date)
      .filter(Boolean)
      .sort();
    const fins = servicos
      .map((v) => v.end_date)
      .filter(Boolean)
      .sort();
    if (cobre) {
      log(`  ok   ${d}`);
    } else {
      algumFora = true;
      falhas.push(`${d}: calendário não cobre ${s}`);
      console.warn(
        `  FALHA ${d}: nenhum serviço cobre ${s}. Validade: ${inicios[0] || "?"} → ${fins[fins.length - 1] || "?"}.\n` +
          `        Publicar isto deixa a app sem partidas deste operador.`,
      );
    }
  }
  return !algumFora;
}

// ─── ARRANQUE ───────────────────────────────────────────────────────────────
(async function main() {
  const t0 = Date.now();
  log("bootup.js · preparação dos dados");

  // Primeiro: se o MapLibre não bater certo com o HTML, o resto não interessa.
  const okBibliotecas = passoBibliotecas();
  if (process.argv.includes("--so-bibliotecas")) {
    process.exit(okBibliotecas ? 0 : 1);
  }

  const okGtfs = passoGtfs();

  try {
    passoCalendario();
  } catch (e) {
    falhas.push(`calendário do MTS: ${e.message}`);
    aviso(e.message);
  }

  try {
    await passoCarris();
  } catch (e) {
    falhas.push(`Carris: ${e.message}`);
    aviso(e.message);
  }

  try {
    await passoMinify();
  } catch (e) {
    falhas.push(`minificação: ${e.message}`);
    aviso(e.message);
  }

  verificarCobertura();

  log(`\nconcluído em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (falhas.length) {
    log(`${falhas.length} problema(s):`);
    for (const f of falhas) log(`  · ${f}`);
  } else {
    log("sem problemas.");
  }

  // Sem bundles não vale a pena publicar. O resto degrada para os ficheiros
  // que já estão no repositório, o que é preferível a não publicar.
  const estrito = process.argv.includes("--strict");
  // Sem bundles ou com o MapLibre desencontrado do HTML, não se publica: o
  // mapa não funcionava. O Netlify mantém o deploy anterior.
  if (!okGtfs || !okBibliotecas || (estrito && falhas.length)) process.exit(1);
})();
