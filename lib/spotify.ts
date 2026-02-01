export function normalizeSpotifyUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // 1) spotify URI (z.B. spotify:track:...)
  if (raw.startsWith("spotify:")) {
    const parts = raw.split(":");
    if (parts.length >= 3) {
      const type = parts[1];
      const id = parts[2];
      if (type && id) return `https://open.spotify.com/${type}/${id}`;
    }
    return null;
  }

  // 2) open.spotify.com Link (auch mit /intl-de/ etc.)
  try {
    const url = new URL(raw);

    const hostOk =
      url.hostname === "open.spotify.com" || url.hostname.endsWith(".spotify.com");
    if (!hostOk) return null;

    // Tracking-Parameter entfernen (optional)
    url.search = "";

    // pathname z.B.:
    // /track/<id>
    // /intl-de/track/<id>
    // /intl-de/album/<id>
    // /intl-de/playlist/<id>

    const parts = url.pathname.split("/").filter(Boolean);
    // parts könnte sein: ["intl-de","track","ONJdto..."]
    // oder: ["track","ONJdto..."]

    const allowedTypes = new Set(["track", "album", "playlist"]);

    // finde den Typ-Index (track/album/playlist)
    const typeIndex = parts.findIndex((p) => allowedTypes.has(p));
    if (typeIndex === -1) return null;

    const type = parts[typeIndex];
    const id = parts[typeIndex + 1];
    if (!id) return null;

    return `https://open.spotify.com/${type}/${id}`;
  } catch {
    return null;
  }
}
