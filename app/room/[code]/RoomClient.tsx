"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { getOrCreatePlayerId } from "@/lib/playerId";
import { normalizeSpotifyUrl } from "@/lib/spotify";
import RoomCodeBar from "@/components/RoomCodeBar";

type Phase = "lobby" | "collect" | "guessing" | "reveal" | "banger" | "finished";

type Room = {
  phase: Phase;
  hostId?: string;

  totalRounds: number;
  roundNumber: number;
  indexInRound: number;

  songOrder?: string[];

  currentSongUrl?: string;
  currentSongOwnerId?: string;
};

type Player = {
  id: string;
  name: string;
  color: string;
  score: number;
  isHost: boolean;
  joinedAt?: any;
};

type Submission = { url: string; createdAt?: any };
type SubmissionWithId = Submission & { id: string };

const PLAYER_COLORS = [
  "#F6E6A8", // Butter Yellow
  "#F2C27B", // Light Sunflower
  "#F7A6A1", // Peach
  "#E86A5A", // Tomato Red
  "#C6B7E2", // Wisterias
  "#CFEAF0", // Aqua
  "#8BB7DE", // Sky Blue
  "#7FC58E", // Spring Green
  "#C9D87A", // Light Leaf Green
  "#FAF3E3", // Warm Cream
];

