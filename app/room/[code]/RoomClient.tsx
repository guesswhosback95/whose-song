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

type Phase = "lobby" | "collect" | "guessing" | "reveal" | "roundreveal" | "banger" | "finished";

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

type SongMeta = { ownerId: string; url: string; createdAt?: any };
type SongMetaWithIndex = SongMeta & { index: number };

type SongRoundStats = {
  index: number;
  ownerId: string;
  url: string;
  correctVoterIds: string[];
  correctCount: number;
};

const PLAYER_COLORS = [
  "#F6E6A8",
  "#F2C27B",
  "#F7A6A1",
  "#E86A5A",
  "#C6B7E2",
  "#CFEAF0",
  "#8BB7DE",
  "#7FC58E",
  "#C9D87A",
  "#FAF3E3",
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
  if (phase === "reveal") return "Zwischenstand";
  if (phase === "roundreveal") return "Runden-Auflösung";
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

/**
 * ✅ Podium wiederverwendbar:
 * - normal: valueLabel="Punkte"
 * - Banger: valueLabel="Banger"
 */
function Podium({
  top3,
  valueLabel = "Punkte",
}: {
  top3: Player[];
  valueLabel?: string;
}) {
  const p1 = top3[0];
  const p2 = top3[1];
  const p3 = top3[2];

  const valueOf = (p?: Player) => (p?.score ?? 0);

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
            <div className="ws-muted">
              {valueOf(p2)} {valueLabel}
            </div>
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
            <div className="ws-muted">
              {valueOf(p1)} {valueLabel}
            </div>
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
            <div className="ws-muted">
              {valueOf(p3)} {valueLabel}
            </div>
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

  // 🔥 Banger während der Runde (1 pro Runde / Spieler)
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

  // Modell C: Runden-Auflösung Daten
  const [roundSongs, setRoundSongs] = useState<SongMetaWithIndex[]>([]);
  const [roundStats, setRoundStats] = useState<SongRoundStats[]>([]);
  const [roundStatsLoading, setRoundStatsLoading] = useState(false);
  const [roundStatsError, setRoundStatsError] = useState("");

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
          phase: ((data.phase ?? "lobby") as Phase) ?? "lobby",
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

  // --- Live: Bangers pro Runde ---
  useEffect(() => {
    if (!room) return;

    if (room.roundNumber < 1) {
      setBangers({});
      setMyBanger(null);
      return;
    }

    if (room.phase !== "guessing" && room.phase !== "reveal" && room.phase !== "roundreveal" && room.phase !== "banger") {
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

  // ✅ Zwischenstand
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

    if (playerId === ownerId) return 5 * revealCorrectCount;

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

    correctVoters.forEach((voterId) => {
      batch.update(doc(db, "rooms", roomCode, "players", voterId), { score: increment(10) });
    });

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

    await updateDoc(doc(db, "rooms", roomCode), { phase: "roundreveal" });
  }

  async function hostGoToBanger() {
    if (!isHost || !room || room.phase !== "roundreveal") return;
    await updateDoc(doc(db, "rooms", roomCode), { phase: "banger" });
  }

  // 🔥 Banger-Finalize: ggf. +5, dann nächste Runde oder Ende
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

  async function toggleBanger() {
    if (!room) return;
    if (room.phase !== "guessing") return;

    const ownerId = room.currentSongOwnerId;
    if (!ownerId) return;

    const ref = doc(db, "rooms", roomCode, "rounds", String(room.roundNumber), "bangers", playerId);

    if (myBanger) {
      await deleteDoc(ref);
      setToast("🔥 Banger zurückgenommen");
      setTimeout(() => setToast(""), 1200);
      return;
    }

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

  const bangerGivenCount = useMemo(() => Object.keys(bangers).length, [bangers]);

  const canUseBangerButton = useMemo(() => {
    if (!room) return false;
    if (room.phase !== "guessing") return false;
    if (!room.currentSongUrl) return false;
    if (!room.currentSongOwnerId) return false;

    if (myBanger) return true;
    if (room.currentSongOwnerId === playerId) return false;
    return true;
  }, [room, myBanger, playerId]);

  const bangerDisabled = !canUseBangerButton;

  const bangerActiveForCurrentSong = useMemo(() => {
    if (!room || !myBanger) return false;
    return myBanger.songOwnerId === room.currentSongOwnerId;
  }, [room, myBanger]);

  // ✅ Round-Reveal: Song-Metas live laden
  useEffect(() => {
    if (!room) return;

    if (room.phase !== "roundreveal") {
      setRoundSongs([]);
      setRoundStats([]);
      setRoundStatsLoading(false);
      setRoundStatsError("");
      return;
    }

    if (room.roundNumber < 1) return;

    const songsRef = collection(db, "rooms", roomCode, "rounds", String(room.roundNumber), "songs");
    const unsub = onSnapshot(songsRef, (snap) => {
      const list: SongMetaWithIndex[] = snap.docs
        .map((d) => {
          const idx = Number(d.id);
          const data = d.data() as SongMeta;
          return {
            index: Number.isFinite(idx) ? idx : 0,
            ownerId: data.ownerId,
            url: data.url,
            createdAt: data.createdAt,
          };
        })
        .sort((a, b) => a.index - b.index);

      setRoundSongs(list);
    });

    return () => unsub();
  }, [room?.phase, room?.roundNumber, roomCode, room]);

  // ✅ Round-Reveal: Votes pro Song sammeln
  useEffect(() => {
    if (!room) return;
    if (room.phase !== "roundreveal") return;
    if (room.roundNumber < 1) return;

    let cancelled = false;

    (async () => {
      try {
        setRoundStatsError("");
        setRoundStatsLoading(true);

        let songs = roundSongs;

        if (!songs || songs.length === 0) {
          const songsRef = collection(db, "rooms", roomCode, "rounds", String(room.roundNumber), "songs");
          const snap = await getDocs(songsRef);
          songs = snap.docs
            .map((d) => {
              const idx = Number(d.id);
              const data = d.data() as SongMeta;
              return {
                index: Number.isFinite(idx) ? idx : 0,
                ownerId: data.ownerId,
                url: data.url,
                createdAt: data.createdAt,
              };
            })
            .sort((a, b) => a.index - b.index);
        }

        const stats: SongRoundStats[] = await Promise.all(
          songs.map(async (s) => {
            const votesRef = collection(
              db,
              "rooms",
              roomCode,
              "rounds",
              String(room.roundNumber),
              "songs",
              String(s.index),
              "votes"
            );
            const vs = await getDocs(votesRef);

            const correctVoters: string[] = [];
            vs.docs.forEach((v) => {
              const voterId = v.id;
              const data = v.data() as { guessedPlayerId?: string };
              if (voterId === s.ownerId) return;
              if (data.guessedPlayerId === s.ownerId) correctVoters.push(voterId);
            });

            return {
              index: s.index,
              ownerId: s.ownerId,
              url: s.url,
              correctVoterIds: correctVoters,
              correctCount: correctVoters.length,
            };
          })
        );

        if (cancelled) return;
        stats.sort((a, b) => a.index - b.index);
        setRoundStats(stats);
      } catch (e: any) {
        if (cancelled) return;
        setRoundStatsError(e?.message ?? String(e));
      } finally {
        if (cancelled) return;
        setRoundStatsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [room?.phase, room?.roundNumber, roomCode, roundSongs]);

  const playersById = useMemo(() => {
    const map: Record<string, Player> = {};
    players.forEach((p) => (map[p.id] = p));
    return map;
  }, [players]);

  // ✅ Banger counts (SongOwnerId -> count)
  const bangerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.values(bangers).forEach((b) => {
      if (!b?.songOwnerId) return;
      counts[b.songOwnerId] = (counts[b.songOwnerId] ?? 0) + 1;
    });
    return counts;
  }, [bangers]);

  // ✅ Banger Scoreboard (als Player[] um Podium wiederzuverwenden)
  const bangerScoreboard = useMemo(() => {
    const list = players.map((p) => ({
      ...p,
      score: bangerCounts[p.id] ?? 0, // hier: score = Banger-Anzahl
    }));

    list.sort((a, b) => {
      const sa = a.score ?? 0;
      const sb = b.score ?? 0;
      if (sb !== sa) return sb - sa;
      return 0;
    });

    return list;
  }, [players, bangerCounts]);

  const bangerTop3 = useMemo(() => bangerScoreboard.slice(0, 3), [bangerScoreboard]);

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
            {/* IN-GAME SCORE */}
            {room.phase !== "lobby" && room.phase !== "finished" && (
              <Card>
                <InGameScoreHeader me={me} myRank={myRank} totalPlayers={players.length} />

                {scoreboard.length >= 3 ? (
                  <>
                    <div className="ws-muted" style={{ marginTop: 10 }}>
                      Top 3 aktuell
                    </div>
                    <Podium top3={top3} valueLabel="Punkte" />
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
                  <div className="ws-row" style={{ alignItems: "baseline" }}>
                    <div>
                      <div className="ws-card-title" style={{ marginBottom: 4 }}>
                        Songs einreichen
                      </div>
                      <div className="ws-muted" style={{ fontSize: 13 }}>
                        Jeder reicht genau 1 Spotify-Link ein. Abgaben sind anonym.
                      </div>
                    </div>
                    <div className="ws-chip">
                      {effectiveSubmissionsCount}/{playersCount}
                    </div>
                  </div>

                  <div className="ws-row" style={{ marginTop: 10 }}>
                    <div className="ws-muted">Songs abgegeben</div>
                    <div className="ws-muted" style={{ fontSize: 13 }}>
                      (Anonym)
                    </div>
                  </div>

                  <ProgressBar value={effectiveSubmissionsCount} max={playersCount} />

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
                      <div style={{ borderRadius: 16, overflow: "hidden", marginTop: 10 }}>
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
                        room.phase !== "guessing"
                          ? "Banger nur während 'Raten' möglich"
                          : myBanger
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
                      {room.phase === "guessing" ? (
                        myBanger ? (
                          <>
                            🔥 gesetzt (Klick = zurücknehmen) · vergeben: {bangerGivenCount}/{players.length}
                          </>
                        ) : (
                          <>
                            🔥 vergeben: {bangerGivenCount}/{players.length}
                          </>
                        )
                      ) : (
                        <>🔥 vergeben: {bangerGivenCount}/{players.length}</>
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
                      Zwischenstand zeigen (Host) {allVotesIn ? "" : `(${votedCount}/${requiredVotes})`}
                    </button>
                  )}
                </Card>
              </div>
            )}

            {/* REVEAL */}
            {room.phase === "reveal" && (
              <Card>
                <div className="ws-card-title">Zwischenstand</div>

                <div
                  className="ws-reveal-hero"
                  style={{
                    backgroundColor: "rgba(0,0,0,.03)",
                    borderRadius: 22,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {/* ✅ Key-Fix: keine doppelten keys mehr */}
                  {myRevealPoints > 0 && (
                    <div key={`confetti-${revealFxKey}`} className="ws-confetti" aria-hidden="true">
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

                  <div className="ws-muted">Richtig geraten</div>
                  <div className="ws-reveal-name">{revealCorrectCount}</div>

                  {myRevealPointsText && (
                    <div
                      key={`points-${revealFxKey}`}
                      className="ws-points-pop"
                      style={{ backgroundColor: "rgba(0,0,0,.85)" }}
                    >
                      {myRevealPointsText}
                    </div>
                  )}

                  <div className="ws-muted" style={{ marginTop: 8 }}>
                    Owner wird erst am Ende der Runde aufgelöst.
                  </div>

                  <div className="ws-muted" style={{ marginTop: 10, fontSize: 13 }}>
                    🔥 Banger kann nur während “Raten” gesetzt werden.
                  </div>
                </div>
              </Card>
            )}

            {/* ROUNDREVEAL */}
            {room.phase === "roundreveal" && (
              <>
                <Card>
                  <div className="ws-row">
                    <div className="ws-card-title">Runden-Auflösung</div>
                    <div className="ws-chip">{room.songOrder?.length ? `${room.songOrder.length} Songs` : ""}</div>
                  </div>

                  <div className="ws-muted" style={{ marginTop: 8 }}>
                    Jetzt wird gezeigt, wem welcher Song gehört – plus wie viele richtig lagen.
                  </div>

                  {roundStatsError && (
                    <div className="ws-muted" style={{ marginTop: 10 }}>
                      ❌ Fehler beim Laden: {roundStatsError}
                    </div>
                  )}

                  {roundStatsLoading && (
                    <div className="ws-muted" style={{ marginTop: 10 }}>
                      Lade Auflösung…
                    </div>
                  )}

                  {!roundStatsLoading && roundStats.length > 0 && (
                    <div className="ws-stack" style={{ marginTop: 12 }}>
                      {roundStats.map((s) => {
                        const owner = playersById[s.ownerId];
                        const ownerName = owner?.name ?? "Unbekannt";
                        const ownerColor = owner?.color ?? "rgba(0,0,0,.08)";

                        const correctNames = s.correctVoterIds
                          .map((id) => playersById[id]?.name)
                          .filter(Boolean) as string[];

                        return (
                          <div key={s.index} className="ws-list-item" style={{ alignItems: "flex-start" }}>
                            <div className="ws-list-left" style={{ alignItems: "flex-start" }}>
                              <div className="ws-chip" style={{ minWidth: 64, textAlign: "center" }}>
                                Song {s.index + 1}
                              </div>

                              <div style={{ display: "grid", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <div className="ws-avatar" style={{ backgroundColor: ownerColor }}>
                                    {(ownerName?.[0] ?? "?").toUpperCase()}
                                  </div>
                                  <div className="ws-name">
                                    {ownerName} {owner?.isHost ? <span className="ws-tag">Host</span> : null}
                                  </div>
                                </div>

                                <div style={{ borderRadius: 14, overflow: "hidden" }}>
                                  <iframe
                                    title={`Spotify Embed ${s.index}`}
                                    src={spotifyEmbedUrlFromSpotifyUrl(s.url)}
                                    width="100%"
                                    height="152"
                                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                                    loading="lazy"
                                    style={{ borderRadius: 14, border: "0" }}
                                  />
                                </div>

                                <div className="ws-muted" style={{ fontSize: 13 }}>
                                  Richtig geraten: <b>{s.correctCount}</b>
                                  {correctNames.length > 0 ? ` · (${correctNames.join(", ")})` : ""}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              </>
            )}

            {/* BANGER (mit Podium + Ranking) */}
            {room.phase === "banger" && (
              <>
                <Card>
                  <div className="ws-row">
                    <div className="ws-card-title">Banger-Rangliste 🔥</div>
                    <div className="ws-chip">
                      vergeben: {bangerGivenCount}/{players.length}
                    </div>
                  </div>

                  <div className="ws-muted" style={{ marginTop: 8 }}>
                    Hier siehst du die Banger-Verteilung dieser Runde.
                  </div>

                  {/* Podium mit Banger-Anzahl */}
                  <Podium top3={bangerTop3} valueLabel="Banger" />

                  {/* komplette Rangliste */}
                  <div className="ws-muted" style={{ marginTop: 12 }}>
                    Rangliste (Banger)
                  </div>
                  <div className="ws-list" style={{ marginTop: 10 }}>
                    {bangerScoreboard.map((p, idx) => (
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
                        <div className="ws-chip">{p.score ?? 0}</div>
                      </div>
                    ))}
                  </div>

                  <div className="ws-muted" style={{ marginTop: 10 }}>
                    Bonus (+5) gibt es nur bei einem eindeutigen Sieger. Danach geht’s automatisch in die nächste Runde / zum Ende.
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
              </>
            )}

            {/* FINISHED */}
            {room.phase === "finished" && (
              <Card>
                <div className="ws-card-title">Spiel beendet 🏁</div>
                <div className="ws-muted">Podium & Ergebnisübersicht</div>

                <Podium top3={top3} valueLabel="Punkte" />

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

            {room.phase === "roundreveal" && isHost && (
              <button className="ws-btn" onClick={hostGoToBanger}>
                Zur Banger-Auswertung
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
