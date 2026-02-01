"use client";

import { useRouter } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { generateRoomCode } from "@/lib/roomCode";
import { getOrCreatePlayerId } from "@/lib/playerId";

export default function HomeClient() {
  const router = useRouter();

  async function createGame() {
    const roomCode = generateRoomCode();
    const playerId = getOrCreatePlayerId();

    // Raum anlegen
    await setDoc(doc(db, "rooms", roomCode), {
      createdAt: serverTimestamp(),
      phase: "lobby",
      round: 0,
      hostId: playerId,
    });

    // Host als Spieler anlegen (WICHTIG: id speichern!)
    await setDoc(
      doc(db, "rooms", roomCode, "players", playerId),
      {
        id: playerId,
        name: "Host",
        joinedAt: serverTimestamp(),
        score: 0,
        isHost: true,
      },
      { merge: true }
    );

    router.push(`/room/${roomCode}`);
  }

  return (
    <main className="min-h-screen p-6 flex items-center justify-center">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-bold">Whose Song?</h1>
          <p className="text-sm text-gray-600">
            Multiplayer Musik-Party-Spiel (öffnet nur Spotify-Links)
          </p>
        </header>

        <div className="space-y-3">
          <button
            onClick={createGame}
            className="w-full rounded-xl bg-black text-white py-3 font-medium"
          >
            Neues Spiel erstellen
          </button>

          <button
            className="w-full rounded-xl border border-black py-3 font-medium"
            onClick={() => router.push("/join")}
          >
            Spiel beitreten
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center">
          Hinweis: Die App spielt keine Musik ab – sie öffnet nur Spotify-Links.
        </p>
      </div>
    </main>
  );
}
