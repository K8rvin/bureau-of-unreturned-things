from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACKS = ROOT / "assets" / "packs"
OUTPUT = ROOT / "assets" / "units" / "generated"
OUTPUT.mkdir(parents=True, exist_ok=True)
manifest = {}


def add_sprite(key, strips, *, reference_height, target_height, directional=False, rates=None, offset_y=0, procedural_motion=False):
    images = []
    for name, entries in strips:
        row = []
        for path, crop, anchor in entries:
            with Image.open(path) as source:
                frame = source.convert("RGBA").crop(crop)
            if not frame.getchannel("A").getbbox():
                raise ValueError(f"Empty frame: {path}")
            row.append({"image": frame, "anchor": anchor, "source": path.relative_to(ROOT).as_posix()})
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
    if procedural_motion:
        sprite["proceduralMotion"] = True

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


def atlas_heroes():
    for key in ["archivist", "student", "witch", "scout"]:
        source = PACKS / "pixel-art-atlas" / f"{key}.png"
        with Image.open(source) as image:
            if image.size != (16, 16):
                raise ValueError(f"Unexpected Atlas frame size: {source}; expected 16x16")
        entries = [(source, (0, 0, 16, 16), (8, 16))]
        add_sprite(key, [("idle", entries), ("run", entries)], reference_height=16, target_height=24, rates={"idle": 1, "run": 1}, procedural_motion=True)


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


def sheet_frames(path, cell_width, cell_height, count, *, baseline):
    with Image.open(path) as source:
        expected_size = (cell_width * count, cell_height)
        if source.size != expected_size:
            raise ValueError(f"Unexpected sheet size: {path}; expected {expected_size}, found {source.size}")
        image = source.convert("RGBA")
    boxes = []
    for frame in range(count):
        cell = image.crop((frame * cell_width, 0, (frame + 1) * cell_width, cell_height))
        bbox = cell.getchannel("A").getbbox()
        if not bbox:
            raise ValueError(f"Empty frame {frame + 1}: {path}")
        boxes.append(bbox)
    entries = []
    for frame, (left, top, right, bottom) in enumerate(boxes):
        crop = (frame * cell_width + left, top, frame * cell_width + right, bottom)
        anchor = (cell_width / 2 - left, baseline - top)
        entries.append((path, crop, anchor))
    reference_height = max(bottom - top for left, top, right, bottom in boxes)
    return entries, reference_height


def curse_caster():
    root = PACKS / "evil-wizard-2"
    states = [("idle", "Idle", 8), ("run", "Run", 8), ("attack", "Attack1", 8), ("attack2", "Attack2", 8), ("hit", "Take hit", 3), ("death", "Death", 7)]
    strips = []
    reference_height = None
    for name, source_name, count in states:
        entries, height = sheet_frames(root / f"{source_name}.png", 250, 250, count, baseline=167)
        if name == "idle":
            reference_height = height
        strips.append((name, entries))
    add_sprite("curseCaster", strips, reference_height=reference_height, target_height=42, rates={"idle": 6, "run": 8, "attack": 10, "attack2": 10, "hit": 12, "death": 8})


def debts_depths():
    root = PACKS / "debts-depths"
    ghost, ghost_height = sheet_frames(root / "sprGhost1.png", 19, 28, 4, baseline=20)
    add_sprite("wraith", [("idle", ghost), ("run", ghost)], reference_height=ghost_height, target_height=32, rates={"idle": 6, "run": 8})
    orb, orb_height = sheet_frames(root / "sprGhostOrb.png", 18, 12, 8, baseline=10)
    add_sprite("ghostOrb", [("idle", orb)], reference_height=orb_height, target_height=12, rates={"idle": 8}, offset_y=orb_height / 2)
    monk, monk_height = sheet_frames(root / "sprLizardMonk1.png", 21, 20, 4, baseline=19)
    add_sprite("workshopMonk", [("idle", monk), ("run", monk)], reference_height=monk_height, target_height=28, rates={"idle": 4, "run": 4})


def intern(key="intern", filename="prototype_character.png"):
    source = PACKS / "snoblin" / "assets" / "sprites" / filename
    strips = []
    for name, row, count in [("idleDown", 0, 2), ("idleSide", 1, 2), ("idleUp", 2, 2), ("runDown", 3, 4), ("runSide", 4, 4), ("runUp", 5, 4), ("hitDown", 6, 2), ("hitSide", 7, 2), ("hitUp", 8, 2), ("deathDown", 9, 3), ("deathSide", 10, 3), ("deathUp", 11, 3)]:
        entries = [(source, (column * 32, row * 32, column * 32 + 32, row * 32 + 26), (16, 26)) for column in range(count)]
        strips.append((name, entries))
    for name, source_name in [("idle", "idleDown"), ("run", "runDown"), ("hit", "hitDown"), ("death", "deathDown")]:
        strips.append((name, next(entries for state, entries in strips if state == source_name)))
    add_sprite(key, strips, reference_height=26, target_height=36, directional=True, rates={"idle": 3, "idleDown": 3, "idleSide": 3, "idleUp": 3, "run": 8, "runDown": 8, "runSide": 8, "runUp": 8, "hit": 8, "death": 6})


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


atlas_heroes()
luiz("skeleton", "skeleton", 32)
luiz("mushroom", "mushroom", 26)
luiz("goblin", "goblin", 25)
luiz("flyingEye", "flying eye", 26, offset_y=-3)
small_animals()
curse_caster()
debts_depths()
(ROOT / "src" / "sprite-manifest.js").write_text("export const GENERATED_SPRITES = " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
print(f"Built {len(manifest)} sprite atlases from original pack frames.")
for key, sprite in manifest.items():
    path = ROOT / sprite["image"]
    with Image.open(path) as image:
        image.verify()
    print(f"{key}: {', '.join(name for name in sprite if isinstance(sprite[name], list))}")
