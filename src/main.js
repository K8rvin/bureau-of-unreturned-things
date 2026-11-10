import { AudioBus } from "./audio.js";
import { Catalog } from "./catalog.js";
import { ENEMY_TYPES, FLOOR_DEFINITIONS, HEIGHT, ITEM_BY_ID, ITEMS, SYNERGIES, WIDTH } from "./content.js";
import { FxManager } from "./fx.js";
import { Game } from "./game.js";
import { DEFAULT_HERO, getHero, HEROES } from "./heroes.js";
import { Renderer } from "./render.js";
import { getChainHint } from "./secrets.js";
import { CHALLENGES, getChallenge, ITEM_UNLOCKS, Progression } from "./progression.js";
import { SpriteLibrary } from "./sprites.js";
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from "./storage.js";

const $ = (id) => document.getElementById(id);
const canvas = $("gameCanvas");
const fx = new FxManager(WIDTH, HEIGHT);
const audio = new AudioBus();
const sprites = new SpriteLibrary();
await sprites.load();
await document.fonts.load('8px "Archive Pixel"');
const renderer = new Renderer(canvas, fx, sprites);
const catalog = new Catalog();
const progression = new Progression();
const game = new Game(handleEvent, { itemUnlocked: (id) => progression.isUnlocked(id) });
const panels = {
  title: $("titlePanel"),
  choice: $("choicePanel"),
  shop: $("shopPanel"),
  contract: $("contractPanel"),
  rift: $("riftPanel"),
  training: $("trainingPanel"),
  challenge: $("challengePanel"),
  workshop: $("workshopPanel"),
  vault: $("vaultPanel"),
  floor: $("floorPanel"),
  catalog: $("catalogPanel"),
  pause: $("pausePanel"),
  end: $("endPanel"),
};
let activePanel = null;
const params = new URLSearchParams(location.search);
let currentSeed = Number(params.get("seed")) >>> 0 || 1;
let paused = false;
let lastTime = performance.now();
let accumulator = 0;
let bombPressed = false;
let interactPressed = false;
let toastTimer = 0;
let hudSignature = "";
const keys = new Set();
const pointer = { x: WIDTH / 2, y: HEIGHT / 2, down: false };
const STEP = 1 / 60;

function readSetting(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    return;
  }
}

audio.setEnabled(readSetting("bureau.audio", true));
fx.setReduced(readSetting("bureau.reducedFx", false));
renderer.showTelegraphs = readSetting("bureau.telegraphs", false);

function updateSettingLabels() {
  $("audioButton").textContent = `Звук: ${audio.enabled ? "вкл" : "выкл"}`;
  $("fxButton").textContent = `FX: ${fx.reduced ? "низкие" : "полные"}`;
  $("telegraphButton").textContent = `Траектории: ${renderer.showTelegraphs ? "вкл" : "выкл"}`;
}

function showPanel(name) {
  activePanel = name;
  if (name === "pause") buildPauseDetails();
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
  $("overlay").hidden = !name;
  $("gameShell").classList.toggle("has-panel", Boolean(name));
}

function syncPanel() {
  if (game.state === "choice") showPanel("choice");
  else if (game.state === "shop") showPanel("shop");
  else if (game.state === "contract") showPanel("contract");
  else if (game.state === "riftMenu") showPanel("rift");
  else if (game.state === "workshop") showPanel("workshop");
  else if (game.state === "vault") showPanel("vault");
  else if (game.state === "floorComplete") showPanel("floor");
  else if (game.state === "victory") showEnd(true, game.stats());
  else if (game.state === "dead") showEnd(false, game.stats());
  else if (game.state === "title") showPanel("title");
  else showPanel(null);
  updateHud(true);
}

function toast(text, duration = 1600) {
  clearTimeout(toastTimer);
  $("toast").textContent = text;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, duration);
}

function newSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

let runUnlocks = [];

function prepareRun() {
  audio.ensure();
  paused = false;
  accumulator = 0;
  bombPressed = false;
  interactPressed = false;
  pointer.down = false;
  runUnlocks = [];
  fx.clearTransient();
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("seed", String(currentSeed));
  url.searchParams.set("hero", selectedHeroId);
  if (game.challengeId) url.searchParams.set("challenge", game.challengeId);
  else url.searchParams.delete("challenge");
  history.replaceState(null, "", url);
}

let selectedHeroId = (() => {
  try {
    return getHero(params.get("hero") || localStorage.getItem("bureau.hero") || DEFAULT_HERO).id;
  } catch {
    return getHero(params.get("hero")).id;
  }
})();

function buildBossTraining() {
  const root = $("bossTraining");
  root.replaceChildren();
  for (const floor of FLOOR_DEFINITIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quiet";
    button.dataset.floorIndex = String(floor.index);
    button.textContent = `Тренировка: ${ENEMY_TYPES[floor.bossType].name}`;
    button.title = `${floor.name}. ${floor.description}`;
    button.addEventListener("click", () => startRun(currentSeed, { bossOnly: true, floorIndex: floor.index }));
    root.append(button);
  }
}

function buildChallengeCards() {
  const root = $("challengeCards");
  root.replaceChildren();
  for (const challenge of CHALLENGES) {
    const reward = ITEM_BY_ID.get(challenge.reward);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-choice challenge-card";
    button.dataset.challenge = challenge.id;
    const title = document.createElement("strong");
    title.textContent = challenge.name;
    const description = document.createElement("p");
    description.textContent = challenge.description;
    const note = document.createElement("small");
    const status = progression.challengeWins(challenge.id) ? `Выполнено: ${progression.challengeWins(challenge.id)}` : progression.isUnlocked(reward.id) ? "Награда уже открыта" : `Награда: ${reward.name}`;
    note.textContent = `${status}. Герой: ${getHero(selectedHeroId).name}`;
    button.append(title, description, note);
    button.addEventListener("click", () => startRun(currentSeed, { challengeId: challenge.id }));
    root.append(button);
  }
}

