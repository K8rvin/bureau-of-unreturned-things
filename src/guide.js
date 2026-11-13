const STORAGE_KEY = "library.guide.v1";
const DURATION = 6;
const HINTS = {
  controls: "WASD — движение, мышь — прицел, ЛКМ — свет страницы.",
  telegraph: "Следите за контуром атаки. Дополнительные траектории можно включить в настройках.",
  map: "Tab — карта, M — скрыть миникарту. Можно вернуться за пропущенным.",
  items: "Esc — пауза: точные свойства полученных вещей и характеристики сборки.",
};

export class FirstBookGuide {
  constructor({ storage } = {}) {
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage;
      } catch {
        storage = null;
      }
    }
    this.storage = storage;
    this.seen = new Set();
    this.pending = null;
    this.active = null;
    try {
      const stored = JSON.parse(storage?.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) this.seen = new Set(stored.filter((id) => Object.hasOwn(HINTS, id)));
    } catch {
      this.seen = new Set();
    }
  }

  reset() {
    this.pending = null;
    this.active = null;
  }

  trigger(id, game) {
    if (this.active && game.time - this.active.shownAt >= DURATION) this.active = null;
    if (!Object.hasOwn(HINTS, id) || this.seen.has(id) || this.pending || this.active) return false;
    if (game.mode !== "run" || game.floorIndex !== 0) return false;
    this.pending = { id, text: HINTS[id] };
    return true;
  }

  handle(event, game) {
    const id = event.type === "room" && event.room.type === "start" ? "controls"
      : event.type === "telegraph" ? "telegraph"
        : event.type === "roomClear" ? "map"
          : event.type === "choice" ? "items" : null;
    if (id) this.trigger(id, game);
  }

  current(game, blocked) {
    if (game.mode !== "run" || game.floorIndex !== 0 || game.state === "title") return null;
    if (blocked) return null;
    if (!this.active && this.pending) {
      this.active = { ...this.pending, shownAt: game.time };
      this.pending = null;
      this.seen.add(this.active.id);
      try {
        this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.seen]));
      } catch {
        return this.active.text;
      }
    }
    if (this.active && game.time - this.active.shownAt >= DURATION) this.active = null;
    return this.active?.text || null;
  }
}
