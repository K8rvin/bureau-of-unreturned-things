export function createRiftRoom(game, source) {
  const existing = game.rooms.find((room) => room.type === "rift");
  if (existing) return existing;
  if (!source || !["combat", "secret"].includes(source.type)) return null;
  const room = {
    id: "rRift",
    x: source.x + 0.45,
    y: source.y - 0.35,
    type: "rift",
    returnTo: source.id,
    doors: {},
    hidden: [],
    visited: false,
    cleared: false,
    rewardClaimed: false,
    secretFound: true,
    loreFound: true,
    stock: null,
    event: "rift",
    encounterSeed: (source.encounterSeed ^ 0x51f0a11) >>> 0,
  };
  game.rooms.push(room);
  game.floor.riftId = room.id;
  return room;
}

export function riftDestinations(game) {
  return game.rooms.filter((room) => room.visited && room.cleared && room.id !== game.currentRoomId);
}

export function getChainHint(chain) {
  const hints = {
    redHood: "Красная лента повторяет форму тропы. Обрывок страницы показывает скрытый поворот.",
    bremen: "Четыре голоса звучат по очереди. Тихая нота между ними указывает на лишнюю комнату.",
    hansel: "Не всякая хлебная крошка ведёт к дому ведьмы. Прочитайте обрывок и проверьте карту.",
    cinderella: "После полуночи направление танца меняется. Часы подсказывают, где искать страницу.",
    snowWhite: "Отражение показывает неправильную дверь. Сравните её с картой и посмотрите в зеркало.",
    rumple: "Имя собирается по частям в комнатах книги и у гонцов. Внешняя энциклопедия не нужна.",
  };
  return hints[chain.bookId] || "Найдите обрывок во второй боевой комнате книги. Он укажет скрытую страницу.";
}
