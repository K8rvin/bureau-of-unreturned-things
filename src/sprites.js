import { GENERATED_SPRITES } from "./sprite-manifest.js";
import { FLOOR_DEFINITIONS } from "./content.js";

const SPRITES = { ...GENERATED_SPRITES };
if (SPRITES.dust) SPRITES.dustSmall = { ...SPRITES.dust, targetHeight: 32 };

export class SpriteLibrary {
  constructor() {
    this.images = new Map();
    this.loaded = false;
  }

  async load() {
    const roomPaths = new Set(FLOOR_DEFINITIONS.map((floor) => floor.image).filter(Boolean));
    const paths = new Set(roomPaths);
    for (const sprite of Object.values(SPRITES)) if (sprite.image) paths.add(sprite.image);
    await Promise.all([...paths].map(async (path) => {
      try {
        if (roomPaths.has(path)) {
          const response = await fetch(path, { method: "HEAD" });
          if (!response.ok) {
            console.warn(`Room background is not ready: ${path}`);
            return;
          }
        }
        const image = new Image();
        image.src = path;
        await image.decode();
        this.images.set(path, image);
      } catch (error) {
        if (!roomPaths.has(path)) throw error;
        console.warn(`Room background is not ready: ${path}`);
      }
    }));
    this.loaded = true;
  }

  roomImage(floorIndex) {
    return this.images.get(FLOOR_DEFINITIONS[floorIndex]?.image);
  }

  has(key) {
    return Boolean(SPRITES[key]);
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
    const image = this.images.get(sprite.image);
    if (!image) return y;
    const factor = (sprite.targetHeight ? sprite.targetHeight / (sprite.referenceHeight || frame.h) : 1) * scale;
    const bob = sprite.proceduralMotion
      ? Math.round(Math.sin(time * (moving ? 12 : 4)) * (moving ? 1.2 : 0.6))
      : moving && !sprite.run && state === "idle" ? Math.round(Math.sin(time * 10) * 1.2) : 0;
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
    this.draw(context, key, { x: 48, y: 68, time: 0, scale: SPRITES[key]?.portraitScale || 64 / this.height(key), aimAngle: Math.PI / 2 });
    return canvas;
  }
}
