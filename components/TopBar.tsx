"use client";

import { useContext, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { UiContext } from "@/app/providers";

function isRoomPath(pathname: string | null) {
  if (!pathname) return false;
  return pathname.startsWith("/room/");
}

export default function TopBar() {
  const ui = useContext(UiContext);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const inRoom = useMemo(() => isRoomPath(pathname), [pathname]);
  const canBack = useMemo(() => pathname !== "/" && !!pathname, [pathname]);
  const soundOn = ui?.soundOn ?? true;

  function back() {
    if (inRoom) {
      ui?.confirmLeaveGame(() => (window.location.href = "/"));
      return;
    }
    window.history.length > 1 ? window.history.back() : (window.location.href = "/");
  }

  return (
    <div className="ws-topbar">
      <div className="ws-topbar-inner">
        <div className="ws-topbar-left">
          {canBack ? (
            <button className="ws-icon-btn ws-btn--press" onClick={back} aria-label="Zurück">
              ←
            </button>
          ) : (
            <div style={{ width: 42 }} />
          )}
          <div className="ws-topbar-title">Whose Song?</div>
        </div>

        <div className="ws-topbar-right">
          <button
            className="ws-icon-btn ws-btn--press"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menü"
          >
            ☰
          </button>

          {menuOpen && (
            <div className="ws-menu">
              <div className="ws-menu-item">
                <span className="ws-menu-label">Töne</span>
                <button
                  className={`ws-toggle ${soundOn ? "is-on" : ""}`}
                  onClick={() => ui?.setSoundOn(!soundOn)}
                >
                  <span className="ws-toggle-dot" />
                </button>
              </div>

              {inRoom && (
                <button
                  className="ws-menu-btn ws-btn--press"
                  onClick={() =>
                    ui?.confirmLeaveGame(() => (window.location.href = "/"))
                  }
                >
                  Spiel verlassen
                </button>
              )}

              <button
                className="ws-menu-btn ws-menu-close ws-btn--press"
                onClick={() => setMenuOpen(false)}
              >
                Schließen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
