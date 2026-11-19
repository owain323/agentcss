/**
 * t-driver.mjs — T 组契约任务驱动（调 DeepSeek API 生成 patch，用 runDeterministic 评分）
 * 🔴 密钥只从 env 读。本文件不含任何密钥。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './run.js';
import { createRequire } from 'node:module';
const ROOT_ESM = join(dirname(fileURLToPath(import.meta.url)), '..');
const require2 = createRequire(import.meta.url);
const patchMod = require2(join(ROOT_ESM, 'ai', 'patch.js'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) { console.error('❌ 设 DEEPSEEK_API_KEY'); process.exit(2); }

const MODEL = 'deepseek-chat';
const API_URL = 'https://api.deepseek.com/chat/completions';
const ATTEMPTS = parseInt(process.argv.find(a => a.startsWith('--attempts='))?.split('=')[1] || '3');
const TASK_FILTER = process.argv.find(a => a.startsWith('--tasks='))?.split('=')[1]?.split(',') || null;

const SYSTEM = `你是一个 JSON patch 生成器。给定一个文档结构和一条编辑意图，输出一个 JSON patch。
输出格式：{"ops": [{"op": "update", "id": "<节点id>", "set": {<要改的字段>}}]}
规则：
- 只输出 JSON，不加解释
- 只改 intent 要求的部分，其他节点一个字不动
- 不许加页面级 override
- 用库提供的组件结构，不自创类名`;

async function callDeepSeek(messages) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.choices[0].message.content;
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

const tasks = TASK_FILTER ? TASKS.filter(t => TASK_FILTER.includes(t.id)) : TASKS;
const runs = [];
let ok = 0, fail = 0, apiErr = 0;

console.log(`=== T 组 benchmark：${tasks.length} 任务 × ${ATTEMPTS} attempts ===\n`);

for (const task of tasks) {
  const userMsg = `编辑意图：${task.intent}\n\n文档结构：\n${JSON.stringify(task.doc, null, 2)}\n\n输出 JSON patch：`;
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: userMsg },
  ];

  for (let a = 1; a <= ATTEMPTS; a++) {
    const label = `${task.id}-a${a}`;
    process.stdout.write(`  ${label} … `);
    try {
      const raw = await callDeepSeek(messages);
      let patch;
      try {
        patch = extractJson(raw);
      } catch (e) {
        runs.push({ task: task.id, attempt: a, ok: false, reason: 'JSON 解析失败', raw: raw.slice(0, 100) });
        fail++;
        console.log('JSON 解析失败');
        continue;
      }
      if (!patch || !patch.ops) {
        runs.push({ task: task.id, attempt: a, ok: false, reason: '缺少 ops 字段' });
        fail++;
        console.log('缺 ops');
        continue;
      }
      // 用 runDeterministic 评分
      const before = JSON.stringify(task.doc);
      const result = patchMod.apply(task.doc, patch);
      const error = task.expect(result, before);
      const passed = !error;
      runs.push({
        task: task.id, attempt: a, ok: passed,
        patch: patch,
        error: error || undefined,
      });
      if (passed) { ok++; console.log('PASS'); }
      else { fail++; console.log(`FAIL: ${error}`); }
    } catch (e) {
      apiErr++;
      runs.push({ task: task.id, attempt: a, ok: false, reason: 'API 错', error: (e.message || '').slice(0, 100) });
      console.log(`API ERR: ${(e.message || '').slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

console.log(`\n=== 汇总：${ok}/${ok + fail} pass，${apiErr} API err ===`);

// 写记录
const record = {
  schemaVersion: '2.0.0',
  model: 'DeepSeek',
  modelVersion: MODEL,
  recordedAt: new Date().toISOString(),
  attemptsPerTask: ATTEMPTS,
  runs: runs,
};

const recPath = join(ROOT, 'benchmark', 'models', MODEL + '.json');
writeFileSync(recPath, JSON.stringify(record, null, 2), 'utf8');
console.log('记录已写入：' + recPath);
console.log('⇒ node benchmark/run.js --record ' + MODEL + ' 验证');
