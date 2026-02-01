"use client";

export default function RoomCodeBar({ roomCode }: { roomCode: string }) {
  function copyCode() {
    navigator.clipboard.writeText(roomCode);
  }

  return (
    <div className="ws-card ws-roomcode-card">
      <div className="ws-card-title">Raumcode</div>
      <div className="ws-muted">Teile diesen Code mit deinen Freunden</div>

      <div className="ws-roomcode-display">{roomCode}</div>

      <button className="ws-btn ws-btn--ghost" onClick={copyCode}>
        Code kopieren
      </button>
    </div>
  );
}
