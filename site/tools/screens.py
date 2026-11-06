"""Make the website's screenshots from the scenario screenshots.

    python site/tools/screens.py            (from the repository root; needs Pillow)

Reads site/screens.json (output name -> scenario screenshot) and writes site/img/screens/<name>.webp.
Run it when the scenario screenshots it uses have changed, look at the results, and commit them.

App window captures (1264 x 821) are tidied for the website:
- the test-only parts of the header are painted over: the amber "Scenario: ..." banner and the
  dev version to the right of it. The logo, Play/Configure and the search field stay.
- the page scrollbar strip on the right edge is cut off.
Anything else (the shared rig picture) is only resized to at most 1600 px wide.
"""

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "img" / "screens"

WINDOW = (1264, 821)
HEADER_ROWS = 45  # the header's content; the ruler below it stays
SCROLLBAR = 14


def is_amber(px):
    # Also when a dialog's scrim darkens the header (the command palette).
    r, g, b = px[:3]
    return r > 50 and r - b >= 0.35 * r and r >= g > b


def tidy_window(im):
    im = im.convert("RGB")
    header_bg = im.getpixel((4, 4))  # --rr-surface, or darker under a dialog's scrim
    # The scenario banner's left border is the first column of the header that is amber from
    # top to bottom. (ClearType leaves amber-ish fringes on text too, but only a few pixels high.)
    left = None
    for x in range(330, WINDOW[0] - SCROLLBAR):
        if sum(is_amber(im.getpixel((x, y))) for y in range(12, 44)) >= 14:
            left = x
            break
    if left is None:
        raise SystemExit("no scenario banner found; is this a window capture?")
    im.paste(header_bg, (left - 6, 0, WINDOW[0], HEADER_ROWS))
    return im.crop((0, 0, WINDOW[0] - SCROLLBAR, WINDOW[1]))


def main():
    screens = json.loads((ROOT / "site" / "screens.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    for name, source in screens.items():
        im = Image.open(ROOT / source)
        if im.size == WINDOW:
            im = tidy_window(im)
        elif im.width > 1600:
            im = im.convert("RGB").resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
        target = OUT / f"{name}.webp"
        im.save(target, "WEBP", quality=92, method=6)
        print(f"{target.relative_to(ROOT)}  {im.width}x{im.height}  {target.stat().st_size // 1024} KB")


if __name__ == "__main__":
    sys.exit(main())
