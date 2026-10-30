# Phase 0 实测结果

- 日期：2026-10-29
- 样本：`phase0-questions-1793256393186.json`（3.5 国防（军事）战略【下】，3 题，满分 100）
- 页面：`mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?...&knowledgeid=1221810778`

---

## 0. 结论

| 假设 | 结论 | 证据 |
|---|---|---|
| A 字体可解 | ✅ **通过，17/17** | 离线字形匹配，17 个假字符全部还原，题干读通 |
| B 元素点击可作答 | ✅ **通过（判据修正）** | `li.click()` 后选项 A 变为选中态；`input` 由函数尾部写入 |
| C 后台视频计时 | ✅ **通过** | `deltaVideo 206.9s / deltaWall 232.4s`，比值 0.89；基线取自 `paused:true`，未播放的约 25s 稀释了分母，实际播放期间接近 1:1 |
| B2 状态→提交载荷 | ✅ **通过** | 函数尾部遍历 `.choice<qid>.check_answer_dx` 的 `data` 属性，拼接后写入 `#answer<qid>` |

A 通过意味着 **"截图读题"这条最贵、最不可靠的链路可以整条去掉**。

---

## 1. 页面结构实测（与既有文档不符）

| 项 | 既有文档（社区/旧版） | 实测 |
|---|---|---|
| 题目容器 | `div.questionLi > div.TiMu` | **没有 `.questionLi`**，题目直接是 `.TiMu` × 3 |
| 页面层级 | studentstudy 内的四层 iframe | 测验文档本身是 `iframe#frame_content` 的文档（Console context 即该帧） |
| 页头 | — | 明文可读：`章节测验 待完成 3.5 国防（军事）战略【下】 题量: 3 满分: 100.0` |

> `.questionLi` 不存在，是 v2 探针误报的直接原因。锚点必须用 `.TiMu`。

## 2. 题目 DOM 契约（实测）

```
.TiMu[data=1|3]                     type=1 多选，type=3 判断
  ├ .newZy_TItle                    【多选题】/【判断题】
  ├ .fontLabel.font-cxsecret        题干（唯一被混淆的部分）
  └ ul.Zy_ulTop > li[qid][role]
        checkbox → onclick="addMultipleChoice(this);"
        radio    → onclick="addChoice(this);"
        > a.font-cxsecret           选项文本（明文！）
input[name="answer<qid>"]           作答值
input[name="answertype<qid>"]       题型
```

三个关键修正：

1. **选项是明文**。德国/意大利/日本/美国、对/错、四条长选项，全部正常汉字。只有题干被替换。
2. **`input[name^="answer"]` 会误匹配** `answertype<qid>`。8 个输入框里只有 3 个是答案，必须用 `/^answer\d+$/`。
3. **`.num_option` 不可靠**。Q1/Q2 的字母取不到（null），Q3 才有 A/B。字母应由选项序号推导。

## 2.5 B 实测：判据修正（重要）

`li.click()` 之后：

- `input[name="answer405887675"].value` → `''`（未写）
- 但页面上 Q1 的 A 项已经变成选中态（蓝底高亮）

函数源码（页面原件，截断）：

```js
function addMultipleChoice(obj) {
  var qid = $(obj).attr("qid");
  var qt  = $(obj).attr("qtype");
  if (qt == 21 && !checkEvaluationQuesNum(obj)) return;
  if ($(obj).find(".num_option_dx").hasClass("check_answer_dx")) {
    $(obj).find(".num_option_dx").removeClass("check_answer_dx");
    $(obj).attr("aria-checked","false");
    $(obj).attr("aria-pressed","false");
  } else {
    $(obj).find(".num_option_dx").addClass("check_answer_dx");
    $(obj).attr("aria-checked","true");
    ...
  }
}
```

四个结论：

1. **作答状态存在 `.num_option_dx.check_answer_dx` 与 `li[aria-checked]` 上，不在 `input.value`。**
   → 断言必须改判据；用 `input.value` 会永远判定"未作答"。
2. 参数必须是**带 `qid` 的 `li` 本身**，`$(obj).attr("qid")` 取的就是它。
3. `qt == 21` 是"评价题"分支，会走 `checkEvaluationQuesNum` 守卫，普通章节测验不触发。
4. `.num_option` 不是选项字母容器——真实类名是 **`.num_option_dx`**，这解释了为什么 Q1/Q2 的 `letter` 抓到 null，而判断题（用 `.num_option`）能抓到 A/B。

**B2 已解决**：写入逻辑在函数尾部。

```js
var choiceContent = "";
$(".choice" + qid).each(function (index, ele) {
  if ($(this).hasClass("check_answer_dx")) {
    choiceContent = choiceContent + $(this).attr("data");
  }
});
var randomOptions = $("#randomOptions").val();
choiceContent = randomOptions ? sortMultiAnswer(choiceContent) : choiceContent;
$("#answer" + qid).val(choiceContent);
```

实测：**单击一次后 `answer405887675 = 'A'`**，其余输入框为空（`answerId`、`answerwqbid` 与本流程无关）。

三条实现约束：

