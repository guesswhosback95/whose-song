let clickAudio: HTMLAudioElement | null = null;

function getClickAudio() {
  if (typeof window === "undefined") return null;
  if (!clickAudio) {
    clickAudio = new Audio("/sfx/click.mp3");
    clickAudio.volume = 0.35;
  }
  return clickAudio;
}

export function playClick() {
  const a = getClickAudio();
  if (!a) return;
  try {
    a.currentTime = 0;
    void a.play();
  } catch {
    // ignore
  }
}
