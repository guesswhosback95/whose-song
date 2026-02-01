export function getOrCreatePlayerId() {
  if (typeof window === "undefined") return "server";

  const key = "whoseSong_playerId";
  let id = localStorage.getItem(key);

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }

  return id;
}
