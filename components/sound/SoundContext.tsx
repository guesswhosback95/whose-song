"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type SoundState = {
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
  toggleSound: () => void;
  click: () => void; // kurzer UI-Tap sound
};

const Ctx = createContext<SoundState | null>(null);

function safeGetLS(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSetLS(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {}
}

function playClick() {
  // super kurzer “tap” (WebAudio) — dezent, nicht nervig
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AudioCtx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 520;
    g.gain.value = 0.02;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 45);
  } catch {
    // ignore
  }
}

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    const v = safeGetLS("ws_sound_on");
    if (v === "0") setSoundOn(false);
  }, []);

  useEffect(() => {
    safeSetLS("ws_sound_on", soundOn ? "1" : "0");
  }, [soundOn]);

  const value = useMemo<SoundState>(
    () => ({
      soundOn,
      setSoundOn,
      toggleSound: () => setSoundOn((s) => !s),
      click: () => {
        if (!soundOn) return;
        playClick();
      },
    }),
    [soundOn]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSound() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSound must be used inside SoundProvider");
  return ctx;
}
