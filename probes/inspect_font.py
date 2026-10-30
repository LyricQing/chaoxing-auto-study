"""Phase 0-A 第一步：把探针导出的字体摊开看结构。

用法： python probes/inspect_font.py <phase0-questions-*.json>
"""

import base64
import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont


def main() -> None:
    src = Path(sys.argv[1])
    data = json.loads(src.read_text(encoding="utf-8"))
    font_info = data.get("font") or {}
    b64 = font_info.get("b64")
    if not b64:
        print("JSON 里没有 font.b64")
        return

    raw = base64.b64decode(b64)
    out = Path("probes/artifacts")
    out.mkdir(parents=True, exist_ok=True)
    ttf_path = out / "cxsecret.ttf"
    ttf_path.write_bytes(raw)
    print(f"字体已落盘：{ttf_path}  字节数={len(raw)}")

    font = TTFont(ttf_path)
    print("tables:", " ".join(sorted(font.keys())))
    print("unitsPerEm:", font["head"].unitsPerEm)
    print("numGlyphs:", font["maxp"].numGlyphs)

    if "name" in font:
        print("\n--- name table ---")
        for rec in font["name"].names:
            try:
                val = rec.toUnicode()
            except Exception:
                continue
            if val.strip():
                print(f"  id={rec.nameID:<3} {val[:80]}")

    print("\n--- post table ---")
    post = font.get("post")
    if post is not None:
        print("  format:", post.formatType)
        names = getattr(post, "glyphOrder", None)
        if names:
            print("  glyph names:", names[:20])

    print("\n--- cmap ---")
    best = font.getBestCmap()
    print("  entries:", len(best))
    items = list(best.items())
    for cp, name in items[:30]:
        ch = chr(cp)
        print(f"  U+{cp:04X} {ch!r} -> {name}")
    print("  ...")
    for cp, name in items[-10:]:
        ch = chr(cp)
        print(f"  U+{cp:04X} {ch!r} -> {name}")

    print("\n--- 题干原文（混淆态） ---")
    for q in data.get("questions", []):
        print(f"  Q{q['idx']+1} [{q.get('typeLabel')}] {q.get('stemRaw')}")


if __name__ == "__main__":
    main()
