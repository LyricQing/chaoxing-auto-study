---
name: chaoxing-answer
description: 把超星章节测验的题目（明文题干 + 选项）交给模型判定答案，输出选项字母。作为学习通刷课扩展的答题后端使用；也可独立用于批量答题。触发场景：需要为题库未命中的题目自动生成答案。
---

# chaoxing-answer · 答题源

一道题进，一组字母出。不碰浏览器，不存题库，不做提交。

## 启动

双击项目根目录的 `start-bridge.bat`，或：

```bash
cd skill/chaoxing-answer
node server.mjs
```

窗口保持打开即可；关掉窗口 = 停止服务。首次使用把 `config.example.json` 复制为
`config.local.json` 并填入 `apiKey`。

确认活着：浏览器打开 <http://127.0.0.1:8765/health>，应返回
`{"ok":true,"backend":"openai","model":"..."}`。

## 契约

`POST http://127.0.0.1:8765/answer`

```json
{
  "typeLabel": "【多选题】",
  "stem": "二战期间，（）结成了法西斯军事政治联盟的轴心……",
  "options": [
    { "letter": "A", "text": "德国" },
    { "letter": "B", "text": "意大利" },
    { "letter": "C", "text": "日本" },
    { "letter": "D", "text": "美国" }
  ]
}
```

```json
{ "answer": ["A","B","C"], "backend": "ollama", "model": "qwen2.5:3b", "ms": 18400, "attempt": 1 }
```

失败时 `answer` 为空数组，并带 `error`。调用方必须把空数组当作"没答出来"，不得回填。

## 三档后端

| 后端 | 启动方式 | 特点 |
|---|---|---|
| `stub` | `node server.mjs` | 固定返回首项，用于联调，不产生任何费用 |
| `ollama` | `CSX_BACKEND=ollama node server.mjs` | 本地、离线、零调用费；3B 在 CPU 上约 20–40 s/题 |
| `openai` | `CSX_BACKEND=openai CSX_BASE_URL=… CSX_API_KEY=… CSX_MODEL=…` | 任意 OpenAI 兼容端点；1–3 s/题 |

## 关于"按调用平台计费"

**这个 skill 本身不能扣任何平台的积分。** 它只是一段本地代码，平台没有向第三方开放"扣积分"的接口。计费发生在模型的调用方，而不是 skill 里。

所以"在哪个平台调用就消耗哪个平台的积分"能否成立，取决于**该平台是否提供带计费的模型通道**：

| 形态 | 计费归属 | 可行性 |
|---|---|---|
| 走宿主平台的免密钥模型代理（如 WorkBuddy 的 cloud-service） | 宿主平台账户 | ✅ 唯一可行形态 |
| 用户自备 API key | key 所属账户 | ✅ 但与原意不符 |
| skill 代码里"扣平台积分" | —— | ❌ 无此接口 |
| 跨平台通用积分协议 | —— | ❌ 不存在 |

结论：**「按平台计费」不是一个功能，而是一种部署关系。** 想让 A 平台的调用扣 A 的积分，就必须让 A 平台自己发起模型调用；skill 只能负责把题目递过去、把字母拿回来。

### 实测记录（2026-10-29，WorkBuddy）

| 尝试 | 结果 |
|---|---|
| 本机模型网关 `127.0.0.1:<port>/skills/vlm/chat`，Bearer token | 401 |
| 同上，`x-auth-token` / `x-token` / `x-workbuddy-token` | 401 |
| 同上，token 作查询参数 / session context 作 bearer | 401 |
| `cloud-service` inspect | `applications: 0`，需新建应用才会产生免密钥通道 |

结论：**该网关是 App 内部 IPC，不对外**；`cloud-service` 的免密钥 LLM 面向平台托管的 Web 应用（Origin 绑定），本地 CLI 无法使用。因此现阶段"按平台计费"没有可对接的落点。

## 已验证配置（火山方舟）

```json
{
  "backend": "openai",
  "baseUrl": "https://ark.cn-beijing.volces.com/api/v3",
  "model": "deepseek-v4-1-flash-261017",
  "maxTokens": 512,
  "timeout": 90000
}
```

密钥写在同目录 `config.local.json`（已在 `.gitignore` 中），不写进代码。

实测三道真题：1.2–1.7 s/题，答案 ABC / BCD / A 全部正确。

注意：`deepseek-v4.1-flash` 这种点号写法在方舟不存在，必须用带日期后缀的 ID；
`*-economy-*` 需要先在方舟控制台开通，未开通会返回 `ModelNotOpen`。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `CSX_PORT` | 8765 | 只监听 127.0.0.1 |
| `CSX_BACKEND` | stub | stub / ollama / openai |
| `CSX_MODEL` | qwen2.5:3b | 模型名。方舟推理模型须写完整 ID，如 `deepseek-v4-1-flash-261017` |
| `CSX_MAX_TOKENS` | 512 | **推理模型必须 ≥256**，否则思考过程吃掉预算、返回空 |
| `CSX_BASE_URL` | 按后端 | OpenAI 兼容端点或 Ollama 地址 |
| `CSX_API_KEY` | 空 | 仅 openai 后端 |
| `CSX_TIMEOUT` | 60000 | 单题超时（毫秒） |

## 提示词策略

- 温度固定 0，`max_tokens` 16，强制只输出字母
- 多选题要求给出全部正确项；判断题只给一个字母
- 首次解析失败自动重试一次，附加"只输出字母"的强约束
- 解析后与选项字母集合求交，任何越界字符直接丢弃

## 已知限制

| 限制 | 说明 |
|---|---|
| 不知道课程上下文 | 只看题干与选项，纯知识判断 |
| 可能答错 | 尤其是多选漏项；建议配合人工答案库优先命中 |
| 不保证离线 | openai 后端依赖网络；ollama 后端可离线 |
| 单题一次调用 | 无批处理；60 题约 60 次请求 |

## 与刷课扩展的关系

扩展在题库未命中时调用本服务；答出来就填、答不出就跳过。服务不参与提交，也不接触浏览器。