function notifyUnlocks(ids) {
  const fresh = ids.filter((id) => !runUnlocks.includes(id));
  if (!fresh.length) return;
  runUnlocks.push(...fresh);
  const names = fresh.map((id) => ITEM_BY_ID.get(id)?.name || id).join(", ");
  toast(`Новая вещь открыта: ${names}`, 2800);
}

function buildHeroChoices() {
  const root = $("heroChoices");
  root.replaceChildren();
  for (const hero of HEROES) {
    const item = ITEM_BY_ID.get(hero.itemId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hero-card";
    button.dataset.hero = hero.id;
    button.setAttribute("role", "radio");
    const trait = hero.trait ? ` Особенность: ${hero.trait}.` : "";
    button.setAttribute("aria-label", `${hero.name}: ${hero.hp} здоровья, ${item ? item.name : "без стартовой вещи"}.${trait}`);
    button.title = `${item ? `${item.name}. ${item.description}` : "Без стартовой находки. Чистая сборка с самого начала."}${trait}`;
    const portrait = sprites.createPortrait(hero.sprite);
    portrait.setAttribute("role", "img");
    portrait.setAttribute("aria-label", hero.name);
    const name = document.createElement("strong");
    name.textContent = hero.name;
    const health = document.createElement("small");
    health.className = "hero-health";
    health.textContent = `${hero.hp} здоровья`;
    const starter = document.createElement("small");
    starter.textContent = item ? item.name : "Без стартовой вещи";
    button.append(portrait, name, health, starter);
    button.addEventListener("click", () => selectHero(hero.id));
    root.append(button);
  }
  root.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.code)) return;
    event.preventDefault();
    const current = HEROES.findIndex((hero) => hero.id === selectedHeroId);
    const index = event.code === "Home" ? 0 : event.code === "End" ? HEROES.length - 1 : (current + (event.code === "ArrowRight" ? 1 : -1) + HEROES.length) % HEROES.length;
    selectHero(HEROES[index].id);
    root.querySelector(`[data-hero="${selectedHeroId}"]`)?.focus();
  });
  updateHeroSelection();
}

function updateHeroSelection() {
  const hero = getHero(selectedHeroId);
  for (const button of $("heroChoices").querySelectorAll("button")) {
    const selected = button.dataset.hero === hero.id;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  $("startButton").textContent = `Играть: ${hero.name}`;
}

function selectHero(id) {
  selectedHeroId = getHero(id).id;
  try {
    localStorage.setItem("bureau.hero", selectedHeroId);
  } catch {
  }
  updateHeroSelection();
}

function startRun(seed = currentSeed, { bossOnly = false, floorIndex = 0, heroId = selectedHeroId, challengeId = null } = {}) {
  currentSeed = seed >>> 0 || 1;
  clearCheckpoint();
  prepareRun();
  game.start(currentSeed, { bossOnly, floorIndex, heroId, challengeId });
  updateUrl();
  syncPanel();
  canvas.focus();
}

function currentRunOptions() {
  return game.mode === "boss"
    ? { bossOnly: true, floorIndex: game.floorIndex, heroId: game.heroId }
    : { heroId: game.heroId, challengeId: game.challengeId };
}

function continueRun() {
  const snapshot = loadCheckpoint();
  if (!snapshot) {
    toast("Сохранённый забег не найден");
    return;
  }
  currentSeed = snapshot.seed;
  prepareRun();
  game.restore(snapshot);
  selectHero(game.heroId);
  updateUrl();
  syncPanel();
  canvas.focus();
}

function showTitle() {
  paused = false;
  pointer.down = false;
  game.reset(currentSeed);
  fx.clearTransient();
  $("bossHud").hidden = true;
  $("continueButton").hidden = !loadCheckpoint();
  showPanel("title");
  updateHud(true);
}

function selectItem(id) {
  if (Date.now() < game.choiceReadyAt) return;
  if (!game.chooseItem(id)) return;
  syncPanel();
  canvas.focus();
}

function buildChoices(choices) {
  const container = $("choiceCards");
  container.replaceChildren();
  choices.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item-card";
    button.dataset.item = item.id;
    button.disabled = true;
    const number = document.createElement("span");
    number.className = "number";
    number.textContent = `0${index + 1}`;
    const image = document.createElement("img");
    image.src = `assets/icons/${item.icon}`;
    image.alt = "";
    const title = document.createElement("strong");
    title.textContent = item.name;
    const description = document.createElement("span");
    description.textContent = item.description;
    button.append(number, image, title, description);
    if (item.partner && game.hasItem(item.partner)) {
      const partner = document.createElement("span");
      partner.className = "partner";
      partner.textContent = `Есть связь с «${ITEM_BY_ID.get(item.partner).name}»`;
      button.append(partner);
    }
    button.addEventListener("click", () => selectItem(item.id));
    container.append(button);
  });
  updateChoiceTimer();
}

function updateChoiceTimer() {
  if (game.state !== "choice") return;
  const remaining = Math.max(0, game.choiceReadyAt - Date.now());
  const locked = remaining > 0;
  for (const button of $("choiceCards").querySelectorAll("button")) button.disabled = locked;
  const hint = $("choiceHint");
  hint.classList.toggle("countdown", locked);
  const availableKeys = game.choices.map((_, index) => index + 1).join(", ");
  const text = locked ? `Переведите дух: ${Math.ceil(remaining / 1000)}…` : `Теперь можно выбрать · ${game.choices.length === 1 ? "клавиша" : "клавиши"} ${availableKeys}`;
  if (hint.textContent !== text) hint.textContent = text;
}

