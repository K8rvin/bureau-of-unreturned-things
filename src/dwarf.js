export const DWARF_FILTERS = [
  "",
  "sepia(0.45)",
  "saturate(0.85) hue-rotate(18deg)",
  "saturate(0.55) brightness(0.9)",
  "saturate(0.9) hue-rotate(-18deg)",
  "saturate(0.7) hue-rotate(35deg)",
  "saturate(1.2)",
];

export const DWARF_TOOLS = ["big-gear", "fire", "unlit-bomb", "alarm-clock", "echo-ripples", "heart-battery", "keyring"];

export function dwarfVariantFor(game) {
  if (game.room().type === "boss" || game.room().type === "challenge") return Math.floor(game.encounterRandom() * 7);
  const rooms = game.rooms.filter(room => room.type === "combat");
  const index = rooms.findIndex(room => room.id === game.currentRoomId);
  const variants = [[0, 1], [2, 3], [4, 5, 6]][Math.max(0, index)] || [0, 1, 2, 3, 4, 5, 6];
  return variants[Math.floor(game.encounterRandom() * variants.length)];
}

export function updateDwarfVariant(game, enemy) {
  if (enemy.type !== "goblin") return false;
  if (enemy.variant === 3 && Math.hypot(game.player.x - enemy.x, game.player.y - enemy.y) > 120) return true;
  if (enemy.variant === 5) {
    const target = game.enemies.filter(other => other !== enemy && other.type === "goblin" && other.variant !== 5 && !other.dead)
      .sort((a, b) => Math.hypot(enemy.x - a.x, enemy.y - a.y) - Math.hypot(enemy.x - b.x, enemy.y - b.y))[0];
    enemy.protectTarget = target?.id || null;
    if (target) target.shieldedBy = enemy.id;
  }
  return false;
}
