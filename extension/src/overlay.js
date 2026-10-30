/* 面板：展示解码结果，并承载「记住选择 / 校验」两个动作。 */
(() => {
  const CSX = (window.CSX = window.CSX || {});

  let panel = null;
  let body = null;
  let status = null;
  let hint = null;
  let submitBtn = null;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  CSX.mountPanel = function () {
    if (panel) return panel;

    panel = el("div", "csx-panel");

    const head = el("div", "csx-head");
    head.appendChild(
      el("span", "csx-title", "题目明文 v" + (CSX.VERSION || "?"))
    );
    status = el("span", "csx-status", "准备中…");
    head.appendChild(status);
    const close = el("button", "csx-btn", "收起");
    close.onclick = () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      close.textContent = hidden ? "收起" : "展开";
    };
    head.appendChild(close);
    panel.appendChild(head);

    body = el("div", "csx-body");
    panel.appendChild(body);

    const foot = el("div", "csx-foot");
    hint = el("span", "csx-hint", "选中选项后点「记住」，下次自动填");
    foot.appendChild(hint);

    const aiBtn = el("button", "csx-btn", "AI：关");
    function paintAi(v) {
      aiBtn.textContent = "AI：" + (v ? "开" : "关");
      aiBtn.classList.toggle("csx-on", !!v);
    }
    chrome.storage.local.get("csx_bridge").then((o) => paintAi(!!o.csx_bridge));
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.csx_bridge) paintAi(!!ch.csx_bridge.newValue);
    });
    aiBtn.onclick = async () => {
      const o = await chrome.storage.local.get("csx_bridge");
      const v = !o.csx_bridge;
      await chrome.storage.local.set({ csx_bridge: v });
      paintAi(v);
    };
    foot.appendChild(aiBtn);

    const submit = el("button", "csx-btn", "提交");
    submit.style.display = "none";
    submit.onclick = () => CSX.__submit && CSX.__submit();
    foot.appendChild(submit);
    submitBtn = submit;
    const logBtn = el("button", "csx-btn", "跳过记录");
    logBtn.onclick = async () => {
      try {
        const o = await chrome.storage.local.get("csx_log");
        const log = o.csx_log || [];
        if (!log.length) {
          logBtn.textContent = "无记录";
          setTimeout(() => (logBtn.textContent = "跳过记录"), 1500);
          return;
        }
        const lines = log.map(
          (x) => `${x.cid}  ${x.reason}  ${new Date(x.at).toLocaleString()}`
        );
        await navigator.clipboard.writeText(lines.join("\n"));
        logBtn.textContent = "已复制 " + log.length;
        setTimeout(() => (logBtn.textContent = "跳过记录"), 1800);
      } catch (e) {
        logBtn.textContent = "失败";
      }
    };
    foot.appendChild(logBtn);

    const copy = el("button", "csx-btn", "复制");
    copy.onclick = () => {
      navigator.clipboard.writeText(body.innerText.replace(/\u00a0/g, " ")).then(
        () => {
          copy.textContent = "已复制";
          setTimeout(() => (copy.textContent = "复制"), 1500);
        },
        () => (copy.textContent = "失败")
      );
    };
    foot.appendChild(copy);
    panel.appendChild(foot);

    document.body.appendChild(panel);
    return panel;
  };

  CSX.setStatus = function (text) {
    if (status) status.textContent = text;
  };

  CSX.enableSubmit = function () {
    if (submitBtn) submitBtn.style.display = "";
  };

  CSX.setHint = function (text) {
    if (hint) hint.textContent = text;
  };

  CSX.showError = function (text) {
    CSX.mountPanel();
    body.innerHTML = "";
    body.appendChild(el("div", "csx-warn", text));
  };

  const STATUS_TEXT = {
    recorded: "已记录",
    filled: "自动填入",
    new: "新题",
    ai: "AI 填入",
    error: "需检查",
  };

  CSX.renderQuestions = function (items, meta) {
    CSX.mountPanel();
    body.innerHTML = "";

    if (!items.length) {
      body.appendChild(el("div", "csx-warn", "没有解析到题目"));
      return;
    }

    for (const q of items) {
      const wrap = el("div", "csx-q");

      const head = el("div", "csx-qhead");
      head.appendChild(
        document.createTextNode(
          `${q.typeLabel || "题目"}${q.qid ? " · " + q.qid : ""}`
        )
      );
      if (q.status && STATUS_TEXT[q.status]) {
        const badge = el("span", "csx-badge csx-badge-" + q.status);
        badge.textContent = STATUS_TEXT[q.status];
        head.appendChild(badge);
      }
      wrap.appendChild(head);

      const stem = el("div", "csx-stem");
      (q.tokens || [{ c: q.stem, conf: "plain" }]).forEach((t) => {
        if (t.conf === "low" || t.conf === "failed") {
          const s = document.createElement("span");
          s.className = "csx-" + t.conf;
          s.textContent = t.c;
          s.title = t.conf === "low" ? "低置信，建议核对" : "未能解码";
          stem.appendChild(s);
        } else {
          stem.appendChild(document.createTextNode(t.c));
        }
      });
      wrap.appendChild(stem);

      for (const o of q.options) {
        const line = el("div", "csx-opt" + (o.selected ? " csx-opt-on" : ""), o.text);
        line.setAttribute("data-letter", o.letter);
        wrap.appendChild(line);
      }

      if (q.lowConf && q.lowConf.length) {
        wrap.appendChild(
          el(
            "div",
            "csx-note",
            "低置信：" +
              q.lowConf
                .map((x) => `${x.fake}→${x.real}(${x.d})`)
                .join("  ")
          )
        );
      }
      if (q.failed && q.failed.length) {
        wrap.appendChild(
          el(
            "div",
            "csx-warn",
            "未能解码：" +
              q.failed
                .map((f) => `${f.fake}→${f.real}(${f.d}/${f.margin})`)
                .join("  ")
          )
        );
      }

      const actions = el("div", "csx-actions");
      const remember = el("button", "csx-btn csx-btn-sm", "记住当前选择");
      remember.onclick = () => q.onRemember && q.onRemember();
      actions.appendChild(remember);
      if (q.expected) {
        actions.appendChild(el("span", "csx-note", "记录：" + q.expected));
      }
      wrap.appendChild(actions);

      body.appendChild(wrap);
    }

    CSX.setStatus(
      `${items.length} 题 · ${meta.ms}ms` + (meta.source === "cache" ? " · 缓存" : "")
    );
  };
})();