function buildShop() {
  const root = $("shopStock");
  root.replaceChildren();
  for (const offer of game.room().stock || []) {
    const item = offer.type === "item" ? ITEM_BY_ID.get(offer.itemId) : null;
    const card = document.createElement("article");
    card.className = "shop-item";
    const image = document.createElement("img");
    image.src = `assets/icons/${item?.icon || "echo-ripples.svg"}`;
    image.alt = "";
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item?.name || "Сломанная игрушка";
    const description = document.createElement("p");
    description.textContent = item?.description || "Оценщик не знает её истории. Сохраните до следующего отдела.";
    body.append(title, description);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = offer.sold ? "Продано" : `${offer.price} жет.`;
    button.disabled = offer.sold || game.player.coins < offer.price || (item && game.hasItem(item.id));
    button.addEventListener("click", () => {
      if (game.buyItem(offer.id)) buildShop();
    });
    card.append(image, body, button);
    root.append(card);
  }
  $("repairButton").hidden = !game.canRepairToy();
  $("shopHint").textContent = getChainHint(game.chain);
}

function buildContract() {
  const root = $("contractChoices");
  root.replaceChildren();
  const eliteTarget = game.contractTarget();
  const choices = [
    { kind: "hp", name: "Оставить печать", description: "Потерять 1 максимум здоровья. Сразу получить выбор одной из трёх вещей.", note: game.player.maxHp > 3 ? `Останется ${game.player.maxHp - 1} здоровья` : "Нужно больше 3 максимума здоровья" },
    { kind: "elite", name: "Сверхурочная калибровка", description: "В следующей незачищенной боевой комнате появятся два элитных противника. За зачистку — выбор вещи.", note: eliteTarget ? "Элиты: +35% здоровья, +10% скорости" : "Все боевые комнаты уже зачищены" },
  ];
  for (const choice of choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-choice";
    button.dataset.contract = choice.kind;
    button.disabled = (choice.kind === "hp" && game.player.maxHp <= 3) || (choice.kind === "elite" && !eliteTarget);
    const title = document.createElement("strong");
    title.textContent = choice.name;
    const description = document.createElement("p");
    description.textContent = choice.description;
    const note = document.createElement("small");
    note.textContent = choice.note;
    button.append(title, description, note);
    button.addEventListener("click", () => {
      if (game.chooseContract(choice.kind)) {
        syncPanel();
        canvas.focus();
      }
    });
    root.append(button);
  }
}

function fillEventChoice(button, title, description) {
  button.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = title;
  const note = document.createElement("small");
  note.textContent = description;
  button.append(strong, note);
}

function buildWorkshop() {
  const room = game.room();
  const pending = room.workshopPending;
  const root = $("workshopChoices");
  root.replaceChildren();
  $("workshopDescription").textContent = pending
    ? `Отдать «${ITEM_BY_ID.get(pending.sacrificeId).name}». Выберите одну замену или оставьте всё как есть.`
    : "Выберите одну обычную вещь для замены. Предложение сохранится даже после отмены.";
  const ids = pending ? pending.choices : game.items.filter((id) => ITEM_BY_ID.get(id)?.pool !== false);
  for (const id of ids) {
    const item = ITEM_BY_ID.get(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-choice";
    button.dataset.item = id;
    const image = document.createElement("img");
    image.src = `assets/icons/${item.icon}`;
    image.alt = "";
    const title = document.createElement("strong");
    title.textContent = item.name;
    const description = document.createElement("p");
    description.textContent = item.description;
    button.append(image, title, description);
    button.addEventListener("click", () => {
      const changed = pending ? game.confirmWorkshop(id) : game.selectWorkshopItem(id);
      if (changed) {
        syncPanel();
        canvas.focus();
      }
    });
    root.append(button);
  }
  if (!ids.length) {
    const text = document.createElement("p");
    text.className = "hint";
    text.textContent = "Пока нет обычных вещей, которые можно отдать на замену.";
    root.append(text);
  }
}

function buildVault() {
  $("vaultDescription").textContent = `Ключей: ${game.player.keys}. Награда одна независимо от способа. Можно уйти без потерь.`;
  fillEventChoice($("vaultKeyButton"), "Отдать 1 ключ", "Открыть награду без боя");
  fillEventChoice($("vaultFightButton"), "Вызвать охрану", "Два элитных противника и сопровождение. Награда без ключа");
  $("vaultKeyButton").disabled = game.player.keys <= 0;
}

function buildRiftMenu(rooms) {
  const names = { start: "Лифт", combat: "Боевая комната", treasure: "Сокровищница", shop: "Магазин Оценщика", challenge: "Сверхурочные", workshop: "Мастерская", vault: "Хранилище", secret: "Скрытая комната", boss: "Зала босса", rift: "Сервисный разрез" };
  const root = $("riftChoices");
  root.replaceChildren();
  for (const room of rooms) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-choice";
    button.dataset.room = room.id;
    const title = document.createElement("strong");
    title.textContent = room.event === "movingShelves" ? "Движущиеся полки" : names[room.type] || "Комната";
    const description = document.createElement("p");
    description.textContent = room.type === "rift" ? "Вернуться к уже стабилизированному разрезу." : "Бой не начнётся заново. Вы окажетесь у входа в комнату.";
    button.append(title, description);
    button.addEventListener("click", () => {
      if (game.useRift(room.id)) {
        syncPanel();
        canvas.focus();
      }
    });
    root.append(button);
  }
}

