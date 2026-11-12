from pathlib import Path
import argparse
from datetime import datetime, timezone
import json

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".cache" / "library-generation"
OUT = ROOT / ".test-output" / "library" / "review"


def main():
    parser = argparse.ArgumentParser(description="Review generated library originals and record visual acceptance or rejection.")
    parser.add_argument("ids", nargs="*", help="Asset ids to review; all downloaded originals by default")
    parser.add_argument("--accept", action="store_true", help="Mark the reviewed originals as visually accepted")
    parser.add_argument("--reject", metavar="REASON", help="Mark the reviewed originals as rejected with a reason")
    args = parser.parse_args()
    if args.accept and args.reject:
        parser.error("Choose only one of --accept or --reject")
    OUT.mkdir(parents=True, exist_ok=True)
    paths = [SOURCE / identifier / "metadata.json" for identifier in args.ids] if args.ids else sorted(SOURCE.glob("*/metadata.json"))
    if not paths:
        print("NO_GENERATED_ORIGINALS")
        return
    font_path = ROOT / "assets" / "fonts" / "PressStart2P-Regular.ttf"
    font = ImageFont.truetype(str(font_path), 10) if font_path.exists() else ImageFont.load_default()
    for path in paths:
        identifier = path.parent.name
        metadata = json.loads(path.read_text(encoding="utf-8"))
        original = ROOT / metadata["originalPath"]
        with Image.open(original) as source:
            source.load()
            image = source.convert("RGBA")
            original_size = list(image.size)
            image.thumbnail((370, 330), Image.Resampling.LANCZOS)
        sheet = Image.new("RGB", (400, 400), "#d8d2c2")
        draw = ImageDraw.Draw(sheet)
        for y in range(0, 340, 10):
            for x in range(0, 400, 10):
                if (x // 10 + y // 10) % 2 == 0:
                    draw.rectangle((x, y, x + 9, y + 9), fill="#b4b0a5")
        sheet.paste(image, ((400 - image.width) // 2, (340 - image.height) // 2), image)
        draw.rectangle((0, 340, 399, 399), fill="#17171f")
        draw.text((12, 352), identifier, font=font, fill="#e8c77c")
        draw.text((12, 375), f"{metadata['originalFormat']} {original_size[0]}x{original_size[1]}", font=font, fill="#bdbbc7")
        review_path = OUT / f"{identifier}.png"
        sheet.save(review_path)
        if args.accept:
            metadata["visualReview"] = "accepted"
            metadata.pop("rejectionReason", None)
        elif args.reject:
            metadata["visualReview"] = "rejected"
            metadata["rejectionReason"] = args.reject
        if args.accept or args.reject:
            metadata["visualReviewedAt"] = datetime.now(timezone.utc).isoformat()
            metadata["reviewer"] = "Kimi visual inspection"
            path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"REVIEW={review_path} STATUS={metadata.get('visualReview')}")


if __name__ == "__main__":
    main()
