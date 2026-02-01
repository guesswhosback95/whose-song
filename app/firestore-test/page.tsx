"use client";

export default function HomePage() {
  return (
    <main className="ws-page">
      <div className="ws-container">
        <header className="ws-header">
          <div>
            <div className="ws-title">Whose Song?</div>
            <div className="ws-subtitle">
              Das Musik-Partyspiel für Gruppen
            </div>
          </div>
        </header>

        <div className="ws-stack">
          <div className="ws-card">
            <div className="ws-card-title">Neues Spiel</div>
            <div className="ws-muted">
              Erstelle einen Raum und lade deine Freunde ein.
            </div>

            <button
              className="ws-btn"
              onClick={() => (window.location.href = "/create")}
              style={{ marginTop: 12 }}
            >
              Neues Spiel erstellen
            </button>
          </div>

          <div className="ws-card">
            <div className="ws-card-title">Spiel beitreten</div>
            <div className="ws-muted">
              Gib den Raumcode ein, den du bekommen hast.
            </div>

            <button
              className="ws-btn ws-btn--ghost"
              onClick={() => (window.location.href = "/join")}
              style={{ marginTop: 12 }}
            >
              Spiel beitreten
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
