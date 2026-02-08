"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { getOrCreatePlayerId } from "@/lib/playerId";
import { normalizeSpotifyUrl } from "@/lib/spotify";
import RoomCodeBar from "@/components/RoomCodeBar";

type Phase = "lobby" | "collect" | "guessing" | "reveal" | "banger" | "roundreveal" | "finished";

type Room = {
  phase: Phase;
  hostId?: string;

  totalRounds: number;
  roundNumber: number; // 0 in lobby, starts at 1
  indexInRound: number;

  songOrder?: string[];

  currentSongUrl?: string;
  currentSongOwnerId?: string;

  // ✅ NEW: Banger mode toggle
  bangerEnabled?: boolean;
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

type SongMeta = { ownerId: string; url: string; createdAt?: any; songStartedAt?: any };
type SongMetaWithIndex = SongMeta & { index: number };

type SongRoundStats = {
  index: number;
  ownerId: string;
  url: string;
  correctVoterIds: string[];
  correctCount: number;
};

type StatRow = { playerId: string; value: number };

type GameStats = {
  correctGuesses: StatRow[];
  songsCorrectlyAttributed: StatRow[];

  // ✅ only meaningful if bangerEnabled
  bangersReceived: StatRow[];
  bangersGiven: StatRow[];

  fastestSubmit: { playerId: string; ms: number } | null;
  slowestSubmit: { playerId: string; ms: number } | null;
  fastestGuess: { playerId: string; ms: number } | null;
  slowestGuess: { playerId: string; ms: number } | null;
};

type VoteDoc = { guessedPlayerId: string; createdAt?: any };

// ✅ NEW: One Banger vote per round per player
type BangerVoteDoc = { songIndex: number; createdAt?: any };

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
  if (phase === "banger") return "Banger wählen";
  if (phase === "roundreveal") return "Runden-Auflösung";
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
 * ✅ Podium wiederverwendbar
 */
function Podium({ top3, valueLabel = "Punkte" }: { top3: Player[]; valueLabel?: string }) {
  const p1 = top3[0];
  const p2 = top3[1];
  const p3 = top3[2];

  const valueOf = (p?: Player) => p?.score ?? 0;

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

function RankListFrom4({ scoreboard, playerId }: { scoreboard: Player[]; playerId: string }) {
  const rest = scoreboard.slice(3);
  if (rest.length === 0) return null;

  return (
    <div className="ws-list" style={{ marginTop: 12 }}>
      {rest.map((p, idx) => (
        <div key={p.id} className="ws-list-item">
          <div className="ws-list-left">
            <div className="ws-chip" style={{ minWidth: 54, textAlign: "center" }}>
              #{idx + 4}
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

function top3FromRows(rows: StatRow[]): StatRow[] {
  return [...rows].sort((a, b) => b.value - a.value).slice(0, 3);
}

function msLabel(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

export default function RoomClient({ code }: { code: string }) {
  const router = useRouter();

  const roomCode = (code ?? "").toUpperCase();
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
  const [myVote, setMyVote] = useState<VoteDoc | null>(null);
  const [votes, setVotes] = useState<Record<string, VoteDoc>>({});

  // ✅ Fake owner action (local only) per song
  const [fakeOwnerSubmittedKey, setFakeOwnerSubmittedKey] = useState<string>("");

  // ✅ NEW: Banger votes (per round)
  const [bangerVotes, setBangerVotes] = useState<Record<string, BangerVoteDoc>>({});
  const [myBangerVote, setMyBangerVote] = useState<BangerVoteDoc | null>(null);
  const [bangerStatus, setBangerStatus] = useState("");

  // Host status
  const [hostStatus, setHostStatus] = useState("");

  // UI FX
  const [shakeKey, setShakeKey] = useState(0);
  const [toast, setToast] = useState("");
  const [revealFxKey, setRevealFxKey] = useState(0);

  // Endscreen stats
  const [statsOpen, setStatsOpen] = useState(false);

  // ✅ Stats state
  const [gameStats, setGameStats] = useState<GameStats | null>(null);
  const [gameStatsLoading, setGameStatsLoading] = useState(false);
  const [gameStatsError, setGameStatsError] = useState("");

  // Modell C: Runden-Auflösung Daten (jetzt auch für Banger-Phase)
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
        const data = snap.data() as Partial<Room>;
        setRoom({
          phase: ((data.phase ?? "lobby") as Phase) ?? "lobby",
          hostId: data.hostId ?? "",
          totalRounds: data.totalRounds ?? 1,
          roundNumber: data.roundNumber ?? 0,
          indexInRound: data.indexInRound ?? 0,
          songOrder: data.songOrder ?? [],
          currentSongUrl: data.currentSongUrl ?? "",
          currentSongOwnerId: data.currentSongOwnerId ?? "",
          bangerEnabled: !!data.bangerEnabled, // ✅ default false
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

  const playersById = useMemo(() => {
    const map: Record<string, Player> = {};
    players.forEach((p) => (map[p.id] = p));
    return map;
  }, [players]);

  function nameOf(pid: string) {
    return playersById[pid]?.name ?? "Unbekannt";
  }

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
      const map: Record<string, VoteDoc> = {};
      snap.docs.forEach((d) => (map[d.id] = d.data() as VoteDoc));
      setVotes(map);

      const mine = map[playerId] ?? null;
      setMyVote(mine);
      if (mine) setSelectedGuessPlayerId(mine.guessedPlayerId);
    });

    return () => unsub();
  }, [room?.phase, room?.roundNumber, room?.indexInRound, roomCode, playerId, room]);

  // ✅ reset fake-owner button per song
  useEffect(() => {
    if (!room) return;
    const key = `${room.roundNumber}:${room.indexInRound}`;
    setFakeOwnerSubmittedKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.roundNumber, room?.indexInRound]);

  // ✅ Live: Banger votes (only in banger phase)
  useEffect(() => {
    if (!room) return;

    if (room.roundNumber < 1) {
      setBangerVotes({});
      setMyBangerVote(null);
      return;
    }

    if (room.phase !== "banger") {
      setBangerVotes({});
      setMyBangerVote(null);
      setBangerStatus("");
      return;
    }

    const ref = collection(db, "rooms", roomCode, "rounds", String(room.roundNumber), "bangerVotes");
    const unsub = onSnapshot(ref, (snap) => {
      const map: Record<string, BangerVoteDoc> = {};
      snap.docs.forEach((d) => (map[d.id] = d.data() as BangerVoteDoc));
      setBangerVotes(map);
      setMyBangerVote(map[playerId] ?? null);
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

  // ✅ Soft reveal: how many guessed correctly (owner hidden)
  const revealCorrectVoters = useMemo(() => {
    if (!room || room.phase !== "reveal") return [];
    const ownerId = room.currentSongOwnerId;
    if (!ownerId) return [];
    return Object.entries(votes)
      .filter(([voterId, v]) => voterId !== ownerId && v.guessedPlayerId === ownerId)
      .map(([voterId]) => voterId);
  }, [room, votes]);

  const revealCorrectCount = revealCorrectVoters.length;

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

  async function hostToggleBangerEnabled() {
    if (!isHost || !room) return;
    await updateDoc(doc(db, "rooms", roomCode), { bangerEnabled: !room.bangerEnabled });
  }

  // ✅ Round meta (für "Finger" beim Einreichen)
  async function writeRoundMetaCollectStart(roundNumber: number) {
    const ref = doc(db, "rooms", roomCode, "rounds", String(roundNumber), "meta", "state");
    await setDoc(ref, { collectStartedAt: serverTimestamp() }, { merge: true });
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
      bangerEnabled: !!room.bangerEnabled,
    });

    await writeRoundMetaCollectStart(1);
  }

  async function writeSongMeta(roundNumber: number, index: number, ownerId: string, url: string) {
    const metaRef = doc(db, "rooms", roomCode, "rounds", String(roundNumber), "songs", String(index));
    await setDoc(
      metaRef,
      {
        ownerId,
        url,
        createdAt: serverTimestamp(),
        songStartedAt: serverTimestamp(), // ✅ Guess-Speed
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

  // ✅ NEW: reveal is only "soft reveal" (NO scoring)
  async function hostRevealSoft() {
    setHostStatus("");
    if (!isHost || !room || room.phase !== "guessing") return;

    if (!allVotesIn) {
      setHostStatus(`Noch nicht alle abgestimmt (${votedCount}/${requiredVotes}).`);
      setTimeout(() => setHostStatus(""), 1200);
      return;
    }

    await updateDoc(doc(db, "rooms", roomCode), { phase: "reveal" });
  }

  // ✅ Apply all round scoring AT ONCE (after guessing, right before round reveal)
  async function hostApplyRoundScoring(roundNumber: number) {
    const playersRef = collection(db, "rooms", roomCode, "players");
    const pSnap = await getDocs(playersRef);

    // defensive: initialize missing scores to 0 locally
    const playerIds = pSnap.docs.map((d) => (d.data() as Player)?.id ?? d.id);

    const songsRef = collection(db, "rooms", roomCode, "rounds", String(roundNumber), "songs");
    const songsSnap = await getDocs(songsRef);

    const addPoints: Record<string, number> = {};
    playerIds.forEach((pid) => (addPoints[pid] = 0));

    for (const songDoc of songsSnap.docs) {
      const song = songDoc.data() as any;
      const ownerId = song?.ownerId as string | undefined;
      if (!ownerId) continue;

      const votesRef = collection(db, "rooms", roomCode, "rounds", String(roundNumber), "songs", songDoc.id, "votes");
      const votesSnap = await getDocs(votesRef);

      let correctCount = 0;
      const correctVoters: string[] = [];

      votesSnap.docs.forEach((v) => {
        const voterId = v.id;
        const guessed = (v.data() as any)?.guessedPlayerId as string | undefined;
        if (voterId === ownerId) return;
        if (guessed && guessed === ownerId) {
          correctCount++;
          correctVoters.push(voterId);
        }
      });

      // points:
      // voter correct => +10
      // owner gets +5 per correct guess
      correctVoters.forEach((voterId) => {
        addPoints[voterId] = (addPoints[voterId] ?? 0) + 10;
      });
      if (correctCount > 0) {
        addPoints[ownerId] = (addPoints[ownerId] ?? 0) + 5 * correctCount;
      }
    }

    const batch = writeBatch(db);
    Object.entries(addPoints).forEach(([pid, pts]) => {
      if (!pts) return;
      batch.update(doc(db, "rooms", roomCode, "players", pid), { score: increment(pts) });
    });

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

    // ✅ end of all songs: go to Banger (if enabled) BEFORE round reveal
    if (room.bangerEnabled) {
      await updateDoc(doc(db, "rooms", roomCode), {
        phase: "banger",
        currentSongUrl: "",
        currentSongOwnerId: "",
      });
      return;
    }

    // ✅ if Banger disabled: apply scoring now and show round reveal
    await hostApplyRoundScoring(room.roundNumber);
    await updateDoc(doc(db, "rooms", roomCode), { phase: "roundreveal" });
  }

  // ✅ Host: after all Banger votes are in -> apply scoring and show round reveal
  async function hostContinueFromBanger() {
    setHostStatus("");
    if (!isHost || !room || room.phase !== "banger") return;

    const votesIn = Object.keys(bangerVotes).length;
    if (votesIn < players.length) {
      setHostStatus(`Noch nicht alle haben einen Banger gewählt (${votesIn}/${players.length}).`);
      setTimeout(() => setHostStatus(""), 1400);
      return;
    }

    await hostApplyRoundScoring(room.roundNumber);
    await updateDoc(doc(db, "rooms", roomCode), { phase: "roundreveal" });
  }

  // ✅ Next round / finish after round reveal
  async function hostNextAfterRoundReveal() {
    setHostStatus("");
    if (!isHost || !room || room.phase !== "roundreveal") return;

    const nextRound = (room.roundNumber ?? 1) + 1;
    const hasNextRound = nextRound <= (room.totalRounds ?? 1);

    const batch = writeBatch(db);

    if (hasNextRound) {
      batch.update(doc(db, "rooms", roomCode), {
        phase: "collect",
        roundNumber: nextRound,
        indexInRound: 0,
        songOrder: [],
        currentSongUrl: "",
        currentSongOwnerId: "",
      });

      // collect-start for timing stats
      batch.set(
        doc(db, "rooms", roomCode, "rounds", String(nextRound), "meta", "state"),
        { collectStartedAt: serverTimestamp() },
        { merge: true }
      );
    } else {
      batch.update(doc(db, "rooms", roomCode), { phase: "finished" });
    }

    await batch.commit();
  }

  // ✅ Helper: Löscht alle Docs einer Collection (ein Level tief)
  async function deleteAllDocsInCollection(refPath: ReturnType<typeof collection>) {
    const snap = await getDocs(refPath);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }

  // ✅ Restart: Scores reset + Room reset + Round-Daten löschen (nur letzte Runde, defensiv)
  async function hostRestartToLobby() {
    if (!isHost || !room) return;

    const currentRound = room.roundNumber ?? 0;

    const batch = writeBatch(db);
    players.forEach((p) => batch.update(doc(db, "rooms", roomCode, "players", p.id), { score: 0 }));

    batch.update(doc(db, "rooms", roomCode), {
      phase: "lobby",
      roundNumber: 0,
      indexInRound: 0,
      songOrder: [],
      currentSongUrl: "",
      currentSongOwnerId: "",
    });

    await batch.commit();

    if (currentRound >= 1) {
      try {
        const roundBase = ["rooms", roomCode, "rounds", String(currentRound)] as const;

        await deleteAllDocsInCollection(collection(db, ...roundBase, "submissions"));
        await deleteAllDocsInCollection(collection(db, ...roundBase, "bangerVotes"));

        const songsRef = collection(db, ...roundBase, "songs");
        const songsSnap = await getDocs(songsRef);

        for (const s of songsSnap.docs) {
          const votesRef = collection(db, ...roundBase, "songs", s.id, "votes");
          await deleteAllDocsInCollection(votesRef);
          await deleteDoc(s.ref);
        }

        const metaRef = doc(db, ...roundBase, "meta", "state");
        await deleteDoc(metaRef).catch(() => {});
      } catch {
        // ignore
      }
    }

    setSongInput("");
    setSongStatus("");
    setSubmissions([]);
    setVotes({});
    setMyVote(null);
    setSelectedGuessPlayerId("");
    setBangerVotes({});
    setMyBangerVote(null);
    setBangerStatus("");

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

  // ✅ Fake button for owner (NO Firestore side effects)
  function submitOwnerFake() {
    if (!room) return;
    const key = `${room.roundNumber}:${room.indexInRound}`;
    setFakeOwnerSubmittedKey(key);
    setToast("✅ Abgeschickt");
    setTimeout(() => setToast(""), 900);
  }

  // ✅ Banger vote (one per round, must choose a song, not own)
  async function submitBangerVote(songIndex: number) {
    setBangerStatus("");
    if (!room || room.phase !== "banger") return;

    if (myBangerVote) {
      setBangerStatus("Du hast bereits einen Banger gewählt.");
      setTimeout(() => setBangerStatus(""), 1200);
      return;
    }

    const song = roundSongs.find((s) => s.index === songIndex);
    if (!song) {
      setBangerStatus("Song nicht gefunden.");
      setTimeout(() => setBangerStatus(""), 1200);
      return;
    }

    if (song.ownerId === playerId) {
      setBangerStatus("Du darfst nicht deinen eigenen Song wählen.");
      setTimeout(() => setBangerStatus(""), 1200);
      return;
    }

    const ref = doc(db, "rooms", roomCode, "rounds", String(room.roundNumber), "bangerVotes", playerId);
    await setDoc(ref, { songIndex, createdAt: serverTimestamp() } satisfies BangerVoteDoc, { merge: true });

    setToast("🔥 Banger gewählt");
    setTimeout(() => setToast(""), 1200);
  }

  const showMain = room && !needsProfile;

  // ✅ Round songs: load for Banger + RoundReveal
  useEffect(() => {
    if (!room) return;

    if (room.phase !== "roundreveal" && room.phase !== "banger") {
      setRoundSongs([]);
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
            songStartedAt: (data as any).songStartedAt,
          };
        })
        .sort((a, b) => a.index - b.index);

      setRoundSongs(list);
    });

    return () => unsub();
  }, [room?.phase, room?.roundNumber, roomCode, room]);

  // ✅ Round reveal: collect votes per song (only in roundreveal)
  useEffect(() => {
    if (!room) return;

    if (room.phase !== "roundreveal") {
      setRoundStats([]);
      setRoundStatsLoading(false);
      setRoundStatsError("");
      return;
    }

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
                songStartedAt: (data as any).songStartedAt,
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

  // ✅ Stats Loader (Finished)
  async function loadGameStats() {
    if (!room) return;

    setGameStatsError("");
    setGameStatsLoading(true);

    try {
      const maxRound = Math.max(1, room.roundNumber ?? 0);

      const correctGuesses: Record<string, number> = {};
      const songsCorrect: Record<string, number> = {};
      const bangersReceived: Record<string, number> = {};
      const bangersGiven: Record<string, number> = {};

      let fastestSubmit: { playerId: string; ms: number } | null = null;
      let slowestSubmit: { playerId: string; ms: number } | null = null;
      let fastestGuess: { playerId: string; ms: number } | null = null;
      let slowestGuess: { playerId: string; ms: number } | null = null;

      for (let r = 1; r <= maxRound; r++) {
        const metaRef = doc(db, "rooms", roomCode, "rounds", String(r), "meta", "state");
        const metaSnap = await getDoc(metaRef);
        const collectStartedAt = metaSnap.exists() ? (metaSnap.data() as any)?.collectStartedAt?.toMillis?.() : null;

        const subsRef = collection(db, "rooms", roomCode, "rounds", String(r), "submissions");
        const subsSnap = await getDocs(subsRef);

        if (collectStartedAt) {
          subsSnap.docs.forEach((d) => {
            const pid = d.id;
            const created = (d.data() as any)?.createdAt?.toMillis?.();
            if (!created) return;
            const ms = created - collectStartedAt;
            if (ms < 0) return;

            if (!fastestSubmit || ms < fastestSubmit.ms) fastestSubmit = { playerId: pid, ms };
            if (!slowestSubmit || ms > slowestSubmit.ms) slowestSubmit = { playerId: pid, ms };
          });
        }

        const songsRef = collection(db, "rooms", roomCode, "rounds", String(r), "songs");
        const songsSnap = await getDocs(songsRef);

        // map songIndex -> ownerId for banger attribution
        const songIndexToOwner: Record<number, string> = {};
        songsSnap.docs.forEach((sd) => {
          const idx = Number(sd.id);
          const ownerId = (sd.data() as any)?.ownerId as string | undefined;
          if (Number.isFinite(idx) && ownerId) songIndexToOwner[idx] = ownerId;
        });

        for (const songDoc of songsSnap.docs) {
          const index = songDoc.id;
          const song = songDoc.data() as any;
          const ownerId = song?.ownerId as string | undefined;
          const songStartedAt = song?.songStartedAt?.toMillis?.() ?? null;
          if (!ownerId) continue;

          const votesRef = collection(db, "rooms", roomCode, "rounds", String(r), "songs", String(index), "votes");
          const votesSnap = await getDocs(votesRef);

          votesSnap.docs.forEach((v) => {
            const voterId = v.id;
            const guessed = (v.data() as any)?.guessedPlayerId as string | undefined;

            if (songStartedAt) {
              const voteAt = (v.data() as any)?.createdAt?.toMillis?.();
              if (voteAt) {
                const ms = voteAt - songStartedAt;
                if (ms >= 0) {
                  if (!fastestGuess || ms < fastestGuess.ms) fastestGuess = { playerId: voterId, ms };
                  if (!slowestGuess || ms > slowestGuess.ms) slowestGuess = { playerId: voterId, ms };
                }
              }
            }

            if (voterId === ownerId) return;
            if (guessed && guessed === ownerId) {
              correctGuesses[voterId] = (correctGuesses[voterId] ?? 0) + 1;
              songsCorrect[ownerId] = (songsCorrect[ownerId] ?? 0) + 1;
            }
          });
        }

        // ✅ Banger stats only if mode enabled (room-level; if it was turned off mid-game, we still read but will hide UI)
        const bRef = collection(db, "rooms", roomCode, "rounds", String(r), "bangerVotes");
        const bSnap = await getDocs(bRef);
        bSnap.docs.forEach((d) => {
          const giverId = d.id;
          const songIndex = (d.data() as any)?.songIndex as number | undefined;
          if (!Number.isFinite(songIndex)) return;

          const ownerId = songIndexToOwner[songIndex as number];
          if (!ownerId) return;

          bangersGiven[giverId] = (bangersGiven[giverId] ?? 0) + 1;
          bangersReceived[ownerId] = (bangersReceived[ownerId] ?? 0) + 1;
        });
      }

      const toRows = (m: Record<string, number>): StatRow[] =>
        Object.entries(m)
          .map(([playerId, value]) => ({ playerId, value }))
          .sort((a, b) => b.value - a.value);

      setGameStats({
        correctGuesses: toRows(correctGuesses),
        songsCorrectlyAttributed: toRows(songsCorrect),
        bangersReceived: toRows(bangersReceived),
        bangersGiven: toRows(bangersGiven),
        fastestSubmit,
        slowestSubmit,
        fastestGuess,
        slowestGuess,
      });
    } catch (e: any) {
      setGameStatsError(e?.message ?? String(e));
    } finally {
      setGameStatsLoading(false);
    }
  }

  // --- UI helpers ---
  const bangerVotesCount = Object.keys(bangerVotes).length;

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
            {/* IN-GAME SCORE (während Spiel, aber NICHT Lobby/Finished) */}
            {room.phase !== "lobby" && room.phase !== "finished" && (
              <Card>
                <InGameScoreHeader me={me} myRank={myRank} totalPlayers={players.length} />

                {players.length >= 3 ? (
                  <>
                    <div className="ws-muted" style={{ marginTop: 10 }}>
                      Top 3 aktuell
                    </div>
                    <Podium top3={top3} valueLabel="Punkte" />
                    <RankListFrom4 scoreboard={scoreboard} playerId={playerId} />
                  </>
                ) : (
                  <>
                    <div className="ws-muted" style={{ marginTop: 10 }}>
                      Rangliste
                    </div>
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
                      {/* ✅ Banger toggle */}
                      <div className="ws-row">
                        <div>
                          <div className="ws-muted" style={{ marginBottom: 2 }}>
                            Banger-Modus
                          </div>
                          <div className="ws-muted" style={{ fontSize: 13 }}>
                            {room.bangerEnabled ? "Aktiv: Jeder MUSS pro Runde 1 Banger wählen." : "Inaktiv: Kein Banger-Voting, keine Banger-Stats."}
                          </div>
                        </div>

                        <button
                          className={`ws-toggle ${room.bangerEnabled ? "is-on" : ""}`}
                          onClick={hostToggleBangerEnabled}
                          aria-label="Banger-Modus umschalten"
                        >
                          <span className="ws-toggle-dot" />
                        </button>
                      </div>

                      <div className="ws-row" style={{ marginTop: 8 }}>
                        <div className="ws-muted">Rundenanzahl</div>
                        <div className="ws-chip">{room.totalRounds ?? 1}</div>
                      </div>

                      {/* ✅ Grey slider */}
                      <input
                        className="ws-slider"
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

                      <button className="ws-btn ws-btn--ghost" onClick={hostRestartToLobby} style={{ marginTop: 8 }}>
                        🔁 Spiel zurücksetzen (Lobby)
                      </button>
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

                <div style={{ borderRadius: 16, overflow: "hidden", position: "relative", pointerEvents: isHost ? "auto" : "none", marginTop: 10 }}>
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

                {!isHost && <div className="ws-muted" style={{ marginTop: 8 }}>(Nur der Host kann den Song starten.)</div>}

                <div className="ws-row" style={{ marginTop: 10, alignItems: "flex-end", gap: 10 }}>
                  <a href={room.currentSongUrl} target="_blank" rel="noreferrer" className="ws-link">
                    In Spotify öffnen
                  </a>
                </div>
              </Card>
            )}

            {/* GUESSING */}
            {room.phase === "guessing" && (
              <div key={shakeKey} className="ws-shake">
                <Card>
                  <div className="ws-card-title">Wem gehört der Song?</div>

                  {/* ✅ Fake button for owner */}
                  {isOwnerNow ? (
                    <>
                      <div className="ws-muted" style={{ marginBottom: 10 }}>
                        Du hast diesen Song eingereicht. <br />
                        Votes: {votedCount}/{requiredVotes}
                      </div>

                      <button
                        className="ws-btn"
                        onClick={submitOwnerFake}
                        disabled={fakeOwnerSubmittedKey === `${room.roundNumber}:${room.indexInRound}`}
                        title="Fake-Button (ohne Effekt)"
                      >
                        {fakeOwnerSubmittedKey === `${room.roundNumber}:${room.indexInRound}` ? "Abgeschickt ✅" : "Dies ist mein Song · Abschicken"}
                      </button>

                      <div className="ws-muted" style={{ marginTop: 10 }}>
                        (Nur du siehst das. Für andere wirkt es ganz normal.)
                      </div>
                    </>
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
                                {/* ✅ Score is allowed to be shown; it simply won't change during guessing anymore */}
                                <div className="ws-playerbtn__meta">{p.score ?? 0} Punkte</div>
                              </button>
                            );
                          })}
                      </div>

                      <button className="ws-btn" style={{ marginTop: 16 }} onClick={submitVote} disabled={!!myVote || !selectedGuessPlayerId}>
                        {myVote ? "Stimme abgegeben ✅" : "Stimme abgeben"}
                      </button>

                      {voteStatus && <div className="ws-muted">{voteStatus}</div>}
                      <div className="ws-muted">
                        Votes: {votedCount}/{requiredVotes}
                      </div>
                    </>
                  )}

                  {isHost && (
                    <button className="ws-btn ws-btn--ghost" onClick={hostRevealSoft} disabled={!allVotesIn} style={{ marginTop: 12 }}>
                      Zwischenstand zeigen (Host) {allVotesIn ? "" : `(${votedCount}/${requiredVotes})`}
                    </button>
                  )}
                </Card>
              </div>
            )}

            {/* REVEAL (Soft) */}
            {room.phase === "reveal" && (
              <Card>
                <div className="ws-card-title">Zwischenstand</div>

                <div className="ws-reveal-hero" style={{ backgroundColor: "rgba(0,0,0,.03)", borderRadius: 22, position: "relative", overflow: "hidden" }}>
                  <div key={`confetti-${revealFxKey}`} className="ws-confetti" aria-hidden="true">
                    {Array.from({ length: 14 }).map((_, idx) => (
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

                  <div className="ws-muted">Richtig geraten</div>
                  <div className="ws-reveal-name">{revealCorrectCount}</div>

                  <div className="ws-muted" style={{ marginTop: 8 }}>
                    Owner wird erst nach allen Songs aufgelöst.
                  </div>

                  <div className="ws-muted" style={{ marginTop: 10, fontSize: 13 }}>
                    ✅ Punkte werden erst nach der Guessing-Phase sichtbar.
                  </div>
                </div>
              </Card>
            )}

            {/* BANGER (NEW SYSTEM) */}
            {room.phase === "banger" && (
              <Card>
                <div className="ws-row">
                  <div className="ws-card-title">Banger wählen 🔥</div>
                  <div className="ws-chip">
                    {bangerVotesCount}/{players.length}
                  </div>
                </div>

                <div className="ws-muted" style={{ marginTop: 8 }}>
                  Jeder MUSS genau einen Banger pro Runde vergeben. Kein Skip. Du darfst nicht deinen eigenen Song wählen.
                </div>

                {hostStatus && (
                  <div className="ws-muted" style={{ marginTop: 10 }}>
                    {hostStatus}
                  </div>
                )}

                {bangerStatus && (
                  <div className="ws-muted" style={{ marginTop: 10 }}>
                    {bangerStatus}
                  </div>
                )}

                {roundSongs.length === 0 ? (
                  <div className="ws-muted" style={{ marginTop: 12 }}>
                    Lade Songs…
                  </div>
                ) : (
                  <div className="ws-stack" style={{ marginTop: 12 }}>
                    {roundSongs.map((s) => {
                      const isMine = s.ownerId === playerId;
                      const disabled = !!myBangerVote || isMine;
                      const selected = myBangerVote?.songIndex === s.index;

                      return (
                        <div key={s.index} className="ws-list-item" style={{ alignItems: "flex-start" }}>
                          <div className="ws-list-left" style={{ alignItems: "flex-start", width: "100%" }}>
                            <div className="ws-chip" style={{ minWidth: 72, textAlign: "center" }}>
                              Song {s.index + 1}
                            </div>

                            <div style={{ display: "grid", gap: 8, width: "100%" }}>
                              <div style={{ borderRadius: 14, overflow: "hidden" }}>
                                <iframe
                                  title={`Spotify Embed banger ${s.index}`}
                                  src={spotifyEmbedUrlFromSpotifyUrl(s.url)}
                                  width="100%"
                                  height="152"
                                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                                  loading="lazy"
                                  style={{ borderRadius: 14, border: "0" }}
                                />
                              </div>

                              <button
                                className="ws-btn ws-btn--ghost"
                                disabled={disabled}
                                onClick={() => submitBangerVote(s.index)}
                                style={{
                                  width: "100%",
                                  opacity: disabled ? 0.55 : 1,
                                  outline: selected ? "3px solid rgba(0,0,0,.75)" : "none",
                                }}
                              >
                                {isMine ? "Eigener Song (nicht wählbar)" : selected ? "Banger gewählt ✅" : "🔥 Diesen Song als Banger wählen"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {isHost && (
                  <button className="ws-btn ws-btn--ghost" style={{ marginTop: 14, width: "100%" }} onClick={hostContinueFromBanger}>
                    Weiter zur Auflösung
                  </button>
                )}
              </Card>
            )}

            {/* ROUNDREVEAL */}
            {room.phase === "roundreveal" && (
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

                {roundStatsLoading && <div className="ws-muted" style={{ marginTop: 10 }}>Lade Auflösung…</div>}

                {!roundStatsLoading && roundStats.length > 0 && (
                  <div className="ws-stack" style={{ marginTop: 12 }}>
                    {roundStats.map((s) => {
                      const owner = playersById[s.ownerId];
                      const ownerName = owner?.name ?? "Unbekannt";
                      const ownerColor = owner?.color ?? "rgba(0,0,0,.08)";

                      const correctNames = s.correctVoterIds.map((id) => playersById[id]?.name).filter(Boolean) as string[];

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

                {isHost && (
                  <button className="ws-btn ws-btn--ghost" style={{ marginTop: 14, width: "100%" }} onClick={hostNextAfterRoundReveal}>
                    {room.roundNumber < room.totalRounds ? "Nächste Runde" : "Spiel beenden"}
                  </button>
                )}
              </Card>
            )}

            {/* FINISHED */}
            {room.phase === "finished" && (
              <Card>
                <div className="ws-card-title">Spiel beendet 🏁</div>
                <div className="ws-muted">Podium & Ergebnisübersicht</div>

                {players.length >= 3 ? (
                  <>
                    <Podium top3={top3} valueLabel="Punkte" />
                    <RankListFrom4 scoreboard={scoreboard} playerId={playerId} />
                  </>
                ) : (
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
                )}

                <div style={{ marginTop: 12 }}>
                  <button
                    className="ws-btn ws-btn--ghost"
                    onClick={async () => {
                      const next = !statsOpen;
                      setStatsOpen(next);
                      if (next) await loadGameStats();
                    }}
                  >
                    {statsOpen ? "Statistiken ausblenden" : "Statistiken anzeigen"}
                  </button>

                  {statsOpen && (
                    <div style={{ marginTop: 10 }}>
                      {gameStatsError && <div className="ws-muted">❌ Fehler: {gameStatsError}</div>}
                      {gameStatsLoading && <div className="ws-muted">Lade Statistiken…</div>}

                      {!gameStatsLoading && gameStats && (
                        <div className="ws-stack" style={{ marginTop: 10 }}>
                          <div className="ws-card">
                            <div className="ws-card-title">🎯 Meiste richtige Guesses</div>
                            <div className="ws-list" style={{ marginTop: 10 }}>
                              {top3FromRows(gameStats.correctGuesses).map((r, i) => (
                                <div key={r.playerId} className="ws-list-item">
                                  <div className="ws-list-left">
                                    <div className="ws-chip" style={{ minWidth: 44, textAlign: "center" }}>
                                      #{i + 1}
                                    </div>
                                    <div className="ws-name">{nameOf(r.playerId)}</div>
                                  </div>
                                  <div className="ws-chip">{r.value}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="ws-card">
                            <div className="ws-card-title">🧠 Songs am häufigsten richtig zugeordnet</div>
                            <div className="ws-list" style={{ marginTop: 10 }}>
                              {top3FromRows(gameStats.songsCorrectlyAttributed).map((r, i) => (
                                <div key={r.playerId} className="ws-list-item">
                                  <div className="ws-list-left">
                                    <div className="ws-chip" style={{ minWidth: 44, textAlign: "center" }}>
                                      #{i + 1}
                                    </div>
                                    <div className="ws-name">{nameOf(r.playerId)}</div>
                                  </div>
                                  <div className="ws-chip">{r.value}</div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* ✅ Banger stats conditional */}
                          {!room.bangerEnabled ? (
                            <div className="ws-card">
                              <div className="ws-card-title">🔥 Banger</div>
                              <div className="ws-muted" style={{ marginTop: 8 }}>
                                Banger-Modus war deaktiviert.
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="ws-card">
                                <div className="ws-card-title">🔥 Meiste Banger erhalten</div>
                                <div className="ws-list" style={{ marginTop: 10 }}>
                                  {top3FromRows(gameStats.bangersReceived).map((r, i) => (
                                    <div key={r.playerId} className="ws-list-item">
                                      <div className="ws-list-left">
                                        <div className="ws-chip" style={{ minWidth: 44, textAlign: "center" }}>
                                          #{i + 1}
                                        </div>
                                        <div className="ws-name">{nameOf(r.playerId)}</div>
                                      </div>
                                      <div className="ws-chip">{r.value}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="ws-card">
                                <div className="ws-card-title">🖐️ Meiste Banger verteilt</div>
                                <div className="ws-list" style={{ marginTop: 10 }}>
                                  {top3FromRows(gameStats.bangersGiven).map((r, i) => (
                                    <div key={r.playerId} className="ws-list-item">
                                      <div className="ws-list-left">
                                        <div className="ws-chip" style={{ minWidth: 44, textAlign: "center" }}>
                                          #{i + 1}
                                        </div>
                                        <div className="ws-name">{nameOf(r.playerId)}</div>
                                      </div>
                                      <div className="ws-chip">{r.value}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}

                          <div className="ws-card">
                            <div className="ws-card-title">⌨️ Song-Einreichzeit (Finger)</div>
                            <div className="ws-muted" style={{ marginTop: 8 }}>
                              (Wird gemessen ab Collect-Start)
                            </div>
                            <div className="ws-list" style={{ marginTop: 10 }}>
                              <div className="ws-list-item">
                                <div className="ws-list-left">
                                  <div className="ws-name">⚡ Schnellster Finger</div>
                                </div>
                                <div className="ws-chip">
                                  {gameStats.fastestSubmit ? `${nameOf(gameStats.fastestSubmit.playerId)} · ${msLabel(gameStats.fastestSubmit.ms)}` : "—"}
                                </div>
                              </div>

                              <div className="ws-list-item">
                                <div className="ws-list-left">
                                  <div className="ws-name">🐢 Langsamster Finger</div>
                                </div>
                                <div className="ws-chip">
                                  {gameStats.slowestSubmit ? `${nameOf(gameStats.slowestSubmit.playerId)} · ${msLabel(gameStats.slowestSubmit.ms)}` : "—"}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="ws-card">
                            <div className="ws-card-title">⏱️ Guess-Speed (Finger)</div>
                            <div className="ws-muted" style={{ marginTop: 8 }}>
                              (Wird gemessen ab Song-Start)
                            </div>
                            <div className="ws-list" style={{ marginTop: 10 }}>
                              <div className="ws-list-item">
                                <div className="ws-list-left">
                                  <div className="ws-name">⚡ Schnellster Guess</div>
                                </div>
                                <div className="ws-chip">
                                  {gameStats.fastestGuess ? `${nameOf(gameStats.fastestGuess.playerId)} · ${msLabel(gameStats.fastestGuess.ms)}` : "—"}
                                </div>
                              </div>

                              <div className="ws-list-item">
                                <div className="ws-list-left">
                                  <div className="ws-name">🐢 Langsamster Guess</div>
                                </div>
                                <div className="ws-chip">
                                  {gameStats.slowestGuess ? `${nameOf(gameStats.slowestGuess.playerId)} · ${msLabel(gameStats.slowestGuess.ms)}` : "—"}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="ws-stack" style={{ marginTop: 14 }}>
                  <button className="ws-btn ws-btn--ghost" onClick={() => router.replace("/")}>
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

            {room.phase === "banger" && isHost && (
              <button className="ws-btn" onClick={hostContinueFromBanger}>
                Weiter zur Auflösung
              </button>
            )}

            {room.phase === "roundreveal" && isHost && (
              <button className="ws-btn" onClick={hostNextAfterRoundReveal}>
                {room.roundNumber < room.totalRounds ? "Nächste Runde" : "Spiel beenden"}
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
