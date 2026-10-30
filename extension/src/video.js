/* 视频帧：自动起播（仅自动模式）+ 看门狗 + 任务点完成后转测验
 * v3：不再假设 video 元素在 document_idle 时已存在——播放器是异步挂载的，
 *     之前脚本取不到 video 就 return，等于从未 Hook。
 *     同时左下角显示状态徽标，便于定位卡在哪一步。
 */
(() => {
  if (window.__csxVideoHooked) return;
  window.__csxVideoHooked = true;

  let v = null;
  let wasPlaying = false;
  let started = false;
  let attempts = 0;
  let auto = false;
  let moved = false;
  let pollId = null;
  let lastUserAct = 0;
  let resumeCount = 0;

  /* ---------- 状态徽标 ---------- */
  let badgeEl = null;
  function badge(text) {
    try {
      if (!badgeEl || !badgeEl.isConnected) {
        badgeEl = document.createElement("div");
        badgeEl.style.cssText =
          "position:fixed;left:8px;bottom:8px;z-index:2147483000;" +
          "font:12px/1.5 -apple-system,'Microsoft YaHei',sans-serif;" +
          "background:rgba(0,0,0,.62);color:#fff;padding:2px 7px;" +
          "border-radius:4px;pointer-events:none;opacity:.9";
        document.body.appendChild(badgeEl);
      }
      badgeEl.textContent = "CSX " + text;
    } catch (e) {}
  }

  /* ---------- 等待播放器挂载 ----------
     播放器在本帧的子 iframe 里，脚本只注入到了外层帧，
     所以必须跨帧查找（同源可直接读 contentDocument）。 */
  function deepFind(win, depth) {
    try {
      const own = win.document.querySelector("video");
      if (own) return own;
    } catch (e) {
      return null;
    }
    if (depth <= 0) return null;
    let frames = [];
    try {
      frames = Array.from(win.document.querySelectorAll("iframe"));
    } catch (e) {
      return null;
    }
    for (const f of frames) {
      try {
        const cd = f.contentDocument || (f.contentWindow && f.contentWindow.document);
        if (!cd) continue;
        const hit = deepFind(f.contentWindow, depth - 1);
        if (hit) return hit;
      } catch (e) {}
    }
    return null;
  }

  function findVideo() {
    return deepFind(window, 3);
  }

  function frameStats() {
    try {
      const fs = Array.from(document.querySelectorAll("iframe"));
      let readable = 0;
      for (const f of fs) {
        try {
          if (f.contentDocument) readable++;
        } catch (e) {}
      }
      return `帧${fs.length}/可读${readable}`;
    } catch (e) {
      return "";
    }
  }

  const waitTimer = setInterval(() => {
    const found = findVideo();
    if (found) {
      clearInterval(waitTimer);
      v = found;
      hook();
      return;
    }
    if (!document.body) return;
    badge("等待播放器… " + frameStats());
  }, 500);

  setTimeout(() => {
    clearInterval(waitTimer);
    if (!v && document.querySelector(".TiMu") && badgeEl) {
      badgeEl.remove();
      badgeEl = null;
    }
  }, 20000);

  async function safePlay() {
    try {
      await v.play();
      return true;
    } catch (e) {}
    try {
      v.muted = true;
      await v.play();
      return true;
    } catch (e) {}
    return false;
  }

  function hook() {
    /* 记录真实用户动作：只有「刚点过播放器」才算主动暂停 */
    ["pointerdown", "keydown", "touchstart"].forEach((t) =>
      window.addEventListener(
        t,
        () => {
          lastUserAct = Date.now();
        },
        true
      )
    );

    v.addEventListener("play", () => {
      wasPlaying = true;
      started = true;
      badge("播放中" + (v.muted ? "（静音）" : ""));
    });

    v.addEventListener("pause", () => {
      if (v.ended) return;

      /* 1.5 秒内有过点击/按键 = 用户主动暂停，尊重 */
      if (Date.now() - lastUserAct < 1500) {
        wasPlaying = false;
        badge("已暂停（手动）");
        return;
      }

      if (!auto) return;
      if (resumeCount >= 30) {
        badge("反复被暂停，已停手");
        return;
      }
      resumeCount++;

      /* 平台在失焦时会暂停；这里不看 document.hidden，
         因为「窗口在但没焦点」同样会触发暂停 */
      badge("被暂停，恢复 " + resumeCount);
      setTimeout(() => {
        if (!v.ended && v.paused) safePlay();
      }, 800);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (wasPlaying && v.paused && !v.ended) v.play().catch(() => {});
    });

    v.addEventListener("canplay", () => {
      if (auto) tryStart();
    });

    chrome.storage.local.get("csx_auto").then((o) => {
      auto = !!o.csx_auto;
      if (auto) scheduleStart();
      else badge("自动已关");
      tick();
    });

    chrome.storage.onChanged.addListener((ch) => {
      if (!ch.csx_auto) return;
      auto = !!ch.csx_auto.newValue;
      if (auto) scheduleStart();
      else badge("自动已关");
      tick();
    });

    setInterval(tick, 3000);
    console.log("[CSX] video hooked", { auto, muted: v.muted, paused: v.paused });
  }

  /* ---------- 起播：三级降级 ---------- */
  async function tryStart() {
    if (!auto || started || !v || !v.paused || v.ended) return;
    if (attempts >= 6) {
      badge("放弃起播");
      return;
    }
    attempts++;
    badge("尝试起播 " + attempts);

    try {
      await v.play();
      started = true;
      console.log("[CSX] play ok");
      return;
    } catch (e) {
      console.log("[CSX] play rejected:", e.name, e.message);
    }

    try {
      v.muted = true;
      await v.play();
      started = true;
      badge("播放中（静音）");
      setTimeout(() => {
        try {
          v.muted = false;
        } catch (e) {}
      }, 1200);
      return;
    } catch (e) {
      console.log("[CSX] muted play rejected:", e.name, e.message);
    }

    try {
      const btn = document.querySelector("button.vjs-play-control");
      if (btn) btn.click();
      badge("点了播放器按钮");
    } catch (e) {}
  }

  function scheduleStart() {
    if (started || pollId) return;
    pollId = setInterval(() => {
      if (started || attempts >= 6) {
        clearInterval(pollId);
        pollId = null;
        return;
      }
      tryStart();
    }, 3000);
    tryStart();
  }

  /* ---------- 任务点完成 → 转测验 ---------- */
  function topDoc() {
    try {
      return window.top.document;
    } catch (e) {
      return document;
    }
  }

  /* 完成任务点的文字可能在任意一层帧里，逐层取 textContent */
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

  function rootWin() {
    try {
      return window.top;
    } catch (e) {
      return window;
    }
  }

  /* 「任务点已完成」在顶层页面，必须从 top 往下找；
     视频 natural end 也是硬信号，避免文字延迟导致卡住 */
  function taskDone() {
    if (/任务点已完成/.test(deepText(rootWin(), 4))) return true;
    if (v && v.ended && v.duration > 30) return true;
    return false;
  }

  function tick() {
    if (!auto || moved || !v) return;
    if (!taskDone()) return;
    moved = true;
    badge("任务点完成，已点测验");
    setTimeout(() => {
      const d = topDoc();
      const tab = d.querySelector("#dct2");
      const next = d.querySelector("#prevNextFocusNext");
      if (tab) tab.click();
      else if (next) next.click();
    }, 2500);
  }
})();
