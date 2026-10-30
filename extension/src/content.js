/* 入口：解码 → 查题库 → 自动填入 → 校验 →（自动模式）提交并跳下一节 */
(() => {
  const CSX = window.CSX;
  if (!CSX) return;
  if (window.__csxMounted) return;

  const REF_FAMILY = '"csx-ref"';
  const BANK_KEY = "csx_bank";
  const AUTO_KEY = "csx_auto";

  let tableCache = null;
  let items = [];
  let meta = { ms: 0, source: "cache" };
  let auto = false;
  let autoStarted = false;
  let ready = false;
  let bridgeOn = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function topDoc() {
    try {
      return window.top.document;
    } catch (e) {
      return document;
    }
  }

  function visible(el) {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    return el.getBoundingClientRect().width > 0;
  }

  async function waitFor(fn, timeout = 5000, step = 300) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  function questionKey(decodedStem, options) {
    return fnv(decodedStem + "||" + options.map((o) => o.text).join("|"));
  }

  async function loadBank() {
    try {
      const o = await chrome.storage.local.get(BANK_KEY);
      return o[BANK_KEY] || {};
    } catch (e) {
      return {};
    }
  }

  async function saveBank(bank) {
    try {
      await chrome.storage.local.set({ [BANK_KEY]: bank });
    } catch (e) {
      console.warn("[CSX] save bank failed", e);
    }
  }

  function isSelected(opt) {
    if (opt.mark && /check_answer/.test(opt.mark.className)) return true;
    return opt.el.getAttribute("aria-checked") === "true";
  }

  function applySelection(q, texts) {
    const want = new Set(texts);
    let clicks = 0;
    for (const opt of q.options) {
      const should = want.has(opt.decoded || opt.text);
      if (should !== isSelected(opt)) {
        opt.el.click();
        clicks++;
      }
    }
    return clicks;
  }

  function currentSelection(q) {
    return q.options.filter(isSelected).map((o) => o.decoded || o.text);
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((x) => {
      if (seen.has(x.fake)) return false;
      seen.add(x.fake);
      return true;
    });
  }

  function unanswered() {
    return CSX.extractQuestions(document).filter(
      (q) => !q.input || !String(q.input.value || "").trim()
    );
  }

  async function waitForStyle(timeout = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (document.querySelector("#cxSecretStyle")) return true;
      await sleep(250);
    }
    return false;
  }

  async function loadRefFont() {
    const url = chrome.runtime.getURL("assets/ref-subset.woff2");
    const face = new FontFace("csx-ref", "url(" + url + ")");
    await face.load();
    document.fonts.add(face);
  }

  /* 提交前全量校验：只允许交一次，空卷不可挽回 */
  function submitPaper() {
    const empty = unanswered();
    if (empty.length) {
      CSX.setHint(`还有 ${empty.length} 题没答，已拦住`);
      return false;
    }
    let btn = document.querySelector("a.btnSubmit");
    if (!btn) {
      btn = Array.from(document.querySelectorAll("a, button, div")).find(
        (e) => (e.textContent || "").trim() === "提交"
      );
    }
    if (!btn) {
      CSX.setHint("没找到提交按钮");
      return false;
    }
    btn.click();
    return true;
  }

  async function goNext(reason) {
    const d = topDoc();
    const next = d.querySelector("#prevNextFocusNext");
    if (!next || !visible(next)) {
      CSX.setHint(reason + "；找不到下一节");
      return;
    }
    CSX.setHint(reason + "，跳转下一节…");
    /* 与顶层看门狗共用一把锁，避免两边都点导致跳过一节 */
    ssSet("csx_adv_" + chapterId(), String(Date.now()));
    await sleep(600);
    next.click();
  }

  function chapterId() {
    const m = /[?&](?:knowledgeid|chapterId)=([^&]+)/.exec(location.href);
    return m ? m[1] : "unknown";
  }

  function ssGet(k) {
    try {
      return window.sessionStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }

  function ssSet(k, v) {
    try {
      window.sessionStorage.setItem(k, v);
    } catch (e) {}
  }

  async function recordLog(reason) {
    try {
      const o = await chrome.storage.local.get("csx_log");
      const log = o.csx_log || [];
      log.push({ cid: chapterId(), reason, at: Date.now() });
      await chrome.storage.local.set({ csx_log: log.slice(-200) });
    } catch (e) {}
  }

  async function closePopup() {
    const pop = topDoc().querySelector("#workpop");
    if (!pop || !visible(pop)) return;
    const btn = Array.from(pop.querySelectorAll("a, button, div")).find(
      (e) => (e.textContent || "").trim() === "取消"
    );
    if (btn) btn.click();
  }

  /* 遇到问题不停机：记一笔、关掉弹窗、直接进下一节 */
  async function skip(reason) {
    await recordLog(reason);
    CSX.setHint("跳过本节：" + reason);
    await closePopup();
    await sleep(400);
    await goNext("跳过");
  }

  /* 提交一次，返回失败类型。区分「可重试」与「不可重试」 */
  async function submitOnce() {
    if (!submitPaper()) return "no-button";

    const pop = await waitFor(() => {
      const p = topDoc().querySelector("#workpop");
      return visible(p) ? p : null;
    }, 4000);

    if (!pop) return "no-popup";

    /* 平台说没做完 = 语义失败，重试无意义 */
    if (/未做完|未完成|没有做完/.test(pop.innerText || "")) return "incomplete";

    const ok = topDoc().querySelector("#popok");
    if (!ok || !visible(ok)) return "no-ok";

    ok.click();
    return "clicked";
  }

  async function autoRun() {
    if (!auto || autoStarted || !ready) return;
    autoStarted = true;

    const hops = Number(ssGet("csx_hops") || 0) + 1;
    ssSet("csx_hops", String(hops));
    if (hops > 80) {
      CSX.setHint("已连续处理 80 节，停止以防跑飞");
      return;
    }

    await sleep(1500);

    if (CSX.readPageState(document).done) {
      await goNext("本节已完成");
      return;
    }

    const empty = unanswered();
    if (empty.length) {
      await skip(empty.length + " 题无答案");
      return;
    }

    /* 阶段一：点提交，最多 3 次。只重试瞬时失败 */
    let phase = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      CSX.setHint(`自动提交（第 ${attempt} 次）…`);
      phase = await submitOnce();

      if (phase === "clicked") break;
      if (phase === "incomplete") {
        await skip("平台提示有未作答题");
        return;
      }
      if (attempt < 3) await sleep(1200);
    }

    if (phase !== "clicked") {
      await skip(`提交失败：${phase}`);
      return;
    }

    /* 阶段二：已点确认，不能再提交第二次，只等结果 */
    let done = await waitFor(() => {
      const st = CSX.readPageState(document);
      const body = (document.body && document.body.innerText) || "";
      return st.done || /满分|得分|成绩/.test(body) ? true : null;
    }, 15000);

    if (!done) {
      await sleep(4000);
      done = await waitFor(() => {
        const st = CSX.readPageState(document);
        const body = (document.body && document.body.innerText) || "";
        return st.done || /满分|得分|成绩/.test(body) ? true : null;
      }, 10000);
    }

    if (!done) {
      await skip("提交后未见完成状态");
      return;
    }

    await sleep(800);
    await goNext("已提交");
  }

  /* 题库未命中 → 交给本地答题桥；答不出就保持原状，由自动模式跳过 */
  async function fillWithAI() {
    if (!bridgeOn || !items.length) return 0;
    let solved = 0;
    const pending = items.filter((i) => i.status === "new" && i.ref);
    let idx = 0;
    let failed = 0;

    for (const it of pending) {
      idx++;
      CSX.setHint(`AI 判定 ${idx}/${pending.length}：${it.qid}`);
      ssSet("csx_busy", String(Date.now())); // 告诉顶层：我还在干活

      const payload = {
        typeLabel: it.typeLabel,
        stem: it.stem,
        options: it.options,
      };
      let r = await CSX.askBridge(payload);
      ssSet("csx_busy", String(Date.now()));
      if (!r.letters.length) {
        /* 网络抖动或服务刚重启，重试一次 */
        CSX.setHint(`AI 重试 ${idx}/${pending.length}：${it.qid}`);
        r = await CSX.askBridge(payload);
      }

      if (!r.letters.length) {
        failed++;
        CSX.setHint(`AI 失败 ${it.qid}：${r.error || "无返回"}`);
        await sleep(700);
        continue;
      }

      const texts = it.options
        .filter((o) => r.letters.includes(o.letter))
        .map((o) => o.text);
      if (!texts.length) continue;

      applySelection(it.ref, texts);
      const val = it.ref.input ? it.ref.input.value : null;
      it.status = val && String(val).trim() ? "ai" : "error";
      it.options = it.ref.options.map((o) => ({
        letter: o.letter,
        text: o.decoded || o.text,
        selected: isSelected(o),
      }));

      const b = await loadBank();
      b[it.key] = { a: texts, t: Date.now(), src: "ai" };
      await saveBank(b);
      solved++;
    }
    if (solved) render();
    CSX.setHint(`AI 补答 ${solved} 题` + (failed ? `，失败 ${failed} 题` : ""));
    return solved;
  }

  function render() {
    CSX.renderQuestions(items, meta);
  }

  async function run() {
    CSX.mountPanel();
    CSX.setStatus("等待字体…");

    const cfg = await chrome.storage.local.get([AUTO_KEY, "csx_bridge"]);
    auto = !!cfg[AUTO_KEY];
    bridgeOn = !!cfg.csx_bridge;
    chrome.storage.onChanged.addListener((ch) => {
      if (ch[AUTO_KEY]) {
        auto = !!ch[AUTO_KEY].newValue;
        if (auto && ready) autoRun();
      }
      if (ch.csx_bridge) {
        bridgeOn = !!ch.csx_bridge.newValue;
        if (bridgeOn && ready) {
          fillWithAI().then((n) => {
            if (n > 0 && auto) {
              autoStarted = false;
              autoRun();
            }
          });
        }
      }
    });

    if (!(await waitForStyle())) {
      /* 结果页/已交卷页没有混淆字体，属于正常情况，不打扰 */
      const t = (document.body && document.body.textContent) || "";
      if (/我的答案|已完成|得分/.test(t)) return;
      CSX.showError("没有找到 #cxSecretStyle，当前页可能没有混淆字体");
      return;
    }

    /* 一页可能有多个 @font-face，逐个子集取并集，否则选项里的假字会漏掉 */
    const blobs = CSX.fontBytesList ? CSX.fontBytesList(document) : [];
    const fakeSet = new Set();
    for (const b of blobs) {
      const cm = CSX.parseCmap(b);
      if (cm) for (const cp of cm.keys()) fakeSet.add(cp);
    }
    if (!fakeSet.size) {
      const one = CSX.fontBytesFromDoc(document);
      const cm = one ? CSX.parseCmap(one) : null;
      if (cm) for (const cp of cm.keys()) fakeSet.add(cp);
    }
    if (!fakeSet.size) {
      CSX.showError("字体解析失败，拿不到假字符集合");
      return;
    }

    CSX.setStatus("加载参考字体…");
    await loadRefFont();
    try {
      await document.fonts.load('64px "font-cxsecret"');
    } catch (e) {}
    await document.fonts.ready;

    const t0 = performance.now();
    let source = "cache";

    if (!tableCache && CSX.loadTable) {
      tableCache = await CSX.loadTable("gb2312-v1");
    }
    if (!tableCache) {
      source = "build";
      CSX.setStatus("建索引…");
      tableCache = await CSX.buildCandidates(REF_FAMILY, (i, total) => {
        if (i % 1000 === 0) CSX.setStatus(`建索引 ${i}/${total}`);
      });
      if (CSX.saveTable) CSX.saveTable("gb2312-v1", tableCache);
    }

    const questions = CSX.extractQuestions(document);
    if (!questions.length) {
      CSX.showError("没有解析到题目结构");
      return;
    }

    const bank = await loadBank();

    items = questions.map((q) => {
      const res = CSX.decodeText(q.stemRaw, fakeSet, tableCache, '"font-cxsecret"', REF_FAMILY);

      /* 选项同样可能被替换，必须逐条解码 */
      const optRes = q.options.map((o) =>
        CSX.decodeText(o.text, fakeSet, tableCache, '"font-cxsecret"', REF_FAMILY)
      );
      q.options.forEach((o, i) => {
        o.decoded = optRes[i].text;
      });

      const decodedOptions = q.options.map((o) => ({
        letter: o.letter,
        text: o.decoded,
        selected: isSelected(o),
      }));

      const key = questionKey(res.text, decodedOptions);
      const rec = bank[key];

      const item = {
        qid: q.qid,
        typeLabel: q.typeLabel,
        stem: res.text,
        tokens: res.tokens,
        ref: q,
        options: decodedOptions,
        lowConf: dedupe(res.detail.filter((d) => d.conf === "low")),
        failed: dedupe(res.detail.filter((d) => d.conf === "failed")),
        status: "new",
        expected: rec ? rec.a.join(" / ") : null,
        key,
      };

      if (rec && rec.a && rec.a.length) {
        applySelection(q, rec.a);
        const val = q.input ? q.input.value : null;
        item.status = val && String(val).trim() ? "filled" : "error";
        item.options = q.options.map((o) => ({
          letter: o.letter,
          text: o.decoded || o.text,
          selected: isSelected(o),
        }));
      }

      item.onRemember = async () => {
        const picked = currentSelection(q);
        if (!picked.length) {
          CSX.setHint("这一题还没选，先在页面上点选");
          return;
        }
        const b = await loadBank();
        b[item.key] = { a: picked, t: Date.now() };
        await saveBank(b);
        item.status = "recorded";
        item.expected = picked.join(" / ");
        CSX.setHint("已记住：" + picked.join(" / "));
        render();
      };

      return item;
    });

    await fillWithAI();

    meta = { ms: Math.round(performance.now() - t0), source };
    render();

    CSX.__submit = () => {
      if (submitPaper()) CSX.setHint("确认框已弹出，请点确认");
    };
    CSX.enableSubmit();

    const filled = items.filter((i) => i.status === "filled" || i.status === "ai").length;
    const bad = items.filter((i) => i.status === "error").length;
    CSX.setHint(
      bad
        ? `${bad} 题填了但值没写进去，请检查`
        : filled
        ? `${filled} 题按记录自动填入` + (auto ? " · 自动模式开" : "")
        : "选中选项后点「记住」，下次自动填"
    );

    window.__csxDebug = {
      fakeCount: fakeSet.size,
      candidates: tableCache.count,
      items,
    };
    console.log("[CSX] ready", window.__csxDebug);

    /* 解码与填入完成后才允许自动提交 */
    ready = true;
    if (auto) autoRun();
  }

  /* 题目异步渲染：document_idle 时可能还没有 .TiMu，先等再判断 */
  const bootAt = Date.now();
  (function boot() {
    if (window.__csxMounted) return;
    if (document.querySelectorAll(".TiMu").length === 0) {
      if (Date.now() - bootAt < 20000) setTimeout(boot, 400);
      return;
    }
    window.__csxMounted = true;
    run().catch((e) => {
      console.error("[CSX]", e);
      CSX.showError("失败：" + e.message);
    });
  })();

})();
