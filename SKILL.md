---
name: chaoxing-auto-study
description: Automates Chaoxing/Xuexitong (超星学习通) video watching and chapter quiz answering by driving the user's real Edge browser with computer-use. Use when the user gives a mooc1.chaoxing.com studentstudy URL and asks to auto-play videos, complete 任务点, or answer 章节测验. Do not use for non-Chaoxing sites or for quiz answering without a browser session.
---

# 学习通自动刷课 + 章节测验答题

用 computer-use MCP 操作用户已在 Edge 中打开的课程页面，逐节完成「视频 + 章节测验」。

**核心流程（单遍，不跳步）**：视频播完 → 点页面顶部「章节测验」→ 答题 → 提交 → 确认 → 点页面底部「下一节」→ 播放。**不点右侧目录**（只有往回补漏时才用）。

**三条硬规则**：
1. 确认弹窗出现后**立即点确认**，不截图、不思考、不复核。
2. 答题**对错一律不复盘**：不读分数、不看绿勾、不重做，提交确认后直接下一节。
3. **导航只走页面内按钮**：前进用底部「下一节」，切习题用顶部「章节测验」。**禁止点右侧目录**——它不保证当前小节的测验已完成，实测曾因此漏做 1.20 的测验（该测验只允许作答一次，永久丢分）。
   **唯一例外**：用户明确要求回头补做某一节时，才允许点目录定位。

## 前置

1. 用户必须已经用**自己的 Edge** 打开学生页面并已登录。不要新开浏览器、不要用 CDP/调试端口、不要 kill Edge 进程。
2. **每个 Exec 脚本开始前，先单独跑一次 Shell 激活窗口**，否则坐标点击会被静默吞掉：
   ```powershell
   (New-Object -ComObject WScript.Shell).AppActivate($PID)
   ```
3. **运行时守卫**：脚本内每次 `tree()` 后检查是否出现 `not the focused window`；命中就中止本块、重新激活后再续，**绝不在未聚焦时点坐标**（点了不报错、什么都不会发生）。
4. 视频会检测焦点：Edge 必须保持前台且不最小化。
5. 用户按 **ESC** 会终止 computer-use。发现 `stopped by the user` 必须 `throw`；若正在长等待块里，直接丢弃该块，**不得重试同一操作**。

## 工具函数

```js
const MCP = "ide_mcp.config.ext.computer-use";
async function cu(n, a) {
  const r = await tools.run_mcp({ server_name: MCP, tool_name: n, args: a });
  const s = (r.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
  if (s.includes("stopped by the user")) throw new Error("USER_ESC");   // ESC 立刻停
  return s;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 只读文本树，约 0.5–0.8s，不耗截图
const tree = () => cu("get_app_state", { pid: PID, windowId: WIN, disableScreenshot: true, disableDiff: true });

// 带截图，约 3–6s：只在读题和定位「下一节」时用
async function shot() { return await tools.run_mcp({ server_name: MCP, tool_name: "get_app_state", args: { pid: PID, windowId: WIN, disableDiff: true } }); }

// 坐标点击（窗口根 "0"）：需要最近一次 get_app_state 带过截图
const clickAt = (x, y) => cu("click", { pid: PID, windowId: WIN, element_id: "0", x, y });
```

**免截图的路子优先**：目录项、「章节测验」胶囊、播放器文档都是无障碍树节点，直接 `cu("click", { element_id: 节点id })` 就生效。坐标点击留给选项圆圈、提交、确认、下一节。

播放器文档节点 id 的取法（**必须带前导空格**，否则会误匹配 URL 里的 `clazzid=`）：

```js
const line = t.split("\n").find(l => l.includes("knowledge/cards")) || "";
const id = (/ id=(\d+)/.exec(line) || [])[1];
```

## 执行纪律

1. **单次 Exec ≤60s**。等视频达标这类长等待，循环按 55s 上限退出，输出一行状态，下一块再续。实测超过 2 分钟的调用会被用户打断，等于白跑。
2. 块间只输出一行：`elapsed=xxs state=playing|done|popup`。
3. **禁止在一个 Exec 里既长等待又做多屏读题**，会把一次调用拖到几分钟。

