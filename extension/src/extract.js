/* 题目抽取：按实测 DOM 契约取题。
 * .TiMu[data=1|3] → .newZy_TItle 题型 / .fontLabel 题干 / ul.Zy_ulTop > li 选项
 * 选中状态在 .num_option_dx.check_answer_dx 上，作答值最终写入 #answer<qid>。
 */
(() => {
  const CSX = (window.CSX = window.CSX || {});

  CSX.extractQuestions = function (doc) {
    const nodes = Array.from(doc.querySelectorAll(".TiMu"));
    const seen = new Set();

    return nodes
      .map((el, idx) => {
        const type = el.getAttribute("data");
        const labelEl = el.querySelector(".newZy_TItle");
        const stemEl =
          el.querySelector(".fontLabel") || el.querySelector(".Zy_TItle");
        const lis = Array.from(el.querySelectorAll("ul.Zy_ulTop > li"));
        const qid = lis.length ? lis[0].getAttribute("qid") : null;

        if (!stemEl || !qid || seen.has(qid)) return null;
        seen.add(qid);

        const options = lis.map((li, i) => {
          const mark =
            li.querySelector(".num_option_dx") ||
            li.querySelector(".num_option") ||
            li.querySelector("a");
          const textEl = li.querySelector("a") || li;
          return {
            letter: String.fromCharCode(65 + i),
            data: mark ? mark.getAttribute("data") : null,
            text: (textEl.textContent || "").trim(),
            selected: !!(mark && /check_answer/.test(mark.className)) ||
              li.getAttribute("aria-checked") === "true",
            el: li,
            mark,
          };
        });

        const input =
          doc.getElementById("answer" + qid) ||
          doc.querySelector('input[name="answer' + qid + '"]');

        return {
          idx,
          qid,
          type,
          typeLabel: labelEl ? labelEl.textContent.trim() : "",
          stemEl,
          stemRaw: (stemEl.textContent || "").trim(),
          options,
          input,
          value: input ? input.value : null,
        };
      })
      .filter(Boolean);
  };

  /* 页头明文状态：「待完成」「已完成」，用于幂等判断 */
  CSX.readPageState = function (doc) {
    const text = (doc.body && doc.body.innerText) || "";
    const head = text.replace(/\s+/g, " ").slice(0, 400);
    return {
      pending: /待完成/.test(head),
      done: /已完成/.test(head),
    };
  };
})();
