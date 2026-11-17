/**
 * Web Audio API Ringtone Synthesizer
 * Generates telephone call tones using pure Web Audio oscillators without requiring external audio files.
 * Gracefully handles browser autoplay restrictions.
 */

class RingtoneManager {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = false;

  public play() {
    if (this.playing) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.playing = true;

      const cycle = () => {
        if (!this.ctx || this.ctx.state === "closed") return;
        if (this.ctx.state === "suspended") {
          void this.ctx.resume();
        }

        const now = this.ctx.currentTime;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Standard North American/European dual ring tone (440Hz + 480Hz)
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(440, now);
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(480, now);

        // Gentle volume curve
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.05);
        gain.gain.setValueAtTime(0.12, now + 1.2);
        gain.gain.linearRampToValueAtTime(0.001, now + 1.3);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.3);
        osc2.stop(now + 1.3);
      };

      cycle();
      this.timer = setInterval(cycle, 2800);
    } catch {
      // Autoplay blocked by browser policy prior to user interaction
    }
  }

  public stop() {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx && this.ctx.state !== "closed") {
      try {
        void this.ctx.close();
      } catch {}
      this.ctx = null;
    }
  }
}

let singleton: RingtoneManager | null = null;

export function playIncomingRingtone() {
  if (typeof window === "undefined") return;
  if (!singleton) singleton = new RingtoneManager();
  singleton.play();
}

export function stopIncomingRingtone() {
  if (singleton) {
    singleton.stop();
  }
}

