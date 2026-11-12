from pathlib import Path
import hashlib
import json
import re
import sys

from PIL import Image

from image_background import remove_edge_background

ROOT = Path(__file__).resolve().parents[1]
REQUESTS = ROOT / "tools" / "library-generation.json"
OUTPUT = ROOT / "assets" / "library" / "icons"
REQUIRE_ALL = "--require-all" in sys.argv
OUTPUT.mkdir(parents=True, exist_ok=True)


def build_icons():
    requests = json.loads(REQUESTS.read_text(encoding="utf-8"))["assets"]
    expected_slots = [slot for asset in requests if asset.get("kind") == "icons" for slot in asset["slots"]]
    if len(set(expected_slots)) != len(expected_slots):
        raise ValueError("Icon ids must be unique across all sheets")
    manifest = {}
    for asset in requests:
        if asset.get("kind") != "icons":
            continue
        identifier = asset["id"]
        metadata_path = ROOT / ".cache" / "library-generation" / identifier / "metadata.json"
        if not metadata_path.exists():
            if REQUIRE_ALL:
                raise FileNotFoundError(f"Missing icon sheet: {identifier}")
            print(f"SKIP={identifier}: no source metadata")
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("visualReview") != "accepted":
            if REQUIRE_ALL:
                raise ValueError(f"Icon sheet is not visually accepted: {identifier}")
            print(f"SKIP={identifier}: visual review is not accepted")
            continue
        source_path = ROOT / metadata["originalPath"]
        with Image.open(source_path) as source:
            source.load()
            if source.format != metadata["originalFormat"] or list(source.size) != metadata["originalSize"]:
                raise ValueError(f"Decoded source differs from metadata: {identifier}")
            if hashlib.sha256(source_path.read_bytes()).hexdigest() != metadata["sha256"]:
                raise ValueError(f"Source hash differs from accepted original: {identifier}")
            image, background = remove_edge_background(source)
            width, height = image.size
            columns = metadata["columns"]
            rows = metadata["rows"]
            slots = metadata["slots"]
            if len(slots) != rows * columns:
                raise ValueError(f"Expected {rows * columns} icon slots in {identifier}, got {len(slots)}")
            for index, slot in enumerate(slots):
                if not re.fullmatch(r"[a-z0-9-]+", slot):
                    raise ValueError(f"Unsafe icon id: {slot}")
                cx, cy = index % columns, index // columns
                left, top = round(cx * width / columns), round(cy * height / rows)
                right, bottom = round((cx + 1) * width / columns), round((cy + 1) * height / rows)
                margin_x = max(1, round((right - left) * 0.03))
                margin_y = max(1, round((bottom - top) * 0.03))
                cell = image.crop((left + margin_x, top + margin_y, right - margin_x, bottom - margin_y))
                cell, cell_background = remove_edge_background(cell)
                background = {"sheet": background, "cell": cell_background}
                cell.putalpha(cell.getchannel("A").point(lambda alpha: 255 if alpha >= 96 else 0))
                cell = cell.convert("RGBa").resize((32, 32), Image.Resampling.LANCZOS).convert("RGBA")
                alpha = cell.getchannel("A").point(lambda value: 0 if value < 8 else value)
                cell = cell.convert("RGB").quantize(colors=32, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
                cell.putalpha(alpha)
                minimum_alpha, maximum_alpha = cell.getchannel("A").getextrema()
                if minimum_alpha != 0 or maximum_alpha <= 0:
                    raise ValueError(f"Invalid alpha in icon: {identifier}/{slot}; extrema={minimum_alpha, maximum_alpha}")
                path = OUTPUT / f"{slot}.png"
                cell.save(path, optimize=True)
                manifest[slot] = {
                    "source": metadata["originalPath"],
                    "sourceFormat": metadata["originalFormat"],
                    "sheet": identifier,
                    "cell": index,
                    "size": [32, 32],
                    "palette": 32,
                    "processing": "3% edge trim, edge-connected background removal, premultiplied-alpha resize, alpha below 8 cleared, no dithering",
                    "background": background,
                }
                print(f"ICON={slot}")
    if REQUIRE_ALL:
        missing = [slot for slot in expected_slots if slot not in manifest]
        extra = [slot for slot in manifest if slot not in expected_slots]
        if missing or extra:
            raise ValueError(f"Icon manifest mismatch: missing={missing}, extra={extra}")
    (ROOT / "assets" / "library" / "icons-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Built {len(manifest)} icons")


if __name__ == "__main__":
    build_icons()
