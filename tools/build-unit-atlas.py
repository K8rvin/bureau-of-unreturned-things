from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACKS = ROOT / "assets" / "packs"
OUTPUT = ROOT / "assets" / "units" / "generated"
OUTPUT.mkdir(parents=True, exist_ok=True)
manifest = {}


def add_sprite(key, strips, *, reference_height, target_height, directional=False, rates=None, offset_y=0):
    images = []
    for name, entries in strips:
        row = []
        for path, crop, anchor in entries:
            with Image.open(path) as source:
                frame = source.convert("RGBA").crop(crop)
            if not frame.getchannel("A").getbbox():
                raise ValueError(f"Empty frame: {path}")
            row.append({"image": frame, "anchor": anchor, "source": str(path.relative_to(ROOT))})
        images.append((name, row))

    width = max(sum(frame["image"].width for frame in row) for _, row in images)
    height = sum(max(frame["image"].height for frame in row) for _, row in images)
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    sprite = {
        "image": f"assets/units/generated/{key}.png",
        "referenceHeight": reference_height,
        "targetHeight": target_height,
        "rates": rates or {},
        "once": ["death"],
        "offsetY": offset_y,
        "sources": sorted({frame["source"] for _, row in images for frame in row}),
    }
    if directional:
        sprite["directional"] = True

    y = 0
    for name, row in images:
        x = 0
        frames = []
        for frame in row:
            image = frame["image"]
            atlas.alpha_composite(image, (x, y))
            frames.append({"x": x, "y": y, "w": image.width, "h": image.height, "ax": frame["anchor"][0], "ay": frame["anchor"][1]})
            x += image.width
        sprite[name] = frames
        y += max(frame["image"].height for frame in row)

    path = OUTPUT / f"{key}.png"
    atlas.save(path, optimize=True)
    manifest[key] = sprite


def separate_files(key, folder, prefix, states, *, reference_height=64, target_height=40):
    strips = []
    minimum_y = 64
    for _, source_name, count in states:
        for frame in range(1, count + 1):
            path = PACKS / folder / f"{prefix}_{source_name}_{frame}.png"
            with Image.open(path) as image:
                bbox = image.getchannel("A").getbbox()
                if bbox:
                    minimum_y = min(minimum_y, bbox[1])
    for name, source_name, count in states:
        entries = []
        for frame in range(1, count + 1):
            path = PACKS / folder / f"{prefix}_{source_name}_{frame}.png"
            entries.append((path, (0, minimum_y, 288, 128), (144, 128 - minimum_y)))
        strips.append((name, entries))
    add_sprite(key, strips, reference_height=reference_height, target_height=target_height, rates={"idle": 8, "run": 12, "attack": 28, "hit": 12, "death": 16})


def luiz(key, monster, target_height, *, offset_y=0):
    root = PACKS / "luizmelo" / "monsters"
    movement = "walk" if key == "skeleton" else "flight" if key == "flyingEye" else "run"
    idle = "flight" if key == "flyingEye" else "idle"
    states = [("idle", idle, 4 if key != "flyingEye" else 8), ("run", movement, 4 if key == "skeleton" else 8), ("attack", "attack", 8), ("hit", "take hit", 4), ("death", "death", 4)]
    if key == "skeleton":
        states.append(("shield", "shield", 4))
    strips = []
    for name, source_name, count in states:
        entries = []
        for frame in range(1, count + 1):
            path = root / f"{monster} {source_name} {frame:02d}.png"
            with Image.open(path) as image:
                width, height = image.size
            entries.append((path, (0, 0, width, height), (width / 2, height)))
        strips.append((name, entries))
    with Image.open(strips[0][1][0][0]) as idle:
        reference_height = idle.height
    add_sprite(key, strips, reference_height=reference_height, target_height=target_height, rates={"idle": 6, "run": 10, "attack": 12, "hit": 14, "shield": 8, "death": 8}, offset_y=offset_y)


