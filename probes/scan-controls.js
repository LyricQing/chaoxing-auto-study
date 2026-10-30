/* 跨帧控件扫描：遍历同源 iframe，列出可点击控件与候选选择器。
 *
 * 用法：在目标页 Console 粘贴运行 → 自动下载 controls-*.json。
 * 只读，不点击任何东西。
 *
 * 对比 v1：v1 只在当前帧扫描，遇到「cards 帧里只有一个 iframe」就会得到空结果。
 */
(() => {
  const KEYWORDS = /下一节|上一节|章节测验|下一章|上一章|提交|保存|返回|继续|播放|开始学习/;

  function visible(el, win) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const st = win.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0")
      return false;
    return true;
  }

  function cssPath(el) {
    const parts = [];
    let node = el;
    for (let depth = 0; node && depth < 4; depth++) {
      let seg = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(seg + "#" + node.id);
        break;
      }
      const cls = (node.className || "").toString().trim().split(/\s+/).filter(Boolean);
      if (cls.length) seg += "." + cls.slice(0, 2).join(".");
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(
          (c) => c.tagName === node.tagName
        );
        if (same.length > 1) seg += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(seg);
      node = parent;
    }
    return parts.join(" > ");
  }

  function desc(el, win, framePath) {
    const r = el.getBoundingClientRect();
    return {
      frame: framePath,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: (el.className || "").toString().slice(0, 90) || null,
      text: (el.innerText || el.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40),
      href: el.getAttribute("href") ? el.getAttribute("href").slice(0, 140) : null,
      onclick: el.getAttribute("onclick")
        ? el.getAttribute("onclick").slice(0, 90)
        : null,
      title: el.getAttribute("title") || null,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      selector: cssPath(el),
    };
  }

  const frameInfo = [];
  const hits = [];
  const controls = [];
  const seenDoc = new Set();
  const seenEl = new Set();

  /* 从真正的顶层窗口起扫：Console 的 context 可能停在某个 iframe 里，
     那样会漏掉外层的「下一节」等页面按钮 */
  let root = window;
  try {
    if (window.top && window.top.document) root = window.top;
  } catch (e) {
    /* 顶层跨域时退回当前帧 */
  }

  const basePath = root === window ? "self" : "top";

  (function walk(win, path) {
    let doc;
    try {
      doc = win.document;
    } catch (e) {
      frameInfo.push({ path, href: "(跨域，跳过)" });
      return;
    }
    if (!doc || seenDoc.has(doc)) return;
    seenDoc.add(doc);

    let href = "(跨域)";
    try {
      href = doc.location.href;
    } catch (e) {}
    frameInfo.push({
      path,
      href,
      title: doc.title || "",
      elements: doc.querySelectorAll("*").length,
    });

    const nodes = doc.querySelectorAll(
      "a, button, [onclick], [role='button'], li, span, div"
    );

    for (const el of nodes) {
      if (seenEl.has(el)) continue;
      seenEl.add(el);
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 40) continue;
      if (!visible(el, win)) continue;

      const d = desc(el, win, path);
      const isHit = KEYWORDS.test(text) || KEYWORDS.test(d.title || "");
      if (isHit) hits.push(d);
      else if (controls.length < 120) controls.push(d);
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
      } catch (e) {
        frameInfo.push({ path: path + ">" + i, href: "(walk 失败)" });
      }
    }
  })(root, basePath);

  const out = {
    at: new Date().toISOString(),
    href: location.href,
    title: document.title,
    consoleInTop: window === window.top,
    scannedFrom: basePath,
    frames: frameInfo,
    keywordHits: hits,
    otherControls: controls,
  };

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `controls-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  console.log("%c跨帧控件扫描", "font-weight:600");
  console.table(frameInfo);
  if (hits.length) console.table(hits);
  else console.warn("没有匹配到关键词控件，看 otherControls");
  return out;
})();
