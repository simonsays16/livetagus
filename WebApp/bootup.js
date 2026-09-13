#!/usr/bin/env node
/**
 * bootup.js · LiveTagus
 * Preparação dos dados no deploy. Corre no Netlify, antes da publicação.
 *
 * Três passos, independentes uns dos outros:
 *   1. Gerar os bundles GTFS (CP, MTS, Metro de Lisboa) com o gtfs-departures.
 *   2. Corrigir o calendário do MTS, que o feed publico acaba em 2025.
 *   3. Actualizar as paragens da Carris Metropolitana: o stops_cm.json e, no
 *      ligacoes_atualizado.json, apenas o bloco "cm" de cada estação.
 *
 * Filosofia de falha: um passo que corre mal não impede os outros, porque
 * ficar com dados de ontem é melhor do que não publicar. Mas o resumo final
 * diz o que falhou, e o passo 1 faz o build falhar se rebentar pq sem bundles
 * não vale a pena publicar.
 *
 * Uso:
 *   node bootup.js              tudo
 *   node bootup.js --skip-gtfs  só os passos 2 e 3 (útil a testar localmente)
 *   node bootup.js --strict     qualquer falha faz o build falhar
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ─── CAMINHOS ───────────────────────────────────────────────────────────────
const RAIZ = process.cwd();
const DIR_GTFS = path.join(RAIZ, "resources/data/gtfs");
const CAL_MTS = path.join(
  DIR_GTFS,
  "metro-transportes-do-sul-gtfs-departures/calendar.json",
);
const STOPS_CM = path.join(RAIZ, "resources/data/json/stops_cm.json");
const LIGACOES = path.join(RAIZ, "json/ligacoes_atualizado.json");

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

// O CSV chama "Areeiro" ao que a Fertagus chama "Roma-Areeiro".
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

// ─── 1. BUNDLES GTFS ────────────────────────────────────────────────────────
function passoGtfs() {
  log("\n[1/3] Bundles GTFS");
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
// isto, a app não mostra partida nenhuma do MTS
// O que se preserva do original, e é importante:
//   - os feriados já lá estão listados até 2030 (added_dates no DOM,
//     removed_dates nos restantes);
//   - a divisão Verão/Inverno nos dias úteis.
// O que se estende são só os intervalos de validade.
function passoCalendario() {
  log("\n[2/3] Calendário do MTS");
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
  log("\n[3/3] Carris Metropolitana");
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
    const chave = ALIAS_CSV[norm(est.nome)] || norm(est.nome);
    const linhaCsv = csvPorNome.get(chave);
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
  if (!okGtfs || (estrito && falhas.length)) process.exit(1);
})();