async function copySeedLink() {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("seed", String(currentSeed));
  url.searchParams.set("hero", game.heroId);
  if (game.challengeId) url.searchParams.set("challenge", game.challengeId);
  let copied = false;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url.href);
      copied = true;
    } catch {
    }
  }
  if (!copied) {
    const field = document.createElement("textarea");
    field.value = url.href;
    field.readOnly = true;
    field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.append(field);
    field.select();
    field.setSelectionRange(0, field.value.length);
    try {
      copied = document.execCommand("copy");
    } catch {
    } finally {
      field.remove();
    }
  }
  const button = $("copySeedButton");
  button.textContent = copied ? "Ссылка скопирована" : "Скопируйте из адресной строки";
  const description = game.challengeId ? "seed, герой и испытание" : "только seed и герой";
  toast(copied ? `Скопированы ${description}` : "Ссылка уже находится в адресной строке", 3000);
  setTimeout(() => { button.textContent = "Скопировать ссылку на seed"; }, 3000);
}

const SYNERGY_DETAILS = {
  "Связанная опись": "Скрепка + нить: до трёх дуг между снарядами. Дуга наносит 0,4 урона каждые 0,2 с.",
  "Длинная разметка": "Мел + ртуть: рикошет сохраняет пройденный путь. Ртуть наращивает урон и размер до ×2,5.",
  "Призматическая разметка": "Лазер + мел: луч, дошедший до стены арены, один раз отражается к ближайшему видимому врагу с ×0,65 урона. Полки не отражают луч.",
  "Реагентная рана": "Яд + кровотечение: гибель врага с обоими эффектами передаёт их на 2 секунды максимум двум соседям в радиусе 60 px. Дальше эффект не распространяется.",
  "Тяжёлая четверть": "Тяжёлый калибр + четыре снаряда: каждый четвёртый залп добавляет центральный снаряд или луч с ×2 обычного урона.",
  "Рабочий режим": "Регулятор + резистор: после секунды неподвижности урон ×1,5. Размер снаряда или луча тоже увеличивается.",
  "Возвратная разметка": "Лоток + мел: на обратном пути снаряд один раз отскакивает от стены к герою. Повторный отскок запрещён.",
  "Огненная опись": "Штамп + огонь: снятие метки петардой поджигает максимум двух соседей на 2 секунды. Дальше эффект не распространяется.",
  "Контурная нить": "Катушка + нить: импульс связывает героя максимум с двумя целями до 90 px и наносит каждой 0,4 урона без on-hit цепочек.",
  "Минута на разборку": "Компас + часы: в радиусе 80 px от петарды вражеские снаряды ограниченно доворачивают к ней. Лазеры не затрагиваются.",
};

function buildCatalog() {
  const root = $("catalogContent");
  root.replaceChildren();
  const bossIds = [...FLOOR_DEFINITIONS.map((floor) => floor.bossType), "riftWarden"];
  const secrets = [
    { id: "dustWall", name: "Пыль идёт не туда", description: "Петарда у подозрительной стены открывает проход." },
    { id: "tag0", name: "Номерок 0", description: "Запись прежнего владельца из скрытой комнаты." },
    { id: "toyRepair", name: "Не продавать", description: "Сохранённая игрушка получает вторую жизнь в Стеллажах." },
    { id: "sigil", name: "Живая трещина", description: "Отпечаток из Приёмного отдела можно показать Оценщику. Следующая подсказка появится в его магазине." },
    { id: "surveyorReveal", name: "Безошибочная съёмка", description: "Картограф открывает тайник после комнаты, в которой не получил ни одного удара, даже поглощённого пальто." },
    { id: "rift", name: "Сервисный разрез", description: "Тайный путь через Сортировочный узел. Смотритель охраняет пропуск к зачищенным комнатам [F]." },
  ];
  const sections = [
    { kind: "items", title: `Предметы · найдено ${catalog.count("items")}/${ITEMS.length} · открыто ${progression.unlockedCount(ITEMS)}/${ITEMS.length}`, entries: ITEMS.map((item) => ({ id: item.id, name: item.name, description: item.description, icon: item.icon })) },
    { kind: "unlocks", title: `Открытия · ${Object.values(ITEM_UNLOCKS).filter((_, index) => progression.isUnlocked(Object.keys(ITEM_UNLOCKS)[index])).length}/${Object.keys(ITEM_UNLOCKS).length}`, entries: Object.entries(ITEM_UNLOCKS).map(([id, rule]) => ({ id, name: ITEM_BY_ID.get(id)?.name || id, description: rule.text, icon: ITEM_BY_ID.get(id)?.icon })) },
    { kind: "bosses", title: `Боссы · ${catalog.count("bosses")}/${bossIds.length}`, entries: bossIds.map((id) => ({ id, name: ENEMY_TYPES[id].name, description: "Атаки записываются после первой встречи.", icon: ENEMY_TYPES[id].icon })) },
    { kind: "synergies", title: `Синергии · ${catalog.count("synergies")}/${SYNERGIES.length}`, entries: SYNERGIES.map((synergy) => ({ id: synergy.name, name: synergy.name, description: SYNERGY_DETAILS[synergy.name] })) },
    { kind: "secrets", title: `Секреты · ${catalog.count("secrets")}/${secrets.length}`, entries: secrets },
  ];
  for (const section of sections) {
    const heading = document.createElement("h3");
    heading.textContent = section.title;
    root.append(heading);
    const grid = document.createElement("div");
    grid.className = "catalog-grid";
    for (const entry of section.entries) {
      const known = section.kind === "unlocks" ? progression.isUnlocked(entry.id) : catalog.has(section.kind, entry.id);
      const locked = (section.kind === "items" && !progression.isUnlocked(entry.id)) || (section.kind === "unlocks" && !known);
      const card = document.createElement("article");
      card.className = `catalog-entry${known ? "" : " unknown"}${locked ? " locked" : ""}`;
      if (entry.icon) {
        const image = document.createElement("img");
        image.src = `assets/icons/${entry.icon}`;
        image.alt = "";
        card.append(image);
      }
      const body = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = section.kind === "items" && !progression.isUnlocked(entry.id) ? `${entry.name} · закрыто` : known ? entry.name : "???";
      const description = document.createElement("p");
      description.textContent = section.kind === "unlocks" ? `${known ? "Открыто" : "Закрыто"}: ${entry.description}` : locked ? progression.unlockGoal(entry.id) : known ? entry.description : "Запись появится после находки.";
      body.append(title, description);
      card.append(body);
      grid.append(card);
    }
    root.append(grid);
  }
}

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function showEnd(victory, stats) {
  const challenge = getChallenge(stats.challengeId);
  $("endEyebrow").textContent = victory ? "СМЕНА ЗАВЕРШЕНА" : "ЗАПИСЬ О СМЕНЕ ЗАКРЫТА";
  $("endTitle").textContent = victory ? stats.mode === "boss" ? "Тренировка завершена" : stats.mode === "challenge" ? "Испытание выполнено" : "Архив отпускает смену" : "Смена окончена";
  $("endText").textContent = victory
    ? stats.mode === "boss" ? "Босс повержен. Можно повторить встречу и отработать другую тактику." : stats.mode === "challenge" ? `${challenge?.name || "Испытание"}: цель в ${challenge?.floors || 0} отдела выполнена. Награда сохранена в профиле открытий.` : `${FLOOR_DEFINITIONS.length} отделов остались позади. Каталог сохранил ваши находки и секреты.`
    : `Последняя причина: ${stats.lastDamage}. Сохранение забега удалено, но записи каталога и открытия остались.`;
  if (runUnlocks.length) {
    const names = runUnlocks.map((id) => ITEM_BY_ID.get(id)?.name || id).join(", ");
    $("endText").textContent += ` Новые открытия: ${names}.`;
  }
  $("endStats").replaceChildren();
  for (const text of [`ВРЕМЯ ${formatTime(stats.time)}`, `ВРАГОВ ${stats.kills}`, `НАХОДОК ${stats.items.length}`]) {
    const span = document.createElement("span");
    span.textContent = text;
    $("endStats").append(span);
  }
  $("bossHud").hidden = true;
  showPanel("end");
}

