/**
 * app-trains.js
 * Lógica de fetch à API Fertagus e processamento dos dados dos comboios.
 * Depende de: app-config.js
 *
 * CONTRATO DE RETORNO de fetchFertagusNewAPI():
 *   null  → erro de rede / offline  → a UI preserva cartões offline existentes
 *   []    → sem comboios (filtro normal) ou apiIsDown (flag separada)
 *   [...]  → lista de comboios processada com sucesso
 */

// ─── CHANGES MANAGER ────────────────────────────────────────────────────────
// Carrega changes.json e resolve, para a data operacional de hoje, quais
// comboios estão suprimidos e quais sofreram substituição de número.
// Toda a lógica é client-side para contornar falhas/atrasos da API.

const ChangesManager = {
  _cache: null,

  load: async function () {
    if (this._cache !== null) return this._cache;
    try {
      const res = await fetch("./json/changes.json?t=" + Date.now());
      if (!res.ok)
        throw new Error("changes.json nao encontrado (" + res.status + ")");
      this._cache = await res.json();
    } catch (e) {
      console.warn("[ChangesManager] Erro a carregar changes.json:", e.message);
      this._cache = { changes: [] };
    }
    return this._cache;
  },

  getActiveChange: async function () {
    const data = await this.load();
    const todayStr = this._todayISO();
    return (
      data.changes.find((c) => {
        const [start, end] = c.targetDates;
        return todayStr >= start && todayStr <= end;
      }) || null
    );
  },

  _todayISO: function () {
    const d = getOperationalDate();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  },
};

// ────────────────────────────────────────────────────────────────────────────