```js
const t0 = Date.now();
while (Date.now() - t0 < 55000) {
  const t = await tree();
  if (/not the focused window/.test(t)) { text("UNFOCUSED"); exit(); }   // 先 AppActivate 再续
  if (POPUP(t)) { text("POPUP"); exit(); }
  if (t.includes("任务点已完成")) { text("DONE"); exit(); }
  if (!t.includes("音频正在播放")) await pressSpace();
  await sleep(5000);
}
text("STILL_RUNNING " + Math.round((Date.now()-t0)/1000) + "s");
```

## 单节循环

### 1. 播放

```js
await cu("press_key", { pid: PID, windowId: WIN, key: "Ctrl+Home" }); // 进节后回顶，视频才在视野内
await sleep(350);
const t = await tree();
const id = (/ id=(\d+)/.exec(t.split("\n").find(l => l.includes("knowledge/cards")) || "") || [])[1];
if (id) await cu("click", { pid: PID, windowId: WIN, element_id: id });
await sleep(300);
await cu("press_key", { pid: PID, windowId: WIN, key: "Space" });   // Space 比点播放按钮可靠
await sleep(1500);
```

判定：`t.includes("音频正在播放")`。没播就再按一次 `Space`（不要退回坐标点播放按钮）。

进节后若树里已有待答插播题（回看旧节才会出现），先答完再播。

### 2. 等达标（状态机）

```js
const POPUP = t => /共\s*\d+\s*题[，,]\s*已答对/.test(t)
                || (/判断题|单选题|多选题/.test(t) && !t.includes("满分") && !t.includes("答题卡"));
while (true) {
  const t = await tree();
  if (POPUP(t)) { await answerInline(); continue; }        // 插播题：原地答，不换页
  if (t.includes("任务点已完成")) break;                    // 达标，立刻走
  if (!t.includes("音频正在播放")) { await cu("press_key", { pid: PID, windowId: WIN, key: "Space" }); }
  await sleep(6000);                                       // 文本树读不到进度，靠 done 标志
}
```

树里读不到播放进度和时长，**不要靠截图判断进度**，只等「任务点已完成」。

#### 插播题（覆盖在播放器上的深色面板）

- 树里能读到题干和选项；面板不遮挡右侧目录。
- 选项圆圈在面板左侧约 13% 窗宽，行距约 11% 窗高；「提交」胶囊约 70% 窗宽 / 89% 窗高。
- 答完点面板「提交」，面板消失后按 `Space` 继续播。

### 3. 视频播完 → 章节测验

播完后页面常变纯视频模式，顶部标题和胶囊整块消失，**先回顶再看有没有**：

```js
await cu("press_key", { pid: PID, windowId: WIN, key: "Ctrl+Home" });
await sleep(350);
let t = await tree();
let tab = (/list-item "章节测验"[^i]*? id=(\d+)/.exec(t) || [])[1];
if (!tab) {                                   // 顶部没看到就向上滚轮找
  await cu("scroll", { pid: PID, windowId: WIN, element_id: "0", x: 500, y: 300, delta_x: 0, delta_y: -600 });
  await sleep(400); t = await tree();
  tab = (/list-item "章节测验"[^i]*? id=(\d+)/.exec(t) || [])[1];
}
if (tab) await cu("click", { pid: PID, windowId: WIN, element_id: tab });
```

进页判定用 `满分` 或 `答题卡`，**不要用 `章节测验`**（隐藏节点会误判）。

> 实测：`scroll` 的 `delta_y` 负值在部分页面被当成向下；`Ctrl+End`/`PageUp` 对内容区常常无效。优先用工具栏的 `scroll`，其次 `press_key PageDown`。

### 4. 读题作答（必须截图：题干字体混淆，树里是乱码）

习题页做了字体反爬（「甲午海战」→「懪午懮战」），**只能截图用眼睛读**。

- 一屏读完并**立刻点掉本屏所有题**，再去下一屏；3 题通常 1–2 屏。
- **缩页实测（1280×720 屏）**：80% 时圆圈 x≈131、行距 **40px**，一屏约 2 题；50% + F11 可把 3 题连同「提交」塞进一屏（圆圈 x≈76、行距 28px、提交 (566,623)、确认 (713,393)）。
- **50% 的代价**：行距 28px，偏 ±8px 就落到相邻选项。实测把 C 点成 D，直接丢 33.3 分。**默认用 80%；50% 只在题 ≤3 且行距能精确读出时用。**
- **缩放不是免费的**：非 100% 缩放下点中选项会触发「滚动到焦点」，页面会自己位移，**上一张截图的坐标随即失效**。所以一次截图只点一道题，点完立刻重新截图，不要拿一张图的坐标连点一串。
- **选项圆圈固定在 x≈161**（100% 缩放）；x≈130 点空，不报错、静默漏答。
- 答案按课程内容判断；对错不计较（见硬规则 2）。

