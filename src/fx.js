import { ENEMY_TYPES } from "./content.js";
import { clearFrame, composite, createFrame, createFx } from "../vendor/pixelfx/core/index.js";
import * as hitSpark from "../vendor/pixelfx/fx/impacts/hit-spark.js";
import * as hitFlash from "../vendor/pixelfx/fx/impacts/hit-flash.js";
import * as shieldBlock from "../vendor/pixelfx/fx/impacts/shield-block.js";
import * as groundSlam from "../vendor/pixelfx/fx/impacts/ground-slam.js";
import * as smallExplosion from "../vendor/pixelfx/fx/explosions/small-explosion.js";
import * as collectBurst from "../vendor/pixelfx/fx/pickups/collect-burst.js";
import * as lootBeam from "../vendor/pixelfx/fx/pickups/loot-beam.js";
import * as chestOpen from "../vendor/pixelfx/fx/pickups/chest-open.js";
import * as poof from "../vendor/pixelfx/fx/spawn/poof.js";
import * as disintegrate from "../vendor/pixelfx/fx/spawn/disintegrate.js";
import * as toxicPuddle from "../vendor/pixelfx/fx/nature/toxic-puddle.js";
import * as fireflies from "../vendor/pixelfx/fx/weather/fireflies.js";
import * as heartLost from "../vendor/pixelfx/fx/ui/heart-lost.js";
import * as pixelDissolve from "../vendor/pixelfx/fx/transitions/pixel-dissolve.js";
import * as runeCircle from "../vendor/pixelfx/fx/arcane/rune-circle.js";

const MODULES = {
  hitSpark, hitFlash, shieldBlock, groundSlam, smallExplosion,
  collectBurst, lootBeam, chestOpen, poof, disintegrate,
  toxicPuddle, fireflies, heartLost, pixelDissolve, runeCircle,
};

const INK_PALETTE = ["#080913", "#151225", "#28203d", "#40305b", "#5d4780", "#806aa2", "#b7a4d2", "#eee4ff"];

export class FxManager {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.frame = createFrame(width, height);
    this.image = new ImageData(width, height);
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.context = this.canvas.getContext("2d");
    this.effects = [];
    this.seed = 100;
    this.reduced = false;
    this.shake = 0;
    this.shakeTime = 0;
    this.ambient = this.spawn("fireflies", 240, 253, { ttl: Infinity, ambient: true });
  }

  spawn(name, x, y, options = {}) {
    if (!MODULES[name]) return null;
    if (this.reduced && !options.essential && !options.ambient) return null;
    if (!options.ambient && this.effects.length > (this.reduced ? 14 : 32)) return null;
    const fx = createFx(MODULES[name], { x, y, seed: this.seed++, light: 0.8, ...options });
    const record = { fx, ttl: options.ttl ?? null, ambient: Boolean(options.ambient), name };
    this.effects.push(record);
    return record;
  }

  clearTransient() {
    this.effects = this.effects.filter((effect) => effect.ambient);
    this.shake = 0;
  }

  setReduced(reduced) {
    this.reduced = reduced;
    if (reduced) this.effects = this.effects.filter((effect) => effect.ambient || effect.name === "smallExplosion" || effect.name === "shieldBlock");
  }

  update(dt) {
    this.shakeTime += dt;
    this.shake = Math.max(0, this.shake - dt * 14);
    for (const effect of this.effects) {
      if (effect.ambient && this.reduced) continue;
      effect.fx.update(dt);
      if (effect.ttl !== null && effect.ttl !== Infinity) {
        effect.ttl -= dt;
        if (effect.ttl <= 0) effect.fx.stop();
      }
    }
    this.effects = this.effects.filter((effect) => !effect.fx.done());
  }

  drawLayer(context, layer, ambient = false) {
    const paint = (predicate, forcedLayer = layer) => {
      clearFrame(this.frame);
      let any = false;
      for (const effect of this.effects) {
        if (!predicate(effect)) continue;
        effect.fx.draw(this.frame, forcedLayer);
        any = true;
      }
      if (any) {
        composite(this.frame, this.image.data, null, 0.8);
        this.context.putImageData(this.image, 0, 0);
      }
      return any;
    };

    const normal = paint((effect) => effect.ambient === ambient && effect.name !== "pixelDissolve" && !(ambient && this.reduced));
    if (normal) {
      context.save();
      if (ambient) context.globalAlpha = 0.16;
      context.drawImage(this.canvas, 0, 0);
      context.restore();
    }

    if (!ambient && layer === "back" && paint((effect) => effect.name === "pixelDissolve", "front")) {
      context.save();
      context.globalAlpha = 0.22;
      context.drawImage(this.canvas, 0, 0, 320, 180, 0, 0, this.width, this.height);
      context.restore();
    }
  }

  shakeOffset() {
    if (this.reduced || this.shake <= 0) return [0, 0];
    return [Math.round(Math.sin(this.shakeTime * 91) * this.shake), Math.round(Math.cos(this.shakeTime * 73) * this.shake)];
  }

  handle(event) {
    const enemy = event.enemy;
    switch (event.type) {
      case "projectileHit":
        this.spawn("hitSpark", event.x, event.y, { height: 3 });
        break;
      case "bounce":
        this.spawn("hitFlash", event.x, event.y, { essential: true });
        break;
      case "spawn":
        if (!ENEMY_TYPES[enemy?.type]?.boss) this.spawn("poof", enemy.x, enemy.y);
        break;
      case "kill":
        this.spawn(ENEMY_TYPES[enemy?.type]?.boss ? "disintegrate" : "poof", enemy.x, enemy.y);
        break;
      case "pickup":
        this.spawn("collectBurst", event.x, event.y);
        this.spawn("lootBeam", event.x, event.y + 4, { ttl: 1.1 });
        break;
      case "choice":
        this.spawn("runeCircle", 240, 224, { ttl: 3 });
        this.spawn("chestOpen", 240, 195);
        break;
      case "hurt":
        this.spawn("heartLost", event.x, event.y - 4, { essential: true });
        this.shake = Math.max(this.shake, 2);
        break;
      case "explosion":
        this.spawn("smallExplosion", event.x, event.y, { essential: true });
        this.shake = Math.max(this.shake, 3);
        break;
      case "shield":
      case "rubber":
        this.spawn("shieldBlock", event.x, event.y, { essential: true });
        break;
      case "slam":
        this.spawn("groundSlam", event.x, event.y, { essential: true });
        this.shake = Math.max(this.shake, 3.5);
        break;
      case "puddle":
        this.spawn("toxicPuddle", event.x, event.y + 2, { ttl: 2, width: event.friendly ? 12 : 14, palette: INK_PALETTE, light: 0.35 });
        break;
      case "wave":
        this.spawn("pixelDissolve", 0, 0, { color: "#11131a" });
        break;
      case "bossPhase":
        this.spawn("runeCircle", enemy.x, enemy.y + 12, { ttl: 1.6, essential: true });
        this.shake = Math.max(this.shake, 2);
        break;
      case "synergy":
        this.spawn("runeCircle", event.x ?? 240, event.y ?? 220, { ttl: 2, essential: true });
        this.spawn("lootBeam", event.x ?? 240, (event.y ?? 220) + 5, { ttl: 1.5, essential: true });
        break;
      case "victory":
        this.spawn("lootBeam", 240, 215, { ttl: 3, essential: true });
        this.spawn("pixelDissolve", 0, 0, { color: "#11131a", essential: true });
        break;
      case "dead":
        this.spawn("heartLost", 240, 130, { essential: true });
        break;
    }
  }
}
