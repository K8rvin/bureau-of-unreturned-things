from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
import re
import statistics
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from image_background import remove_edge_background

ROOT = Path(__file__).resolve().parents[1]
LIBRARY = ROOT / "assets" / "library"
METADATA_ROOT = ROOT / ".cache" / "library-generation"
REQUESTS_PATH = ROOT / "tools" / "library-generation.json"
JS_MANIFEST_PATH = ROOT / "src" / "sprite-manifest.js"
JSON_MANIFEST_PATH = LIBRARY / "manifest.json"
EXTERNAL_ORIGINALS = Path("C:/Projects/YandexGames/assets")

CHILD_ORIGINAL = EXTERNAL_ORIGINALS / "library-child-v1.png"
CHILD_ATLAS = ROOT / ".test-output" / "library" / "child-nearest-atlas.png"
WOLF_ATLAS = ROOT / ".test-output" / "library" / "wolf-final-atlas.png"
WOLF_METADATA = ROOT / ".test-output" / "library" / "wolf-final-atlas.json"
RED_HOOD_ROOM = EXTERNAL_ORIGINALS / "library-red-hood-room-v1.png"

ALPHA_THRESHOLD = 16
UNIT_COLORS = 24
ROOM_COLORS = 64
FRAME_FIELDS = ("x", "y", "w", "h", "ax", "ay")
CHILD_STATES = [
    ("idleDown", [0]),
    ("runDown", [1, 2]),
    ("attackDown", [3]),
    ("idleSide", [4]),
    ("runSide", [5, 6]),
    ("attackSide", [7]),
    ("idleUp", [8]),
    ("runUp", [9, 10]),
    ("attackUp", [11]),
    ("hitDown", [12]),
    ("hitSide", [13]),
    ("death", [14]),
    ("victory", [15]),
]
WOLF_STATES = [
    ("idle", [0]),
    ("sniff", [1]),
    ("run", [3, 4, 5]),
    ("pounce", [6]),
    ("attack", [7]),
    ("howl", [8]),
    ("hit", [9]),
    ("front", [10]),
    ("death", [11]),
]
ALIASES = {
    "sniper": "hunter",
    "bat": "pigeon",
    "packer": "robber",
    "shooter": "robber",
    "dust": "gingerbread",
    "mushroom": "gingerbread",
    "moth": "sugarBat",
    "rat": "stepsister",
    "thief": "stepsister",
    "inker": "pigeon",
    "flyingEye": "pigeon",
    "skeleton": "lackey",
    "guardian": "lackey",
    "goblin": "dwarf",
    "curseCaster": "messenger",
    "wraith": "strawMan",
    "hanger": "strawMan",
    "mimic": "child",
    "spawner": "candyWitch",
    "npc": "librarian",
    "workshopMonk": "librarian",
    "redHood": "redHood",
    "umbrellaBoss": "bremenQuartet",
    "sorterBoss": "candyWitch",
    "finalBoss": "cinderella",
    "calibratorBoss": "rumple",
    "chemistBoss": "snowWhite",
    "queen": "queen",
    "riftWarden": "rumple",
}


class MissingSource(Exception):
    pass


class BuildError(Exception):
    pass


@dataclass
class SpriteAsset:
    key: str
    image: Image.Image
    entry: dict
    detail: dict
    png_bytes: bytes | None = None
    alias: bool = False


@dataclass
class RoomAsset:
    key: str
    image: Image.Image
    detail: dict


def display_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(ROOT).as_posix()
    except ValueError:
        return resolved.as_posix()