### 5. 提交 → 确认（不犹豫）

```js
await cu("scroll", { pid: PID, windowId: WIN, element_id: "0", x: 500, y: 450, delta_x: 0, delta_y: 900 });
await sleep(500);           // 滚到底
await clickAt(590, 550);    // 「提交」
await sleep(800);
await clickAt(780, 440);    // 「确认提交?」→ 直接点，不看不想
```

出现「还有未做完的题」说明有选项点偏：点「取消」(658,440) 补选后重提，不要强提交。

### 6. 下一节

滚到底找「下一节」（1280×672 窗口实测 y≈548，随页面高度浮动，用一张截图定位）：

```js
await cu("scroll", { pid: PID, windowId: WIN, element_id: "0", x: 500, y: 450, delta_x: 0, delta_y: 900 });
await sleep(400);
await clickAt(847, 548);
```

节点树里**没有**「下一节」按钮，只能用坐标。

### 7. 窗口耗时

`T0` 取「任务点已完成」那一刻，终点取新节 `音频正在播放`：

```js
text("WINDOW=" + ((Date.now()-T0)/1000).toFixed(1) + "s");
```

实测参考：新节加载 2.5–7s（有缓存时 2.5s），点播放到出声约 1.5s，答案读图 3–6s/张。
3 题一屏的节约 13–17s；需要翻第二屏或题多则 20s 以上——如实汇报，不掩饰。

## 已确认答案（避免重犯）

| 节 | 题 | 正确项 |
|---|---|---|
| 1.20 | 判断：现代国防斗争以军事实力对抗为主，也是多种非武装斗争形式的综合角逐 | **对** |
| 1.21 | 单选：蒙哥马利要把进攻（ ）列为世界一大禁忌 | 俄罗斯 |
| 1.21 | 多选：（ ）构成我国国力的基本要素 | 经济实力、国防实力、民族凝聚力 |
| 1.22 | 单选：2003 年布什降落林肯号宣布（ ）战争结束 | 伊拉克 |
| 1.22 | 单选：（ ）说没有原子弹卫星就没有国际地位 | 邓小平 |

## 常见故障

| 现象 | 处理 |
|---|---|
| 点了没反应 / 树里出现 `not the focused window` | Edge 不在前台。先 `AppActivate($PID)`，再操作 |
| 播放起不来 | 点播放器文档节点拿到焦点，再按 `Space`；坐标点播放按钮常失效 |
| 页面停在内容中部看不到顶部胶囊 | 先 `Ctrl+Home`，不行再用 `scroll` 向上 |
| 坐标点击静默失效 | 最近一次 `get_app_state` 必须带截图；翻屏/加载后重新 `shot()` |
| 点选项后页面自己位移、后续连点全失效 | 缩放 <100% 时点中会「滚动到焦点」。一次截图只点一道题，点完立刻重拍 |
| 习题页题干是乱码 | 字体反爬，只能截图读 |
| 点选项没选中也不报错 | 圆圈固定在 x≈161（100%）；80% 时 x≈131 |
| 插播题弹出、视频暂停 | 原地作答（不换页），答完按 `Space` 继续 |
| 回到任务点已绿的旧节，弹窗又出现 | 那节插播题没答，先补答再播放 |
| 提交弹窗迟迟不点 | 违规。弹窗出现即点确认（100% 缩放时 (780,440)） |
| 想验证得分 | 不需要。只允许作答一次，复盘无收益，直接下一节 |
| 返回 `stopped by the user` | 用户按 ESC：立刻停止、汇报已完成小节与当前进度、**丢弃正在跑的长等待块**，不得重试同一操作 |
| 选错题标 `x≈161` 仍然漏答 | 先确认页面没有因滚动导致整体位移，重新 `shot()` 后按新坐标点 |

## 汇报

每节一行：`1.20 ✅ 15.3s`（超 20s 标 ⚠️ 并注明卡在哪一步）。全部结束后给清单：已完成小节、各节窗口耗时、未完成小节及原因。分数只在用户明确要求时回看。