function buildPauseDetails() {
  const format = (value) => Number(value.toFixed(2).replace(/\.?0+$/, "")).toString().replace(".", ",");
  const stats = game.buildStats();
  const rows = [
    ["Оружие", stats.weapon],
    [stats.laser ? "Урон за луч" : "Урон за снаряд", stats.maxDamage > stats.damage ? `${format(stats.damage)} → ${format(stats.maxDamage)}` : format(stats.damage)],
    [stats.laser ? "Лучей за залп" : "Снарядов за залп", stats.projectileCount],
    ["Перезарядка", `${format(stats.fireInterval)} с`],
    ["Темп стрельбы", `${format(stats.fireRate)}/с`],
    ["Скорость снаряда", stats.laser ? "мгновенно" : `${stats.projectileSpeed} px/s`],
    [stats.laser ? "Толщина луча" : "Размер снаряда", stats.maxProjectileRadius > stats.projectileRadius ? `${format(stats.projectileRadius)} → ${format(stats.maxProjectileRadius)} px` : `${format(stats.projectileRadius)} px`],
    ["Скорость героя", `${format(stats.moveSpeed)} px/s`],
    ["Пронзание", stats.laser ? "все цели по линии" : stats.pierce],
    ["Рикошеты", stats.bounces],
    ["Здоровье", `${stats.health}/${stats.maxHealth}`],
    ["Петарды", stats.bombs],
    ["Жетоны", stats.coins],
    ["Ключи", stats.keys],
    ["Герой", game.hero.name],
  ];
  if (stats.umbrellaCooldown !== null) rows.push(["Зонт", stats.umbrellaRemaining > 0 ? `ещё ${format(stats.umbrellaRemaining)} с` : `готов · ${stats.umbrellaCooldown} с`]);
  const statsRoot = $("pauseStats");
  statsRoot.replaceChildren();
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "stat-row";
    const name = document.createElement("span");
    name.textContent = label;
    const number = document.createElement("strong");
    number.textContent = value;
    row.append(name, number);
    statsRoot.append(row);
  }
  const itemsRoot = $("pauseItems");
  itemsRoot.replaceChildren();
  if (!game.items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Пока ничего. Найдите сокровищницу или испытание.";
    itemsRoot.append(empty);
  }
  for (const id of game.items) {
    const item = ITEM_BY_ID.get(id);
    const card = document.createElement("article");
    card.className = "pause-item";
    card.dataset.item = id;
    const image = document.createElement("img");
    image.src = `assets/icons/${item.icon}`;
    image.alt = "";
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.name;
    const description = document.createElement("p");
    description.textContent = item.description;
    body.append(title, description);
    const related = game.activeSynergies().find((synergy) => synergy.ids.includes(id));
    if (related) {
      const synergy = document.createElement("p");
      synergy.className = "pause-item-synergy";
      synergy.textContent = `Активно: ${related.name}`;
      body.append(synergy);
    }
    card.append(image, body);
    itemsRoot.append(card);
  }
  const synergyRoot = $("pauseSynergies");
  synergyRoot.replaceChildren();
  if (game.hero.trait) {
    const trait = document.createElement("div");
    trait.className = "pause-synergy hero-trait";
    const title = document.createElement("strong");
    title.textContent = `Особенность: ${game.hero.name}`;
    const description = document.createElement("span");
    description.textContent = `${game.hero.trait}. Поглощённый пальто удар тоже отменяет безошибочную комнату.`;
    trait.append(title, description);
    synergyRoot.append(trait);
  }
  const active = game.activeSynergies();
  if (!active.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "Синергии пока не активны.";
    synergyRoot.append(empty);
  }
  for (const synergy of active) {
    const block = document.createElement("div");
    block.className = "pause-synergy";
    const title = document.createElement("strong");
    title.textContent = synergy.name;
    const description = document.createElement("span");
    description.textContent = SYNERGY_DETAILS[synergy.name];
    block.append(title, description);
    synergyRoot.append(block);
  }
}

