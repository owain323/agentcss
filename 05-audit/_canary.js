/**
 * _canary.js — :8000 身份校验共享库（WO-03 · 0.27.21）
 *
 * JS 门禁单跑前调用 `require('./_canary.js').assertOurs()`：
 * 不通过时 process.exit(3)——观测条件错误，不是产品不合格。
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BASE = 'http://127.0.0.1:8000';
const ROOT = path.resolve(__dirname, '..');

function sameTree() {
  const idx = path.join(ROOT, 'index.html');
  if (!fs.existsSync(idx)) return false;
  try {
    const remote = execFileSync('curl', ['-s', '--max-time', '3', BASE + '/index.html'],
      { cwd: ROOT, timeout: 10000, encoding: 'buffer' });
    return Buffer.compare(remote, fs.readFileSync(idx)) === 0;
  } catch (e) { return false; }
}

function isGateServer() {
  try {
    const hdrs = execFileSync('curl', ['-sI', '--max-time', '3', BASE + '/index.html'],
      { cwd: ROOT, timeout: 10000, encoding: 'utf8' });
    return /x-fl-gate-server/i.test(hdrs || '');
  } catch (e) { return false; }
}

function isOurs() { return sameTree() && isGateServer(); }

function assertOurs() {
  if (isOurs()) return;
  if (!sameTree()) {
    console.log('  [EXIT 3] :8000 上是另一棵树——是服务的错，不是判据的错');
  } else if (!isGateServer()) {
    console.log('  [EXIT 3] :8000 不是门禁服务器（缺 X-FL-Gate-Server）——是服务的错');
  } else {
    console.log('  [EXIT 3] :8000 不可达——是服务的错，不是判据的错');
  }
  console.log('  ⇒ 先 bash 05-audit/with-server.sh 或 python 05-audit/http-serve.py 8000');
  process.exit(3);
}

module.exports = { sameTree, isGateServer, isOurs, assertOurs };
