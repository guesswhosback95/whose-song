"use client";

import { useState } from "react";

export default function JoinPage() {
  const [code, setCode] = useState("");

  return (
    <main className="ws-page">
      <div className="ws-container">
        <div className="ws-card">
          <div className="ws-card-title">Spiel beitreten</div>
          <div className="ws-muted">
            Gib den Raumcode ein, um beizutreten.
          </div>

          <input
            className="ws-input"
            placeholder="z. B. A1B2C3"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{ marginTop: 14 }}
          />

          <button
            className="ws-btn"
            style={{ marginTop: 16 }}
            disabled={code.length < 4}
            onClick={() => (window.location.href = `/room/${code}`)}
          >
            Beitreten
          </button>
        </div>
      </div>
    </main>
  );
}
