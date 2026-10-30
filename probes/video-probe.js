/* ============================================================================
 * 视频后台计时探针（不依赖函数注册，可反复运行）
 * ----------------------------------------------------------------------------
 * 为什么单独做一个：控制台里定义的函数属于「那个 document 的 window」，
 * 页面一导航、或 Console 的 context 一换，函数就没了。
 * 这段脚本不定义任何函数，跑两次即可，中间只切标签页、不导航。
 *
 * 用法：
 *   1. Console 左上角 context 选到 iframe (cards)——视频所在的那个帧
 *   2. 把视频拖到还剩 3 分钟以上的位置（重要，见下）
 *   3. 运行本段 → 返回 phase: baseline
 *   4. 切到别的标签页，等 90 秒，回来
 *   5. 再运行本段 → 返回 phase: verdict，看 ratio
 *
 * 判定：ratio ≥ 0.9 视频仍在后台推进；≈ 0 表示被暂停或计时停止。
 *
 * ⚠ 剩余时长必须大于测量时长，否则视频播完会停在结尾，
 *   ratio 被稀释成 0.5 左右，得出假阴性。
 * ========================================================================== */
(() => {
  const KEY = "__pc_baseline";
  const WINDOW_MS = 30 * 60 * 1000;

  function findVideo() {
    const own = document.querySelector("video");
    if (own) return { v: own, where: "current" };
    let hit = null;
    (function walk(win, path) {
      if (hit) return;
      let doc;
      try {
        doc = win.document;
      } catch (e) {
        return;
      }
      const cand = doc.querySelector("video");
      if (cand) {
        hit = { v: cand, where: path };
        return;
      }
      let n = 0;
      try {
        n = win.frames.length;
      } catch (e) {
        return;
      }
      for (let i = 0; i < n; i++) {
        try {
          walk(win.frames[i], path + ">" + i);
        } catch (e) {}
      }
    })(window, "top");
    return hit;
  }

  const found = findVideo();
  if (!found) {
    return {
      error: "当前上下文找不到 video",
      hint: "把 Console 左上角的 context 切到 iframe (cards) 再运行",
      contextIsTop: window === top,
      href: location.href,
    };
  }

  const v = found.v;
  const now = Date.now();
  const raw = localStorage.getItem(KEY);
  const prev = raw ? JSON.parse(raw) : null;

  if (!prev || now - prev.ts > WINDOW_MS) {
    localStorage.setItem(
      KEY,
      JSON.stringify({ t: v.currentTime, ts: now, duration: v.duration || 0 })
    );
    return {
      phase: "baseline",
      currentTime: +v.currentTime.toFixed(1),
      duration: v.duration ? +v.duration.toFixed(1) : null,
      remaining: v.duration ? +(v.duration - v.currentTime).toFixed(1) : null,
      paused: v.paused,
      where: found.where,
      hint: "现在切到别的标签页等 90 秒，回来再运行本段",
      warning:
        v.duration && v.duration - v.currentTime < 120
          ? "剩余不足 120 秒，视频可能播完导致假阴性，先往回拖"
          : null,
    };
  }

  const wall = (now - prev.ts) / 1000;
  const delta = v.currentTime - prev.t;
  const ended = v.ended || (v.duration && v.currentTime >= v.duration - 0.5);
  localStorage.removeItem(KEY);

  return {
    phase: "verdict",
    deltaVideo: +delta.toFixed(1),
    deltaWall: +wall.toFixed(1),
    ratio: wall > 0 ? +(delta / wall).toFixed(2) : null,
    paused: v.paused,
    ended: !!ended,
    docHidden: document.hidden,
    visibility: document.visibilityState,
    where: found.where,
    verdict: ended
      ? "视频在测量期间播完了，结果不可用，请回拖后重测"
      : delta / wall >= 0.9
      ? "通过：后台仍在正常推进"
      : delta / wall <= 0.1
      ? "未推进：被暂停或计时停止"
      : "部分推进：可能中途被暂停过",
  };
})();
