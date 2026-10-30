"""Phase 0-A：用字形位图匹配把 font-cxsecret 的假字符还原成真字。

原理：混淆只重排 cmap，字形轮廓不变。把假字符用混淆字体渲染出来，
再把候选汉字用同设计的参考字体渲染出来，逐像素比对取最相似者。

用法： python probes/match_glyphs.py <phase0-questions-*.json>
"""

import base64
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

SIZE = 80
GRID = 32
REF = Path("probes/artifacts/ref.otf")


def render(font_path: str, ch: str) -> np.ndarray | None:
    try:
        font = ImageFont.truetype(font_path, SIZE)
    except Exception:
        return None
    canvas = Image.new("L", (SIZE * 2, SIZE * 2), 0)
    draw = ImageDraw.Draw(canvas)
    try:
        draw.text((SIZE // 2, SIZE // 2), ch, fill=255, font=font)
    except Exception:
        return None
    box = canvas.getbbox()
    if not box:
        return None
    ink = canvas.crop(box).resize((GRID, GRID), Image.LANCZOS)
    arr = np.asarray(ink, dtype=np.float32) / 255.0
    if arr.max() < 0.05:
        return None
    return arr.reshape(-1)


def main() -> None:
    src = Path(sys.argv[1])
    data = json.loads(src.read_text(encoding="utf-8"))
    b64 = data["font"]["b64"]
    ttf = Path("probes/artifacts/cxsecret.ttf")
    ttf.write_bytes(base64.b64decode(b64))

    font = TTFont(str(ttf))
    cmap = font.getBestCmap()
    fakes = [chr(cp) for cp in sorted(cmap)]
    print(f"假字符 {len(fakes)} 个: {''.join(fakes)}")

    targets = {}
    for ch in fakes:
        vec = render(str(ttf), ch)
        if vec is not None:
            targets[ch] = vec
    print(f"成功渲染 {len(targets)} 个目标字形")

    print("\n构建候选字库（CJK 基本区）...")
    cands: list[str] = []
    feats: list[np.ndarray] = []
    for cp in range(0x4E00, 0xA000):
        ch = chr(cp)
        vec = render(str(REF), ch)
        if vec is not None:
            cands.append(ch)
            feats.append(vec)
    mat = np.stack(feats)
    print(f"候选 {len(cands)} 个，特征矩阵 {mat.shape}")

    mapping = {}
    print("\n--- 匹配结果 ---")
    for ch, vec in targets.items():
        d = ((mat - vec) ** 2).mean(axis=1)
        order = np.argsort(d)[:3]
        best = cands[order[0]]
        mapping[ch] = best
        trail = "  ".join(
            f"{cands[i]}({d[i]:.4f})" for i in order
        )
        flag = "" if d[order[0]] < 0.02 else "  ⚠ 低置信"
        print(f"  {ch} -> {best}   {trail}{flag}")

    print("\n--- 解码后的题干 ---")
    for q in data.get("questions", []):
        raw = q.get("stemRaw") or ""
        decoded = "".join(mapping.get(c, c) for c in raw)
        print(f"  Q{q['idx']+1} {decoded}")

    out = Path("probes/artifacts/glyph-map.json")
    out.write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n映射表已保存：{out}")


if __name__ == "__main__":
    main()
