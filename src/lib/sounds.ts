/**
 * Audio playback helpers for scanner feedback.
 * Uses Web Audio API for instant, reliable playback.
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/** Called from a user gesture so asynchronous scan confirmation can play audio. */
export function prepareAudio(): void {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  } catch { /* Sound is optional on devices without Web Audio. */ }
}

/** Original short 8-bit victory fanfare; no game recording or melody is bundled. */
export function playVictory(): void {
  try {
    const ctx = getAudioContext();
    const schedule = () => {
      const notes = [[74, 0.12], [78, 0.12], [81, 0.22], [79, 0.12], [83, 0.12], [86, 0.18], [85, 0.12], [86, 0.45]];
      let start = ctx.currentTime + 0.02;
      for (const [midi, duration] of notes) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), start);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.10, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
        start += duration + 0.025;
      }
    };
    if (ctx.state === "suspended") void ctx.resume().then(schedule).catch(() => {});
    else schedule();
  } catch { /* Finishing a batch must not depend on audio support. */ }
}

/**
 * Plays a success tone — short pleasant ascending beep.
 */
export function playSuccess(): void {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.setValueAtTime(800, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.2);
  } catch {
    // Fallback: try HTML Audio
    const audio = new Audio("/sounds/success.mp3");
    audio.play().catch(() => {});
  }
}

/**
 * Plays an error tone — descending buzzer.
 */
export function playError(): void {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(400, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
    
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch {
    const audio = new Audio("/sounds/error.mp3");
    audio.play().catch(() => {});
  }
}
