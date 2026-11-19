/**
 * deepseek-driver.mjs — DeepSeek API → benchmark P 组页面生成驱动
 * ============================================================================
 * 🔴 密钥纪律：本文件**不含任何密钥**。密钥只从环境变量 DEEPSEEK_API_KEY 读。
 *    如果 env 缺失 ⇒ 立即退出，不 fallback、不提示值。
 *    产物（HTML/评分/记录）写到 benchmark/models/ —— 不含密钥。
 *
 * 用法：
 *   DEEPSEEK_API_KEY=sk-… node benchmark/deepseek-driver.mjs [--tasks=P01,P02] [--attempts=3]
 *
 * 产出：
 *   benchmark/models/deepseek-chat.json   （--record 格式的记录文件）
 *   /tmp/agentcss-benchmark/<task>-<attempt>.html  （模型原始产出）
 * ============================================================================
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.error('❌ 请设 DEEPSEEK_API_KEY 环境变量。');
  process.exit(2);
}

// P 组任务（从 REAL-PAGE-TASKS.md 提取的需求原话 + 评分要求）
const TASKS = [
  { id: 'P01', prompt: '用给定数据做一页财务研究报告，含 KPI、趋势、明细表', libs: 'metric delta table analysis-report' },
  { id: 'P02', prompt: '把这份数据做成学术风格的表格页，含误差列与脚注', libs: 'table longform' },
  { id: 'P03', prompt: '做一页科学绘图，含误差带与坐标轴标注', libs: '09-assets/scientific-plot' },
  { id: 'P04', prompt: '长文排版，含引用、脚注、目录', libs: 'longform typography.css' },
  { id: 'P05', prompt: '两栏：正文 + 侧边说明，窄屏要能折叠', libs: '.cmp' },
  { id: 'P06', prompt: '做一个含 tabs 切换、内嵌 sparkline 的仪表板页', libs: 'tabs sparkline' },
  { id: 'P07', prompt: '做一个含 toast 通知和 dialog 确认框的交互页', libs: 'overlay' },
  { id: 'P08', prompt: '做一个含手风琴 FAQ 和分页的页面', libs: 'accordion pagination' },
  { id: 'P09', prompt: '做一个含表单校验和下拉选择的注册页', libs: 'form-validation select' },
  { id: 'P10', prompt: '做一个含 tooltip 提示和 badge 标签的数据展示页', libs: 'tooltip badge' },
];

const ATTEMPTS = parseInt(process.argv.find(a => a.startsWith('--attempts='))?.split('=')[1] || '3');
const TASK_FILTER = process.argv.find(a => a.startsWith('--tasks='))?.split('=')[1]?.split(',') || null;
const MODEL = 'deepseek-chat';
const API_URL = 'https://api.deepseek.com/chat/completions';

// 读 llms.txt 作为 system prompt（agent 的信息面）
const llmsTxt = readFileSync(join(ROOT, 'llms.txt'), 'utf8');
const SYSTEM_PROMPT = `你是一个前端开发者，使用 agentcss 库生成移动端 HTML 页面。
以下是 agentcss 的机器可读契约（llms.txt）。严格按照里面的类名、令牌和规则生成 HTML。
不许内联任何 <style> 里的裸色值或裸字号——全部走 CSS 变量。
只输出完整的 HTML 文件（<!doctype html> 到 </html>），不加解释。

${llmsTxt}`;

async function callDeepSeek(prompt) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  const d = await res.json();
  return d.choices[0].message.content;
}

function extractHtml(text) {
  // 从模型回复中提取 HTML（可能有 ```html 包裹）
  const m = text.match(/```(?:html)?\s*\n([\s\S]*?)\n```/);
  return m ? m[1] : text;
}

// 主流程
const outDir = '/tmp/agentcss-benchmark';
mkdirSync(outDir, { recursive: true });
mkdirSync(join(ROOT, 'benchmark', 'models'), { recursive: true });

const tasks = TASK_FILTER ? TASKS.filter(t => TASK_FILTER.includes(t.id)) : TASKS;
const runs = [];
let apiErrors = 0;

console.log(`=== DeepSeek benchmark：${tasks.length} 任务 × ${ATTEMPTS} attempts ===\n`);

for (const task of tasks) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const label = `${task.id}-a${attempt}`;
    process.stdout.write(`  ${label} … `);
    try {
      const raw = await callDeepSeek(
        `${task.prompt}\n\n必须用到的 agentcss 能力：${task.libs}\n` +
        `输出一个完整的 HTML 文件（含 <!doctype html>），引用 agentcss 的 CSS 文件。`
      );
      const html = extractHtml(raw);
      const outFile = join(outDir, `${label}.html`);
      writeFileSync(outFile, html, 'utf8');

      // 用 score-page.js 评分
      let score = null;
      try {
        const { execFileSync } = await import('node:child_process');
        const scoreOut = execFileSync('node', [
          join(ROOT, 'benchmark', 'score-page.js'), outFile,
        ], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
        score = JSON.parse(scoreOut);
      } catch (e) {
        // score-page 可能还没准备好对任意文件评分
        score = { error: (e.message || '').slice(0, 80) };
      }

      runs.push({
        task: task.id,
        attempt,
        htmlFile: outFile,
        score,
        raw_length: raw.length,
        timestamp: new Date().toISOString(),
      });
      console.log(`OK (${raw.length} chars, score=${score?.score ?? score?.error ?? '?'})`);
    } catch (e) {
      apiErrors++;
      runs.push({ task: task.id, attempt, error: (e.message || '').slice(0, 120) });
      console.log(`ERR: ${(e.message || '').slice(0, 80)}`);
    }
    // 节流：避免触发 rate limit
    await new Promise(r => setTimeout(r, 500));
  }
}

console.log(`\n=== 汇总：${runs.filter(r => !r.error).length}/${runs.length} 成功，${apiErrors} 个 API 错误 ===`);

// 写记录文件（不含密钥）
const record = {
  schemaVersion: '2.0.0',
  model: 'DeepSeek',
  modelVersion: MODEL,
  recordedAt: new Date().toISOString(),
  attemptsPerTask: ATTEMPTS,
  runs: runs.map(r => ({
    task: r.task,
    attempt: r.attempt,
    ok: !r.error,
    score: r.score,
    raw_length: r.raw_length,
    timestamp: r.timestamp,
    ...(r.error ? { error: r.error } : {}),
  })),
};

const recPath = join(ROOT, 'benchmark', 'models', 'deepseek-chat.json');
writeFileSync(recPath, JSON.stringify(record, null, 2), 'utf8');
console.log('记录已写入：' + recPath);
console.log('⇒ 运行 node benchmark/run.js --record deepseek-chat 验证');
