"use client";

import React, { createContext, useCallback, useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import ConfirmDialog from "@/components/ConfirmDialog";

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm?: () => void;
};

type UiContextValue = {
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
  playClick: () => void;

  confirmLeaveGame: (onLeave: () => void) => void;
  closeConfirm: () => void;
};

export const UiContext = createContext<UiContextValue | null>(null);

export default function Providers({ children }: { children: React.ReactNode }) {
  const [soundOn, setSoundOn] = useState(true);

  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    title: "",
    message: "",
    confirmText: "Verlassen",
    cancelText: "Abbrechen",
  });

  const closeConfirm = useCallback(() => {
    setConfirm((c) => ({ ...c, open: false }));
  }, []);

  const confirmLeaveGame = useCallback((onLeave: () => void) => {
    setConfirm({
      open: true,
      title: "Spiel wirklich verlassen?",
      message: "Du verlässt den Raum und landest wieder auf der Startseite.",
      confirmText: "Verlassen",
      cancelText: "Abbrechen",
      onConfirm: onLeave,
    });
  }, []);

  const playClick = useCallback(async () => {
    if (!soundOn) return;
    try {
      const mod = await import("@/components/sound/sfx");
      mod.playClick();
    } catch {
      // silent
    }
  }, [soundOn]);

  const value = useMemo<UiContextValue>(
    () => ({
      soundOn,
      setSoundOn,
      playClick,
      confirmLeaveGame,
      closeConfirm,
    }),
    [soundOn, playClick, confirmLeaveGame, closeConfirm]
  );

  return (
    <UiContext.Provider value={value}>
      {/* Global TopBar auf ALLEN Seiten */}
      <TopBar />
      {children}

      {/* Globaler Confirm-Dialog */}
      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmText={confirm.confirmText}
        cancelText={confirm.cancelText}
        onCancel={closeConfirm}
        onConfirm={() => {
          closeConfirm();
          confirm.onConfirm?.();
        }}
      />
    </UiContext.Provider>
  );
}