function spotifyEmbedUrlFromSpotifyUrl(url: string): string {
  return url.replace("https://open.spotify.com/", "https://open.spotify.com/embed/");
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function phaseLabel(phase: Phase) {
  if (phase === "lobby") return "Warteraum";
  if (phase === "collect") return "Links eintragen";
  if (phase === "guessing") return "Raten";
  if (phase === "reveal") return "Auflösung";
  if (phase === "banger") return "Banger auswerten";
  return "Beendet";
}

function isBadDefaultName(name?: string) {
  const n = (name ?? "").trim().toLowerCase();
  return n.length < 2 || n === "host";
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="ws-card">{children}</div>;
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div className="ws-progress">
      <div className="ws-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

function medalForRank(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "•";
}

function Podium({ top3 }: { top3: Player[] }) {
  const p1 = top3[0];
  const p2 = top3[1];
  const p3 = top3[2];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
      <div className="ws-scorecard is-second" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 26 }}>🥈</div>
        {p2 ? (
          <>
            <div className="ws-avatar ws-avatar--big" style={{ margin: "10px auto 0", backgroundColor: p2.color }}>
              {(p2.name?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="ws-name ws-name--big" style={{ marginTop: 8 }}>
              {p2.name}
            </div>
            <div className="ws-muted">{p2.score ?? 0} Punkte</div>
          </>
        ) : (
          <div className="ws-muted" style={{ marginTop: 10 }}>
            —
          </div>
        )}
      </div>

      <div className="ws-scorecard is-first" style={{ textAlign: "center", transform: "translateY(-6px)" }}>
        <div style={{ fontSize: 28 }}>🥇</div>
        {p1 ? (
          <>
            <div className="ws-avatar ws-avatar--big" style={{ margin: "10px auto 0", backgroundColor: p1.color }}>
              {(p1.name?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="ws-name ws-name--big" style={{ marginTop: 8 }}>
              {p1.name}
            </div>
            <div className="ws-muted">{p1.score ?? 0} Punkte</div>
          </>
        ) : (
          <div className="ws-muted" style={{ marginTop: 10 }}>
            —
          </div>
        )}
      </div>

      <div className="ws-scorecard is-third" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 26 }}>🥉</div>
        {p3 ? (
          <>
            <div className="ws-avatar ws-avatar--big" style={{ margin: "10px auto 0", backgroundColor: p3.color }}>
              {(p3.name?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="ws-name ws-name--big" style={{ marginTop: 8 }}>
              {p3.name}
            </div>
            <div className="ws-muted">{p3.score ?? 0} Punkte</div>
          </>
        ) : (
          <div className="ws-muted" style={{ marginTop: 10 }}>
            —
          </div>
        )}
      </div>
    </div>
  );
}

function InGameScoreHeader({
  me,
  myRank,
  totalPlayers,
}: {
  me: Player | null;
  myRank: number | null;
  totalPlayers: number;
}) {
  const points = me?.score ?? 0;

  return (
    <div className="ws-row" style={{ alignItems: "baseline" }}>
      <div>
        <div className="ws-card-title" style={{ marginBottom: 4 }}>
          Dein Stand
        </div>
        <div className="ws-muted" style={{ fontSize: 13 }}>
          {myRank ? `Rang #${myRank}` : "Rang —"} · {points} Punkte · {totalPlayers} Spieler
        </div>
      </div>

      {myRank ? <div className="ws-chip">#{myRank}</div> : <div className="ws-chip">—</div>}
    </div>
  );
}

function InGameScoreMiniList({
  scoreboard,
  playerId,
}: {
  scoreboard: Player[];
  playerId: string;
}) {
  return (
    <div className="ws-list" style={{ marginTop: 12 }}>
      {scoreboard.map((p, idx) => (
        <div key={p.id} className="ws-list-item">
          <div className="ws-list-left">
            <div className="ws-chip" style={{ minWidth: 44, textAlign: "center" }}>
              #{idx + 1}
            </div>
            <div className="ws-avatar" style={{ backgroundColor: p.color }}>
              {(p.name?.[0] ?? "?").toUpperCase()}
            </div>
            <div className="ws-name">
              {p.name}
              {p.id === playerId ? <span className="ws-you">du</span> : null}
              {p.isHost ? <span className="ws-tag">Host</span> : null}
            </div>
          </div>
          <div className="ws-name">{p.score ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

export default function RoomClient({ code }: { code: string }) {
  const roomCode = code.toUpperCase();
  const playerId = useMemo(() => getOrCreatePlayerId(), []);

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState("");

  // Profil
  const [needsProfile, setNeedsProfile] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [selectedColor, setSelectedColor] = useState<string>(PLAYER_COLORS[0]);
  const [joinStatus, setJoinStatus] = useState("");

  // Submissions
  const [submissions, setSubmissions] = useState<SubmissionWithId[]>([]);
  const [songInput, setSongInput] = useState("");
  const [songStatus, setSongStatus] = useState("");
  const [optimisticSubmittedThisRound, setOptimisticSubmittedThisRound] = useState(false);

  // Votes (Guess)
  const [selectedGuessPlayerId, setSelectedGuessPlayerId] = useState("");
  const [voteStatus, setVoteStatus] = useState("");
  const [myVote, setMyVote] = useState<{ guessedPlayerId: string } | null>(null);
  const [votes, setVotes] = useState<Record<string, { guessedPlayerId: string }>>({});

  // 🔥 Banger während der Runde (1 pro Runde)
  const [bangers, setBangers] = useState<Record<string, { songOwnerId: string }>>({});
  const [myBanger, setMyBanger] = useState<{ songOwnerId: string } | null>(null);

  // Host status
  const [hostStatus, setHostStatus] = useState("");

  // UI FX
  const [shakeKey, setShakeKey] = useState(0);
  const [toast, setToast] = useState("");
  const [revealFxKey, setRevealFxKey] = useState(0);

  // Endscreen stats (Basis)
  const [statsOpen, setStatsOpen] = useState(false);

  // --- Live: Room / Players ---
  useEffect(() => {
    const roomRef = doc(db, "rooms", roomCode);

    const unsubRoom = onSnapshot(
      roomRef,
      (snap) => {
        if (!snap.exists()) {
          setError("Raum nicht gefunden.");
          setRoom(null);
          return;
        }
        setError("");
        const data = snap.data() as Room;
        setRoom({
          ...data,
          phase: (data.phase ?? "lobby") as Phase,
          totalRounds: data.totalRounds ?? 1,
          roundNumber: data.roundNumber ?? 0,
          indexInRound: data.indexInRound ?? 0,
          songOrder: data.songOrder ?? [],
          currentSongUrl: data.currentSongUrl ?? "",
          currentSongOwnerId: data.currentSongOwnerId ?? "",
        });
      },
      (err) => setError(err.message)
    );

    const playersRef = collection(db, "rooms", roomCode, "players");
    const playersQuery = query(playersRef, orderBy("joinedAt", "asc"));
    const unsubPlayers = onSnapshot(playersQuery, (snap) => {
      setPlayers(snap.docs.map((d) => d.data() as Player));
    });

    return () => {
      unsubRoom();
      unsubPlayers();
    };
  }, [roomCode]);

  const isHost = useMemo(() => room?.hostId === playerId, [room?.hostId, playerId]);

  // --- Scoreboard sorted ---
  const scoreboard = useMemo(() => {
    const copy = [...players];
    copy.sort((a, b) => {
      const sa = a.score ?? 0;
      const sb = b.score ?? 0;
      if (sb !== sa) return sb - sa;
      return 0;
    });
    return copy;
  }, [players]);

  const top3 = useMemo(() => scoreboard.slice(0, 3), [scoreboard]);

  const me = useMemo(() => players.find((p) => p.id === playerId) ?? null, [players, playerId]);

  const myRank = useMemo(() => {
    const idx = scoreboard.findIndex((p) => p.id === playerId);
    return idx >= 0 ? idx + 1 : null;
  }, [scoreboard, playerId]);

  // --- Profil-Check ---
  useEffect(() => {
    if (!room) return;

    (async () => {
      try {
        const meRef = doc(db, "rooms", roomCode, "players", playerId);
        const snap = await getDoc(meRef);

        if (!snap.exists()) {
          setNeedsProfile(true);
          setNameInput("");
          setSelectedColor(PLAYER_COLORS[0]);
          return;
        }

        const data = snap.data() as Partial<Player>;
        const nameMissing = isBadDefaultName(data?.name);
        const colorMissing = !data?.color;

        if (typeof data?.name === "string") setNameInput(data.name);
        if (typeof data?.color === "string") setSelectedColor(data.color);

        if (nameMissing || colorMissing) {
          setNeedsProfile(true);
          return;
        }

        setNeedsProfile(false);
      } catch {
        setNeedsProfile(true);
      }
    })();
  }, [room, roomCode, playerId]);

  // ✅ saveProfile vergibt NICHT Host (Host ist room.hostId)
  async function saveProfile() {
    setJoinStatus("");

    const name = nameInput.trim();
    if (name.length < 2) {
      setJoinStatus("Bitte gib mindestens 2 Zeichen ein.");
      return;
    }

    if (!room) {
      setJoinStatus("Raum lädt noch…");
      return;
    }

    try {
      const meRef = doc(db, "rooms", roomCode, "players", playerId);
      const snap = await getDoc(meRef);

      const amIHost = room.hostId === playerId;

      if (!snap.exists()) {
        await setDoc(
          meRef,
          {
            id: playerId,
            name,
            color: selectedColor,
            score: 0,
            isHost: amIHost,
            joinedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await setDoc(
          meRef,
          {
            id: playerId,
            name,
            color: selectedColor,
            isHost: amIHost,
          },
          { merge: true }
        );
      }

      setNeedsProfile(false);
      setJoinStatus("✅ Gespeichert!");
      setTimeout(() => setJoinStatus(""), 900);
    } catch (e: any) {
      setJoinStatus(`❌ Fehler: ${e?.message ?? String(e)}`);
    }
  }

  // --- Live: Submissions pro Runde ---
  useEffect(() => {
    if (!room) return;

    setOptimisticSubmittedThisRound(false);

    if (room.roundNumber < 1) {
      setSubmissions([]);
      return;
    }

    const subRef = collection(db, "rooms", roomCode, "rounds", String(room.roundNumber), "submissions");
    const unsub = onSnapshot(subRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Submission) }));
      setSubmissions(list);

      const mineExists = list.some((s) => s.id === playerId);
      if (mineExists) setOptimisticSubmittedThisRound(false);
    });

    return () => unsub();
  }, [room?.roundNumber, roomCode, playerId, room]);

  // --- Live: Votes pro Song ---
  useEffect(() => {
    if (!room) return;

    if (room.phase !== "guessing" && room.phase !== "reveal") {
      setVotes({});
      setMyVote(null);
      setSelectedGuessPlayerId("");
      return;
    }

    const votesRef = collection(
      db,
      "rooms",
      roomCode,
      "rounds",
      String(room.roundNumber),
      "songs",
      String(room.indexInRound),
      "votes"
    );

    const unsub = onSnapshot(votesRef, (snap) => {
      const map: Record<string, { guessedPlayerId: string }> = {};
      snap.docs.forEach((d) => (map[d.id] = d.data() as { guessedPlayerId: string }));
      setVotes(map);

      const mine = map[playerId] ?? null;
      setMyVote(mine);
      if (mine) setSelectedGuessPlayerId(mine.guessedPlayerId);
    });

    return () => unsub();
  }, [room?.phase, room?.roundNumber, room?.indexInRound, roomCode, playerId, room]);

  // --- Live: Bangers pro Runde (nur 1 pro Spieler / Runde) ---
  useEffect(() => {
    if (!room) return;

    // Reset außerhalb der Runde
    if (room.roundNumber < 1) {
      setBangers({});
      setMyBanger(null);
      return;
    }

    // Banger sinnvoll in guessing/reveal/banger (damit Host in banger auswerten kann)
    if (room.phase !== "guessing" && room.phase !== "reveal" && room.phase !== "banger") {
      setBangers({});
      setMyBanger(null);
      return;
    }

    const ref = collection(db, "rooms", roomCode, "rounds", String(room.roundNumber), "bangers");
    const unsub = onSnapshot(ref, (snap) => {
      const map: Record<string, { songOwnerId: string }> = {};
      snap.docs.forEach((d) => (map[d.id] = d.data() as any));
      setBangers(map);
      setMyBanger(map[playerId] ?? null);
    });

    return () => unsub();
  }, [room?.phase, room?.roundNumber, roomCode, playerId, room]);

  const playersCount = players.length;
  const submissionsCount = submissions.length;

  const mySubmission = useMemo(() => submissions.find((s) => s.id === playerId) ?? null, [submissions, playerId]);

  const effectiveSubmissionsCount = useMemo(() => {
    if (mySubmission) return submissionsCount;
    if (optimisticSubmittedThisRound) return Math.min(playersCount, submissionsCount + 1);
    return submissionsCount;
  }, [mySubmission, optimisticSubmittedThisRound, playersCount, submissionsCount]);

  const everyoneSubmitted = useMemo(() => {
    if (playersCount === 0) return false;
    return effectiveSubmissionsCount >= playersCount;
  }, [effectiveSubmissionsCount, playersCount]);

  const currentOwnerId = room?.currentSongOwnerId ?? "";
  const isOwnerNow = useMemo(() => {
    if (!room) return false;
    if (room.phase !== "guessing" && room.phase !== "reveal") return false;
    return currentOwnerId === playerId;
  }, [room, currentOwnerId, playerId]);

  const votedCount = Object.keys(votes).length;

  const requiredVotes = useMemo(() => {
    if (!room || room.phase !== "guessing") return 0;
    if (!currentOwnerId) return playersCount;
    return Math.max(0, playersCount - 1);
  }, [room, playersCount, currentOwnerId]);

  const allVotesIn = useMemo(() => {
    if (!room || room.phase !== "guessing") return false;
    return votedCount >= requiredVotes;
  }, [room, votedCount, requiredVotes]);

  const revealOwner = useMemo(() => {
    if (!room || room.phase !== "reveal") return null;
    return players.find((p) => p.id === room.currentSongOwnerId) ?? null;
  }, [room, players]);

  const revealCorrectVoters = useMemo(() => {
    if (!room || room.phase !== "reveal") return [];
    const ownerId = room.currentSongOwnerId;
    if (!ownerId) return [];
    return Object.entries(votes)
      .filter(([voterId, v]) => voterId !== ownerId && v.guessedPlayerId === ownerId)
      .map(([voterId]) => voterId);
  }, [room, votes]);

  const revealCorrectCount = revealCorrectVoters.length;

  const myRevealPoints = useMemo(() => {
    if (!room || room.phase !== "reveal") return 0;

    const ownerId = room.currentSongOwnerId;
    if (!ownerId) return 0;

    // Owner: +5 pro korrekt (von anderen)
    if (playerId === ownerId) return 5 * revealCorrectCount;

    // Spieler: +10 wenn korrekt
    const mine = votes[playerId];
    if (mine && mine.guessedPlayerId === ownerId) return 10;

    return 0;
  }, [room, playerId, votes, revealCorrectCount]);

  const myRevealPointsText = useMemo(() => {
    if (!room || room.phase !== "reveal") return "";
    if (myRevealPoints <= 0) return "";
    if (playerId === room.currentSongOwnerId) return `+${myRevealPoints} Punkte (Owner)`;
    return `+${myRevealPoints} Punkte`;
  }, [room, myRevealPoints, playerId]);

  useEffect(() => {
    if (!room) return;
    if (room.phase !== "reveal") return;
    setRevealFxKey((k) => k + 1);
  }, [room?.phase, room?.roundNumber, room?.indexInRound]);

  // Raumcode groß NUR in Lobby (nach Start: Badge oben rechts)
  const showBigRoomBar = useMemo(() => {
    if (!room) return true;
    return room.phase === "lobby";
  }, [room]);

  function copyRoomCode() {
    navigator.clipboard.writeText(roomCode);
    setToast("📋 Raumcode kopiert");
    setTimeout(() => setToast(""), 1000);
  }

  // ---------- Host actions ----------
  async function hostSetTotalRounds(n: number) {
    if (!isHost) return;
    const value = Math.max(1, Math.min(10, Math.floor(n)));
    await updateDoc(doc(db, "rooms", roomCode), { totalRounds: value });
  }

  async function hostStartGame() {
    if (!isHost || !room) return;

    await updateDoc(doc(db, "rooms", roomCode), {
      phase: "collect",
      roundNumber: 1,
      indexInRound: 0,
      songOrder: [],
      currentSongUrl: "",
      currentSongOwnerId: "",
      totalRounds: room.totalRounds ?? 1,
    });
  }

  // (optional / stats basis)
  async function writeSongMeta(roundNumber: number, index: number, ownerId: string, url: string) {
    const metaRef = doc(db, "rooms", roomCode, "rounds", String(roundNumber), "songs", String(index));
    await setDoc(
      metaRef,
      {
        ownerId,
        url,
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async function hostStartRound() {
    setHostStatus("");
    if (!isHost || !room) return;
    if (room.phase !== "collect") return;

    if (!everyoneSubmitted) {
      setHostStatus("Noch nicht alle haben abgegeben.");
      setTimeout(() => setHostStatus(""), 1200);
      return;
    }

    const order = shuffle(submissions.map((s) => s.id));
    const firstOwnerId = order[0];
    const first = submissions.find((s) => s.id === firstOwnerId);
    if (!first) return;

    await writeSongMeta(room.roundNumber, 0, firstOwnerId, first.url);

    await updateDoc(doc(db, "rooms", roomCode), {
      phase: "guessing",
      songOrder: order,
      indexInRound: 0,
      currentSongOwnerId: firstOwnerId,
      currentSongUrl: first.url,
    });
  }

  // Punkte:
  // - Voter: +10 pro richtig
  // - Owner: +5 pro richtigem Vote (von anderen)
  async function hostRevealAndScore() {
    setHostStatus("");
    if (!isHost || !room || room.phase !== "guessing") return;

    if (!allVotesIn) {
      setHostStatus(`Noch nicht alle abgestimmt (${votedCount}/${requiredVotes}).`);
      setTimeout(() => setHostStatus(""), 1200);
      return;
    }

    const correctOwner = room.currentSongOwnerId;
    if (!correctOwner) return;

    const votesRef = collection(
      db,
      "rooms",
      roomCode,
      "rounds",
      String(room.roundNumber),
      "songs",
      String(room.indexInRound),
      "votes"
    );
    const snap = await getDocs(votesRef);

    let correctCount = 0;
    const correctVoters: string[] = [];

    snap.docs.forEach((v) => {
      const voterId = v.id;
      const data = v.data() as { guessedPlayerId?: string };

      if (voterId === correctOwner) return;
      if (data.guessedPlayerId === correctOwner) {
        correctCount++;
        correctVoters.push(voterId);
      }
    });

    const batch = writeBatch(db);

    // Voter +10
    correctVoters.forEach((voterId) => {
      batch.update(doc(db, "rooms", roomCode, "players", voterId), { score: increment(10) });
    });

    // Owner +5 pro korrekt
    if (correctCount > 0) {
      batch.update(doc(db, "rooms", roomCode, "players", correctOwner), { score: increment(5 * correctCount) });
    }

    batch.update(doc(db, "rooms", roomCode), { phase: "reveal" });
    await batch.commit();
  }

  async function hostContinue() {
    if (!isHost || !room || room.phase !== "reveal") return;

    const order = room.songOrder ?? [];
    const nextIndex = room.indexInRound + 1;

    if (nextIndex < order.length) {
      const nextOwnerId = order[nextIndex];
      const nextSub = submissions.find((s) => s.id === nextOwnerId);
      if (!nextSub) return;

      await writeSongMeta(room.roundNumber, nextIndex, nextOwnerId, nextSub.url);

      await updateDoc(doc(db, "rooms", roomCode), {
        phase: "guessing",
        indexInRound: nextIndex,
        currentSongOwnerId: nextOwnerId,
        currentSongUrl: nextSub.url,
      });
      return;
    }

    // Ende der Runde -> zur Banger-Auswertung
    await updateDoc(doc(db, "rooms", roomCode), { phase: "banger" });
  }

  // 🔥 Banger am Ende auswerten
  async function hostFinalizeBanger() {
    setHostStatus("");
    if (!isHost || !room || room.phase !== "banger") return;

    const ref = collection(db, "rooms", roomCode, "rounds", String(room.roundNumber), "bangers");
    const snap = await getDocs(ref);

    const counts: Record<string, number> = {};
    snap.docs.forEach((d) => {
      const songOwnerId = (d.data() as any)?.songOwnerId as string;
      if (!songOwnerId) return;
      counts[songOwnerId] = (counts[songOwnerId] ?? 0) + 1;
    });

    let max = 0;
    let winners: string[] = [];
    for (const [pid, c] of Object.entries(counts)) {
      if (c > max) {
        max = c;
        winners = [pid];
      } else if (c === max && c > 0) {
        winners.push(pid);
      }
    }

    const batch = writeBatch(db);

    // +5 nur bei eindeutiger Mehrheit (sonst 0)
    if (max > 0 && winners.length === 1) {
      batch.update(doc(db, "rooms", roomCode, "players", winners[0]), { score: increment(5) });
    }

    const nextRound = (room.roundNumber ?? 1) + 1;
    const hasNextRound = nextRound <= (room.totalRounds ?? 1);

    if (hasNextRound) {
      batch.update(doc(db, "rooms", roomCode), {
        phase: "collect",
        roundNumber: nextRound,
        indexInRound: 0,
        songOrder: [],
        currentSongUrl: "",
        currentSongOwnerId: "",
      });
    } else {
      batch.update(doc(db, "rooms", roomCode), { phase: "finished" });
    }

    await batch.commit();
  }

  // ✅ Neustart: zurück auf Lobby + Scores reset
  async function hostRestartToLobby() {
    if (!isHost || !room) return;

    const batch = writeBatch(db);

    players.forEach((p) => {
      batch.update(doc(db, "rooms", roomCode, "players", p.id), { score: 0 });
    });

    batch.update(doc(db, "rooms", roomCode), {
      phase: "lobby",
      roundNumber: 0,
      indexInRound: 0,
      songOrder: [],
      currentSongUrl: "",
      currentSongOwnerId: "",
    });

    await batch.commit();

    setToast("🔁 Neues Spiel bereit (Lobby)");
    setTimeout(() => setToast(""), 1200);
    setStatsOpen(false);
  }

  // ---------- Player actions ----------
  async function submitMySong() {
    setSongStatus("");
    if (!room || room.phase !== "collect") return;

    const normalized = normalizeSpotifyUrl(songInput);
    if (!normalized) {
      setSongStatus("Bitte einen gültigen Spotify-Link einfügen.");
      setShakeKey((k) => k + 1);
      return;
    }

    const already = submissions.some((s) => s.url === normalized && s.id !== playerId);
    if (already) {
      setSongStatus("Dieser Song wurde in dieser Runde schon eingereicht. Bitte einen anderen wählen.");
      setShakeKey((k) => k + 1);
      return;
    }

    setOptimisticSubmittedThisRound(true);

    await setDoc(
      doc(db, "rooms", roomCode, "rounds", String(room.roundNumber), "submissions", playerId),
      { url: normalized, createdAt: serverTimestamp() },
      { merge: true }
    );

    setSongInput("");
    setSongStatus("✅ Gespeichert!");
    setTimeout(() => setSongStatus(""), 1000);
  }

  async function submitVote() {
    setVoteStatus("");
    if (!room || room.phase !== "guessing") return;

    if (isOwnerNow) {
      setVoteStatus("Du bist der Owner. Du darfst nicht abstimmen.");
      setShakeKey((k) => k + 1);
      return;
    }

    if (!selectedGuessPlayerId) {
      setVoteStatus("Bitte wähle eine Person aus.");
      setShakeKey((k) => k + 1);
      return;
    }
    if (selectedGuessPlayerId === playerId) {
      setVoteStatus("Du kannst nicht dich selbst wählen.");
      setShakeKey((k) => k + 1);
      return;
    }

    const voteRef = doc(
      db,
      "rooms",
      roomCode,
      "rounds",
      String(room.roundNumber),
      "songs",
      String(room.indexInRound),
      "votes",
      playerId
    );

    await setDoc(voteRef, { guessedPlayerId: selectedGuessPlayerId, createdAt: serverTimestamp() }, { merge: true });

    setVoteStatus("✅ Stimme gespeichert!");
    setToast("✅ Stimme gespeichert");
    setTimeout(() => setToast(""), 1200);
    setTimeout(() => setVoteStatus(""), 1000);
  }

  // 🔥 Banger Toggle: vergeben ODER zurücknehmen
  async function toggleBanger() {
    if (!room) return;
    if (room.phase !== "guessing" && room.phase !== "reveal") return;

    const ownerId = room.currentSongOwnerId;
    if (!ownerId) return;

    const ref = doc(db, "rooms", roomCode, "rounds", String(room.roundNumber), "bangers", playerId);

    // ✅ Wenn schon vergeben -> zurücknehmen (doc löschen)
    if (myBanger) {
      await deleteDoc(ref);
      setToast("🔥 Banger zurückgenommen");
      setTimeout(() => setToast(""), 1200);
      return;
    }

    // ✅ Sonst vergeben (nicht für sich selbst)
    if (ownerId === playerId) {
      setToast("❌ Kein Banger für dich selbst");
      setTimeout(() => setToast(""), 1200);
      return;
    }

    await setDoc(ref, { songOwnerId: ownerId, createdAt: serverTimestamp() }, { merge: true });
    setToast("🔥 Banger vergeben");
    setTimeout(() => setToast(""), 1200);
  }

  const showMain = room && !needsProfile;

  // Banger UI Counter (optional)
  const bangerGivenCount = useMemo(() => Object.keys(bangers).length, [bangers]);

  // 🔥 Button State
  const canUseBangerButton = useMemo(() => {
    if (!room) return false;
    if (room.phase !== "guessing" && room.phase !== "reveal") return false;
    if (!room.currentSongUrl) return false;
    if (!room.currentSongOwnerId) return false;

    // Wenn bereits vergeben -> Button darf genutzt werden (zum zurücknehmen)
    if (myBanger) return true;

    // Sonst: vergeben nur wenn nicht self
    if (room.currentSongOwnerId === playerId) return false;
    return true;
  }, [room, myBanger, playerId]);

  const bangerDisabled = !canUseBangerButton;

  const bangerActiveForCurrentSong = useMemo(() => {
    if (!room || !myBanger) return false;
    return myBanger.songOwnerId === room.currentSongOwnerId;
  }, [room, myBanger]);

  return (
    <main className="ws-page">
      <div className="ws-container">
        <header className="ws-header">
          <div>
            <div className="ws-title">Whose Song?</div>
            <div className="ws-subtitle">
              {room ? `${phaseLabel(room.phase)} · Runde ${room.roundNumber}/${room.totalRounds}` : "Lade…"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {room && !showBigRoomBar && (
              <button className="ws-roomcode-mini-btn" onClick={copyRoomCode} title="Raumcode kopieren">
                {roomCode}
              </button>
            )}
          </div>
        </header>

        {showBigRoomBar && <RoomCodeBar roomCode={roomCode} />}

        {error && (
          <Card>
            <div className="ws-error">{error}</div>
          </Card>
        )}
        {!error && !room && <Card>Lade Raum…</Card>}

        {/* PROFIL */}
        {room && needsProfile && (
          <Card>
            <div className="ws-card-title">Dein Profil</div>
            <div className="ws-muted">Name + Farbe festlegen. Das sehen die anderen Spieler.</div>

            <div className="ws-stack" style={{ marginTop: 10 }}>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="ws-input"
                placeholder="z. B. Tommy"
                style={{ fontSize: 16 }}
              />

              <div className="ws-color-preview">
                <div className="ws-preview-avatar" style={{ backgroundColor: selectedColor }}>
                  {(nameInput.trim()?.[0] ?? "?").toUpperCase()}
                </div>
                <div className="ws-preview-text">
                  <div className="ws-preview-name">{nameInput.trim() || "Dein Name"}</div>
                  <div className="ws-preview-sub">Vorschau: so erscheinst du im Spiel</div>
                </div>
              </div>

              <div className="ws-color-picker">
                {PLAYER_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`ws-color-swatch ${selectedColor === color ? "is-selected" : ""}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setSelectedColor(color)}
                    aria-label={`Farbe ${color}`}
                  />
                ))}
              </div>

              <button className="ws-btn" onClick={saveProfile}>
                Speichern
              </button>

              {joinStatus && <div className="ws-muted">{joinStatus}</div>}
            </div>
          </Card>
        )}

        {showMain && room && (
          <>
            {/* ✅ IN-GAME SCORE (Top3 + eigener Rang) – NICHT im Lobby */}
            {room.phase !== "lobby" && room.phase !== "finished" && (
              <Card>
                <InGameScoreHeader me={me} myRank={myRank} totalPlayers={players.length} />

                {scoreboard.length >= 3 ? (
                  <>
                    <div className="ws-muted" style={{ marginTop: 10 }}>
                      Top 3 aktuell
                    </div>
                    <Podium top3={top3} />
                  </>
                ) : (
                  <>
                    <div className="ws-muted" style={{ marginTop: 10 }}>
                      Rangliste
                    </div>
                    <InGameScoreMiniList scoreboard={scoreboard} playerId={playerId} />
                  </>
                )}
              </Card>
            )}

            {/* LOBBY */}
            {room.phase === "lobby" && (
              <>
                <Card>
                  <div className="ws-row">
                    <div className="ws-card-title">Spieler im Raum</div>
                    <div className="ws-chip">{players.length} verbunden</div>
                  </div>

                  <div className="ws-list">
                    {players.map((p) => (
                      <div key={p.id} className="ws-list-item">
                        <div className="ws-list-left">
                          <div className="ws-avatar" style={{ backgroundColor: p.color }}>
                            {(p.name?.[0] ?? "?").toUpperCase()}
                          </div>
                          <div className="ws-name">
                            {p.name} {p.isHost ? <span className="ws-tag">Host</span> : null}
                          </div>
                        </div>
                        <div className="ws-muted">{p.id === playerId ? "Du" : ""}</div>
                      </div>
                    ))}
                  </div>
                </Card>

                {isHost && (
                  <Card>
                    <div className="ws-card-title">Host Einstellungen</div>
                    <div className="ws-muted">Zeitlimit ist aus. 1 Runde = alle Songs einmal durch.</div>

                    <div className="ws-stack" style={{ marginTop: 12 }}>
                      <div className="ws-row">
                        <div className="ws-muted">Rundenanzahl</div>
                        <div className="ws-chip">{room.totalRounds ?? 1}</div>
                      </div>

                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={room.totalRounds ?? 1}
                        onChange={(e) => hostSetTotalRounds(Number(e.target.value))}
                        style={{ width: "100%" }}
                      />

                      <div className="ws-muted" style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>1</span>
                        <span>10</span>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            )}

            {/* COLLECT */}
            {room.phase === "collect" && (
              <>
                <Card>
                  <div className="ws-card-title">Genre-Karte zieht ihr vor Ort 🎴</div>
                  <div className="ws-muted">Dann trägt jeder genau 1 Spotify-Link ein.</div>

                  <div className="ws-row" style={{ marginTop: 10 }}>
                    <div className="ws-muted">Songs abgegeben</div>
                    <div className="ws-chip">
                      {effectiveSubmissionsCount}/{playersCount}
                    </div>
                  </div>

                  <ProgressBar value={effectiveSubmissionsCount} max={playersCount} />
                  <div className="ws-muted" style={{ marginTop: 8 }}>
                    (Anonym – es wird nicht angezeigt, wer abgegeben hat.)
                  </div>

                  {hostStatus && (
                    <div className="ws-muted" style={{ marginTop: 8 }}>
                      {hostStatus}
                    </div>
                  )}
                </Card>

                <Card>
                  <div className="ws-card-title">Dein Spotify-Link</div>

                  {mySubmission ? (
                    <div className="ws-embed">
                      <div className="ws-chip">Du hast abgegeben ✅</div>
                      <div style={{ borderRadius: 16, overflow: "hidden" }}>
                        <iframe
                          title="Spotify Embed"
                          src={spotifyEmbedUrlFromSpotifyUrl(mySubmission.url)}
                          width="100%"
                          height="152"
                          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                          loading="lazy"
                          style={{ borderRadius: 16, border: "0" }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="ws-muted">Noch kein Link gespeichert.</div>
                  )}

                  <div className="ws-stack" style={{ marginTop: 12 }}>
                    <input
                      value={songInput}
                      onChange={(e) => setSongInput(e.target.value)}
                      className="ws-input"
                      placeholder="https://open.spotify.com/track/…"
                      style={{ fontSize: 16 }}
                    />
                    <button className="ws-btn" onClick={submitMySong}>
                      Link speichern
                    </button>
                    {songStatus && <div className="ws-muted">{songStatus}</div>}
                  </div>
                </Card>
              </>
            )}

            {/* SONG CARD */}
            {(room.phase === "guessing" || room.phase === "reveal") && room.currentSongUrl && (
              <Card>
                <div className="ws-row">
                  <div className="ws-card-title">Song</div>
                  <div className="ws-chip">
                    {room.songOrder?.length ? `Song ${room.indexInRound + 1}/${room.songOrder.length}` : ""}
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 16,
                    overflow: "hidden",
                    position: "relative",
                    pointerEvents: isHost ? "auto" : "none",
                    marginTop: 10,
                  }}
                >
                  <iframe
                    title="Spotify Embed"
                    src={spotifyEmbedUrlFromSpotifyUrl(room.currentSongUrl)}
                    width="100%"
                    height="152"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                    style={{ borderRadius: 16, border: "0" }}
                  />
                </div>

                {!isHost && (
                  <div className="ws-muted" style={{ marginTop: 8 }}>
                    (Nur der Host kann den Song starten.)
                  </div>
                )}

                <div className="ws-row" style={{ marginTop: 10, alignItems: "flex-end", gap: 10 }}>
                  <a href={room.currentSongUrl} target="_blank" rel="noreferrer" className="ws-link">
                    In Spotify öffnen
                  </a>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (bangerDisabled) return;
                        toggleBanger();
                      }}
                      disabled={bangerDisabled}
                      title={
                        myBanger
                          ? "Klick = Banger zurücknehmen"
                          : room.currentSongOwnerId === playerId
                          ? "Du kannst dir selbst keinen Banger geben"
                          : "Banger vergeben"
                      }
                      className="ws-icon-btn"
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 14,
                        opacity: bangerDisabled ? 0.5 : 1,
                        pointerEvents: bangerDisabled ? "none" : "auto",
                        borderColor: myBanger ? "rgba(0,0,0,.38)" : undefined,
                        outline: bangerActiveForCurrentSong ? "3px solid rgba(0,0,0,.65)" : "none",
                        background: myBanger ? "rgba(0,0,0,.04)" : undefined,
                      }}
                    >
                      🔥
                    </button>

                    <div className="ws-muted" style={{ fontSize: 12, textAlign: "right" }}>
                      {myBanger ? (
                        <>
                          🔥 gesetzt (Klick = zurücknehmen) · vergeben: {bangerGivenCount}/{players.length}
                        </>
                      ) : (
                        <>
                          🔥 vergeben: {bangerGivenCount}/{players.length}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* GUESSING */}
            {room.phase === "guessing" && (
              <div key={shakeKey} className="ws-shake">
                <Card>
                  <div className="ws-card-title">Wem gehört der Song?</div>

                  {isOwnerNow ? (
                    <div className="ws-muted">
                      Du hast diesen Song eingereicht. Du darfst nicht abstimmen. <br />
                      Votes: {votedCount}/{requiredVotes}
                    </div>
                  ) : (
                    <>
                      <div className="ws-muted">Wähle deine Antwort:</div>

                      <div className="ws-playergrid">
                        {players
                          .filter((p) => p.id !== playerId)
                          .map((p) => {
                            const selected = selectedGuessPlayerId === p.id;
                            const disabled = !!myVote;
                            return (
                              <button
                                key={p.id}
                                className={`ws-playerbtn ${selected ? "is-selected" : ""}`}
                                onClick={() => !disabled && setSelectedGuessPlayerId(p.id)}
                                disabled={disabled}
                                type="button"
                              >
                                <div className="ws-playerbtn__avatar" style={{ backgroundColor: p.color }}>
                                  {(p.name?.[0] ?? "?").toUpperCase()}
                                </div>
                                <div className="ws-playerbtn__name">
                                  {p.name}
                                  {p.isHost ? <span className="ws-tag">Host</span> : null}
                                </div>
                                <div className="ws-playerbtn__meta">{p.score ?? 0} Punkte</div>
                              </button>
                            );
                          })}
                      </div>

                      <button
                        className="ws-btn"
                        style={{ marginTop: 16 }}
                        onClick={submitVote}
                        disabled={!!myVote || !selectedGuessPlayerId}
                      >
                        {myVote ? "Stimme abgegeben ✅" : "Stimme abgeben"}
                      </button>

                      {voteStatus && <div className="ws-muted">{voteStatus}</div>}
                      <div className="ws-muted">
                        Votes: {votedCount}/{requiredVotes}
                      </div>
                    </>
                  )}

                  {isHost && (
                    <button
                      className="ws-btn ws-btn--ghost"
                      onClick={hostRevealAndScore}
                      disabled={!allVotesIn}
                      style={{ marginTop: 12 }}
                    >
                      Auflösen (Host) {allVotesIn ? "" : `(${votedCount}/${requiredVotes})`}
                    </button>
                  )}
                </Card>
              </div>
            )}

            {/* REVEAL */}
            {room.phase === "reveal" && (
              <Card>
                <div className="ws-card-title">Auflösung</div>

                {revealOwner && (
                  <div
                    className="ws-reveal-hero"
                    style={{
                      backgroundColor: `${revealOwner.color}80`,
                      borderRadius: 22,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {myRevealPoints > 0 && (
                      <div key={revealFxKey} className="ws-confetti" aria-hidden="true">
                        {Array.from({ length: 18 }).map((_, idx) => (
                          <i
                            key={idx}
                            style={{
                              left: `${(idx * 7) % 100}%`,
                              top: `${(idx * 11) % 60}%`,
                              background: idx % 2 === 0 ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.18)",
                              animationDelay: `${(idx % 6) * 0.06}s`,
                            }}
                          />
                        ))}
                      </div>
                    )}

                    <div className="ws-avatar ws-avatar--big" style={{ backgroundColor: revealOwner.color }}>
                      {revealOwner.name[0].toUpperCase()}
                    </div>

                    <div className="ws-muted">Der Song gehört</div>
                    <div className="ws-reveal-name">{revealOwner.name}</div>

                    {myRevealPointsText && (
                      <div className="ws-points-pop" style={{ backgroundColor: revealOwner.color }}>
                        {myRevealPointsText}
                      </div>
                    )}

                    <div className="ws-muted" style={{ marginTop: 6 }}>
                      Richtig geraten: {revealCorrectCount}
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* BANGER (nur Auswertung / kein Voting UI) */}
            {room.phase === "banger" && (
              <Card>
                <div className="ws-row">
                  <div className="ws-card-title">Banger auswerten 🔥</div>
                  <div className="ws-chip">
                    vergeben: {bangerGivenCount}/{players.length}
                  </div>
                </div>

                <div className="ws-muted" style={{ marginTop: 8 }}>
                  Banger wurden während der Runde per 🔥 vergeben. Punkte (+5) gibt es nur für einen eindeutigen Sieger.
                </div>

                {isHost && (
                  <button
                    className="ws-btn ws-btn--ghost"
                    style={{ marginTop: 14, width: "100%" }}
                    onClick={hostFinalizeBanger}
                  >
                    Banger auswerten & weiter
                  </button>
                )}
              </Card>
            )}

            {/* FINISHED */}
            {room.phase === "finished" && (
              <Card>
                <div className="ws-card-title">Spiel beendet 🏁</div>
                <div className="ws-muted">Podium & Ergebnisübersicht</div>

                <Podium top3={top3} />

                <div style={{ marginTop: 14 }}>
                  <div className="ws-row">
                    <div className="ws-card-title" style={{ marginBottom: 0 }}>
                      Rangliste
                    </div>
                    <div className="ws-chip">Final</div>
                  </div>

                  <div className="ws-list" style={{ marginTop: 10 }}>
                    {scoreboard.map((p, idx) => (
                      <div key={p.id} className="ws-list-item">
                        <div className="ws-list-left">
                          <div className="ws-chip" style={{ minWidth: 44, textAlign: "center" }}>
                            #{idx + 1}
                          </div>
                          <div className="ws-avatar" style={{ backgroundColor: p.color }}>
                            {(p.name?.[0] ?? "?").toUpperCase()}
                          </div>
                          <div className="ws-name">
                            {p.name} {p.isHost ? <span className="ws-tag">Host</span> : null}
                            {p.id === playerId ? <span className="ws-you">du</span> : null}
                          </div>
                        </div>
                        <div className="ws-name">{p.score ?? 0}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <button className="ws-btn ws-btn--ghost" onClick={() => setStatsOpen((s) => !s)}>
                    {statsOpen ? "Statistiken ausblenden" : "Statistiken anzeigen"}
                  </button>

                  {statsOpen && (
                    <div style={{ marginTop: 10 }}>
                      <div className="ws-muted">(Basis) Aktuell: Finale Punkte + Podium.</div>
                    </div>
                  )}
                </div>

                <div className="ws-stack" style={{ marginTop: 14 }}>
                  {isHost && (
                    <button className="ws-btn" onClick={hostRestartToLobby}>
                      🔁 Nochmal spielen (Host)
                    </button>
                  )}

                  <button className="ws-btn ws-btn--ghost" onClick={() => (window.location.href = "/")}>
                    ⬅️ Zur Startseite
                  </button>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Sticky Controls */}
      {room && !needsProfile && (
        <div className="ws-sticky">
          <div className="ws-sticky-inner">
            {room.phase === "lobby" && isHost && (
              <button className="ws-btn" onClick={hostStartGame}>
                Spiel starten
              </button>
            )}

            {room.phase === "collect" && isHost && (
              <button className="ws-btn" onClick={hostStartRound} disabled={!everyoneSubmitted}>
                Runde starten ({effectiveSubmissionsCount}/{playersCount})
              </button>
            )}

            {room.phase === "reveal" && isHost && (
              <button className="ws-btn" onClick={hostContinue}>
                Weiter
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="ws-toast">{toast}</div>}
    </main>
  );
}
