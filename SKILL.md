---
name: chaoxing-auto-study
description: Automates Chaoxing/Xuexitong (超星学习通) video watching and chapter quiz answering by driving the user's real Edge browser with computer-use. Use when the user gives a mooc1.chaoxing.com studentstudy URL and asks to auto-play videos, complete 任务点, or answer 章节测验. Do not use for non-Chaoxing sites or for quiz answering without a browser session.
---

# 学习通自动刷课 + 章节测验答题

用 computer-use MCP 操作用户已在 Edge 中打开的课程页面，逐节完成「视频 + 章节测验」。

## 前置

1. 用户必须已经用**自己的 Edge** 打开学生页面并已登录。不要新开浏览器、不要用 CDP/调试端口、不要 kill Edge 进程。
2. 视频会检测焦点：Edge 必须保持前台且不最小化，否则自动暂停。开始前提醒用户不要切走窗口。
3. 用户按 **ESC** 会立即终止 computer-use。发现返回 “Computer Use was stopped by the user” 时，停止操作并汇报进度。

## 启动

用 `list_apps` 拿到 `msedge.exe` 的 pid（若无则让用户打开页面）。之后每个 Exec 脚本开头都要定义：

```js
async function cu(tool_name, args) { return await tools.run_mcp({ server_name: "ide_mcp.config.ext.computer-use", tool_name, args }); }
```

**等待一律用条件轮询，不要写固定 sleep。** 每次 `get_app_state` 本身耗 0.3–2 秒，所以轮询间隔取 300–500ms 即可，别更密：

```js
async function waitFor(pid, windowId, pred, { timeout = 8000, interval = 400 } = {}) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < timeout) {
    const st = await cu("get_app_state", { pid, windowId, disableScreenshot: true, disableDiff: true });
    const t = st.content.filter(b => b.type === "text").map(b => b.text).join("\n");
    if (pred(t)) return { ok: true, text: t, ms: Date.now() - t0 };
    last = t;
    await new Promise(r => setTimeout(r, interval));
  }
  return { ok: false, text: last, ms: Date.now() - t0 };
}
```

## 单节循环

对每一节按以下顺序执行，每步之间重新观察，不要凭记忆复用坐标。点击后立刻 `waitFor` 目标特征，命中就走，命中不了才等满 timeout。

### 1. 进入小节
点右侧目录里目标小节条目（x≈1080，y 按截图），然后 `waitFor(t => t.includes("任务点") || t.includes("章节测验"))` 确认新页加载完成，不要固定等 3 秒。

### 2. 播放视频
点视频中央播放按钮（约 527,551），`waitFor(t => t.includes("音频正在播放"), { timeout: 5000 })`。

进度从 UI 树读取，**不要读截图判断进度**：

```js
const state = await cu("get_app_state", { pid: PID, windowId: WIN, disableScreenshot: true, disableDiff: true });
const t = state.content.filter(b => b.type === "text").map(b => b.text).join("\n");
const prog = t.match(/进度小节"[^\n]*val=([\d.]+)/);   // val 是百分比
const playing = t.includes("音频正在播放");
const done = t.includes("任务点已完成");
```

轮询模板（一次 Exec 最多跑 9 分钟，超时会被截断，所以要分段循环）：

```js
for (let i = 0; i < 9; i++) {
  await new Promise(r => setTimeout(r, 60000));
  const st = await cu("get_app_state", { pid: PID, windowId: WIN, disableScreenshot: true, disableDiff: true });
  const t = st.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const p = t.match(/进度小节"[^\n]*val=([\d.]+)/);
  const ok = t.includes("任务点已完成");
  text(`[${i+1}min] ${p ? parseFloat(p[1]).toFixed(1) : "?"}% playing=${t.includes("音频正在播放")} done=${ok}`);
  if (ok || (p && parseFloat(p[1]) >= 90)) { text("达标"); break; }
  if (!t.includes("音频正在播放")) { text("视频已暂停"); break; }
}
```

判定完成的条件：`任务点已完成` 出现，或进度 ≥ 90%。达标后**立即停止等待**，不必看完。

间隔自适应：进度 < 80% 时每 60 秒查一次；≥ 80% 后改成 15–30 秒查一次，避免在结尾白等一整分钟（每节可省 30–45 秒）。

