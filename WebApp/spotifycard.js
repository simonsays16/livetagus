// Lógica do Cartão Spotify
const SPOTIFY_API_URL = "https://api.npoint.io/0f0a3c1ca3b044f666e8";

async function loadSpotifyCard() {
  const container = document.getElementById("spotify-card-container");
  const coverImg = document.getElementById("sp-cover");
  const titleText = document.getElementById("sp-title");
  const artistText = document.getElementById("sp-artist");
  const btnLink = document.getElementById("sp-link");
  const badge = document.getElementById("quinzena-badge");

  try {
    const response = await fetch(`${SPOTIFY_API_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = await response.json();

    // Verificar dados minimos de funcionamento
    if (data.album_link || data.album_id) {
      // Artista e Album
      artistText.innerText = data.artist_name || "Artista";
      titleText.innerText = data.album_name || "Sugestão Musical";

      // Link
      btnLink.href =
        data.album_link || `https://open.spotify.com/album/${data.album_id}`;

      // Imagem Link
      if (data.album_cover) {
        coverImg.src = data.album_cover;
      }

      // Nota?
      if (data.nota && data.nota.trim() !== "") {
        if (badge) badge.innerText = data.nota;
      } else {
        // Quinzena atual se o campo "nota" estiver vazio
        const agora = new Date();
        const mes = agora
          .toLocaleString("pt-PT", { month: "short" })
          .replace(".", "");
        const mesCap = mes.charAt(0).toUpperCase() + mes.slice(1);
        const parte = agora.getDate() <= 15 ? "1.ª" : "2.ª";
        if (badge) badge.innerText = `${parte} Quiz. ${mesCap}`;
      }

      // Mostrar cartao
      container.classList.remove("hidden");
      if (window.lucide) lucide.createIcons();
    }
  } catch (e) {
    console.error("Erro no widget Spotify:", e);
  }
}
document.addEventListener("DOMContentLoaded", loadSpotifyCard);
