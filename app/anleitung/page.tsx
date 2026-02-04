export default function AnleitungPage() {
  return (
    <main className="ws-page">
      <div className="ws-container">
        <header className="ws-header">
          <div>
            <div className="ws-title">Anleitung</div>
            <div className="ws-subtitle">
              Whose Song? · Quick Start + Regeln · (Diese Seite kann jederzeit geändert werden, URL bleibt gleich)
            </div>
          </div>
        </header>

        <div className="ws-stack">
          <div className="ws-card">
            <div className="ws-row">
              <div className="ws-card-title" style={{ marginBottom: 0 }}>
                Quick Start (60 Sekunden)
              </div>
              <div className="ws-chip">v0.1 · Stand: Feb 2026</div>
            </div>

            <ol style={{ marginTop: 12, paddingLeft: 18, display: "grid", gap: 10 }}>
              <li>
                <span className="ws-name">Host erstellt einen Raum</span>
                <div className="ws-muted">Alle treten per Code bei und wählen Name + Farbe.</div>
              </li>
              <li>
                <span className="ws-name">Pro Runde: Jeder reicht genau 1 Song ein</span>
                <div className="ws-muted">Aktuell per Spotify-Link (in der App). Die Abgaben sind anonym.</div>
              </li>
              <li>
                <span className="ws-name">Der Host spielt die Songs nacheinander ab</span>
                <div className="ws-muted">Alle raten bei jedem Song: wem gehört er?</div>
              </li>
              <li>
                <span className="ws-name">Punkte</span>
                <div className="ws-muted">
                  Richtig geraten: +10 · Owner bekommt +5 pro richtigem Vote von anderen.
                </div>
              </li>
              <li>
                <span className="ws-name">🔥 Banger (1x pro Runde pro Spieler)</span>
                <div className="ws-muted">
                  Während des Ratens kann jeder genau 1x pro Runde einen Banger vergeben (nicht an sich selbst).
                  Am Rundenende gibt’s +5 Bonus nur bei eindeutigem Sieger (kein Bonus bei Gleichstand).
                </div>
              </li>
              <li>
                <span className="ws-name">Reveal-Style</span>
                <div className="ws-muted">
                  Während der Runde wird nicht sofort gezeigt, wem ein Song gehört. Die komplette Auflösung kommt am
                  Rundenende.
                </div>
              </li>
            </ol>

            <div className="ws-muted" style={{ marginTop: 12 }}>
              Tipp: Zieht eure Genre/Theme-Karte <b>vor Ort</b> – die Karte ist nur ein Hinweis/Flavor und nicht Teil der App.
            </div>
          </div>

          <div className="ws-card">
            <div className="ws-card-title">Regeln (Detail)</div>

            <div className="ws-stack" style={{ marginTop: 10 }}>
              <div>
                <div className="ws-name">1) Lobby</div>
                <div className="ws-muted">
                  Raum erstellen oder beitreten. Name + Farbe festlegen. Host stellt die Rundenanzahl ein und startet.
                </div>
              </div>

              <div>
                <div className="ws-name">2) Collect (Song einreichen)</div>
                <div className="ws-muted">
                  Jeder reicht genau 1 Song ein (Spotify-Link). In der App sieht man nur: <b>X/Y Songs abgegeben</b> –
                  nicht wer.
                </div>
              </div>

              <div>
                <div className="ws-name">3) Guessing (Raten)</div>
                <div className="ws-muted">
                  Der Host spielt den Song ab. Alle (außer der Owner) wählen, wem der Song gehört.
                  <br />
                  🔥 Banger darf nur in dieser Phase gesetzt/entfernt werden.
                </div>
              </div>

              <div>
                <div className="ws-name">4) Mini-Reveal (ohne Owner)</div>
                <div className="ws-muted">
                  Nach jedem Song wird nur gezeigt, wie viele richtig lagen (z. B. “3 von 7 richtig”). Punkte werden im
                  Hintergrund gebucht – ohne dass der Owner angezeigt wird.
                </div>
              </div>

              <div>
                <div className="ws-name">5) Round Reveal (am Rundenende)</div>
                <div className="ws-muted">
                  Erst nach dem letzten Song der Runde wird die komplette Zuordnung gezeigt: Song → Owner, korrekte Votes,
                  Bangers.
                </div>
              </div>

              <div>
                <div className="ws-name">6) Banger-Auswertung</div>
                <div className="ws-muted">
                  Ranking der Bangers. Bonus +5 nur bei eindeutigem Platz 1 (kein Bonus bei Gleichstand).
                </div>
              </div>
            </div>

            <div className="ws-muted" style={{ marginTop: 12 }}>
              Diese Seite ist absichtlich editierbar. Der QR-Code bleibt immer gleich, solange die URL gleich bleibt:
              <span className="ws-chip" style={{ marginLeft: 8 }}> /anleitung </span>
            </div>
          </div>

          <div className="ws-card">
            <div className="ws-card-title">Platzhalter / Updates</div>
            <div className="ws-muted">
              Hier kannst du später Bilder, Beispiele, FAQ, oder “Regel-Versionen” ergänzen (z. B. v1.0, v1.1…).
              <br />
              Wichtig: Die URL bleibt stabil, daher bleibt auch der QR-Code stabil.
            </div>
          </div>

          <div className="ws-stack" style={{ marginTop: 2 }}>
            <button className="ws-btn ws-btn--ghost" onClick={() => (window.location.href = "/")}>
              ⬅️ Zur Startseite
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