function handleEvent(event) {
  fx.handle(event);
  audio.handle(event);
  switch (event.type) {
    case "checkpoint":
      saveCheckpoint(event.snapshot);
      break;
    case "kill":
      renderer.recordDeath(event.enemy, game.time);
      break;
    case "room":
      showPanel(null);
      if (["boss", "rift"].includes(event.room.type) && !event.room.cleared) {
        const bossType = event.room.type === "rift" ? "riftWarden" : game.floor.bossType;
        catalog.record("bosses", bossType);
        $("bossHud").hidden = false;
        $("bossName").textContent = ENEMY_TYPES[bossType].name;
        toast(ENEMY_TYPES[bossType].name, 2100);
      } else if (event.room.type !== "start") {
        const names = { combat: "Боевая комната", treasure: "Сокровищница", shop: "Магазин Оценщика", challenge: "Сверхурочные", workshop: "Мастерская Разборщика", vault: "Запечатанное хранилище", secret: "Скрытая комната", rift: "Сервисный разрез" };
        const events = { sigil: "Неучтённая трещина", contract: "Терминал калибровки", riftTerminal: "Сервисный терминал" };
        toast(events[event.room.event] || event.room.layoutName || names[event.room.type] || "Новая комната", 900);
      }
      break;
    case "roomResumed":
      showPanel(null);
      break;
    case "roomClear":
      toast("Комната зачищена · двери открыты", 1200);
      break;
    case "choice":
      buildChoices(event.choices);
      showPanel("choice");
      break;
    case "pickup":
      catalog.record("items", event.item.id);
      toast(event.item.name);
      break;
    case "synergy":
      catalog.record("synergies", event.name);
      toast(`Синергия: ${event.name}`, 2300);
      break;
    case "shop":
    case "shopUpdate":
      buildShop();
      showPanel("shop");
      break;
    case "contract":
      buildContract();
      showPanel("contract");
      break;
    case "contractAccepted":
      toast("Контракт принят: следующий бой усилен", 2100);
      break;
    case "chain": {
      const messages = { sigil: "Отпечаток получен. Покажите его Оценщику.", npc: "Оценщик узнал трещину. Ищите терминал в Сортировочном узле.", terminal: "Сервисный разрез открыт" };
      if (event.step === "sigil") catalog.record("secrets", "sigil");
      toast(messages[event.step] || "Запись цепочки обновлена", 2300);
      break;
    }
    case "riftMenu":
      buildRiftMenu(event.rooms);
      showPanel("rift");
      break;
    case "riftTravel":
      toast("Пропуск использован. Следующий проход — в новом отделе.", 1900);
      break;
    case "riftReturn":
      toast("Вы вернулись в Сортировочный узел", 1600);
      break;
    case "workshop":
      buildWorkshop();
      showPanel("workshop");
      break;
    case "workshopComplete":
      toast(`Замена: ${event.sacrifice.name} → ${event.item.name}`, 2200);
      break;
    case "vault":
      buildVault();
      showPanel("vault");
      break;
    case "vaultFight":
      showPanel(null);
      toast("Охрана хранилища пробуждается", 1800);
      break;
    case "synergySpread":
      toast("Реагентная рана: яд и кровотечение переданы соседям", 1500);
      break;
    case "floorComplete": {
      notifyUnlocks(progression.recordFloor(event));
      const nextFloor = FLOOR_DEFINITIONS[game.floorIndex + 1];
      if (nextFloor) {
        $("floorDescription").textContent = `Можно остаться и исследовать отдел. Когда будете готовы, вернитесь к лифту в комнате босса. ${nextFloor.description} Пальто с подкладкой снова защитит от первого удара.`;
        $("nextFloorButton").textContent = `Спуститься: ${nextFloor.name}`;
      } else {
        $("floorDescription").textContent = "Это последний отдел в текущей цели. Можно завершить оставшиеся комнаты или вернуться к лифту и закончить смену.";
        $("nextFloorButton").textContent = game.mode === "challenge" ? "Завершить испытание" : "Завершить смену";
      }
      $("exploreButton").textContent = `Остаться: ${game.floor.name}`;
      showPanel("floor");
      break;
    }
    case "floor":
      toast(event.name, 1800);
      break;
    case "secret":
      catalog.record("secrets", event.id);
      toast(`Секрет: ${event.name}`, 2300);
      break;
    case "memory":
      toast(`Просьба памяти: ${event.name}`, 2300);
      break;
    case "quest":
      toast("Игрушка ваша. Не продавайте её.", 2100);
      break;
    case "locked":
      toast(event.message, 1300);
      break;
    case "unlocked":
      toast("Ключ использован", 1000);
      break;
    case "bossPhase":
      toast("Фаза II · атаки меняются", 1800);
      break;
    case "shield":
      if (event.blocked) toast("Зонт раскрылся", 700);
      break;
    case "victory":
      notifyUnlocks(progression.recordVictory(event));
      clearCheckpoint();
      showEnd(true, event);
      break;
    case "dead":
      clearCheckpoint();
      showEnd(false, event);
      break;
    case "restore":
      toast("Забег восстановлен", 1300);
      break;
  }
  updateHud(true);
}

