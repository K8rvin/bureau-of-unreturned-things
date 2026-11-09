import { GENERATED_SPRITES } from "./sprite-manifest.js";

const row = (x, y, w, h) => Array.from({ length: 4 }, (_, frame) => ({ x: x + frame * w, y, w, h }));

const SPRITES = {
  player: { idle: row(128, 100, 16, 28), run: row(192, 100, 16, 28), hit: [{ x: 256, y: 100, w: 16, h: 28 }] },
  lost: { idle: row(368, 40, 16, 16), run: row(432, 40, 16, 16) },
  shooter: { idle: row(368, 64, 16, 16), run: row(432, 64, 16, 16) },
  inker: { idle: row(368, 225, 16, 23) },
  hanger: { idle: row(368, 153, 16, 23), run: row(432, 153, 16, 23) },
  dust: { idle: row(432, 112, 16, 16) },
  dustSmall: { idle: row(368, 112, 16, 16) },
  moth: { idle: row(368, 304, 16, 16), run: row(432, 304, 16, 16) },
  guardian: { idle: row(16, 380, 32, 36), run: row(144, 380, 32, 36) },
  packer: { idle: row(368, 201, 16, 23), run: row(432, 201, 16, 23) },
  mimic: { idle: row(368, 321, 16, 23), run: row(432, 321, 16, 23) },
  thief: { idle: row(368, 273, 16, 23), run: row(432, 273, 16, 23) },
  sniper: { idle: row(128, 164, 16, 28), run: row(192, 164, 16, 28), hit: [{ x: 256, y: 164, w: 16, h: 28 }] },
  spawner: { idle: [{ x: 288, y: 408, w: 16, h: 24 }], run: [{ x: 288, y: 408, w: 16, h: 24 }] },
  npc: { idle: row(368, 345, 16, 23), run: row(432, 345, 16, 23) },
  boss: { idle: row(16, 428, 32, 36), run: row(144, 428, 32, 36) },
  umbrellaBoss: { idle: row(16, 332, 32, 36), run: row(144, 332, 32, 36) },
};

for (const [key, sprite] of Object.entries(GENERATED_SPRITES)) SPRITES[key] = sprite;

export class SpriteLibrary {
  constructor() {
    this.images = new Map();
    this.loaded = false;
  }

  async load() {
    const paths = new Set(["assets/units/dungeon-tileset-ii-v1.7.png"]);
    for (const sprite of Object.values(SPRITES)) if (sprite.image) paths.add(sprite.image);
    await Promise.all([...paths].map(async (path) => {
      const image = new Image();
      image.src = path;
      await image.decode();
      this.images.set(path, image);
    }));
    this.loaded = true;
  }

  draw(context, key, { x, y, time, moving = false, flip = false, scale = 1, alpha = 1, flash = false, hit = false, attacking = false, action = null, actionTime = null, aimAngle = null, filter = null }) {
    const sprite = SPRITES[key];
    if (!this.loaded || !sprite) return y;
    let state = hit && sprite.hit ? "hit" : attacking && sprite.attack ? "attack" : moving && sprite.run ? "run" : "idle";
    if (action && sprite[action]) state = action;
    if (aimAngle !== null && sprite.directional) {
      const direction = Math.abs(Math.cos(aimAngle)) > 0.5 ? "Side" : Math.sin(aimAngle) > 0 ? "Down" : "Up";
      if (sprite[state + direction]) state += direction;
    }
    const frames = sprite[state] || sprite.idle;
    const rate = sprite.rates?.[state] || (state === "run" ? 10 : state === "hit" ? 1 : 6);
    const animationTime = actionTime ?? time;
    const index = sprite.once?.includes(state) ? Math.min(frames.length - 1, Math.floor(animationTime * rate)) : Math.floor(animationTime * rate) % frames.length;
    const frame = frames[index];
    const image = this.images.get(sprite.image || "assets/units/dungeon-tileset-ii-v1.7.png");
    if (!image) return y;
    const factor = (sprite.targetHeight ? sprite.targetHeight / (sprite.referenceHeight || frame.h) : 1) * scale;
    const bob = moving && !sprite.run && state === "idle" ? Math.round(Math.sin(time * 10) * 1.2) : 0;
    const offsetX = (sprite.offsetX || 0) * scale;
    const offsetY = (sprite.offsetY || 0) * scale;

    context.save();
    context.translate(Math.round(x), Math.round(y));
    context.scale(flip ? -factor : factor, factor);
    context.globalAlpha = alpha;
    if (flash) context.filter = "brightness(0) invert(1)";
    else if (filter) context.filter = filter;
    context.drawImage(image, frame.x, frame.y, frame.w, frame.h, -(frame.ax ?? frame.w / 2) + offsetX, -(frame.ay ?? frame.h) + bob + offsetY, frame.w, frame.h);
    context.restore();
    return y - (frame.ay ?? frame.h) * factor;
  }

  height(key) {
    const sprite = SPRITES[key];
    return sprite?.targetHeight || sprite?.idle[0].h || 16;
  }

  hasAnimation(key, state) {
    return Boolean(SPRITES[key]?.[state]);
  }

  createPortrait(key) {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 72;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    this.draw(context, key, { x: 48, y: 68, time: 0, scale: 2, aimAngle: Math.PI / 2 });
    return canvas;
  }
}
