/**
 * mapa-tema.js · LiveTagus (mapa)
 * Tema escuro do mapa, sem trocar de estilo nem de fornecedor de tiles.
 *
 * O basemap é uma camada raster do OpenStreetMap. Escurecê-la à bruta
 * (baixar o brilho) dá um mapa abafado: o terreno do OSM é claro e as letras
 * são escuras, por isso ao escurecer tudo as letras desaparecem no fundo.
 *
 * O que se faz aqui é INVERTER. O MapLibre não tem "raster-invert", mas o
 * raster-brightness aceita um mínimo MAIOR do que o máximo, e isso inverte a
 * luminância: terreno claro → escuro, letras escuras → claras. A inversão
 * também roda as cores (a água azul fica alaranjada), e o hue-rotate de 180°
 * devolve-as ao sítio. É a receita clássica de mapa escuro a partir de tiles
 * claros, e é usada por muita app de transportes.
 *
 * Porquê isto e não um estilo escuro a sério: trocar de estilo com
 * map.setStyle() destrói TODAS as fontes e camadas, e há módulos aqui que não
 * sobrevivem a isso (o mapa-render e o mapa-cm não reagem a "styledata" — a
 * linha da Fertagus e as paragens Carris desapareciam a cada troca de tema).
 * Mexer só na paint da camada do basemap não destrói nada.
 *
 * Se um dia isto não chegar, o passo seguinte é trocar o URL dos tiles por um
 * basemap escuro a sério com setTiles() — que também não destrói camadas.
 *
 * Inclusão: <script src="./mapa-tema.js" defer></script> (depois do mapa-render.js)
 */

(function () {
  "use strict";
  if (window.MapaTema) return;

  const BASEMAP_LAYER = "basemap-layer";

  // Valores a afinar. O brilho invertido é o que faz o trabalho todo; o resto
  // é correcção do que a inversão estraga.
  const ESCURO = {
    "raster-brightness-min": 1, // maior que o max = inverte a luminância
    "raster-brightness-max": 0,
    "raster-hue-rotate": 180, // devolve as cores rodadas pela inversão
    "raster-saturation": -0.45, // a inversão exagera a cor; isto acalma-a
    "raster-contrast": -0.12, // menos contraste, para não picar os olhos
  };

  // Os valores por omissão do MapLibre. Repostos explicitamente, para o tema
  // claro ficar EXACTAMENTE como estava.
  const CLARO = {
    "raster-brightness-min": 0,
    "raster-brightness-max": 1,
    "raster-hue-rotate": 0,
    "raster-saturation": 0,
    "raster-contrast": 0,
  };

  let map = null;
  let aplicado = null; // "dark" | "light"
  let observando = false;

  function isDark() {
    return document.documentElement.classList.contains("dark");
  }

  function aplicar(forcar) {
    if (!map) return;
    const alvo = isDark() ? "dark" : "light";
    if (!forcar && alvo === aplicado) return;
    if (!map.getLayer(BASEMAP_LAYER)) return; // ainda não há basemap
    const props = alvo === "dark" ? ESCURO : CLARO;
    try {
      for (const k in props) map.setPaintProperty(BASEMAP_LAYER, k, props[k]);
      aplicado = alvo;
    } catch (e) {
      console.warn("[MapaTema] não foi possível aplicar:", e && e.message);
    }
  }

  // As etiquetas das camadas próprias (Metro, CP, guardadas) já sabem mudar de
  // cor, mas os seus applyTheme() só correm no "styledata" — que não dispara
  // quando se alterna o tema. Disparar o evento à mão põe todos a actualizar
  // sem ser preciso mexer em nenhum: é o mesmo caminho que já percorrem quando
  // o estilo muda, portanto já está testado por uso.
  function avisarCamadas() {
    try {
      if (map && map.fire) map.fire("styledata");
    } catch (_) {}
    try {
      window.dispatchEvent(
        new CustomEvent("lt:theme", { detail: { dark: isDark() } }),
      );
    } catch (_) {}
  }

  function onTemaMudou() {
    const antes = aplicado;
    aplicar();
    if (aplicado !== antes) avisarCamadas();
  }

  // Não há evento de mudança de tema no site: o interruptor mexe na classe do
  // <html> e mais nada. Observar essa classe é o mesmo padrão que o
  // paragens.js já usa.
  function observarTema() {
    // A guarda tem de ser uma variável do módulo. Testar window.MapaTema não
    // servia: já está definido quando o init corre, e o observador nunca
    // chegava a ser criado.
    if (observando) return;
    observando = true;
    try {
      const obs = new MutationObserver(onTemaMudou);
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    } catch (_) {}
    // Preferência do sistema, para quem não fixou um tema.
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", onTemaMudou);
    } catch (_) {}
  }

  function init(m) {
    map = m;
    if (map.isStyleLoaded()) aplicar(true);
    else map.once("styledata", () => aplicar(true));
    // Uma troca de estilo repõe a paint por omissão; volta a aplicar.
    map.on("styledata", () => aplicar(true));
    observarTema();
  }

  function patchMapaRender() {
    if (!window.MapaRender) return false;
    if (window.MapaRender._temaPatched) return true;
    const orig = window.MapaRender.setMap;
    window.MapaRender.setMap = function (m) {
      if (orig) orig.call(this, m);
      init(m);
    };
    window.MapaRender._temaPatched = true;
    return true;
  }
  if (!patchMapaRender()) {
    const t = setInterval(() => {
      if (patchMapaRender()) clearInterval(t);
    }, 20);
  }

  window.MapaTema = {
    isDark,
    // Reaplica à força — útil na consola ao afinar os valores.
    refresh: () => aplicar(true),
    // Para experimentar sem editar o ficheiro:
    //   MapaTema.set({ "raster-saturation": -0.2 }); MapaTema.refresh();
    set: (props) => Object.assign(ESCURO, props || {}),
    valores: () => Object.assign({}, ESCURO),
  };
})();
