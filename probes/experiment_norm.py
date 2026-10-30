"""对比几种归一化方式对形近字的区分度，重点看 岨→略。"""

import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

SIZE = 80
REF = "probes/artifacts/ref.otf"


def gb2312():
    out = []
    for b1 in range(0xB0, 0xF8):
        for b2 in range(0xA1, 0xFF):
            try:
                out.append(bytes([b1, b2]).decode("gb2312"))
            except Exception:
                pass
    return out


def ink(ch, path):
    font = ImageFont.truetype(path, SIZE)
    canvas = Image.new("L", (SIZE * 2, SIZE * 2), 0)
    ImageDraw.Draw(canvas).text((SIZE // 2, SIZE // 2), ch, fill=255, font=font)
    box = canvas.getbbox()
    if not box:
        return None
    return canvas.crop(box)


def vec_stretch(ch, path, grid):
    c = ink(ch, path)
    if c is None:
        return None
    a = np.asarray(c.resize((grid, grid), Image.LANCZOS), dtype=np.float32) / 255.0
    return a.reshape(-1)


def vec_contain(ch, path, grid):
    c = ink(ch, path)
    if c is None:
        return None
    w, h = c.size
    side = max(w, h)
    sq = Image.new("L", (side, side), 0)
    sq.paste(c, ((side - w) // 2, (side - h) // 2))
    a = np.asarray(sq.resize((grid, grid), Image.LANCZOS), dtype=np.float32) / 255.0
    return a.reshape(-1)


def run(mode, grid, targets, cands, fn):
    mat = []
    keep = []
    for ch in cands:
        v = fn(ch, REF, grid)
        if v is not None:
            keep.append(ch)
            mat.append(v)
    mat = np.stack(mat)
    print(f"\n=== {mode} grid={grid} 候选={len(keep)} ===")
    bad = 0
    for ch in targets:
        v = fn(ch, "probes/artifacts/cxsecret.ttf", grid)
        d = ((mat - v) ** 2).mean(axis=1)
        order = np.argsort(d)[:3]
        top = keep[order[0]]
        margin = d[order[1]] - d[order[0]] if len(order) > 1 else 1
        flag = ""
        if ch == "岨":
            print(f"  岨 -> {top} d={d[order[0]]:.4f} margin={margin:.4f}")
            print("     " + "  ".join(f"{keep[i]}({d[i]:.4f})" for i in order))
        if d[order[0]] > 0.03:
            bad += 1
        if ch == "岨" and top != "略":
            print("   ⚠ 首选不是略")
    print(f"  距离>0.03 的字符数: {bad}")


def main():
    data = json.loads(
        Path("C:/Users/jeffery/Downloads/phase0-questions-1793256393186.json").read_text(
            encoding="utf-8"
        )
    )
    Path("probes/artifacts/cxsecret.ttf").write_bytes(
        base64.b64decode(data["font"]["b64"])
    )
    font = TTFont("probes/artifacts/cxsecret.ttf")
    targets = [chr(cp) for cp in sorted(font.getBestCmap())]
    cands = gb2312()
    for mode, fn in (("stretch", vec_stretch), ("contain", vec_contain)):
        for grid in (32, 48):
            run(mode, grid, targets, cands, fn)


if __name__ == "__main__":
    main()
