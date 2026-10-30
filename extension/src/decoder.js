/* 字形解码：把 font-cxsecret 的假字符还原成真字。
 * 原理：混淆只重排 cmap，字形轮廓不变。用页面字体渲染假字，
 * 用参考字体渲染候选汉字，逐像素比对取最近邻。两侧渲染路径一致，
 * 因此不受渲染器差异影响。
 */
(() => {
  const CSX = (window.CSX = window.CSX || {});
  CSX.VERSION = "1.0.2";

  const GRID = 32;
  const PX = 64;
  const CANVAS = PX * 1.5;

  function u16(d, o) {
    return (d[o] << 8) | d[o + 1];
  }
  function u32(d, o) {
    return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* 一页可能有多个 @font-face（题干一个子集、选项另一个子集），
     只取第一个会漏掉选项里的假字——表现为选项显示成「岕空炮弹」。 */
  CSX.fontBytesList = function (doc) {
    const style = doc.querySelector("#cxSecretStyle");
    if (!style) return [];
    const txt = style.textContent || "";
    const out = [];
    const re = /base64,([A-Za-z0-9+/=\s]+)/g;
    let m;
    while ((m = re.exec(txt))) {
      try {
        out.push(b64ToBytes(m[1]));
      } catch (e) {}
    }
    return out;
  };

  CSX.fontBytesFromDoc = function (doc) {
    const list = CSX.fontBytesList(doc);
    return list.length ? list[0] : null;
  };

  /* ---------- 候选表缓存：避免每次加载都重算 6763 个字 ---------- */
  const IDB_NAME = "csx";
  const IDB_STORE = "tables";

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  CSX.loadTable = async function (key) {
    try {
      const db = await idb();
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const rq = tx.objectStore(IDB_STORE).get(key);
        rq.onsuccess = () => {
          const v = rq.result;
          if (!v) return resolve(null);
          resolve({
            chars: v.chars.split(""),
            vecs: new Uint8Array(v.vecs),
            count: v.count,
          });
        };
        rq.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  };

  CSX.saveTable = async function (key, table) {
    try {
      const db = await idb();
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(
          {
            chars: table.chars.join(""),
            vecs: table.vecs.buffer.slice(0),
            count: table.count,
          },
          key
        );
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch (e) {}
  };

  /* 只解析 cmap，目的是拿到「这个字体覆盖了哪些假字符」 */
  CSX.parseCmap = function (buf) {
    try {
      const d = new Uint8Array(buf);
      const numTables = u16(d, 4);
      let cmapOff = 0;
      for (let i = 0; i < numTables; i++) {
        const o = 12 + i * 16;
        const tag = String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
        if (tag === "cmap") {
          cmapOff = u32(d, o + 8);
          break;
        }
      }
      if (!cmapOff) return null;

      const n = u16(d, cmapOff + 2);
      let best = 0;
      let bestScore = -1;
      for (let i = 0; i < n; i++) {
        const o = cmapOff + 4 + i * 8;
        const pid = u16(d, o);
        const eid = u16(d, o + 2);
        const off = u32(d, o + 4);
        const sub = cmapOff + off;
        if (sub + 2 > d.length) continue;
        const fmt = u16(d, sub);
        let score = 0;
        if (pid === 3 && eid === 10 && fmt === 12) score = 4;
        else if (pid === 0 && fmt === 12) score = 3;
        else if (pid === 3 && eid === 1 && fmt === 4) score = 2;
        else if (pid === 0 && fmt === 4) score = 1;
        if (score > bestScore) {
          bestScore = score;
          best = sub;
        }
      }
      if (!best) return null;

      const fmt = u16(d, best);
      const map = new Map();
      if (fmt === 4) {
        const segX2 = u16(d, best + 6);
        const endO = best + 14;
        const startO = endO + segX2 + 2;
        const deltaO = startO + segX2;
        const rangeO = deltaO + segX2;
        for (let s = 0; s < segX2 / 2; s++) {
          const end = u16(d, endO + s * 2);
          const start = u16(d, startO + s * 2);
          const delta = u16(d, deltaO + s * 2);
          const rangeOff = u16(d, rangeO + s * 2);
          if (start === 0xffff) continue;
          for (let c = start; c <= end && c < 0xffff; c++) {
            let gid;
            if (rangeOff === 0) {
              gid = (c + delta) & 0xffff;
            } else {
              const gi = rangeO + s * 2 + rangeOff + (c - start) * 2;
              if (gi + 1 >= d.length) continue;
              gid = u16(d, gi);
              if (gid !== 0) gid = (gid + delta) & 0xffff;
            }
            if (gid) map.set(c, gid);
          }
        }
      } else if (fmt === 12) {
        const nGroups = u32(d, best + 12);
        for (let g = 0; g < nGroups; g++) {
          const o = best + 16 + g * 12;
          const sc = u32(d, o);
          const ec = u32(d, o + 4);
          const sg = u32(d, o + 8);
          for (let c = sc; c <= ec && c - sc < 70000; c++) map.set(c, sg + (c - sc));
        }
      }
      return map;
    } catch (e) {
      console.warn("[CSX] parseCmap failed", e);
      return null;
    }
  };

  function makeCtx(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    return { c, ctx };
  }

  function renderVec(ch, family, grid, px) {
    grid = grid || GRID;
    px = px || PX;
    const side = Math.round(px * 1.5);
    const { c, ctx } = makeCtx(side);
    ctx.clearRect(0, 0, side, side);
    ctx.fillStyle = "#000";
    ctx.textBaseline = "top";
    ctx.font = `${px}px ${family}`;
    ctx.fillText(ch, 4, 4);

    const { data, width, height } = ctx.getImageData(0, 0, side, side);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[row + x * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;

    const out = makeCtx(grid);
    out.ctx.imageSmoothingEnabled = true;
    out.ctx.imageSmoothingQuality = "high";
    out.ctx.drawImage(
      c,
      minX,
      minY,
      maxX - minX + 1,
      maxY - minY + 1,
      0,
      0,
      grid,
      grid
    );
    const od = out.ctx.getImageData(0, 0, grid, grid).data;
    const vec = new Uint8Array(grid * grid);
    for (let i = 0; i < vec.length; i++) vec[i] = od[i * 4 + 3];
    return vec;
  }

  /* GB2312 全集，约 6763 字，覆盖常用汉字 */
  function gb2312Chars() {
    let dec;
    try {
      dec = new TextDecoder("gb2312");
    } catch (e) {
      return [];
    }
    const chars = [];
    for (let b1 = 0xb0; b1 < 0xf8; b1++) {
      for (let b2 = 0xa1; b2 < 0xff; b2++) {
        let s = "";
        try {
          s = dec.decode(new Uint8Array([b1, b2]));
        } catch (e) {
          continue;
        }
        if (s && s.length === 1 && s !== "\ufffd") chars.push(s);
      }
    }
    return chars;
  }

  CSX.buildCandidates = async function (family, onProgress) {
    const chars = gb2312Chars();
    const vecs = new Uint8Array(chars.length * GRID * GRID);
    let n = 0;
    for (let i = 0; i < chars.length; i++) {
      const v = renderVec(chars[i], family);
      if (v) {
        vecs.set(v, n * GRID * GRID);
        chars[n] = chars[i];
        n++;
      }
      if (onProgress && i % 500 === 0) onProgress(i, chars.length);
      if (i % 400 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return {
      chars: chars.slice(0, n),
      vecs: vecs.slice(0, n * GRID * GRID),
      count: n,
    };
  };

  function dist(a, aOff, b, bOff, size) {
    let s = 0;
    for (let i = 0; i < size; i++) {
      const d = a[aOff + i] - b[bOff + i];
      s += d * d;
    }
    return s / (size * 65025);
  }

  CSX.match = function (vec, table, topK = 3) {
    const stride = GRID * GRID;
    const best = [];
    for (let i = 0; i < table.count; i++) {
      const d = dist(vec, 0, table.vecs, i * stride, stride);
      if (best.length < topK) {
        best.push({ ch: table.chars[i], d });
        best.sort((x, y) => x.d - y.d);
      } else if (d < best[best.length - 1].d) {
        best[best.length - 1] = { ch: table.chars[i], d };
        best.sort((x, y) => x.d - y.d);
      }
    }
    return best;
  };

  /* 粗筛只保证候选进了前几名；形近字要靠高分辨率复核才能分开 */
  CSX.refine = function (targetVec, chars, family, grid = 64, px = 96) {
    const stride = grid * grid;
    const out = [];
    for (let i = 0; i < chars.length; i++) {
      const v = renderVec(chars[i], family, grid, px);
      if (!v) continue;
      out.push({ ch: chars[i], d: dist(targetVec, 0, v, 0, stride) });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  };

  /* 判据不再依赖 cmap：
     同一个字，用页面字体渲染一次、用参考字体渲染一次。
     若两者差异明显，说明页面字体把它的字形换掉了 → 需要解码。
     这样无论字体是 TTF / WOFF / 多个子集，都能识别。 */
  const selfCache = new Map();

  function selfDiff(ch, pageFamily, refFamily) {
    const key = ch + "|" + pageFamily;
    if (selfCache.has(key)) return selfCache.get(key);
    const a = renderVec(ch, pageFamily);
    const b = renderVec(ch, refFamily);
    let d = 1;
    if (a && b) {
      let s = 0;
      for (let i = 0; i < a.length; i++) {
        const t = a[i] - b[i];
        s += t * t;
      }
      d = s / (a.length * 65025);
    }
    selfCache.set(key, d);
    return d;
  }

  CSX.decodeText = function (text, fakeSet, table, pageFamily, refFamily) {
    pageFamily = pageFamily || '"font-cxsecret"';
    refFamily = refFamily || '"csx-ref"';

    const tokens = [];
    const detail = [];

    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const isCJK = cp >= 0x4e00 && cp <= 0x9fa5;

      /* 非汉字、或页面字体没有改动它 → 原样保留 */
      let suspicious = fakeSet.has(cp);
      if (!suspicious && isCJK) {
        suspicious = selfDiff(ch, pageFamily, refFamily) > 0.06;
      }
      if (!suspicious) {
        tokens.push({ c: ch, conf: "plain" });
        continue;
      }

      const vec = renderVec(ch, pageFamily);
      if (!vec) {
        tokens.push({ c: ch, conf: "failed" });
        continue;
      }

      const coarse = CSX.match(vec, table, 8);
      let hit = coarse[0];
      let d = hit ? hit.d : 1;
      let margin = coarse[1] ? coarse[1].d - d : 1;
      let stage = "coarse";

      if (!hit || margin < 0.025) {
        const target = renderVec(ch, pageFamily, 64, 96);
        const fine = target
          ? CSX.refine(target, coarse.map((c) => c.ch), refFamily)
          : [];
        if (fine.length > 1) {
          hit = fine[0];
          d = hit.d;
          margin = fine[1].d - hit.d;
          stage = "fine";
        }
      }

      /* 严格：宁可不换，也不换错 */
      let conf;
      if (stage === "coarse") {
        conf =
          d < 0.05 && margin > 0.015 ? "high" : margin >= 0.025 ? "low" : "failed";
      } else {
        conf = hit && margin >= 0.015 ? "low" : "failed";
      }

      detail.push({
        fake: ch,
        real: hit ? hit.ch : "?",
        d: hit ? +d.toFixed(4) : null,
        margin: +margin.toFixed(4),
        stage,
        conf,
      });
      tokens.push({ c: conf === "failed" ? ch : hit.ch, conf });
    }

    return {
      text: tokens.map((t) => t.c).join(""),
      tokens,
      detail,
    };
  };

  CSX.renderVec = renderVec;
  CSX.GRID = GRID;
})();
