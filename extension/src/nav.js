/* 导航条：只在 studentstudy 顶层页面出现。
 * 选择器来自实测扫描：
 *   章节测验 li#dct2 → changeDisplayContent(...)
 *   下一节   div#prevNextFocusNext → PCount.next(...)
 *
 * 另含「顶层看门狗」：不依赖子帧脚本，直接从 top 判断本节是否全部完成，
 * 完成就前进。与子帧的 goNext 共用 sessionStorage 锁，避免重复点击跳两节。
 */
(() => {
  if (window !== window.top) return;
  if (!/\/mycourse\/studentstudy/.test(location.href)) return;
  if (window.__csxNav) return;
  window.__csxNav = true;

  const bar = document.createElement("div");
  bar.className = "csx-nav";

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => (btn.textContent = old), 1200);
  }

  function make(label, handler) {
    const b = document.createElement("button");
    b.className = "csx-nav-btn";
    b.textContent = label;
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = handler();
      flash(b, ok ? "已触发" : "未找到");
    };
    return b;
  }

  function toQuiz() {
    const el = document.querySelector("#dct2");
    if (!el) return false;
    el.click();
    return true;
  }

  function nextSection() {
    const el = document.querySelector("#prevNextFocusNext");
    if (!el) return false;
    if (getComputedStyle(el).display === "none") return false;
    el.click();
    return true;
  }

  const autoBtn = document.createElement("button");
  autoBtn.className = "csx-nav-btn";
  function paintAuto(v) {
    autoBtn.textContent = "自动：" + (v ? "开" : "关");
    autoBtn.classList.toggle("csx-on", !!v);
  }
  chrome.storage.local.get("csx_auto").then((o) => paintAuto(!!o.csx_auto));
  autoBtn.onclick = async () => {
    const o = await chrome.storage.local.get("csx_auto");
    const v = !o.csx_auto;
    await chrome.storage.local.set({ csx_auto: v });
    paintAuto(v);
  };

  const aiBtn = document.createElement("button");
  aiBtn.className = "csx-nav-btn";
  function paintAi(v) {
    aiBtn.textContent = "AI 补答：" + (v ? "开" : "关");
    aiBtn.classList.toggle("csx-on", !!v);
  }
  chrome.storage.local.get("csx_bridge").then((o) => paintAi(!!o.csx_bridge));
  aiBtn.onclick = async () => {
    const o = await chrome.storage.local.get("csx_bridge");
    const v = !o.csx_bridge;
    await chrome.storage.local.set({ csx_bridge: v });
    paintAi(v);
    if (v) {
      const h = await fetch("http://127.0.0.1:8765/health").catch(() => null);
      if (!h || !h.ok) alert("答题桥未启动。先运行：node skill/chaoxing-answer/server.mjs");
    }
  };

  bar.appendChild(make("章节测验", toQuiz));
  bar.appendChild(make("下一节", nextSection));
  bar.appendChild(autoBtn);
  bar.appendChild(aiBtn);
  document.body.appendChild(bar);

  /* ---------------- 顶层看门狗 ---------------- */
  let auto = false;
  chrome.storage.local.get("csx_auto").then((o) => (auto = !!o.csx_auto));
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.csx_auto) auto = !!ch.csx_auto.newValue;
  });

  function deepText(win, depth) {
    let t = "";
    try {
      t += win.document.body ? win.document.body.textContent || "" : "";
    } catch (e) {
      return t;
    }
    if (depth <= 0) return t;
    try {
      for (const f of win.document.querySelectorAll("iframe")) {
        try {
          t += deepText(f.contentWindow, depth - 1);
        } catch (e) {}
      }
    } catch (e) {}
    return t;
  }

  function deepVideo(win, depth) {
    try {
      const own = win.document.querySelector("video");
      if (own) return own;
    } catch (e) {
      return null;
    }
    if (depth <= 0) return null;
    try {
      for (const f of win.document.querySelectorAll("iframe")) {
        try {
          const hit = deepVideo(f.contentWindow, depth - 1);
          if (hit) return hit;
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  function collectQuizDocs(win, out, depth) {
    try {
      if (win.document.querySelector(".TiMu")) out.push(win.document);
    } catch (e) {
      return;
    }
    if (depth <= 0) return;
    try {
      for (const f of win.document.querySelectorAll("iframe")) {
        try {
          collectQuizDocs(f.contentWindow, out, depth - 1);
        } catch (e) {}
      }
    } catch (e) {}
  }

  function cid() {
    const m = /[?&]chapterId=([^&]+)/.exec(location.href);
    return m ? m[1] : "x";
  }

  /* 完成 = 视频达标（或本来就没有视频）且 测验已交（或本节没有测验）
     注意不能拿「满分」判交卷——作答页的页头也写着「满分: 100.0」 */
  function sectionComplete() {
    const v = deepVideo(window, 4);
    const videoDone =
      !v ||
      (v.ended && v.duration > 30) ||
      /任务点已完成/.test(deepText(window, 4));
    if (!videoDone) return false;

    const hasQuizTab = !!document.querySelector("#dct2");
    const docs = [];
    collectQuizDocs(window, docs, 4);

    if (!hasQuizTab) return true;
    if (!docs.length) return false; // 还没打开测验

    return docs.some((d) => {
      const t = d.body ? d.body.textContent || "" : "";

      /* 结果页铁证：只要出现「我的答案」，就一定交过卷 */
      if (/我的答案/.test(t)) return true;

      /* 提交按钮必须是「可见」才算没交卷——结果页里它是隐藏的 */
      const btn = d.querySelector("a.btnSubmit");
      const win = d.defaultView || window;
      const visibleBtn =
        btn &&
        btn.getBoundingClientRect().width > 0 &&
        win.getComputedStyle(btn).display !== "none" &&
        win.getComputedStyle(btn).visibility !== "hidden";
      if (visibleBtn) return false;

      if (/待完成/.test(t)) return false;
      return /已完成/.test(t);
    });
  }

  /* ---------- 通用弹窗处理：永远选「能继续走」的那个 ---------- */
  function findDialog(re) {
    const all = Array.from(document.querySelectorAll("div"));
    return all.find((n) => {
      const r = n.getBoundingClientRect();
      if (r.width < 200 || r.width > 900 || r.height < 60) return false;
      return re.test(n.textContent || "");
    });
  }

  function clickIn(dlg, text) {
    const nodes = Array.from(dlg.querySelectorAll("a,button,div,span"));
    const btn = nodes.find((e) => (e.textContent || "").trim() === text);
    if (btn) {
      btn.click();
      return true;
    }
    /* 认不出的弹窗：点最右/最后一个按钮，通常就是主操作 */
    const able = Array.from(dlg.querySelectorAll("a,button")).filter(
      (e) => (e.textContent || "").trim() && e.getBoundingClientRect().width > 0
    );
    if (able.length) {
      able[able.length - 1].click();
      return true;
    }
    return false;
  }

  function dismissDialogs() {
    /* 1. 笔记未保存 —— 选「保存」，不选「不保存」（后者会把流程留在原地） */
    let dlg = findDialog(/章节笔记未保存|是否保存/);
    if (dlg && clickIn(dlg, "保存")) return "notes-saved";

    /* 2. 任务点未完成 —— 选「下一节」，跳过继续 */
    dlg = findDialog(/还有任务点未完成|是否去完成/);
    if (dlg && clickIn(dlg, "下一节")) return "skip-section";

    return null;
  }

  /* ---------- 停滞兜底：测验页长时间没交卷就跳过 ---------- */
  let lastSig = "";
  let lastChange = Date.now();

  function progressSignature() {
    const docs = [];
    collectQuizDocs(window, docs, 4);
    if (!docs.length) return "none";
    const d = docs[0];
    const inputs = Array.from(
      d.querySelectorAll('input[name^="answer"]')
    ).filter((i) => /^answer\d+$/.test(i.name));
    const filled = inputs.filter((i) => String(i.value || "").trim()).length;
    return `${docs.length}:${inputs.length}:${filled}`;
  }

  function quizStillUnanswered() {
    const docs = [];
    collectQuizDocs(window, docs, 4);
    if (!docs.length) return false;
    const d = docs[0];
    const hasSubmit = !!d.querySelector("a.btnSubmit");
    if (!hasSubmit) return false;
    const empty = Array.from(
      d.querySelectorAll('input[name^="answer"]')
    ).filter((i) => /^answer\d+$/.test(i.name) && !String(i.value || "").trim());
    return empty.length > 0;
  }

  setInterval(() => {
    if (!auto) return;

    const handled = dismissDialogs();
    if (handled) {
      console.log("[CSX] dialog:", handled);
      return;
    }

    /* 锁只在 60 秒内有效：点过但没跳成（被弹窗挡住）不能永久锁死本节 */
    const key = "csx_adv_" + cid();
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const at = Number(raw) || 0;
        if (Date.now() - at < 60000) return;
        sessionStorage.removeItem(key);
      }
    } catch (e) {
      return;
    }

    /* 硬规则：10 秒内没有任何进展就跳过，绝不停死。
       「进展」= 已填答案数 / 题目数发生变化，作答过程中不会被误杀。 */
    if (quizStillUnanswered()) {
      const sig = progressSignature();
      if (sig !== lastSig) {
        lastSig = sig;
        lastChange = Date.now();
        return;
      }
      let busy = 0;
      try {
        busy = Number(sessionStorage.getItem("csx_busy") || 0);
      } catch (e) {}
      if (Date.now() - busy < 8000) return; // 子帧正在作答，不算停滞
      if (Date.now() - lastChange < 10000) return;
      console.log("[CSX] no progress in 10s, skipping");
      try {
        sessionStorage.setItem(key, String(Date.now()));
      } catch (e) {}
      nextSection();
      return;
    }

    if (!sectionComplete()) return;
    try {
      sessionStorage.setItem(key, String(Date.now()));
    } catch (e) {}
    setTimeout(() => {
      if (!nextSection()) {
        try {
          sessionStorage.removeItem(key);
        } catch (e) {}
      }
    }, 1200);
  }, 3000);
})();
