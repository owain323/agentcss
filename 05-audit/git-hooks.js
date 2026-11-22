#!/usr/bin/env node
/*
 * git-hooks.js — `npm run prepare` 的执行体：把 core.hooksPath 指向 .githooks
 *
 * 为什么不是 package.json 里的一行 `git config core.hooksPath .githooks`：
 *
 *  ① **写锁竞争**。`npm pack` / `npm publish` 都会跑 `prepare`，而仓里的
 *     `check-all.sh --fast` 是**并行**跑门禁的。两个进程同时写 `.git/config`
 *     会抢 `config.lock`，实测报
 *       error: could not lock config file .git/config: File exists   (RC=255)
 *     直接把 `pkg-resolve` 门禁打红 —— 一个"装提交钩子"的便利动作，
 *     反倒成了发布链路上的随机失败源。
 *     所以这里先**读**（读不拿写锁）：值已经正确就立刻退出，稳态零写入。
 *
 *  ② **可能根本没有 git**。从 tarball 解压、CI 只拷子目录、用户装了
 *     git 依赖但没有 .git —— 这些情况下 `git config` 必然失败。
 *     装钩子是开发便利，**不是发布前提**：此时只警告，退出码 0，
 *     不让 `npm pack` 因为"钩子没装上"而失败。
 *
 * 退出码约定：0 = 已接线 / 不适用 / 装不上（带警告）；永不返回非 0。
 */
'use strict';

var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var WANT = '.githooks';

function git(args) {
  return cp.spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

/* 不是 git 检出（tarball / CI 子目录拷贝）：静默通过。 */
if (!fs.existsSync(path.join(ROOT, '.git'))) process.exit(0);

/* 先读：稳态下不产生任何写入，因而不参与 config.lock 竞争。 */
var cur = git(['config', '--local', '--get', 'core.hooksPath']);
if (cur.status === 0 && String(cur.stdout || '').trim() === WANT) process.exit(0);

var set = git(['config', '--local', 'core.hooksPath', WANT]);
if (set.status !== 0) {
  var why = String((set.stderr || '') + (set.stdout || '')).trim().split('\n')[0] || '未知原因';
  process.stderr.write(
    '  ⚠️  git 提交钩子未接线：' + why + '\n' +
    '      影响：commit 时不会自动跑 .githooks/pre-commit（凭据扫描 + 快门禁）。\n' +
    '      手动：bash .githooks/pre-commit     修复：git config core.hooksPath ' + WANT + '\n');
}
process.exit(0);
