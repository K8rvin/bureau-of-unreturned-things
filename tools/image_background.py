from collections import deque

import numpy as np
from PIL import Image


def remove_edge_background(image: Image.Image, remove_white_holes: bool = False) -> tuple[Image.Image, dict]:
    rgba = np.array(image.convert("RGBA"))
    alpha = rgba[:, :, 3]
    if alpha.min() < 250:
        return Image.fromarray(rgba, "RGBA"), {"operation": "preserve-source-alpha"}

    rgb = rgba[:, :, :3].astype(np.float32)
    height, width = alpha.shape
    border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]))
    background = np.median(border, axis=0)
    distance = np.linalg.norm(rgb - background, axis=2)
    candidate = (distance < 100) & (rgb.min(axis=2) > 165)
    background_map = np.broadcast_to(background, rgb.shape).copy()
    chroma = np.ptp(rgb, axis=2)
    luminance = rgb.mean(axis=2)
    border_luminance = border.mean(axis=1)
    border_chroma = np.ptp(border, axis=1)
    dark_luminance, light_luminance = np.percentile(border_luminance, [10, 90])
    checker_split = (dark_luminance + light_luminance) / 2
    checkerboard = (
        np.mean(border_chroma < 18) > 0.95
        and dark_luminance > 100
        and light_luminance > 165
        and light_luminance - dark_luminance > 18
        and np.mean(border_luminance < checker_split) > 0.25
        and np.mean(border_luminance > checker_split) > 0.25
    )
    palette = None
    if checkerboard:
        dark_color = np.median(border[border_luminance < checker_split], axis=0)
        light_color = np.median(border[border_luminance > checker_split], axis=0)
        palette = np.array([dark_color, light_color])
        nearest = np.linalg.norm(rgb[:, :, None, :] - palette[None, None, :, :], axis=3).argmin(axis=2)
        background_map = palette[nearest]
        distance = np.linalg.norm(rgb - background_map, axis=2)
        candidate = (distance < 100) & ((rgb.min(axis=2) > 165) | ((chroma < 18) & (luminance > 110)))
    outside = np.zeros((height, width), dtype=bool)
    queue = deque()
    step_x = max(1, width // (512 if checkerboard else 128))
    step_y = max(1, height // (512 if checkerboard else 128))
    seeds = {(x, 0) for x in range(0, width, step_x)}
    seeds.update((x, height - 1) for x in range(0, width, step_x))
    seeds.update((0, y) for y in range(0, height, step_y))
    seeds.update((width - 1, y) for y in range(0, height, step_y))
    for x, y in seeds:
        if candidate[y, x] and not outside[y, x]:
            outside[y, x] = True
            queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= next_y < height and 0 <= next_x < width and candidate[next_y, next_x] and not outside[next_y, next_x]:
                outside[next_y, next_x] = True
                queue.append((next_y, next_x))

    removed_white_holes = 0
    if remove_white_holes:
        possible_holes = (distance < 5) & ~outside
        visited = outside.copy()
        for y, x in zip(*np.nonzero(possible_holes)):
            if visited[y, x]:
                continue
            pixels = []
            queue = deque([(int(y), int(x))])
            visited[y, x] = True
            while queue:
                current_y, current_x = queue.popleft()
                pixels.append((current_y, current_x))
                for next_y, next_x in ((current_y - 1, current_x), (current_y + 1, current_x), (current_y, current_x - 1), (current_y, current_x + 1)):
                    if 0 <= next_y < height and 0 <= next_x < width and possible_holes[next_y, next_x] and not visited[next_y, next_x]:
                        visited[next_y, next_x] = True
                        queue.append((next_y, next_x))
            if len(pixels) >= 512:
                removed_white_holes += 1
                for pixel_y, pixel_x in pixels:
                    outside[pixel_y, pixel_x] = True

    opacity = np.clip((distance - 12) / 68, 0, 1)
    opacity[~outside] = 1
    if checkerboard:
        opacity[outside & (chroma < 18) & (luminance > 110)] = 0
    for channel in range(3):
        original = rgb[:, :, channel]
        restored = background_map[:, :, channel] + (original - background_map[:, :, channel]) / np.maximum(opacity, 0.04)
        rgb[:, :, channel] = np.where((opacity > 0) & (opacity < 1), restored, original)
    rgba[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = np.rint(opacity * 255).astype(np.uint8)
    rgba[rgba[:, :, 3] == 0, :3] = 0
    return Image.fromarray(rgba, "RGBA"), {
        "version": 3,
        "operation": "edge-connected-background-removal",
        "connectivity": 4,
        "backgroundType": "neutral-checkerboard" if checkerboard else "light",
        "backgroundRGB": [round(float(value), 2) for value in background],
        "backgroundPalette": None if palette is None else palette.round(2).tolist(),
        "neutralChromaBelow": 18 if checkerboard else None,
        "candidateDistanceBelow": 100,
        "softAlphaDistanceRange": [12, 80],
        "removedPixels": int((rgba[:, :, 3] == 0).sum()),
        "whiteInteriorsPreserved": True,
        "largeWhiteHolesRemoved": removed_white_holes,
    }