def intern():
    source = PACKS / "snoblin" / "assets" / "sprites" / "prototype_character.png"
    strips = []
    for name, row, count in [("idleDown", 0, 2), ("idleSide", 1, 2), ("idleUp", 2, 2), ("runDown", 3, 4), ("runSide", 4, 4), ("runUp", 5, 4), ("hitDown", 6, 2), ("hitSide", 7, 2), ("hitUp", 8, 2), ("deathDown", 9, 3), ("deathSide", 10, 3), ("deathUp", 11, 3)]:
        entries = [(source, (column * 32, row * 32, column * 32 + 32, row * 32 + 26), (16, 26)) for column in range(count)]
        strips.append((name, entries))
    for name, source_name in [("idle", "idleDown"), ("run", "runDown"), ("hit", "hitDown"), ("death", "deathDown")]:
        strips.append((name, next(entries for state, entries in strips if state == source_name)))
    add_sprite("intern", strips, reference_height=26, target_height=36, directional=True, rates={"idle": 3, "idleDown": 3, "idleSide": 3, "idleUp": 3, "run": 8, "runDown": 8, "runSide": 8, "runUp": 8, "hit": 8, "death": 6})


def courier():
    source = PACKS / "chrome-district" / "relay-cass_ortho_sheet.png"
    strips = []
    for state, first_column, count in [("idle", 0, 1), ("run", 6, 6)]:
        for suffix, row in [("Down", 0), ("Side", 2), ("Up", 4)]:
            entries = [(source, (column * 56 + 8, row * 84 + 8, column * 56 + 48, row * 84 + 72), (20, 64)) for column in range(first_column, first_column + count)]
            strips.append((state + suffix, entries))
    for state in ["idle", "run"]:
        entries = next(entries for name, entries in strips if name == state + "Down")
        strips.append((state, entries))
    add_sprite("courier", strips, reference_height=64, target_height=40, directional=True, rates={"run": 14, "runDown": 14, "runSide": 14, "runUp": 14})


def small_animals():
    source = PACKS / "calciumtrice" / "rat-and-bat.png"
    for key, first_row, target_height in [("rat", 0, 12), ("bat", 5, 26)]:
        strips = []
        for name, row, count in [("idle", first_row, 10), ("gesture", first_row + 1, 10), ("run", first_row + 2, 10), ("attack", first_row + 3, 10), ("death", first_row + 4, 10)]:
            top = 20 if key == "rat" else 6
            entries = [(source, (column * 32, row * 32 + top, column * 32 + 32, row * 32 + 32), (16, 32 - top)) for column in range(count)]
            strips.append((name, entries))
        add_sprite(key, strips, reference_height=32 - (20 if key == "rat" else 6), target_height=target_height, rates={"idle": 8, "gesture": 12, "run": 14, "attack": 14, "death": 12}, offset_y=-2 if key == "bat" else 0)


separate_files("priestess", "chierit-water", "Water Priestess", [("idle", "Idle", 8), ("run", "Walk", 10), ("attack", "Attack1", 7), ("hit", "Take Hit", 7), ("death", "Death", 16)])
separate_files("fireKnight", "chierit-fire", "Fire Knight", [("idle", "Idle", 8), ("run", "Run", 8), ("attack", "Attack1", 11), ("hit", "Take Hit", 6), ("death", "Death", 13)])
intern()
courier()
luiz("skeleton", "skeleton", 32)
luiz("mushroom", "mushroom", 26)
luiz("goblin", "goblin", 25)
luiz("flyingEye", "flying eye", 26, offset_y=-3)
small_animals()
(ROOT / "src" / "sprite-manifest.js").write_text("export const GENERATED_SPRITES = " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
print(f"Built {len(manifest)} sprite atlases from original pack frames.")
for key, sprite in manifest.items():
    path = ROOT / sprite["image"]
    with Image.open(path) as image:
        image.verify()
    print(f"{key}: {', '.join(name for name in sprite if isinstance(sprite[name], list))}")
