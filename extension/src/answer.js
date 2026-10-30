/* 答题桥客户端：题库未命中时，把题目交给本地服务判定 */
(() => {
  const CSX = (window.CSX = window.CSX || {});
  const BRIDGE = "http://127.0.0.1:8765/answer";

  CSX.askBridge = async function (q, timeout = 25000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(BRIDGE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeLabel: q.typeLabel || "",
          stem: q.stem,
          options: q.options.map((o) => ({ letter: o.letter, text: o.text })),
        }),
        signal: ctrl.signal,
      });
      if (!r.ok) return { letters: [], error: "http " + r.status };
      const j = await r.json();
      if (!j.answer || !j.answer.length) {
        return { letters: [], error: j.error || "empty" };
      }
      return { letters: j.answer, ms: j.ms, backend: j.backend };
    } catch (e) {
      return { letters: [], error: String(e.message || e) };
    } finally {
      clearTimeout(timer);
    }
  };

  CSX.bridgeHealth = async function () {
    try {
      const r = await fetch("http://127.0.0.1:8765/health", {
        signal: AbortSignal.timeout(3000),
      });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  };
})();