async function fetchFertagusNewAPI() {
  const currentDB = activeTab === "lisboa" ? DB_LISBOA : DB_MARGEM;
  if (!currentDB) return [];

  // Resolve changes.json ANTES do try/catch da API para que forceSuppressed e
  // replacements estejam sempre definidos, mesmo que o fetch à API falhe.
  const activeChange = await ChangesManager.getActiveChange();
  const forceSuppressed = new Set(
    activeChange ? activeChange.suppressed.map(String) : [],
  );
  const replacements = activeChange ? activeChange.replacements : {};

  try {
    const res = await fetch(API_FERTAGUS_NEW + "?t=" + Date.now(), {
      method: "GET",
      headers: {
        "x-api-key": CLIENT_API_KEY,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 503) {
      window.apiIsDown = true;
      return [];
    }

    if (!res.ok) throw new Error("API Middleware Error " + res.status);

    const data = await res.json();

    if (data.error === "IP_DOWN") {
      window.apiIsDown = true;
      return [];
    }

    window.apiIsDown = false;

    const futureTrains = data.futureTrains || {};
    const apiTrains = Object.values(data).filter((v) => v && v["id-comboio"]);
    const orgInfo = FERTAGUS_STATIONS.find((s) => s.key === fertagusOrigin);
    const dstInfo = FERTAGUS_STATIONS.find((s) => s.key === fertagusDest);
    const now = new Date();

    const allDbTrips = currentDB.trips.filter((trip) => {
      if (!trip[fertagusOrigin] || !trip[fertagusDest]) return false;

      const trainDate = window.parseTimeStr(trip[fertagusOrigin]);
      const destDate = window.parseTimeStr(trip[fertagusDest]);
      if (!trainDate || !destDate || trainDate >= destDate) return false;

      const opDate = new Date(trainDate);
      if (opDate.getHours() < 5) opDate.setDate(opDate.getDate() - 1);
      const trainIsWeekend = isWeekendOrHoliday(opDate);

      const hType = parseInt(trip.horario);
      if (hType === 1) return true;
      if (hType === 0 && !trainIsWeekend) return true;
      if (hType === 2 && trainIsWeekend) return true;
      return false;
    });

    const processed = allDbTrips
      .map((dbTrain) => {
        const scheduledTimeStr = dbTrain[fertagusOrigin];
        const scheduledDate = window.parseTimeStr(scheduledTimeStr);
        const scheduledDestStr = dbTrain[fertagusDest];

        const opDate = new Date(scheduledDate);
        if (opDate.getHours() < 5) opDate.setDate(opDate.getDate() - 1);
        const trainIsSpecialDay = isWeekendOrHoliday(opDate);

        // Se há número provisório, procura na API por ele; exibe o original.
        const lookupId = replacements[String(dbTrain.id)] || String(dbTrain.id);
        const apiTrain = apiTrains.find(
          (t) => String(t["id-comboio"]) === lookupId,
        );

        let originNode = null;
        let destNode = null;
        if (apiTrain) {
          originNode = apiTrain.NodesPassagemComboio.find(
            (n) => n.EstacaoID == orgInfo.id,
          );
          destNode = apiTrain.NodesPassagemComboio.find(
            (n) => n.NomeEstacao.toUpperCase() === dstInfo.name.toUpperCase(),
          );
        }

        let mainTime = scheduledTimeStr;
        let secondaryTime = null;
        let status = "Programado";
        let dotStatus = "gray";
        let pulse = false;
        let context = null;
        let isLive = false;
        let isSuppressed = false;
        let hasPassedOrigin = false;
        let originLabel = "FERTAGUS";
        if (dbTrain.setubal) originLabel = "SETUBAL";
        else if (dbTrain.coina) originLabel = "COINA";
        let arrTime = scheduledDestStr;

        // ── SUPRESSAO LOCAL (changes.json) ───────────────────────────────────
        // Aplicada antes de qualquer dado da API — o override local nao pode
        // ser desfeito por estados incorretos reportados pelo servidor.
        const isForceSuppr = forceSuppressed.has(String(dbTrain.id));
        if (isForceSuppr) {
          isSuppressed = true;
          status = "SUPRIMIDO";
          dotStatus = "red";
          pulse = true;
        }

        if (apiTrain && originNode) {
          isLive = apiTrain.Live;
          isSuppressed =
            isSuppressed || apiTrain.SituacaoComboio === "SUPRIMIDO";
          hasPassedOrigin = originNode.ComboioPassou;
          if (destNode && destNode.HoraPrevista) {
            arrTime = destNode.HoraPrevista.substring(0, 5);
          }
          const isPerturbacao =
            apiTrain.SituacaoComboio === "Possivel Perturbacao";

          if (isSuppressed) {
            status = "SUPRIMIDO";
            dotStatus = "red";
            pulse = true;
          } else if (isPerturbacao) {
            status = "Possível Perturbação";
            dotStatus = "orange";
            pulse = true;
            isLive = true;
          } else if (apiTrain) {
            // Fonte de verdade: HoraPrevista do no de origem.
            // Atraso = HoraPrevista - HoraProgramada (nunca inferido do texto).
            const progStr = originNode.HoraProgramada;
            const prevStr = originNode.HoraPrevista;

            if (prevStr && prevStr.length >= 5) {
              mainTime = prevStr.substring(0, 5);
            } else {
              mainTime = progStr.substring(0, 5);
            }

            const dProg = window.parseTimeStr(progStr);
            const dPrev = window.parseTimeStr(mainTime);
            const diffMin =
              dProg && dPrev ? Math.round((dPrev - dProg) / 60000) : 0;

            if (diffMin > 0) {
              status =
                "Atraso " +
                diffMin +
                ' min (Estimativa) <br /><span style="text-transform: none;" class="text-[10px] text-left text-zinc-500 dark:text-zinc-400 opacity-60">Atrasos podem ser recuperados.</span>';
              dotStatus = "yellow";
              pulse = true;
              secondaryTime = progStr.substring(0, 5);
              isLive = true;
            } else {
              if (isLive || prevStr) {
                status = "A Horas";
                dotStatus = "green";
                pulse = true;
                isLive = true;
              } else {
                status = "Programado";
                dotStatus = "green";
                pulse = true;
              }
            }
            const currentIdx = apiTrain.NodesPassagemComboio.findIndex(
              (n) => !n.ComboioPassou,
            );
            if (currentIdx >= 0) {
              const currNode = apiTrain.NodesPassagemComboio[currentIdx];
              const currName = currNode.NomeEstacao;
              if (hasPassedOrigin && !isSuppressed) status = "Em " + currName;
              const prevNode =
                currentIdx > 0
                  ? apiTrain.NodesPassagemComboio[currentIdx - 1]
                  : null;
              const nextNode = apiTrain.NodesPassagemComboio[currentIdx + 1]
                ? apiTrain.NodesPassagemComboio[currentIdx + 1]
                : null;
              context = {
                prev: prevNode
                  ? {
                      name: prevNode.NomeEstacao,
                      time: prevNode.HoraReal
                        ? prevNode.HoraReal.substring(0, 5)
                        : "--:--",
                    }
                  : null,
                curr: {
                  name: currName,
                  time: currNode.HoraPrevista
                    ? currNode.HoraPrevista.substring(0, 5)
                    : currNode.HoraProgramada.substring(0, 5),
                },
                next: nextNode
                  ? {
                      name: nextNode.NomeEstacao,
                      time: nextNode.HoraPrevista
                        ? nextNode.HoraPrevista.substring(0, 5)
                        : nextNode.HoraProgramada.substring(0, 5),
                    }
                  : null,
              };
            }
          }
        } else {
          // FutureTrains: para comboios sem dados detalhados na API.
          // Se ja esta em forceSuppressed, ignoramos completamente o estado
          // da API — "Realizado" ou outro valor nao pode desfazer a supressao.
          // Para comboios com número provisório (replacements), o estado no
          // futureTrains está sob o novo ID — usa lookupId em vez do original.
          const fStatus = isForceSuppr
            ? null
            : futureTrains[lookupId] || futureTrains[String(dbTrain.id)];
          if (fStatus) {
            if (fStatus.toUpperCase().includes("SUPRIMIDO")) {
              status = "SUPRIMIDO";
              dotStatus = "red";
              pulse = true;
              isSuppressed = true;
            } else if (/perturbação/i.test(fStatus)) {
              status = "Possível Perturbação";
              dotStatus = "orange";
              pulse = true;
            } else if (/atraso/i.test(fStatus)) {
              const match = fStatus.match(/(\d+)/);
              if (match) {
                const delay = parseInt(match[1]);
                status = "Atraso " + delay + " min";
                dotStatus = "yellow";
                pulse = true;
                mainTime = addMinutes(scheduledTimeStr, delay);
                secondaryTime = scheduledTimeStr;
                isLive = true;
              }
            } else if (/programado/i.test(fStatus) || /hora/i.test(fStatus)) {
              status = "Programado";
              dotStatus = "green";
              pulse = true;
            }
          }
        }

        // ── FILTROS DE VISIBILIDADE ──────────────────────────────────────────
        // Suprimidos pela API: removidos assim que a hora agendada passa.
        // Suprimidos pelo changes.json (isForceSuppr): visiveis todo o dia
        // operacional — o utilizador precisa de saber que o comboio foi suprimido.
        if (isSuppressed && !isForceSuppr && scheduledDate < now) return null;
        if (isLive && !isForceSuppr) {
          if (destNode && destNode.ComboioPassou) return null;
        } else if (!isSuppressed) {
          if (scheduledDate < now) return null;
        }

        const effectiveDate = window.parseTimeStr(mainTime);
        return {
          id: dbTrain.id,
          num: dbTrain.id,
          op: originLabel,
          time: mainTime,
          secTime: secondaryTime,
          dest: dstInfo.name,
          status: status,
          arr: arrTime,
          dotStatus: dotStatus,
          pulse: pulse,
          isLive: isLive,
          isSuppressed: isSuppressed,
          carriages: trainIsSpecialDay ? 4 : dbTrain.carruagens,
          occupancy: trainIsSpecialDay ? null : dbTrain.ocupacao,
          context: context,
          isPassed: hasPassedOrigin,
          isEffectiveFuture: !hasPassedOrigin && !isSuppressed,
          rawTime: scheduledDate,
          effectiveDate: effectiveDate,
          fullSchedule: apiTrain ? apiTrain.NodesPassagemComboio : null,
          isOffline: false,
        };
      })
      .filter((t) => t !== null)
      .sort((a, b) => a.effectiveDate - b.effectiveDate);

    return processed;
  } catch (e) {
    console.warn("[Fertagus API] Erro de rede:", e.message);
    return null;
  }
}

async function getTrains() {
  return await fetchFertagusNewAPI();
}
