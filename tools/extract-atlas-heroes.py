from pathlib import Path
import argparse
import json
import zipfile

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HEROES = {
    "archivist": 557736,
    "student": 449462,
    "witch": 438176,
    "scout": 446450,
}


def main():
    parser = argparse.ArgumentParser(description="Extract the four selected static hero sprites from Pixel Art Atlas.")
    parser.add_argument("--atlas-root", type=Path, default=Path(r"C:/Projects/YandexGames/pixel-art-atlas-1.4m"))
    parser.add_argument("--output", type=Path, default=ROOT / "assets" / "packs" / "pixel-art-atlas")
    args = parser.parse_args()
    archive_path = args.atlas_root / "pixel-art-16x16-1.4m.zip"
    args.output.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(archive_path) as archive:
        captions = json.loads(archive.read("captions.json"))
        palette = np.load(archive.open("palette.npy"), allow_pickle=False)
        tokens = np.load(archive.open("tokens.npy"), allow_pickle=False)
        sources = {
            "dataset": "https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m",
            "generator": "Krea 2 Turbo + pixel art LoRA",
            "sourceType": "Static AI-generated sprites; no verified animation set",
            "heroes": {},
        }
        for key, index in HEROES.items():
            pixels = tokens[index].reshape(16, 16)
            rgba = np.dstack((palette[pixels], (pixels != 0).astype("uint8") * 255))
            image = Image.fromarray(rgba)
            image.save(args.output / f"{key}.png", optimize=True)
            sources["heroes"][key] = {
                "id": index,
                "caption": captions[index],
                "file": f"{key}.png",
                "size": [16, 16],
            }
            print(f"{key}: ID {index} — {captions[index]}")

    (args.output / "sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output / "LICENSE.txt").write_text((args.atlas_root / "LICENSE").read_text(encoding="utf-8"), encoding="utf-8")


if __name__ == "__main__":
    main()
