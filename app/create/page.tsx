"use client";

import { useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { getOrCreatePlayerId } from "@/lib/playerId";

function makeRoomCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export default function CreatePage() {
  const [status, setStatus] = useState("");

  async function createRoom() {
    try {
      setStatus("Erstelle Raum…");

      const playerId = getOrCreatePlayerId();

      let code = "";
      for (let i = 0; i < 8; i++) {
        const candidate = makeRoomCode();
        const snap = await getDoc(doc(db, "rooms", candidate));
        if (!snap.exists()) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        setStatus("❌ Kein freier Raumcode gefunden.");
        return;
      }

      await setDoc(doc(db, "rooms", code), {
        phase: "lobby",
        hostId: playerId, // ✅ HOST WIRD HIER FEST GESETZT

        totalRounds: 1,
        roundNumber: 0,
        indexInRound: 0,

        songOrder: [],
        currentSongUrl: "",
        currentSongOwnerId: "",

        createdAt: serverTimestamp(),
      });

      window.location.href = `/room/${code}`;
    } catch (e: any) {
      setStatus(`❌ Fehler: ${e?.message ?? String(e)}`);
    }
  }

  return (
    <main className="ws-page">
      <div className="ws-container">
        <div className="ws-card">
          <div className="ws-card-title">Neues Spiel</div>
          <div className="ws-muted">
            Erstelle einen Raum und lade deine Freunde ein.
          </div>

          <button className="ws-btn" style={{ marginTop: 16 }} onClick={createRoom}>
            Raum erstellen
          </button>

          {status && <div className="ws-muted" style={{ marginTop: 12 }}>{status}</div>}
        </div>
      </div>
    </main>
  );
}