### 3. 切到章节测验
视频播放结束后页面常进入纯视频模式，标题和 `视频 / 章节测验` 胶囊标签都不见了。

**不要用 `list-item "章节测验"` 判断标签栏已恢复**——该节点在纯视频模式下依然存在于 DOM，会误判成功。

恢复顺序（每一步都用截图确认标题+胶囊标签真的可见，不能只看树）：

1. 点地址栏刷新（91,60）。约一半情况有效。
2. 无效就点左上「返回课程」（36,60）；它会退回到上一状态并重新渲染，实测常能恢复。
3. 仍无效就点目录里相邻小节，再点回目标小节。

标签栏可见后点「章节测验」（约 210,231），再 `waitFor(t => t.includes("满分"))` 确认进入测验页。

### 4. 读题与作答
**一次读完**：滚动 1–2 屏把所有题一次性截完（每屏滚 0.6–0.75 页）。3 道题通常 2 屏就能全看到，先记清每题的题号→选项→y 坐标再动手。

- 滚动必须用 `element_id: "0"`（窗口根），配合坐标；用具体控件 id 常常无效。
- 单选题/判断题的选项圆圈统一在 x≈161，y 以当前截图为准。
- **点完立刻截图确认圆圈已变实心**。选项行之间有空隙，点偏了不会报错，只会静默漏答。宁可每题验一次，也不要盲连点——漏答后提交会被弹窗拦下，返工更慢。
- 答案依据课程内容判断；点之前先核对题号与选项字母，避免错行。

### 5. 提交
滚到底部点「提交」（约 590,343，以截图为准）。

**弹窗文字不在无障碍树里**，`waitFor` 检测不到「确认提交」，不要在这里死等。点完等约 1.2 秒直接截图看弹窗：

- 显示「确认提交?」→ 点「提交」（约 780,440）。
- 显示「您还有未做完的 单选题，确认提交吗?」→ **必须点「取消」**（约 658,440），回去补选漏掉的题，重新提交。

### 6. 验证
提交后等约 2.5 秒截图，直接看结果页是否每题绿勾 + 「本次成绩 100 分」。看到 100 分即可结束本节。若有红叉，记下错题，不要重复提交同一份答案。

### 7. 下一节
点目录下一节条目，`waitFor(t => t.includes("任务点"))` 确认已进入新节，然后直接循环到第 2 步。目录条目 y 坐标按当前截图推算，用完即弃。

## 常见故障

| 现象 | 处理 |
|---|---|
| `get_app_state` 截图变成小块 “javascript:void(0);” | 页面弹出了同进程的小弹层干扰截图。调用时显式传主窗口 `windowId`（如 590796），并加 `disableDiff: true` |
| 点击 `element_id` 无反应 | 该站点的控件是坐标热区。改用主窗口根 `element_id: "0"` + 截图坐标 |
| 目录点击后没有标签栏 | 依次试刷新 → 「返回课程」→ 切别的小节再切回，每步都要截图确认胶囊标签可见 |
| `waitFor` 明明没出现却返回 ok | 无障碍树里可能存在隐藏节点（如纯视频模式下的 `章节测验` 标签）。对「是否可见」的判断一律以截图为准 |
| 提交弹窗提示「还有未做完的题」 | 说明有选项点偏了。点「取消」回去补选，不要强提交 |
| 进度长时间不动 | 视频暂停了，多半是 Edge 失焦/最小化；提醒用户切回窗口后点播放按钮 |
| 测验提交后仍有题「待完成」 | 说明视频任务点未真正达标（进度 < 90%），回去补播 |
| 返回 “stopped by the user” | 用户按了 ESC，立刻停下并汇报当前进度 |
| 节奏慢、像卡住 | 检查有没有残留固定 `setTimeout`。命中条件就该立刻走，正常每节切换+答题应在 10–20 秒内完成（不含看视频） |

## 汇报

每完成一节用一行汇报：`1.7 ✅ 100分`。全部结束后给一份清单：已完成小节、得分、未完成小节及原因。中途主动说明还剩哪些节、每节大致耗时（视频约 10–15 分钟/节）。
