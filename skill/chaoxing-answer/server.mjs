#!/usr/bin/env node
/**
 * chaoxing-answer · 本地答题桥
 *
 * 职责单一：收一道题，返回答案字母。不碰浏览器、不存题库。
 * 三种后端：
 *   stub    —— 固定返回首项，用于联调（不需要任何模型）
 *   ollama  —— 本地 Ollama（默认 qwen2.5:3b）
 *   openai  —— 任意 OpenAI 兼容端点（平台免密钥代理 / 自备 key）
 *
 * 起法：
 *   node server.mjs                     # 默认 stub
 *   CSX_BACKEND=ollama node server.mjs
 *   CSX_BACKEND=openai CSX_BASE_URL=... CSX_API_KEY=... CSX_MODEL=... node server.mjs
 */

import http from "node:http";
import { readFileSync, existsSync, appendFileSync } from "node:fs";

const CFG_PATH = new URL("./config.local.json", import.meta.url);
let fileCfg = {};
try {
  if (existsSync(CFG_PATH)) fileCfg = JSON.parse(readFileSync(CFG_PATH, "utf8"));
} catch (e) {
  console.warn("[csx-answer] config.local.json 读取失败，用环境变量");
}

const PORT = Number(process.env.CSX_PORT || 8765);
const BACKEND = process.env.CSX_BACKEND || fileCfg.backend || "stub";
const MODEL =
  process.env.CSX_MODEL ||
  fileCfg.model ||
  (BACKEND === "ollama" ? "qwen2.5:3b" : "gpt-4o-mini");
const BASE_URL =
  process.env.CSX_BASE_URL ||
  fileCfg.baseUrl ||
  (BACKEND === "ollama" ? "http://127.0.0.1:11434" : "https://api.openai.com/v1");
const API_KEY = process.env.CSX_API_KEY || fileCfg.apiKey || "";
const MAX_TOKENS = Number(process.env.CSX_MAX_TOKENS || fileCfg.maxTokens || 512);
const TIMEOUT_MS = Number(process.env.CSX_TIMEOUT || fileCfg.timeout || 60000);

function buildPrompt(q, extra) {
  const opts = (q.options || []).map((o) => `${o.letter}. ${o.text}`).join("\n");
  const lines = [
    "你是课程测验答题器。只输出答案，不要解释。",
    "",
    `题型：${q.typeLabel || ""}`,
    `题干：${q.stem}`,
    "选项：",
    opts,
    "",
    '输出格式：只输出选项字母，多个字母连写，例如 "AC"。',
    "多选题给出全部正确项；单选题与判断题只给一个字母。",
  ];
  if (extra) lines.push("", extra);
  return lines.join("\n");
}

async function callOllama(prompt) {
  const r = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0 },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const j = await r.json();
  return (j.message && j.message.content) || "";
}

async function callOpenAI(prompt) {
  const r = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const t = (await r.text()).slice(0, 120);
    throw new Error(`openai ${r.status} ${t}`);
  }
  const j = await r.json();
  return j.choices?.[0]?.message?.content || "";
}

function parseLetters(text, valid) {
  const set = new Set(valid);
  const out = [];
  for (const ch of String(text).toUpperCase()) {
    if (set.has(ch) && !out.includes(ch)) out.push(ch);
  }
  return out.sort();
}

async function attempt(q, valid, extra) {
  if (BACKEND === "stub") {
    const first = (q.options[0] && q.options[0].letter) || "A";
    return { raw: first, letters: [first] };
  }
  const prompt = buildPrompt(q, extra);
  const raw = BACKEND === "ollama" ? await callOllama(prompt) : await callOpenAI(prompt);
  return { raw, letters: parseLetters(raw, valid) };
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-private-network": "true",
    });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "OPTIONS") return send(204, {});
  if (req.method === "GET" && req.url === "/health") {
    return send(200, { ok: true, backend: BACKEND, model: MODEL });
  }
  if (req.method !== "POST" || req.url !== "/answer") {
    return send(404, { error: "not found" });
  }

  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1e6) return send(413, { error: "too large" });
  }

  let q;
  try {
    q = JSON.parse(body);
  } catch (e) {
    return send(400, { error: "bad json" });
  }
  if (!q.stem || !Array.isArray(q.options) || !q.options.length) {
    return send(400, { error: "missing stem/options" });
  }

  const valid = q.options.map((o) => o.letter);
  const t0 = Date.now();

  const log = (letters, ms) => {
    try {
      appendFileSync(
        new URL("./answers.jsonl", import.meta.url),
        JSON.stringify({
          at: new Date().toISOString(),
          qid: q.qid || null,
          stem: String(q.stem).slice(0, 80),
          answer: letters,
          ms,
          model: MODEL,
        }) + "\n"
      );
    } catch (e) {}
  };

  try {
    const first = await attempt(q, valid, "");
    if (first.letters.length) {
      log(first.letters, Date.now() - t0);
      return send(200, {
        answer: first.letters,
        backend: BACKEND,
        model: MODEL,
        ms: Date.now() - t0,
        attempt: 1,
      });
    }

    const second = await attempt(
      q,
      valid,
      "上一次输出无法解析。本次只输出选项字母，不要标点、空格、解释或任何其他字符。"
    );
    if (second.letters.length) {
      log(second.letters, Date.now() - t0);
      return send(200, {
        answer: second.letters,
        backend: BACKEND,
        model: MODEL,
        ms: Date.now() - t0,
        attempt: 2,
      });
    }

    return send(200, {
      answer: [],
      error: "unparsable",
      raw: String(second.raw).slice(0, 200),
      backend: BACKEND,
      ms: Date.now() - t0,
    });
  } catch (e) {
    return send(502, { error: String(e.message || e), backend: BACKEND });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[csx-answer] http://127.0.0.1:${PORT}  backend=${BACKEND} model=${MODEL}`
  );
});