def validate_id(asset_id: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", asset_id):
        raise BuildError(f"Unsafe asset id: {asset_id!r}")


def grid_boxes(size: tuple[int, int], rows: int, columns: int) -> list[tuple[int, int, int, int]]:
    width, height = size
    if rows <= 0 or columns <= 0 or width < columns or height < rows:
        raise BuildError(f"Invalid {rows}x{columns} grid for image size {size}")
    boxes = []
    for row in range(rows):
        top = round(row * height / rows)
        bottom = round((row + 1) * height / rows)
        for column in range(columns):
            left = round(column * width / columns)
            right = round((column + 1) * width / columns)
            boxes.append((left, top, right, bottom))
    return boxes


def alpha_components(alpha: np.ndarray, threshold: int) -> tuple[np.ndarray, list[dict | None]]:
    mask = alpha >= threshold
    labels = np.zeros(mask.shape, dtype=np.int32)
    stats: list[dict | None] = [None]
    height, width = mask.shape
    for source_y, source_x in zip(*np.nonzero(mask)):
        if labels[source_y, source_x]:
            continue
        label = len(stats)
        stack = [(int(source_y), int(source_x))]
        labels[source_y, source_x] = label
        area = 0
        left = right = int(source_x)
        top = bottom = int(source_y)
        while stack:
            y, x = stack.pop()
            area += 1
            left = min(left, x)
            right = max(right, x)
            top = min(top, y)
            bottom = max(bottom, y)
            for delta_y in (-1, 0, 1):
                for delta_x in (-1, 0, 1):
                    next_y, next_x = y + delta_y, x + delta_x
                    if (
                        0 <= next_y < height
                        and 0 <= next_x < width
                        and mask[next_y, next_x]
                        and not labels[next_y, next_x]
                    ):
                        labels[next_y, next_x] = label
                        stack.append((next_y, next_x))
        stats.append({"area": area, "bbox": [left, top, right + 1, bottom + 1]})
    return labels, stats


def main_component(stats: list[dict | None]) -> tuple[int, dict]:
    for label in range(1, len(stats)):
        if stats[label] is not None:
            break
    else:
        raise BuildError("Frame has no alpha component above the threshold")
    main_label = max(range(1, len(stats)), key=lambda item: stats[item]["area"])
    return main_label, stats[main_label]


def alpha_component_bbox(image: Image.Image, threshold: int = ALPHA_THRESHOLD) -> tuple[list[int], int]:
    alpha = np.asarray(image.convert("RGBA").getchannel("A"))
    _, stats = alpha_components(alpha, threshold)
    _, component = main_component(stats)
    return component["bbox"], component["area"]


def cleanup_alpha(image: Image.Image, threshold: int = ALPHA_THRESHOLD) -> tuple[Image.Image, dict]:
    pixels = np.array(image.convert("RGBA"))
    pixels[:, :, 3][pixels[:, :, 3] < threshold] = 0
    labels, stats = alpha_components(pixels[:, :, 3], threshold)
    main_label, component = main_component(stats)
    minimum_area = max(4, component["area"] // 1000)
    light_interior_limit = max(24, component["area"] // 250)
    keep = np.zeros(len(stats), dtype=bool)
    removed_light_interiors = []
    for label, stat in enumerate(stats):
        if stat is None:
            continue
        mask = labels == label
        mean_rgb = pixels[mask, :3].mean(axis=0)
        light_background = mean_rgb.min() > 170 and np.ptp(mean_rgb) < 30 and stat["area"] >= light_interior_limit
        if light_background and label != main_label:
            removed_light_interiors.append({"area": stat["area"], "bbox": stat["bbox"], "meanRGB": mean_rgb.round(2).tolist()})
        elif label == main_label or stat["area"] >= minimum_area:
            keep[label] = True
    pixels[:, :, 3][~keep[labels]] = 0
    pixels[:, :, :3][pixels[:, :, 3] == 0] = 0
    result = Image.fromarray(pixels, "RGBA")
    component = copy.deepcopy(component)
    component["alphaThreshold"] = threshold
    component["removedComponentsBelowArea"] = minimum_area
    component["removedLightInteriors"] = removed_light_interiors
    return result, component


def premultiplied_alpha_resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return image.convert("RGBA").convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def visible_color_count(image: Image.Image) -> int:
    pixels = np.asarray(image.convert("RGBA"))
    visible = pixels[pixels[:, :, 3] > 0, :3]
    if not len(visible):
        return 0
    return len(np.unique(visible, axis=0))


def reduce_palette(image: Image.Image, colors: int) -> Image.Image:
    if image.mode == "RGBA":
        alpha = image.getchannel("A")
        reduced = image.convert("RGB").quantize(colors=colors, dither=Image.Dither.NONE).convert("RGB")
        reduced.putalpha(alpha)
        return reduced
    return image.convert("RGB").quantize(colors=colors, dither=Image.Dither.NONE).convert("RGB")


def export_frame_atlas(
    cells: list[Image.Image],
    rows: int,
    columns: int,
    cell_size: tuple[int, int],
    anchor_bottoms: list[int] | None = None,
) -> tuple[Image.Image, list[dict]]:
    if len(cells) != rows * columns:
        raise BuildError("Frame count does not match the requested atlas grid")
    cell_width, cell_height = cell_size
    atlas = Image.new("RGBA", (cell_width * columns, cell_height * rows), (0, 0, 0, 0))
    frames = []
    for index, cell in enumerate(cells):
        if cell.size != cell_size or cell.mode != "RGBA":
            raise BuildError(f"Unexpected frame {index} geometry: {cell.size}, {cell.mode}")
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        atlas.alpha_composite(cell, (x, y))
        if anchor_bottoms is None:
            bbox, _ = alpha_component_bbox(cell, threshold=1)
            anchor_y = bbox[3]
        else:
            anchor_y = anchor_bottoms[index]
        frames.append({"x": x, "y": y, "w": cell_width, "h": cell_height, "ax": cell_width // 2, "ay": anchor_y})
    return atlas, frames


def encode_png(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    return output.getvalue()


def decode_png(data: bytes, expected_mode: str) -> Image.Image:
    with Image.open(io.BytesIO(data)) as opened:
        opened.load()
        if opened.format != "PNG" or opened.mode != expected_mode:
            raise BuildError(f"Expected {expected_mode} PNG, found {opened.format} {opened.mode}")
        return opened.copy()


def load_source(path: Path) -> tuple[Image.Image, dict]:
    if not path.is_file():
        raise MissingSource(display_path(path))
    try:
        with Image.open(path) as opened:
            opened.load()
            info = {
                "format": opened.format,
                "size": list(opened.size),
                "mode": opened.mode,
            }
            image = opened.copy()
    except Exception as error:
        raise BuildError(f"Cannot decode {display_path(path)}: {error}") from error
    return image, info


def approved_child() -> SpriteAsset:
    for path in (CHILD_ORIGINAL, CHILD_ATLAS):
        if not path.is_file():
            raise MissingSource(display_path(path))
    raw = CHILD_ATLAS.read_bytes()
    atlas = decode_png(raw, "RGBA")
    if atlas.size != (144, 144):
        raise BuildError(f"Approved child atlas must be 144x144, found {atlas.size}")
    original, original_info = load_source(CHILD_ORIGINAL)
    original = original.convert("RGBA")
    if original.size != (1254, 1254):
        raise BuildError(f"Child original must be 1254x1254, found {original.size}")

    original_boxes = grid_boxes(original.size, 4, 4)
    frames = []
    frame_details = []
    visible_heights = []
    for index, output_box in enumerate(grid_boxes(atlas.size, 4, 4)):
        source_box = original_boxes[index]
        source_cell = original.crop(source_box)
        source_bbox, source_area = alpha_component_bbox(source_cell)
        anchor_y = math.floor(source_bbox[3] * 36 / source_cell.height)
        anchor_y = max(0, min(36, anchor_y))
        output_cell = atlas.crop(output_box)
        visible_bbox, visible_area = alpha_component_bbox(output_cell, threshold=1)
        visible_heights.append(visible_bbox[3] - visible_bbox[1])
        x, y, _, _ = output_box
        frame = {"x": x, "y": y, "w": 36, "h": 36, "ax": 18, "ay": anchor_y}
        frames.append(frame)
        frame_details.append({
            "index": index,
            "row": index // 4,
            "column": index % 4,
            "sourceCell": list(source_box),
            "sourceMainComponent": {"bbox": source_bbox, "area": source_area, "alphaThreshold": ALPHA_THRESHOLD},
            "outputFrame": frame,
            "outputVisibleComponent": {"bbox": visible_bbox, "area": visible_area},
        })

    sources = sorted([display_path(CHILD_ATLAS), display_path(CHILD_ORIGINAL)])
    rates = {"idle": 4, "run": 8, "attack": 8, "hit": 1, "death": 1, "victory": 1}
    for state in ("idleDown", "idleSide", "idleUp"):
        rates[state] = 4
    for state in ("runDown", "runSide", "runUp"):
        rates[state] = 8
    for state in ("attackDown", "attackSide", "attackUp"):
        rates[state] = 8
    for state in ("hitDown", "hitSide"):
        rates[state] = 1
    entry = {
        "image": "assets/library/units/child.png",
        "referenceHeight": 36,
        "targetHeight": 36,
        "rates": rates,
        "once": ["death"],
        "offsetY": 0,
        "sources": sources,
        "directional": True,
        "proceduralMotion": True,
        "portraitScale": round(64 / statistics.median(visible_heights), 6),
    }
    for state, indices in CHILD_STATES:
        entry[state] = [copy.deepcopy(frames[index]) for index in indices]
    for alias, source in (("idle", "idleDown"), ("run", "runDown"), ("attack", "attackDown"), ("hit", "hitDown")):
        entry[alias] = copy.deepcopy(entry[source])

    detail = {
        "kind": "unit",
        "image": entry["image"],
        "sources": {
            "approvedAtlas": display_path(CHILD_ATLAS),
            "originalForAnchors": display_path(CHILD_ORIGINAL),
        },
        "original": original_info,
        "dimensions": {"width": 144, "height": 144, "mode": "RGBA"},
        "frameGrid": {"rows": 4, "columns": 4, "cellWidth": 36, "cellHeight": 36},
        "palette": {
            "colors": UNIT_COLORS,
            "actualColors": visible_color_count(atlas),
            "shared": True,
            "dither": "none",
            "appliedByBuilder": False,
        },
        "transformations": [
            {"operation": "copy-approved-atlas", "resize": False, "paletteReduction": False},
            {
                "operation": "measure-original-main-alpha-component",
                "connectivity": 8,
                "alphaThreshold": ALPHA_THRESHOLD,
                "anchorX": 18,
                "anchorY": "floor(componentBottom * 36 / sourceCellHeight)",
            },
        ],
        "medianVisibleCharacterHeight": statistics.median(visible_heights),
        "frames": frame_details,
    }
    return SpriteAsset("child", atlas, entry, detail, raw)


def approved_wolf() -> SpriteAsset:
    for path in (WOLF_ATLAS, WOLF_METADATA):
        if not path.is_file():
            raise MissingSource(display_path(path))
    raw = WOLF_ATLAS.read_bytes()
    atlas = decode_png(raw, "RGBA")
    records = json.loads(WOLF_METADATA.read_text(encoding="utf-8"))
    if not isinstance(records, list) or len(records) != 12:
        raise BuildError("Approved wolf metadata must contain exactly 12 records")
    by_index = {}
    for record in records:
        missing = [field for field in ("index", "state", "source", *FRAME_FIELDS) if field not in record]
        if missing:
            raise BuildError(f"Wolf record is missing fields: {missing}")
        index = record["index"]
        if isinstance(index, bool) or not isinstance(index, int) or index in by_index:
            raise BuildError(f"Invalid or duplicate wolf frame index: {index}")
        for field in ("x", "y", "w", "h"):
            value = record[field]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0 or (field in ("w", "h") and value == 0):
                raise BuildError(f"Invalid wolf frame {index} field {field}: {value}")
        for field in ("ax", "ay"):
            if isinstance(record[field], bool) or not isinstance(record[field], (int, float)):
                raise BuildError(f"Invalid wolf frame {index} anchor {field}")
        if record["x"] + record["w"] > atlas.width or record["y"] + record["h"] > atlas.height:
            raise BuildError(f"Wolf frame {index} lies outside the atlas")
        by_index[index] = record
    if set(by_index) != set(range(12)):
        raise BuildError("Wolf frame indices must be exactly 0 through 11")

    frames = {index: {field: copy.deepcopy(record[field]) for field in FRAME_FIELDS} for index, record in by_index.items()}
    original_sources = sorted({display_path(EXTERNAL_ORIGINALS / record["source"]) for record in records})
    sources = sorted([display_path(WOLF_ATLAS), display_path(WOLF_METADATA), *original_sources])
    entry = {
        "image": "assets/library/units/wolf.png",
        "referenceHeight": 64,
        "targetHeight": 64,
        "rates": {"idle": 4, "sniff": 4, "run": 8, "pounce": 8, "attack": 8, "howl": 4, "hit": 1, "front": 1, "death": 1},
        "once": ["death"],
        "offsetY": 0,
        "sources": sources,
    }
    for state, indices in WOLF_STATES:
        entry[state] = [copy.deepcopy(frames[index]) for index in indices]
    detail = {
        "kind": "unit",
        "image": entry["image"],
        "sources": {
            "approvedAtlas": display_path(WOLF_ATLAS),
            "approvedFrameMetadata": display_path(WOLF_METADATA),
            "originals": original_sources,
        },
        "dimensions": {"width": atlas.width, "height": atlas.height, "mode": "RGBA"},
        "frameGrid": {"rows": 3, "framesPerRow": [4, 4, 4], "variableFrameWidths": True},
        "palette": {
            "colors": None,
            "actualColors": visible_color_count(atlas),
            "shared": True,
            "dither": "none",
            "appliedByBuilder": False,
        },
        "transformations": [{"operation": "copy-approved-atlas-and-frame-records", "resize": False, "paletteReduction": False}],
        "frames": copy.deepcopy(records),
    }
    return SpriteAsset("lost", atlas, entry, detail, raw)


def make_room(source: Path, asset_id: str, source_info: dict | None = None) -> RoomAsset:
    original, decoded_info = load_source(source)
    resized = original.convert("RGB").resize((480, 270), Image.Resampling.LANCZOS)
    room = reduce_palette(resized, ROOM_COLORS)
    if room.mode != "RGB":
        raise BuildError("Room conversion did not produce RGB")
    detail = {
        "kind": "room",
        "image": f"assets/library/rooms/{asset_id}.png",
        "sources": {"original": display_path(source)},
        "original": source_info or decoded_info,
        "dimensions": {"width": 480, "height": 270, "mode": "RGB"},
        "frameGrid": None,
        "palette": {
            "colors": ROOM_COLORS,
            "actualColors": visible_color_count(room),
            "shared": True,
            "dither": "none",
            "appliedByBuilder": True,
        },
        "transformations": [
            {"operation": "resize", "method": "LANCZOS", "from": list(original.size), "to": [480, 270]},
            {"operation": "palette", "colors": ROOM_COLORS, "dither": "none", "outputMode": "RGB"},
        ],
    }
    return RoomAsset(asset_id, room, detail)


def approved_review(value) -> bool:
    if value is True:
        return True
    if isinstance(value, dict):
        return approved_review(value.get("status"))
    if isinstance(value, str):
        normalized = value.strip().lower()
        return normalized.startswith(("approved", "accepted", "passed")) or normalized in {"approve", "accept", "pass", "ok"}
    return False


def future_source(asset_id: str, metadata_path: Path, metadata: dict) -> tuple[Path, Image.Image, dict]:
    original_path = metadata.get("originalPath")
    if not isinstance(original_path, str) or not original_path:
        raise MissingSource(f"{display_path(metadata_path)} has no originalPath")
    relative = Path(original_path)
    if relative.is_absolute():
        raise BuildError(f"{asset_id}: originalPath must be relative to the project root")
    source = (ROOT / relative).resolve()
    try:
        source.relative_to(ROOT)
    except ValueError as error:
        raise BuildError(f"{asset_id}: originalPath leaves the project root") from error
    original, info = load_source(source)
    expected_format = metadata.get("originalFormat")
    expected_size = metadata.get("originalSize")
    if expected_format and info["format"] != expected_format:
        raise BuildError(f"{asset_id}: decoder reports {info['format']}, metadata says {expected_format}")
    if expected_size and info["size"] != list(expected_size):
        raise BuildError(f"{asset_id}: decoded size {info['size']} differs from metadata {expected_size}")
    expected_hash = metadata.get("sha256")
    if expected_hash:
        actual_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
            raise BuildError(f"{asset_id}: source SHA-256 does not match metadata")
    info["metadata"] = display_path(metadata_path)
    info["visualReview"] = metadata.get("visualReview")
    return source, original, info


def future_unit(asset_id: str, source: Path, original: Image.Image, info: dict, rows: int, columns: int, source_grid: dict | None = None) -> SpriteAsset:
    source_grid = source_grid or {}
    source_rows = source_grid.get("rows", rows)
    source_columns = source_grid.get("columns", columns)
    if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in (source_rows, source_columns)):
        raise BuildError(f"{asset_id}: invalid source grid")
    frame_map = source_grid.get("frameMap", list(range(source_rows * source_columns)))
    if (
        not isinstance(frame_map, list)
        or len(frame_map) != rows * columns
        or len(set(frame_map)) != len(frame_map)
        or any(isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < source_rows * source_columns for index in frame_map)
    ):
        raise BuildError(f"{asset_id}: source frameMap must select each requested pose once")
    source_boxes = [grid_boxes(original.size, source_rows, source_columns)[index] for index in frame_map]
    if (rows, columns) == (2, 2):
        cell_size = (48, 48)
        states = [("idle", [0]), ("run", [1]), ("attack", [2]), ("hit", [3])]
        rates = {"idle": 4, "run": 8, "attack": 8, "hit": 1}
        once = []
    elif (rows, columns) == (2, 4):
        cell_size = (80, 80)
        states = [("idle", [0]), ("run", [1, 2]), ("attack", [3]), ("attack2", [4]), ("special", [5]), ("hit", [6]), ("death", [7])]
        rates = {"idle": 4, "run": 8, "attack": 8, "attack2": 8, "special": 6, "hit": 1, "death": 1}
        once = ["death"]
    else:
        raise BuildError(f"{asset_id}: unsupported future grid {rows}x{columns}; expected 2x2 or 4x2 sheet")

    atlas_cache_path = source.parent / "atlas-v4.png"
    record_cache_path = source.parent / "atlas-v4.json"
    source_digest = hashlib.sha256(source.read_bytes())
    source_digest.update(json.dumps(source_grid, sort_keys=True).encode("utf-8"))
    source_hash = source_digest.hexdigest()
    if atlas_cache_path.is_file() and record_cache_path.is_file():
        cached = json.loads(record_cache_path.read_text(encoding="utf-8"))
        if cached.get("sourceHash") == source_hash:
            raw = atlas_cache_path.read_bytes()
            atlas = decode_png(raw, "RGBA")
            return SpriteAsset(asset_id, atlas, cached["entry"], cached["detail"], raw)

    cutout_path = source.parent / "cutout-v3.png"
    cutout_metadata_path = source.parent / "cutout-v3.json"
    background = None
    if cutout_path.is_file() and cutout_metadata_path.is_file():
        source_image, _ = load_source(cutout_path)
        if source_image.mode != "RGBA" or source_image.size != original.size:
            raise BuildError(f"{asset_id}: cached cutout has invalid dimensions or mode")
        background = json.loads(cutout_metadata_path.read_text(encoding="utf-8"))
        if background.get("sourceHash") != source_hash:
            background = None
    if background is None:
        source_image, background = remove_edge_background(original, remove_white_holes=True)
        background["sourceHash"] = source_hash
        source_image.save(cutout_path, optimize=True)
        cutout_metadata_path.write_text(json.dumps(background, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cells = []
    anchor_bottoms = []
    frame_details = []
    for index, source_box in enumerate(source_boxes):
        source_cell = source_image.crop(source_box)
        cleaned, component = cleanup_alpha(source_cell)
        resized = premultiplied_alpha_resize(cleaned, cell_size)
        anchor_y = math.floor(component["bbox"][3] * cell_size[1] / source_cell.height)
        anchor_y = max(0, min(cell_size[1], anchor_y))
        cells.append(resized)
        anchor_bottoms.append(anchor_y)
        frame_details.append({
            "index": index,
            "row": index // columns,
            "column": index % columns,
            "sourceCell": list(source_box),
            "sourceMainComponent": component,
            "outputCellSize": list(cell_size),
            "anchorY": anchor_y,
        })
    atlas, frames = export_frame_atlas(cells, rows, columns, cell_size, anchor_bottoms)
    atlas = reduce_palette(atlas, UNIT_COLORS)
    for detail, frame in zip(frame_details, frames):
        detail["outputFrame"] = frame
    entry = {
        "image": f"assets/library/units/{asset_id}.png",
        "referenceHeight": cell_size[1],
        "targetHeight": cell_size[1],
        "rates": rates,
        "once": once,
        "offsetY": 0,
        "sources": [display_path(source)],
        "proceduralMotion": True,
    }
    for state, indices in states:
        entry[state] = [copy.deepcopy(frames[index]) for index in indices]
    detail = {
        "kind": "boss" if columns == 4 else "unit",
        "image": entry["image"],
        "sources": {"original": display_path(source), "metadata": info["metadata"]},
        "original": {key: value for key, value in info.items() if key != "metadata"},
        "dimensions": {"width": atlas.width, "height": atlas.height, "mode": "RGBA"},
        "frameGrid": {"rows": rows, "columns": columns, "cellWidth": cell_size[0], "cellHeight": cell_size[1]},
        "palette": {
            "colors": UNIT_COLORS,
            "actualColors": visible_color_count(atlas),
            "shared": True,
            "dither": "none",
            "appliedByBuilder": True,
        },
        "transformations": [
            background,
            {
                "operation": "alpha-cleanup",
                "alphaThreshold": ALPHA_THRESHOLD,
                "mainComponent": "largest 8-connected component",
                "smallComponentLimit": "max(4, mainArea // 1000)",
            },
            {"operation": "premultiplied-alpha-resize", "modeSequence": ["RGBA", "RGBa", "RGBA"], "method": "LANCZOS"},
            {"operation": "shared-palette", "colors": UNIT_COLORS, "dither": "none", "alphaPreserved": True},
        ],
        "frames": frame_details,
    }
    atlas.save(atlas_cache_path, optimize=True)
    record_cache_path.write_text(json.dumps({"sourceHash": source_hash, "entry": entry, "detail": detail}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return SpriteAsset(asset_id, atlas, entry, detail)


def composite_quartet(parts: dict[str, SpriteAsset]) -> SpriteAsset:
    part_names = ["donkey", "dog", "cat", "rooster"]
    cells = []
    for state in ("idle", "run", "attack", "hit"):
        cell = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
        for index, name in enumerate(part_names):
            part = parts[name]
            grid = part.detail.get("frameGrid") or {}
            if (grid.get("rows"), grid.get("columns"), grid.get("cellWidth"), grid.get("cellHeight")) != (2, 2, 48, 48):
                raise BuildError(f"bremenQuartet: {name} is not a processed 2x2, 48 px sprite")
            frame = part.entry[state][0]
            crop = part.image.crop((frame["x"], frame["y"], frame["x"] + frame["w"], frame["y"] + frame["h"]))
            if crop.size != (48, 48):
                raise BuildError(f"bremenQuartet: unexpected {name} frame size {crop.size}")
            cell.alpha_composite(crop, ((index % 2) * 48, (index // 2) * 48))
        cells.append(cell)
    atlas, frames = export_frame_atlas(cells, 2, 2, (96, 96))
    atlas = reduce_palette(atlas, UNIT_COLORS)
    sources = sorted({source for name in part_names for source in parts[name].entry["sources"]})
    entry = {
        "image": "assets/library/units/bremenQuartet.png",
        "referenceHeight": 96,
        "targetHeight": 80,
        "rates": {"idle": 4, "run": 8, "attack": 8, "hit": 1},
        "once": [],
        "offsetY": 0,
        "sources": sources,
        "proceduralMotion": True,
    }
    for state, index in (("idle", 0), ("run", 1), ("attack", 2), ("hit", 3)):
        entry[state] = [copy.deepcopy(frames[index])]
    detail = {
        "kind": "boss",
        "image": entry["image"],
        "sources": {"compositeParts": part_names, "originals": sources},
        "dimensions": {"width": atlas.width, "height": atlas.height, "mode": "RGBA"},
        "frameGrid": {"rows": 2, "columns": 2, "cellWidth": 96, "cellHeight": 96},
        "palette": {
            "colors": UNIT_COLORS,
            "actualColors": visible_color_count(atlas),
            "shared": True,
            "dither": "none",
            "appliedByBuilder": True,
        },
        "transformations": [
            {"operation": "compose", "parts": part_names, "layout": "2x2 parts inside each 96x96 state cell"},
            {"operation": "shared-palette", "colors": UNIT_COLORS, "dither": "none", "alphaPreserved": True},
        ],
        "frames": frames,
    }
    return SpriteAsset("bremenQuartet", atlas, entry, detail)


class Builder:
    def __init__(self) -> None:
        self.sprites: dict[str, SpriteAsset] = {}
        self.rooms: dict[str, RoomAsset] = {}
        self.outputs: dict[str, bytes] = {}
        self.aliases: dict[str, str] = {}
        self.skipped: list[dict] = []
        self.missing_aliases: list[str] = []

    def skip(self, asset_id: str, kind: str, reason: str) -> None:
        print(f"SKIP {kind} {asset_id}: {reason}")
        self.skipped.append({"id": asset_id, "kind": kind, "reason": reason})

    def add_sprite(self, asset: SpriteAsset) -> None:
        validate_id(asset.key)
        self.sprites[asset.key] = asset
        if not asset.alias:
            path = asset.entry["image"]
            self.outputs[path] = asset.png_bytes if asset.png_bytes is not None else encode_png(asset.image)
        print(f"READY sprite {asset.key}: {asset.entry['image']}")

    def add_room(self, asset: RoomAsset) -> None:
        validate_id(asset.key)
        self.rooms[asset.key] = asset
        self.outputs[asset.detail["image"]] = encode_png(asset.image)
        print(f"READY room {asset.key}: {asset.detail['image']}")

    def add_alias(self, alias: str, target: str) -> None:
        source = self.sprites.get(target)
        if source is None:
            self.missing_aliases.append(alias)
            self.skip(alias, "alias", f"required source sprite {target} is unavailable")
            return
        self.aliases[alias] = target
        if alias == target:
            print(f"READY direct asset {alias}")
            return
        entry = copy.deepcopy(source.entry)
        asset = SpriteAsset(alias, source.image, entry, {"aliasOf": target}, source.png_bytes, alias=True)
        self.sprites[alias] = asset
        print(f"READY alias {alias}: {target}")

    def load_requests(self) -> dict[str, dict]:
        if not REQUESTS_PATH.is_file():
            print(f"NO OPTIONAL REQUEST FILE: {display_path(REQUESTS_PATH)}")
            return {}
        data = json.loads(REQUESTS_PATH.read_text(encoding="utf-8"))
        requests = {}
        for request in data.get("assets", []):
            asset_id = request.get("id")
            if not isinstance(asset_id, str):
                raise BuildError("Every tools/library-generation.json request needs an id")
            validate_id(asset_id)
            requests[asset_id] = request
        return requests

    def build_future(self, requests: dict[str, dict]) -> None:
        metadata_ids = {path.parent.name for path in METADATA_ROOT.glob("*/metadata.json")} if METADATA_ROOT.is_dir() else set()
        for asset_id in sorted(set(requests) | metadata_ids):
            if asset_id in self.sprites or asset_id in self.rooms:
                continue
            metadata_path = METADATA_ROOT / asset_id / "metadata.json"
            if not metadata_path.is_file():
                if asset_id in requests:
                    self.skip(asset_id, "request", "metadata and original source are not available")
                continue
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                source, original, info = future_source(asset_id, metadata_path, metadata)
                if not approved_review(metadata.get("visualReview")):
                    raise MissingSource(f"visualReview is {metadata.get('visualReview')!r}, not approved")
                request = requests.get(asset_id, {})
                kind = metadata.get("kind", request.get("kind", "unit"))
                if kind == "icons":
                    continue
                if kind == "room":
                    room = make_room(source, asset_id, info)
                    room.detail["sources"]["metadata"] = display_path(metadata_path)
                    self.add_room(room)
                    continue
                rows = metadata.get("rows", request.get("rows"))
                columns = metadata.get("columns", request.get("columns"))
                if isinstance(rows, bool) or isinstance(columns, bool) or not isinstance(rows, int) or not isinstance(columns, int):
                    raise BuildError(f"{asset_id}: rows and columns must be integers")
                self.add_sprite(future_unit(asset_id, source, original, info, rows, columns, source_grid=metadata.get("sourceGrid")))
            except (MissingSource, BuildError, json.JSONDecodeError) as error:
                self.skip(asset_id, "request", str(error))

    def build_composite(self) -> None:
        part_names = ["donkey", "dog", "cat", "rooster"]
        present = {name: self.sprites[name] for name in part_names if name in self.sprites}
        if len(present) != len(part_names):
            missing = [name for name in part_names if name not in present]
            if present:
                self.skip("bremenQuartet", "composite", f"waiting for {', '.join(missing)}")
            return
        self.add_sprite(composite_quartet(present))

    def validate(self) -> None:
        image_sizes = {}
        for relative, data in sorted(self.outputs.items()):
            expected_mode = "RGB" if relative.startswith("assets/library/rooms/") else "RGBA"
            image = decode_png(data, expected_mode)
            image_sizes[relative] = image.size
        for key, sprite in self.sprites.items():
            entry = sprite.entry
            image_path = entry.get("image", "")
            if not image_path.startswith("assets/library/") or image_path not in image_sizes:
                raise BuildError(f"{key}: generated sprite must reference an assets/library PNG")
            width, height = image_sizes[image_path]
            for field in ("referenceHeight", "targetHeight", "rates", "once", "offsetY", "sources"):
                if field not in entry:
                    raise BuildError(f"{key}: missing manifest field {field}")
            for state, frames in entry.items():
                if not isinstance(frames, list) or state == "once" or not frames or not isinstance(frames[0], dict):
                    continue
                for frame in frames:
                    if any(field not in frame for field in FRAME_FIELDS):
                        raise BuildError(f"{key}/{state}: incomplete frame")
                    if frame["x"] < 0 or frame["y"] < 0 or frame["w"] <= 0 or frame["h"] <= 0:
                        raise BuildError(f"{key}/{state}: invalid frame rectangle")
                    if frame["x"] + frame["w"] > width or frame["y"] + frame["h"] > height:
                        raise BuildError(f"{key}/{state}: frame lies outside {image_path}")

    def require_all(self, requests: dict[str, dict]) -> None:
        missing = []
        for asset_id in sorted(set(requests) | {"child", "lost", "boss", "red-hood"}):
            if requests.get(asset_id, {}).get("kind") == "icons":
                continue
            if asset_id not in self.sprites and asset_id not in self.rooms:
                missing.append(f"request {asset_id}")
        for alias in ALIASES:
            if alias not in self.sprites:
                missing.append(f"alias {alias} -> {ALIASES[alias]}")
        if missing:
            raise BuildError("--require-all failed; missing valid generated assets:\n  " + "\n  ".join(missing))

    def write(self) -> None:
        self.validate()
        manifest = {
            "version": 1,
            "sprites": {key: self.sprites[key].detail for key in sorted(self.sprites) if not self.sprites[key].alias},
            "rooms": {key: self.rooms[key].detail for key in sorted(self.rooms)},
            "aliases": {key: self.aliases[key] for key in sorted(self.aliases)},
            "skipped": self.skipped,
            "validation": {"status": "passed", "unitPngMode": "RGBA", "roomPngMode": "RGB", "bureauPlaceholders": False},
        }
        sprite_manifest = {key: self.sprites[key].entry for key in sorted(self.sprites)}
        js_text = "export const GENERATED_SPRITES = " + json.dumps(sprite_manifest, ensure_ascii=False, indent=2, sort_keys=True) + ";\n"
        json_text = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        json.loads(js_text.removeprefix("export const GENERATED_SPRITES = ").removesuffix(";\n"))

        for relative in sorted(self.outputs):
            destination = (ROOT / relative).resolve()
            destination.relative_to(LIBRARY)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(self.outputs[relative])
            with Image.open(destination) as image:
                image.load()
                expected_mode = "RGB" if "/rooms/" in relative else "RGBA"
                if image.format != "PNG" or image.mode != expected_mode:
                    raise BuildError(f"Written PNG validation failed: {relative}")
                print(f"WROTE {relative}: {image.mode} {image.width}x{image.height}")
        JSON_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
        JSON_MANIFEST_PATH.write_text(json_text, encoding="utf-8")
        JS_MANIFEST_PATH.write_text(js_text, encoding="utf-8")
        print(f"WROTE {display_path(JSON_MANIFEST_PATH)}")
        print(f"WROTE {display_path(JS_MANIFEST_PATH)}: {len(sprite_manifest)} sprite keys")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build approved Grimm library sprite atlases and rooms.")
    parser.add_argument("--require-all", action="store_true", help="Fail instead of writing when any request or required alias is unavailable.")
    args = parser.parse_args()
    builder = Builder()
    for asset_id, approved_builder in (("child", approved_child), ("lost", approved_wolf)):
        try:
            builder.add_sprite(approved_builder())
        except MissingSource as error:
            builder.skip(asset_id, "approved source", str(error))
    try:
        builder.add_room(make_room(RED_HOOD_ROOM, "red-hood"))
    except MissingSource as error:
        builder.skip("red-hood", "approved room", str(error))
    builder.add_alias("boss", "lost")
    requests = builder.load_requests()
    builder.build_future(requests)
    builder.build_composite()
    for alias, target in ALIASES.items():
        builder.add_alias(alias, target)
    if args.require_all:
        builder.require_all(requests)
    builder.write()


if __name__ == "__main__":
    main()
