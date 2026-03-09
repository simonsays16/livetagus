/**
 * app-trains.js
 * Lógica de fetch à API Fertagus e processamento dos dados dos comboios.
 * Depende de: app-config.js
 */

/**
 * Obtém e processa os comboios a partir da API Fertagus + base de dados local.
 */
async function fetchFertagusNewAPI() {
  const currentDB = activeTab === "lisboa" ? DB_LISBOA : DB_MARGEM;
  if (!currentDB) return [];
  try {
    const res = await fetch(API_FERTAGUS_NEW + "?t=" + Date.now(), {
      method: "GET",
      headers: {
        "x-api-key": CLIENT_API_KEY,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("API Middleware Error");
    const data = await res.json();

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

        const apiTrain = apiTrains.find((t) => t["id-comboio"] == dbTrain.id);

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
        if (dbTrain.setubal) originLabel = "SETÚBAL";
        else if (dbTrain.coina) originLabel = "COINA";
        let arrTime = scheduledDestStr;

        if (apiTrain && originNode) {
          isLive = apiTrain.Live;
          isSuppressed = apiTrain.SituacaoComboio === "SUPRIMIDO";
          hasPassedOrigin = originNode.ComboioPassou;
          if (destNode && destNode.HoraPrevista) {
            arrTime = destNode.HoraPrevista.substring(0, 5);
          }
          if (isSuppressed) {
            status = "SUPRIMIDO";
            dotStatus = "red";
            pulse = true;
          } else if (apiTrain) {
            const progStr = originNode.HoraProgramada;
            const prevStr = originNode.HoraPrevista;
            const obsStr = originNode.Observacoes;
            let diffMin = 0;
            let explicitDelayFound = false;
            if (
              apiTrain.SituacaoComboio &&
              /atraso/i.test(apiTrain.SituacaoComboio)
            ) {
              const match = apiTrain.SituacaoComboio.match(/(\d+)/);
              if (match) {
                diffMin = parseInt(match[1]);
                explicitDelayFound = true;
              }
            }
            const obsMatch = obsStr
              ? obsStr.match(/Hora Prevista:(\d{2}:\d{2})/)
              : null;
            if (obsMatch) {
              mainTime = obsMatch[1];
              if (!explicitDelayFound) {
                const dProg = window.parseTimeStr(progStr);
                const dObs = window.parseTimeStr(mainTime);
                diffMin = Math.round((dObs - dProg) / 60000);
              }
            } else if (explicitDelayFound) {
              mainTime = addMinutes(progStr, diffMin);
            } else if (prevStr && prevStr !== progStr) {
              mainTime = prevStr.substring(0, 5);
              const dProg = window.parseTimeStr(progStr);
              const dPrev = window.parseTimeStr(mainTime);
              diffMin = Math.round((dPrev - dProg) / 60000);
            } else {
              mainTime = progStr.substring(0, 5);
            }
            if (diffMin > 0) {
              status = `Atraso ${diffMin} min`;
              dotStatus = "yellow";
              pulse = true;
              secondaryTime = progStr.substring(0, 5);
              isLive = true;
            } else {
              if (isLive || explicitDelayFound || obsMatch) {
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
              if (hasPassedOrigin && !isSuppressed) status = `Em ${currName}`;
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
          const fStatus = futureTrains[dbTrain.id];
          if (fStatus) {
            if (fStatus.toUpperCase().includes("SUPRIMIDO")) {
              status = "SUPRIMIDO";
              dotStatus = "red";
              pulse = true;
              isSuppressed = true;
            } else if (/atraso/i.test(fStatus)) {
              const match = fStatus.match(/(\d+)/);
              if (match) {
                const delay = parseInt(match[1]);
                status = `Atraso ${delay} min`;
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
        if (isSuppressed && scheduledDate < now) return null;
        if (isLive) {
          if (destNode && destNode.ComboioPassou) return null;
        } else {
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
        };
      })
      .filter((t) => t !== null)
      .sort((a, b) => a.effectiveDate - b.effectiveDate);

    return processed;
  } catch (e) {
    console.error("Erro Fertagus API:", e);
    return [];
  }
}

async function getTrains() {
  const apiData = await fetchFertagusNewAPI();
  return apiData;
}
