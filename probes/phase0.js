/* ============================================================================
 * chaoxing-auto-study · Phase 0 探针 v3
 * ----------------------------------------------------------------------------
 * v3 修复：v2 的 __probeClick 复用了「粘贴那一刻」的 DOM 快照，题目帧稍后
 * 才加载时就会误报「没有 .questionLi」。v3 改为每次调用重新采集，并在
 * 找不到题目时输出诊断（帧树 / 跨域帧 / 疑似题目帧），而不是只报一句话。
 *
 * 怎么用：
 *   0. 若 Console 拒绝粘贴：手动键入 allow pasting 回车；
 *      或 Sources → Snippets → New snippet → 粘贴 → Ctrl+Enter（推荐）
 *   1. 打开「章节测验」页并等题目显示出来 → 运行本脚本
 *   2. 先跑 __probeScan() 看诊断；有题目再跑 __probeClick()
 *   3. 视频页运行本脚本 → __probeC('start') → 切标签 90 秒 → __probeC('end')
 *
 * 结果自动下载到 Downloads，无需复制粘贴。
 * ========================================================================== */
(() => {
  const EPOCH = Date.now();
  const LS_VIDEO = "__phase0_video_last";

  const Q_SELECTORS = [
    ".questionLi",
    ".TiMu",
    "ul.Zy_ulTop",
    "[class*='questionLi']",
  ];

  function download(name, data) {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeHref(doc) {
    try {
      return doc.location.href;
    } catch (e) {
      return "(跨域)";
    }
  }

  function collect() {
    const docs = [];
    const seen = new Set();
    const blocked = [];

    (function walk(win, path) {
      let doc;
      try {
        doc = win.document;
      } catch (e) {
        blocked.push({ path, reason: "跨域或无权限" });
        return;
      }
      if (!doc || seen.has(doc)) return;
      seen.add(doc);
      docs.push({ doc, win, path });

      let n = 0;
      try {
        n = win.frames.length;
      } catch (e) {
        blocked.push({ path, reason: "frames 不可枚举" });
        return;
      }
      for (let i = 0; i < n; i++) {
        try {
          walk(win.frames[i], path + ">" + i);
        } catch (e) {
          blocked.push({ path: path + ">" + i, reason: "walk 抛错" });
        }
      }
    })(window, "top");

    return { docs, blocked };
  }

  function findQuestions(docs) {
    for (const sel of Q_SELECTORS) {
      const hits = docs
        .map((d) => ({ d, n: d.doc.querySelectorAll(sel).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n);
      if (hits.length) return { sel, entry: hits[0].d, count: hits[0].n };
    }
    return null;
  }

  function diagnose(C) {
    const frames = C.docs.map((d) => {
      let title = "";
      let text = "";
      try {
        title = d.doc.title || "";
        text = d.doc.body ? d.doc.body.innerText || "" : "";
      } catch (e) {}
      const flat = text.replace(/\s+/g, " ").trim();
      return {
        路径: d.path,
        地址: safeHref(d.doc),
        标题: title.slice(0, 30),
        questionLi: d.doc.querySelectorAll(".questionLi").length,
        TiMu: d.doc.querySelectorAll(".TiMu").length,
        选项组: d.doc.querySelectorAll("ul.Zy_ulTop").length,
        输入框: d.doc.querySelectorAll('input[name^="answer"]').length,
        含测验字样: /章节测验|测验|作业|答题卡|单选题|多选题|判断题/.test(flat),
        文本头: flat.slice(0, 50),
      };
    });

    const iframes = [];
    for (const d of C.docs) {
      let list = [];
      try {
        list = Array.from(d.doc.querySelectorAll("iframe"));
      } catch (e) {}
      for (const f of list) {
        const src = f.src || f.getAttribute("src") || "";
        iframes.push({
          宿主帧: d.path,
          id: f.id || null,
          src: src.slice(0, 160),
          疑似题目帧: /work|dowork|quiz|exam|ans|knowledge/i.test(src),
        });
      }
    }

    return {
      可访问帧: frames,
      无法访问的帧: C.blocked,
      iframe清单: iframes,
    };
  }

  function hintFor(C, hit) {
    if (hit) return null;
    const hints = [];
    if (C.blocked.length) {
      hints.push(
        "存在无法访问的帧：把 Console 左上角 context 下拉框切到该帧，或把该帧地址单独开一个标签页再跑"
      );
    }
    const hasQuizFrame = C.docs.some((d) => {
      try {
        return Array.from(d.doc.querySelectorAll("iframe")).some((f) =>
          /work|dowork|quiz|exam/i.test(f.src || f.getAttribute("src") || "")
        );
      } catch (e) {
        return false;
      }
    });
    if (hasQuizFrame) {
      hints.push(
        "检测到疑似题目 iframe 但里面还没有题目：先点进具体测验，等题目渲染出来，再 Ctrl+Enter 重跑"
      );
    }
    if (!hints.length) {
      hints.push(
        "当前页没有题目帧：可能停在章节列表、成绩页或视频页。点顶部「章节测验」进入具体测验后再跑"
      );
    }
    return hints;
  }

  const C = collect();
  const hit = findQuestions(C.docs);
  const diag = diagnose(C);
  const hints = hintFor(C, hit);

  const qEntry = hit ? hit.entry : null;
  let cssText = "";
  for (const d of C.docs) {
    const st = d.doc.querySelector("#cxSecretStyle");
    if (st) cssText += st.textContent || "";
  }
  const b64 = /base64,([A-Za-z0-9+/=\s]+)/.exec(cssText);
  const font = b64
    ? {
        found: true,
        approxBytes: Math.round((b64[1].replace(/\s/g, "").length * 3) / 4),
        cssHead: cssText.slice(0, 200),
        b64: b64[1].replace(/\s/g, ""),
      }
    : { found: false, cssPresent: cssText.length > 0 };

  const questions = qEntry
    ? Array.from(qEntry.doc.querySelectorAll(hit.sel)).map((q, idx) => {
        const timu = q.querySelector(".TiMu") || q;
        const stemEl =
          q.querySelector(".fontLabel") || q.querySelector(".Zy_TItle");
        const lis = Array.from(q.querySelectorAll("ul.Zy_ulTop > li"));
        const inp = q.querySelector('input[name^="answer"]');
        const label = q.querySelector(".newZy_TItle");
        return {
          idx,
          qid: lis[0] ? lis[0].getAttribute("qid") : null,
          type: timu ? timu.getAttribute("data") : null,
          typeLabel: label ? label.textContent.trim() : null,
          stemRaw: stemEl ? stemEl.textContent.trim().slice(0, 300) : null,
          stemFont: stemEl
            ? qEntry.win.getComputedStyle(stemEl).fontFamily
            : null,
          stemUsesCxFont: !!(
            stemEl && stemEl.classList.contains("font-cxsecret")
          ),
          options: lis.map((li) => {
            const optEl =
              li.querySelector(".font-cxsecret") || li.querySelector("a");
            const num = li.querySelector(".num_option");
            return {
              letter: num ? num.textContent.trim() : null,
              qid: li.getAttribute("qid"),
              role: li.getAttribute("role"),
              onclick: li.getAttribute("onclick"),
              textRaw: optEl ? optEl.textContent.trim().slice(0, 160) : null,
            };
          }),
          inputName: inp ? inp.name : null,
          inputValue: inp ? inp.value : null,
        };
      })
    : [];

  const R = {
    probe: "phase0-v3",
    at: new Date().toISOString(),
    topHref: location.href,
    found: !!hit,
    matchedSelector: hit ? hit.sel : null,
    questionCount: hit ? hit.count : 0,
    questionDocPath: qEntry ? qEntry.path : null,
    font,
    questions,
    diagnosis: diag,
    hints,
  };
  window.__probeResult = R;

  const fname = `phase0-${hit ? "questions" : "nodetect"}-${EPOCH}.json`;
  const saved = download(fname, R);

  window.__probeScan = () => {
    const c = collect();
    const h = findQuestions(c.docs);
    const d = diagnose(c);
    console.log("%c帧诊断", "font-weight:600");
    console.table(d.可访问帧);
    if (d.无法访问的帧.length) console.table(d.无法访问的帧);
    if (d.iframe清单.length) console.table(d.iframe清单);
    console.log("命中：", h ? `${h.sel} × ${h.count}（${h.entry.path}）` : "无");
    return d;
  };

  window.__probeClick = () => {
    const c = collect();
    const h = findQuestions(c.docs);
    if (!h) {
      const hs = hintFor(c, null);
      console.warn("仍然没有找到题目：\n- " + hs.join("\n- "));
      return {
        changed: false,
        reason: "no-question",
        hints: hs,
        snapshot: diagnose(c),
      };
    }
    const doc = h.entry.doc;
    const li =
      doc.querySelector(".questionLi ul.Zy_ulTop > li") ||
      doc.querySelector("ul.Zy_ulTop > li");
    if (!li) {
      return {
        changed: false,
        reason: "no-option-li",
        matchedSelector: h.sel,
        hint: "找到题目容器但选项不是 ul.Zy_ulTop > li，导出 diagnosis 发我看结构",
      };
    }
    const q = li.closest(".questionLi") || li.closest(".TiMu") || doc;
    const inp = q.querySelector('input[name^="answer"]');
    if (!inp) {
      return {
        changed: false,
        reason: "no-answer-input",
        optionOnclick: li.getAttribute("onclick"),
      };
    }
    const before = inp.value;
    li.click();
    const after = inp.value;
    const out = {
      probe: "click",
      at: new Date().toISOString(),
      matchedSelector: h.sel,
      inputName: inp.name,
      before,
      after,
      changed: before !== after,
      optionOnclick: li.getAttribute("onclick"),
      optionRole: li.getAttribute("role"),
    };
    window.__probeResult = out;
    download(`phase0-click-${EPOCH}.json`, out);
    console.log(
      "%c⚠ 已勾选一个选项，请立刻按 F5 丢弃，不要点提交",
      "color:#c00;font-weight:600"
    );
    return out;
  };

  window.__probeC = (tag) => {
    let v = null;
    let vPath = null;
    for (const d of collect().docs) {
      const cand = d.doc.querySelector("video");
      if (cand) {
        v = cand;
        vPath = d.path;
        break;
      }
    }
    const rec = {
      probe: "video",
      tag: tag || "sample",
      at: new Date().toISOString(),
      ts: Date.now(),
      currentTime: v ? +v.currentTime.toFixed(2) : null,
      paused: v ? v.paused : null,
      readyState: v ? v.readyState : null,
      duration: v ? +(v.duration || 0).toFixed(1) : null,
      playbackRate: v ? v.playbackRate : null,
      docHidden: document.hidden,
      videoDocPath: vPath,
    };
    const prevRaw = localStorage.getItem(LS_VIDEO);
    localStorage.setItem(LS_VIDEO, JSON.stringify(rec));
    if (!prevRaw || !v) {
      console.log(
        "已记录基线，切到别的标签页等 90 秒，再回来执行 __probeC('end')"
      );
      return rec;
    }
    const prev = JSON.parse(prevRaw);
    const wall = (rec.ts - prev.ts) / 1000;
    const delta = rec.currentTime - prev.currentTime;
    const out = {
      ...rec,
      prevTag: prev.tag,
      deltaVideo: +delta.toFixed(2),
      deltaWall: +wall.toFixed(2),
      playingRatio: wall > 0 ? +(delta / wall).toFixed(2) : null,
    };
    window.__probeResult = out;
    download(`phase0-video-${EPOCH}.json`, out);
    return out;
  };

  console.log("%cPhase 0 探针 v3", "font-weight:600;font-size:14px");
  console.table({
    命中: hit ? `${hit.sel} × ${hit.count}` : "未找到",
    题目帧: qEntry ? qEntry.path : "无",
    可访问帧数: C.docs.length,
    跨域帧数: C.blocked.length,
    字体: font.found ? `约 ${font.approxBytes} 字节` : "未找到",
    文件: saved ? fname : "下载失败",
  });
  if (hints) {
    console.warn("%c未找到题目，按顺序排查：", "font-weight:600;color:#c00");
    hints.forEach((h, i) => console.warn(`${i + 1}. ${h}`));
    console.warn("详细帧信息：执行 __probeScan()");
  } else {
    console.log("下一步：__probeClick()（会勾选一个选项，跑完 F5）");
  }
  return R;
})();