function updateHud(force = false) {
  updateChoiceTimer();
  const room = game.room();
  const signature = [game.heroId, game.player.maxHp, game.player.hp, game.player.bombs, game.player.coins, game.player.keys, game.state, game.floorIndex, game.currentRoomId, game.items.join(","), game.seed].join("|");
  if (force || signature !== hudSignature) {
    hudSignature = signature;
    $("health").replaceChildren();
    for (let i = 0; i < game.player.maxHp; i++) {
      const image = document.createElement("img");
      image.src = "assets/icons/heart-battery.svg";
      image.alt = "";
      if (i >= game.player.hp) image.className = "lost";
      $("health").append(image);
    }
    $("bombs").textContent = game.player.bombs;
    $("coins").textContent = game.player.coins;
    $("keys").textContent = game.player.keys;
    const roomNames = { start: "Лифт", combat: "бой", treasure: "находка", shop: "магазин", challenge: "испытание", workshop: "мастерская", vault: "хранилище", secret: "тайник", boss: "босс", rift: "разрез" };
    $("wave").textContent = game.state === "title" ? "Смена не начата" : `${game.floor?.name || "Архив"} · ${room ? roomNames[room.type] || "событие" : "исследование"}`;
    $("seed").textContent = `seed ${game.seed}`;
    const inventory = $("inventory");
    inventory.replaceChildren();
    if (!game.items.length) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "Находок пока нет";
      inventory.append(empty);
    } else {
      for (const id of game.items) {
        const item = ITEM_BY_ID.get(id);
        const chip = document.createElement("div");
        chip.className = "inventory-item";
        chip.title = item.description;
        const image = document.createElement("img");
        image.src = `assets/icons/${item.icon}`;
        image.alt = "";
        const label = document.createElement("span");
        label.textContent = item.name;
        chip.append(image, label);
        inventory.append(chip);
      }
      for (const synergy of game.activeSynergies()) {
        const chip = document.createElement("div");
        chip.className = "inventory-item synergy";
        chip.textContent = `Синергия: ${synergy.name}`;
        inventory.append(chip);
      }
    }
  }
  const boss = game.enemies.find((enemy) => ENEMY_TYPES[enemy.type]?.boss && !enemy.dead);
  $("bossHud").hidden = game.state !== "boss" || !boss;
  if (boss) $("bossFill").style.width = `${Math.max(0, boss.hp / boss.maxHp) * 100}%`;
  const interaction = game.interactionHint();
  const hint = $("interactHint");
  hint.hidden = !interaction || paused;
  if (interaction && hint.dataset.action !== interaction) {
    const key = document.createElement("kbd");
    key.textContent = "E";
    hint.replaceChildren(key, document.createTextNode(` ${interaction}`));
    hint.dataset.action = interaction;
  }
  $("mapHint").hidden = game.state === "title";
}

function togglePause(force) {
  if (!["room", "wave", "boss"].includes(game.state)) return;
  paused = typeof force === "boolean" ? force : !paused;
  pointer.down = false;
  accumulator = 0;
  if (paused) showPanel("pause");
  else {
    showPanel(null);
    canvas.focus();
  }
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / WIDTH, rect.height / HEIGHT);
  const offsetX = (rect.width - WIDTH * scale) / 2;
  const offsetY = (rect.height - HEIGHT * scale) / 2;
  pointer.x = Math.max(0, Math.min(WIDTH, (event.clientX - rect.left - offsetX) / scale));
  pointer.y = Math.max(0, Math.min(HEIGHT, (event.clientY - rect.top - offsetY) / scale));
}

