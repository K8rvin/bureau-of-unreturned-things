export class AudioBus {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.last = new Map();
  }

  ensure() {
    if (!this.enabled) return;
    this.context ??= new (window.AudioContext || window.webkitAudioContext)();
    if (this.context.state === "suspended") this.context.resume();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this.ensure();
  }

  tone(frequency, duration, { type = "square", volume = 0.025, end = frequency, delay = 0 } = {}) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.context) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(30, frequency), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, end), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  throttle(key, interval) {
    const now = performance.now();
    if (now - (this.last.get(key) || 0) < interval) return true;
    this.last.set(key, now);
    return false;
  }

  handle(event) {
    if (!this.enabled) return;
    switch (event.type) {
      case "shot":
        if (!this.throttle("shot", 55)) this.tone(280, 0.045, { end: 180, volume: 0.012 });
        break;
      case "hit":
      case "projectileHit":
        if (!this.throttle("hit", 40)) this.tone(150, 0.055, { end: 90, volume: 0.016 });
        break;
      case "kill":
        this.tone(170, 0.12, { end: 55, type: "sawtooth", volume: 0.02 });
        break;
      case "hurt":
        this.tone(115, 0.22, { end: 48, type: "sawtooth", volume: 0.045 });
        break;
      case "explosion":
        this.tone(90, 0.32, { end: 32, type: "sawtooth", volume: 0.055 });
        break;
      case "shield":
        this.tone(480, 0.13, { end: 760, type: "sine", volume: 0.035 });
        break;
      case "pickup":
        this.tone(420, 0.12, { end: 520, type: "sine", volume: 0.03 });
        this.tone(630, 0.16, { end: 760, type: "sine", volume: 0.025, delay: 0.08 });
        break;
      case "synergy":
        this.tone(330, 0.25, { end: 660, type: "sine", volume: 0.035 });
        this.tone(495, 0.3, { end: 990, type: "sine", volume: 0.025, delay: 0.1 });
        break;
      case "wave":
        this.tone(160, 0.2, { end: 240, volume: 0.025 });
        break;
      case "boss":
        this.tone(82, 0.65, { end: 48, type: "sawtooth", volume: 0.04 });
        break;
      case "bossPhase":
        this.tone(100, 0.4, { end: 190, type: "sawtooth", volume: 0.04 });
        break;
      case "enemyShot":
        if (!this.throttle("enemyShot", 90)) this.tone(190, 0.08, { end: 130, volume: 0.012 });
        break;
      case "eat":
        this.tone(240, 0.08, { end: 120, type: "triangle", volume: 0.02 });
        break;
      case "victory":
        this.tone(330, 0.25, { end: 440, type: "sine", volume: 0.03 });
        this.tone(550, 0.35, { end: 660, type: "sine", volume: 0.03, delay: 0.18 });
        break;
    }
  }
}