1. **答案字母取自 `.num_option_dx[data]`，不是显示顺序。** 填充器要按选项文本定位元素，再读它的 `data` 拿字母，绝不能按"第几个"推断。
2. **`#randomOptions` 非空时会调用 `sortMultiAnswer`**——平台支持选项乱序。乱序开启时显示顺序与字母顺序不一致，按位置点击必错。
3. **这是 toggle 语义**：点已选中的选项会取消并写回空串。填充器必须先读状态、再决定是否点击。

关于早期 `changed:false` 的解释：`__probeClick` 连续两次作用于同一选项，一次开一次关，第二次自然写回空串；中途调试器暂停又打断过尾部写入，才呈现"点了没反应"。**不是路径不通，是幂等没做。**

## 3. 字体实测

| 项 | 值 |
|---|---|
| 家族 | `Source Han Sans CN Normal`（思源黑体，Apache-2.0） |
| unitsPerEm | 1000 |
| numGlyphs | 18（17 字形 + notdef） |
| cmap 条目 | 17 |
| 假字符集 | `岢岣岤岥岦岧岨岪岫岬岮岯岰岲岴岵罓`（U+5CA2–U+5CB5 + U+7F53） |
| 体积 | 9276 字节 |

**cmap 的 17 项恰好等于三道题里被替换字符的并集**——说明一页一张表、按需子集化。

混淆是**按字抽样**：同一页里"战"在 Q1/Q3 被替换成 `岣`，在 Q2 却保持明文。所以解码器只需替换命中项，未命中的字原样保留。

## 4. 解码结果

方法：假字符用页面字体渲染 → 候选汉字用 Noto Sans CJK SC DemiLight（= Source Han Sans Normal 字重）渲染 → 32×32 归一化位图 → 最小均方误差取最近邻。候选 20992 字。

| 假字 | 真字 | 距离 | 次优 |
|---|---|---:|---|
| 岢 | 欧 | 0.0074 | 欭 0.1102 |
| 岣 | 战 | 0.0121 | 乩 0.1418 |
| 岤 | 政 | 0.0076 | 改 0.1029 |
| 岥 | 西 | 0.0192 | 酉 0.1032 |
| 岦 | 速 | 0.0056 | 逋 0.0862 |
| 岧 | 将 | 0.0080 | 特 0.1560 |
| **岨** | **略** | **0.0770** | 峈 0.0913 ⚠ |
| 岪 | 是 | 0.0093 | 昰 0.0751 |
| 岫 | 的 | 0.0052 | 虳 0.1109 |
| 岬 | 确 | 0.0031 | 崅 0.1205 |
| 岮 | 正 | 0.0027 | 止 0.0898 |
| 岯 | 法 | 0.0028 | 怯 0.0866 |
| 岰 | 境 | 0.0037 | 璄 0.0614 |
| 岲 | 础 | 0.0022 | 砒 0.0883 |
| 岴 | 客 | 0.0037 | 峉 0.0915 |
| 岵 | 基 | 0.0149 | 茥 0.1283 |
| 罓 | 迅 | 0.0060 | 逜 0.1288 |

解码后的题干：

- Q1 二战期间，（）结成了法西斯军事政治联盟的轴心，并将战火迅速扩大到欧洲。
- Q2 关于战略与战略环境的辩证关系说法正确的是（）
- Q3 战略环境是制定战略的客观基础。

16 项距离 < 0.02，1 项（岨→略）0.077 且次优仅 0.091——**需要置信度阈值**，不能无条件信任。

## 5. 对实现的影响

| 原设计 | 改为 |
|---|---|
| `.questionLi` 为主选择器 | `.TiMu` 为主，`.questionLi` 作兼容回退 |
| `input[name^="answer"]` | `/^answer\d+$/` |
| 字母取 `.num_option` 或按序号推导 | 读 `.num_option_dx[data]`，这是平台自己的 canonical 字母 |
| 点击即视为已作答 | 先读 `check_answer_dx` / `aria-checked` 再决定是否点击（toggle 语义） |
| 按显示顺序点第 N 个 | 按选项文本定位，`#randomOptions` 开启时顺序会被打乱 |
| 截图 + VLM 读题 | 字形位图匹配解码，纯文本进 LLM |
| 靠点目录判断是否已做 | 读页头「待完成 / 已完成」明文状态，幂等 |

## 6. 剩余风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 浏览器栅格 ≠ PIL 栅格 | 线上解码要在 canvas 里渲染，与离线建表用的 FreeType 可能有像素差 | Phase 1 先在浏览器里跑一次 17/17 对照，不过就改用轮廓哈希 |
| 低置信字 | 如 岨→略 距离 0.077 | 距离 > 0.05 标 `partial`，交 LLM 结合上下文纠正，或挂起人工 |
| 字体表体积 | 20k 字 × 位图哈希约 160 KB | 可接受；也可只装常用 3500 字 + 按需扩 |
| 页面改版 | 选择器偏移 | adapter 单点收口 |

## 7. 样本文件处置

`phase0-questions-*.json` 与 `phase0-click-*.json` 含 `enc=`、`cpi` 等会话参数，**不要提交到仓库或外发**，验证完即删。
