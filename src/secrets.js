export function createRiftRoom(game, source) {
  const existing = game.rooms.find((room) => room.type === "rift");
  if (existing) return existing;
  if (!source || source.type !== "combat") return null;
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
  if (!chain.sigil) return "Сначала найдите трещину во второй боевой комнате Приёмного отдела.";
  if (!chain.npc) return "Покажите трещину Оценщику в магазине.";
  if (!chain.terminal) return "Третья боевая комната Сортировочного узла: подойдите к сервисному терминалу и нажмите E.";
  if (!chain.wardenDefeated) return "Смотритель Разреза ждёт за сервисным терминалом.";
  return "Разрез стабилен. F — сервисный проход по уже зачищенным комнатам.";
}
