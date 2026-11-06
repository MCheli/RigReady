"""Make the website's screenshots from the scenario screenshots.

    python site/tools/screens.py            (from the repository root; needs Pillow)

Writes two sets:
- site/img/screens/<name>.webp for the pages, from site/screens.json (output name -> screenshot).
- site/img/guide/<folder>--<file>.webp for every screenshot docs/USER-GUIDE.md shows, with
  site/img/guide/index.json (the guide's image path -> file, width, height) for the build.

Run it when those scenario screenshots or the guide's pictures change, look at the results, and
commit them. A guide picture without a tidied copy still appears on the site, as the raw capture.

App window captures (1264 x 821) are tidied:
- the test-only parts of the header are painted over: the amber "Scenario: ..." banner and the
  dev version to the right of it. The logo, Play/Configure and the search field stay.
- the page scrollbar strip on the right edge is cut off.
Anything else (the shared rig picture, a kneeboard page) is only resized to at most 1600 px wide.
"""

import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SCREENS = ROOT / "site" / "img" / "screens"
GUIDE = ROOT / "site" / "img" / "guide"
GUIDE_MD = ROOT / "docs" / "USER-GUIDE.md"

WINDOW = (1264, 821)
HEADER_ROWS = 45  # the header's content; the ruler below it stays
SCROLLBAR = 14


def is_amber(px):
    # Also when a dialog's scrim darkens the header (the command palette).
    r, g, b = px[:3]
    return r > 50 and r - b >= 0.35 * r and r >= g > b


def tidy_window(im, name):
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
        print(f"  {name}: no scenario banner found; header left as it is")
    else:
        im.paste(header_bg, (left - 6, 0, WINDOW[0], HEADER_ROWS))
    return im.crop((0, 0, WINDOW[0] - SCROLLBAR, WINDOW[1]))


def make(source, target):
    im = Image.open(source)
    if im.size == WINDOW:
        im = tidy_window(im, source.name)
    elif im.width > 1600:
        im = im.convert("RGB").resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    else:
        im = im.convert("RGB")
    target.parent.mkdir(parents=True, exist_ok=True)
    im.save(target, "WEBP", quality=92, method=6)
    print(f"{target.relative_to(ROOT)}  {im.width}x{im.height}  {target.stat().st_size // 1024} KB")
    return im.size


def main():
    for name, source in json.loads((ROOT / "site" / "screens.json").read_text()).items():
        make(ROOT / source, SCREENS / f"{name}.webp")

    index = {}
    for ref in re.findall(r"!\[[^\]]*\]\(([^)\s]+)\)", GUIDE_MD.read_text()):
        source = (GUIDE_MD.parent / ref).resolve()
        rel = source.relative_to(ROOT / "artifacts" / "screens")
        file = f"{'--'.join(rel.with_suffix('').parts)}.webp"
        width, height = make(source, GUIDE / file)
        index[ref] = {"file": file, "width": width, "height": height}
    (GUIDE / "index.json").write_text(json.dumps(index, indent=2) + "\n")


if __name__ == "__main__":
    sys.exit(main())