function resizeCanvas() {
  const shell = $("gameShell");
  const available = Math.max(240, Math.min(window.innerWidth - 48, 1240));
  const scale = available >= WIDTH ? Math.max(1, Math.floor(available / WIDTH)) : available / WIDTH;
  const width = Math.round(WIDTH * scale);
  const height = Math.round(HEIGHT * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  shell.style.width = `${width}px`;
  shell.style.height = `${height}px`;
  shell.style.minHeight = "0";
  shell.style.aspectRatio = "auto";
  shell.style.marginInline = "auto";
}

function frame(now) {
  const elapsed = Math.min(0.08, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  if (!paused) {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= STEP && steps < 6) {
      const moveX = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
      const moveY = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
      game.update(STEP, { moveX, moveY, aimX: pointer.x, aimY: pointer.y, fire: pointer.down, bombPressed, interactPressed });
      bombPressed = false;
      interactPressed = false;
      accumulator -= STEP;
      steps++;
    }
    fx.update(elapsed);
  }
  renderer.render(game);
  updateHud();
  requestAnimationFrame(frame);
}

$("startButton").addEventListener("click", () => startRun(currentSeed));
$("continueButton").addEventListener("click", continueRun);
$("trainingButton").addEventListener("click", () => {
  buildBossTraining();
  showPanel("training");
});
$("challengeButton").addEventListener("click", () => {
  buildChallengeCards();
  showPanel("challenge");
});
$("closeTrainingButton").addEventListener("click", () => showPanel("title"));
$("closeChallengesButton").addEventListener("click", () => showPanel("title"));
$("catalogButton").addEventListener("click", () => {
  buildCatalog();
  showPanel("catalog");
});
$("closeCatalogButton").addEventListener("click", () => showPanel("title"));
$("resumeButton").addEventListener("click", () => togglePause(false));
$("pauseButton").addEventListener("click", () => togglePause());
$("restartButton").addEventListener("click", () => startRun(currentSeed, currentRunOptions()));
$("newRunButton").addEventListener("click", () => startRun(newSeed(), currentRunOptions()));
$("retryButton").addEventListener("click", () => startRun(currentSeed, currentRunOptions()));
$("nextRunButton").addEventListener("click", () => startRun(newSeed(), currentRunOptions()));
$("menuButton").addEventListener("click", showTitle);
$("endMenuButton").addEventListener("click", showTitle);
$("copySeedButton").addEventListener("click", copySeedLink);
$("closeContractButton").addEventListener("click", () => {
  game.closeContract();
  syncPanel();
  canvas.focus();
});
$("closeRiftButton").addEventListener("click", () => {
  game.closeRiftMenu();
  syncPanel();
  canvas.focus();
});
$("closeWorkshopButton").addEventListener("click", () => {
  game.closeWorkshop();
  syncPanel();
  canvas.focus();
});
$("vaultKeyButton").addEventListener("click", () => {
  if (game.chooseVault("key")) {
    syncPanel();
    canvas.focus();
  }
});
$("vaultFightButton").addEventListener("click", () => {
  if (game.chooseVault("fight")) {
    syncPanel();
    canvas.focus();
  }
});
$("closeVaultButton").addEventListener("click", () => {
  game.closeVault();
  syncPanel();
  canvas.focus();
});
$("closeShopButton").addEventListener("click", () => {
  game.closeShop();
  syncPanel();
});
$("repairButton").addEventListener("click", () => {
  if (game.repairToy()) buildShop();
});
$("nextFloorButton").addEventListener("click", () => {
  if (game.nextFloor()) syncPanel();
});
$("exploreButton").addEventListener("click", () => {
  if (game.continueExploring()) {
    syncPanel();
    canvas.focus();
  }
});
$("audioButton").addEventListener("click", () => {
  audio.setEnabled(!audio.enabled);
  saveSetting("bureau.audio", audio.enabled);
  updateSettingLabels();
});
$("fxButton").addEventListener("click", () => {
  fx.setReduced(!fx.reduced);
  saveSetting("bureau.reducedFx", fx.reduced);
  updateSettingLabels();
});
$("telegraphButton").addEventListener("click", () => {
  renderer.showTelegraphs = !renderer.showTelegraphs;
  saveSetting("bureau.telegraphs", renderer.showTelegraphs);
  updateSettingLabels();
});

window.addEventListener("keydown", (event) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(event.code)) event.preventDefault();
  if (event.code === "Tab") {
    renderer.mapExpanded = true;
    return;
  }
  if (event.code === "Escape") {
    event.preventDefault();
    if (["shop", "contract", "riftMenu", "workshop", "vault"].includes(game.state)) {
      game.closeShop();
      game.closeContract();
      game.closeRiftMenu();
      game.closeWorkshop();
      game.closeVault();
      syncPanel();
      canvas.focus();
    } else if (["catalog", "training", "challenge"].includes(activePanel)) showPanel("title");
    else togglePause();
    return;
  }
  if (game.state === "choice" && Date.now() >= game.choiceReadyAt && ["Digit1", "Digit2", "Digit3", "Numpad1", "Numpad2", "Numpad3"].includes(event.code)) {
    const index = Number(event.code.at(-1)) - 1;
    const item = game.choices[index];
    if (item) selectItem(item.id);
    return;
  }
  if (game.state === "title" && event.code === "Enter") {
    startRun(currentSeed);
    return;
  }
  if (event.code === "KeyF" && !event.repeat && !paused) {
    if (game.state === "riftMenu") game.closeRiftMenu();
    else game.openRiftMenu();
    syncPanel();
    if (game.state === "room") canvas.focus();
    return;
  }
  if (event.code === "KeyM" && !event.repeat) {
    renderer.mapHidden = !renderer.mapHidden;
    toast(renderer.mapHidden ? "Мини-карта скрыта" : "Мини-карта показана", 1200);
    return;
  }
  if (event.code === "KeyR" && !event.repeat && !paused && ["room", "wave", "boss"].includes(game.state)) bombPressed = true;
  if (event.code === "KeyE" && !event.repeat && !paused && game.state === "room") interactPressed = true;
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Tab") renderer.mapExpanded = false;
  keys.delete(event.code);
});
window.addEventListener("blur", () => {
  keys.clear();
  pointer.down = false;
  renderer.mapExpanded = false;
  if (!paused && ["room", "wave", "boss"].includes(game.state)) togglePause(true);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !paused && ["room", "wave", "boss"].includes(game.state)) togglePause(true);
});
window.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointermove", pointerPosition);
canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  pointerPosition(event);
  pointer.down = true;
  audio.ensure();
  canvas.focus();
});
window.addEventListener("pointerup", () => {
  pointer.down = false;
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

updateSettingLabels();
buildHeroChoices();
buildBossTraining();
const compactScreen = window.matchMedia("(max-width: 800px)");
const updateFieldManual = () => { $("fieldManual").open = !compactScreen.matches; };
compactScreen.addEventListener("change", updateFieldManual);
updateFieldManual();
resizeCanvas();
showTitle();
requestAnimationFrame(frame);

if (params.has("debug")) {
  window.__bureau = { game, startRun, continueRun, selectItem, togglePause, fx, audio, sprites, catalog, renderer, storage: { loadCheckpoint, clearCheckpoint } };
}
