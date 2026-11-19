const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * tooltip-check.js — 文字提示契约（总 C1 /
 *
 * ⭐ 核心判据：**tooltip 不承载必要信息**（WCAG 1.4.13）。
 *   触屏没有 hover ⇒ 只放在 tooltip 里的内容等于不存在。
 *   判据：tooltip 文字必须与触发元素的可见文字**不完全相同**。
 *   （如果相同，说明它只是重复了可见文字，没有提供任何额外信息。）
 *
 * 🔴 0.27 起另有一组行为判据（⑦~⑩：悬停弹出 / 一次点击就开 / 点外部 / detach），
 *   守 attach 路径实测修出的三处缺陷（hover 死、双翻转、栈泄漏）；
 *   判据 ② 的旧 `.is-open` 选择器也修了 —— 它曾让 Esc 判据恒走"跳过"。
 */
(async () => {
  const r = await kit.check({
    name: 'tooltip',
    url: 'http://127.0.0.1:8000/03-patterns/tooltip/demo.html',
    dir: REPO + '/03-patterns/tooltip',
    primary: '.tooltip',
    /* ⭐ 焦点策略（准入清单第 ① 条）：
       tooltip **不接管焦点** —— 焦点始终在触发元素上，
       提示层是纯展示（role=tooltip + aria-describedby 关联）。
       ⚠️ 绝不能把焦点移进提示层（它不是交互元素，且触屏无 hover）。 */
    interactive: '[data-tooltip], .btn',

    extra: {
      /* ⭐ 核心：不承载必要信息 */
      'tooltip 提供额外信息（不重复可见文字）': async (p) => {
        const r = await p.evaluate(() => {
          const all = [...document.querySelectorAll('[data-tooltip]')];
          if (!all.length) return { ok: true, note: '无 tooltip（跳过）' };
          /* ⚠️ demo 里**故意造了一个反例**（#bad，tooltip 文字 = 按钮文字）
             用来演示"这样写是错的"。
             ⇒ 判据要跳过标了 data-bad-example 的，否则会把"演示反例"当成"真 bug"。 */
          const isDemo = (t) => t.hasAttribute('data-bad-example') ||
                               /^(bad|反例|wrong)/i.test(t.id || '');
          const triggers = all.filter((t) => !isDemo(t));
          const dup = triggers.filter((t) => {
            const tip = (t.getAttribute('data-tooltip') || '').trim();
            const vis = (t.textContent || '').trim();
            /* 完全相同 ⇒ 只是重复，没提供额外信息 */
            return tip && vis && tip === vis;
          });
          return { ok: dup.length === 0,
                   note: triggers.length + ' 个正式 tooltip（另有反例已豁免），' +
                         dup.length + ' 个与可见文字完全相同' +
                         (dup.length
                           ? '（🔴 ' + dup.map((d) => d.textContent.trim()).join('/') + '）'
                           : '都提供了额外信息') };
        });
        return r;
      },

      /* ② Esc 能关（WCAG 1.4.13 明确要求）
         🔴 选择器修正（0.27 审查）：这里原来查 `.tooltip.is-open` ——
            那是改名前的旧类（API.md：显隐只有 `data-state="open"` 一套）。
            旧选择器永远查不到 ⇒ opened 恒为 false ⇒ 判据恒走"跳过"，
            **Esc 从来没被真的测过**（假绿）。改成 data-state 后才红得起来。 */
      'Esc 能关闭': async (p) => {
        await p.evaluate(() => {
          const t = document.querySelector('[data-tooltip]');
          if (t) t.focus();               // focus 应弹出
        });
        await new Promise((r) => setTimeout(r, 250));
        const opened = await p.evaluate(() =>
          !!document.querySelector('.tooltip[data-state="open"]'));
        if (!opened) return { ok: false, note: '🔴 focus 没能弹出（Esc 无从测起）' };
        await p.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 250));
        const closed = await p.evaluate(() =>
          !document.querySelector('.tooltip[data-state="open"]'));
        return { ok: closed, note: closed ? 'Esc 已关闭 ✅' : '🔴 Esc 之后仍在' };
      },

      /* ③ 键盘必须能触发（**用真键盘 Tab**，不能用 el.focus()）
         🔴 判据修正（第一次跑时误报"focus 不触发"）：
            `element.focus()` 是**编程式聚焦**，浏览器**不认为**它是键盘操作
            ⇒ `:focus-visible` 不匹配 ⇒ 连 CSS 里的 hover/focus 规则都不生效。
            ⇒ 那不是组件的 bug，是**测法错了**。
            ⇒ 正解：先 `blur()` 清焦点，再真按 `Tab` 键。 */
      '键盘 Tab 能触发（键盘可达）': async (p) => {
        await p.evaluate(() => {
          if (document.activeElement) document.activeElement.blur();
          window.scrollTo(0, 0);
        });
        await new Promise((r) => setTimeout(r, 200));
        let found = false;
        for (let i = 0; i < 14; i++) {
          await p.keyboard.press('Tab');
          await new Promise((r) => setTimeout(r, 160));
          const hit = await p.evaluate(() =>
            !!(document.activeElement &&
               document.activeElement.hasAttribute('data-tooltip') &&
               document.querySelector('.tooltip[data-state="open"]')));
          if (hit) { found = true; break; }
        }
        return { ok: found,
                 note: found ? 'Tab 到触发器后提示已弹出 ✅'
                             : '🔴 连按 14 次 Tab 都没有弹出（键盘用户看不到）' };
      },

      /* ④ 用 aria-describedby 关联（不是 aria-label）*/
      '用 aria-describedby 关联': async (p) => {
        const r = await p.evaluate(() => {
          const ts = [...document.querySelectorAll('[data-tooltip]')];
          if (!ts.length) return { ok: true, note: '无 tooltip（跳过）' };
          const bad = ts.filter((t) => {
            if (t.getAttribute('aria-describedby')) return false;
            /* 允许用 aria-label 之外的方式，但必须有一种关联 */
            return !t.getAttribute('aria-labelledby');
          });
          const wrongAttr = ts.filter((t) => {
            /* ⛔ tooltip 内容写进 aria-label 是错的：
               label 是「这个元素叫什么」，tooltip 是「补充说明」 */
            const al = t.getAttribute('aria-label');
            return al && al === t.getAttribute('data-tooltip');
          });
          return { ok: bad.length === 0 && wrongAttr.length === 0,
                   note: bad.length ? '🔴 ' + bad.length + ' 个未关联'
                        : (wrongAttr.length ? '🔴 ' + wrongAttr.length + ' 个错用 aria-label'
                                            : ts.length + ' 个都用了 aria-describedby') };
        });
        return r;
      },

      /* ⑤ 提示层不挡内容（pointer-events:none）*/
      '提示层不挡点击': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/03-patterns/tooltip/tooltip.css', 'utf8'));
        const m = raw.match(/\.tooltip\s*\{[^}]*\}/);
        if (!m) return { ok: false, note: '🔴 没有 .tooltip 规则' };
        const has = /pointer-events\s*:\s*none/.test(m[0]);
        return { ok: has, note: has ? 'pointer-events:none ✅' : '🔴 会挡住下面的点击' };
      },

      /* ⑥ 左右方位的小三角**真的画出来了**，且 RTL 下指向相反的物理边
         🔴 为什么补这条（0.4.2 实测出来的既有缺口）：
            `tooltip.js` 的 `place='left'|'right'` 会拼出 `tooltip--left` /
            `--right`，而 `tooltip.css` 里**根本没有这两个类**（只有
            `--inset-inline-start` / `--inset-inline-end`）
            ⇒ 这两个方位的气泡**完全没有小三角**（::after 四条边全是
            transparent），而 demo 里 `p-left` / `p-right` 正好在用。
            这是最典型的静默失效：不报错、不红，只是少一块。
         ⚠️ 为什么必须**在真浏览器里量**：
            读源码只能知道"类名对不对"，知道不了"这条声明有没有被渲染出来"。
            计算样式是浏览器给的，不是我推断的。 */
      /* ⑦ 边缘翻转（0.27.13）：靠右缘时 'right' 放不下 ⇒ 气泡翻到锚点左侧，
         箭头（::after 有色边）跟着指向锚点。反向控制：把翻转逻辑禁用必须红。 */
      '右缘翻转：right 放不下翻到左侧且箭头仍指向锚点': async (p) => {
        const r = await p.evaluate(() => {
          var box = document.createElement('div');
          box.setAttribute('dir', 'ltr');
          box.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999';
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'edge';
          btn.style.cssText = 'position:absolute;top:120px;left:330px;' +
                              'width:50px;height:24px';
          box.appendChild(btn);
          document.body.appendChild(box);
          window.Tooltip.attach(btn, 'probe-edge', 'right');
          btn.click();
          var tips = document.querySelectorAll('.tooltip[data-state="open"]');
          var tip = tips[tips.length - 1];
          if (!tip) { box.remove(); return { err: '气泡没弹出' }; }
          var vw = document.documentElement.clientWidth;
          var tr = tip.getBoundingClientRect();
          var br = btn.getBoundingClientRect();
          var cs = getComputedStyle(tip, '::after');
          var out = {
            cls: tip.className,
            bubbleInside: tr.left >= 0 && tr.right <= vw,
            arrowPointsToAnchor: cs.borderLeftColor !== 'rgba(0, 0, 0, 0)',
            detail: 'bubble ' + Math.round(tr.left) + '..' + Math.round(tr.right) +
                    ' vw=' + vw + ' cls=' + tip.className,
          };
          box.remove();
          return out;
        });
        return { ok: r.bubbleInside === true && r.arrowPointsToAnchor === true,
                 note: r.err || r.detail };
      },

      /* ⑦b RTL 边缘翻转（0.27.17）：RTL + place='start' + 锚贴右缘 ⇒
         气泡在锚点右侧放不下（右缘越界），必须翻到 'end'（锚点左侧），
         箭头仍指向锚点。
         🔴 为什么必须有这条：0.27.16 的翻转谓词按 LTR 几何写死
         （start 溢出判 left < M），RTL 下这个场景真实溢出**永不翻转**，
         气泡被钳制到与锚点脱开 50px、箭头背向锚点 —— 不报错、只是错，
         而 ⑦ 的 LTR 判据全程绿（假绿结构）。RTL 用户拿着全绿的
         审计报告用着坏的翻转，就是这条判据要堵的洞。
         期望四件事同时成立：翻类（--inset-inline-end）/ 气泡贴锚点
         （右缘 ≈ 锚点左缘）/ 全程在视口内 / 箭头 border-left 有色
         （气泡在锚左侧 ⇒ 箭头指右）。 */
      'RTL 右缘翻转：start 放不下翻到 end 且气泡贴住锚点': async (p) => {
        const r = await p.evaluate(() => {
          var box = document.createElement('div');
          box.setAttribute('dir', 'rtl');
          box.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999';
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'edge';
          var vw = document.documentElement.clientWidth;
          btn.style.cssText = 'position:absolute;top:120px;left:' + (vw - 58) + 'px;' +
                              'width:50px;height:24px';
          box.appendChild(btn);
          document.body.appendChild(box);
          window.Tooltip.attach(btn, 'probe-edge-rtl', 'start');
          btn.click();
          var tips = document.querySelectorAll('.tooltip[data-state="open"]');
          var tip = tips[tips.length - 1];
          if (!tip) { box.remove(); return { err: '气泡没弹出' }; }
          var tr = tip.getBoundingClientRect();
          var br = btn.getBoundingClientRect();
          var cs = getComputedStyle(tip, '::after');
          var out = {
            flippedToEnd: tip.className.indexOf('tooltip--inset-inline-end') >= 0,
            stillStart: tip.className.indexOf('tooltip--inset-inline-start') >= 0,
            bubbleInside: tr.left >= 0 && tr.right <= vw,
            bubbleHugsAnchor: Math.abs(tr.right - br.left) <= 2,
            arrowPointsToAnchor: cs.borderLeftColor !== 'rgba(0, 0, 0, 0)',
            detail: 'bubble ' + Math.round(tr.left) + '..' + Math.round(tr.right) +
                    ' anchor.left=' + Math.round(br.left) + ' vw=' + vw +
                    ' cls=' + tip.className,
          };
          box.remove();
          return out;
        });
        return { ok: r.flippedToEnd === true && r.bubbleInside === true &&
                      r.bubbleHugsAnchor === true && r.arrowPointsToAnchor === true &&
                      r.stillStart === false,
                 note: r.err || (r.detail + ' flipped=' + r.flippedToEnd +
                       ' hug=' + r.bubbleHugsAnchor + ' arrow=' + r.arrowPointsToAnchor) };
      },

      '左右方位的小三角真的画出来了（含 RTL）': async (p) => {
        const r = await p.evaluate(() => {
          function one(dir, place) {
            var box = document.createElement('div');
            box.setAttribute('dir', dir);
            box.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;' +
                                'z-index:99999;background:transparent';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'p';
            /* 🔴 0.27.13 起有边缘翻转：按钮必须离左右缘足够远，
               否则 place() 会合法地翻到对侧，箭头期望就不成立了
               （边缘翻转行为由新增的独立判据负责）。 */
            btn.style.cssText = 'position:absolute;top:300px;left:80px;' +
                                'width:60px;height:24px';
            box.appendChild(btn);
            document.body.appendChild(box);
            window.Tooltip.attach(btn, 'probe', place);
            btn.click();                       // click 会 show（内部 stopPropagation）
            var tips = document.querySelectorAll('.tooltip[data-state="open"]');
            var tip = tips[tips.length - 1];
            if (!tip) { box.remove(); return { err: '气泡没弹出' }; }
            var cs = getComputedStyle(tip, '::after');
            var sides = {
              top: cs.borderTopColor, bottom: cs.borderBottomColor,
              left: cs.borderLeftColor, right: cs.borderRightColor,
            };
            var visible = Object.keys(sides).filter(function (k) {
              return sides[k] && sides[k] !== 'rgba(0, 0, 0, 0)' &&
                     sides[k] !== 'transparent';
            });
            /* 🔴 0.27.17 起补几何断言：place='left' 的气泡必须在锚点左侧、
               'right' 在右侧 —— 旧版只查"有一条有色边"，而箭头的物理边
               跟随气泡自己的 direction（0.27.17 修：跟随锚点写入），
               修之前 RTL 的箭头几何上背向锚点，判据照样绿。 */
            var tr = tip.getBoundingClientRect();
            var br = btn.getBoundingClientRect();
            var out = { cls: tip.className, visible: visible,
                        bubbleOnLeft: tr.right <= br.left + 2,
                        dir: getComputedStyle(btn).direction };
            box.remove();
            tip.remove();
            return out;
          }
          return {
            ltrLeft: one('ltr', 'left'), rtlLeft: one('rtl', 'left'),
            ltrRight: one('ltr', 'right'), rtlRight: one('rtl', 'right'),
          };
        });
        /* 期望：恰好一条边有色；有色边跟随**几何**（气泡在锚点哪侧，
           箭头就指向哪侧）：气泡在左 ⇒ 箭头指右（border-left 有色），
           在右 ⇒ 指左（border-right 有色）。
           🔴 0.27.17 之前期望表写的是"RTL 与 LTR 物理边相反"——
              那是在给"箭头背向锚点"的 bug 背书：RTL 的 tip 继承 body 的
              ltr，逻辑类渲染成物理边时方向就错了。修后 LTR/RTL 同一
              几何布局的有色边必然相同，方向正确性由气泡位置断言守。 */
        const want = [
          ['ltr + left', r.ltrLeft, 'left', true],
          ['rtl + left', r.rtlLeft, 'left', true],
          ['ltr + right', r.ltrRight, 'right', false],
          ['rtl + right', r.rtlRight, 'right', false],
        ];
        const bad = [];
        for (const [label, got, side, onLeft] of want) {
          if (got.err) { bad.push(label + '：' + got.err); continue; }
          if (got.visible.length !== 1) {
            bad.push(label + '：有色边 ' + got.visible.length + ' 条（应为 1 条）' +
                     ' class=' + got.cls);
          } else if (got.visible[0] !== side) {
            bad.push(label + '：有色边是 ' + got.visible[0] + '（应为 ' + side + '）' +
                     ' class=' + got.cls);
          }
          if (got.bubbleOnLeft !== onLeft) {
            bad.push(label + '：气泡应在锚点' + (onLeft ? '左' : '右') + '侧，实测' +
                     (got.bubbleOnLeft ? '左' : '右') + '侧');
          }
        }
        return { ok: bad.length === 0,
                 note: bad.length ? '🔴 ' + bad.join('；')
                                  : '四个组合各一条有色边、箭头指向锚点、气泡在期望的一侧 ✅' };
      },

      /* 🔴 0.27.20 WCAG 1.4.13 三条件实测（无障碍官 F1 实锤的清算）：
         ① Dismissible——hover 态（焦点在 body）按 Esc 必须能收。
            旧实现 Esc 挂在触发元素上（焦点不在 ⇒ 收不到）⇒ 违规。 */
      'Esc 可关 hover 态（1.4.13 Dismissible）': async (p) => {
        const probe = await p.evaluate(() => {
          const el = document.createElement('button');
          el.id = 'tt-esc-probe';
          el.textContent = 'esc probe';
          el.style.cssText = 'position:fixed;top:20px;left:20px;z-index:100000';
          document.body.appendChild(el);
          window.Tooltip.attach(el, 'tt-esc-probe-tip', 'bottom');
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
          return true;
        });
        if (!probe) return { ok: false, note: '🔴 探针装不上' };
        await new Promise((r) => setTimeout(r, 250));
        const opened = await p.evaluate(() =>
          [...document.querySelectorAll('.tooltip[data-state="open"]')].length);
        await p.keyboard.press('Escape');   /* 焦点在 body——旧实现收不到 */
        await new Promise((r) => setTimeout(r, 200));
        const after = await p.evaluate(() => {
          const tip = [...document.querySelectorAll('.tooltip')].pop();
          const gone = !tip || tip.getAttribute('data-state') !== 'open';
          const el = document.getElementById('tt-esc-probe');
          if (el) { try { window.Tooltip.detach(el); } catch (e) {} el.remove(); }
          return gone;
        });
        return { ok: opened >= 1 && after === true,
                 note: 'hover 开=' + opened + ' · Esc 后收=' + after };
      },

      /* ② Hoverable——指针从触发器滑进气泡，气泡不消失（80ms 宽限） */
      '指针可移入气泡（1.4.13 Hoverable）': async (p) => {
        const setup = await p.evaluate(() => {
          const el = document.createElement('button');
          el.id = 'tt-hover-in';
          el.textContent = 'hover-in probe';
          el.style.cssText = 'position:fixed;top:80px;left:20px;z-index:100000';
          document.body.appendChild(el);
          window.Tooltip.attach(el, 'tt-hover-in-tip', 'bottom');
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
          return true;
        });
        if (!setup) return { ok: false, note: '🔴 探针装不上' };
        await new Promise((r) => setTimeout(r, 250));
        /* 指针滑进气泡：先离开触发器（触发 80ms 宽限），再 hover 气泡 */
        await p.evaluate(() => {
          const el = document.getElementById('tt-hover-in');
          el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
        });
        await new Promise((r) => setTimeout(r, 40));   /* 宽限窗口内 */
        const tipBox = await p.evaluate(() => {
          const tip = [...document.querySelectorAll('.tooltip')].pop();
          if (!tip) return null;
          const r = tip.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        let hovered = null;
        if (tipBox) { await p.mouse.move(tipBox.x, tipBox.y); }
        await new Promise((r) => setTimeout(r, 300));
        hovered = await p.evaluate(() => {
          const tip = [...document.querySelectorAll('.tooltip')].pop();
          const alive = tip && tip.getAttribute('data-state') === 'open';
          const el = document.getElementById('tt-hover-in');
          if (el) { try { window.Tooltip.detach(el); } catch (e) {} el.remove(); }
          return alive;
        });
        return { ok: hovered === true,
                 note: '离开触发器 40ms 后滑入气泡中心：气泡仍开=' + hovered };
      },

      /* ⑦ 悬停能弹出、移开能关（attach 路径 —— 0.27 修的真缺陷）
         🔴 为什么要这条：attach() 把气泡挂到 body，CSS 的
            `[data-tooltip]:hover + .tooltip`（相邻兄弟）永远打不中，
            而 tooltip.js 之前没有任何 mouse 监听 ⇒ hover 是**死的**。
            用真鼠标移入/移出（p.hover / p.mouse.move），移走必须收掉。
         ⚠️ 探针自造自清理，不碰 demo 里的元素（判据 ⑥ 的老规矩）。 */
      '悬停能弹出、移开能关（attach 路径）': async (p) => {
        await p.evaluate(() => {
          const btn = document.createElement('button');
          btn.id = 'tt-hover-probe';
          btn.textContent = '悬停探针';
          btn.style.cssText = 'position:fixed;top:16px;left:16px;z-index:99999';
          document.body.appendChild(btn);
          window.Tooltip.attach(btn, '悬停探针的说明');
        });
        await p.hover('#tt-hover-probe');
        await new Promise((r) => setTimeout(r, 250));
        const opened = await p.evaluate(() => {
          const tip = document.querySelector('.tooltip[data-state="open"]');
          return tip ? tip.textContent : null;
        });
        await p.mouse.move(360, 700);            // 移远 ⇒ mouseleave
        await new Promise((r) => setTimeout(r, 250));
        const closed = await p.evaluate(() =>
          !document.querySelector('.tooltip[data-state="open"]'));
        await p.evaluate(() => {
          const b = document.getElementById('tt-hover-probe');
          window.Tooltip.detach(b);
          b.remove();
        });
        if (!opened) {
          return { ok: false, note: '🔴 悬停后气泡没弹出（attach 路径的 hover 是死的）' };
        }
        if (opened !== '悬停探针的说明') {
          return { ok: false, note: '🔴 弹出的是别家的气泡：' + opened };
        }
        if (!closed) {
          return { ok: false, note: '🔴 移开后气泡还开着（mouseleave 没接上，会粘住）' };
        }
        return { ok: true, note: '悬停弹出、移开关闭 ✅' };
      },

      /* ⑧ 一次点击就开、再点才关（真鼠标序列 —— 0.27 修的双翻转缺陷）
         🔴 为什么必须用 p.mouse.click 真坐标（坑 ⑤）：
            真指针点击 = mouseenter → mousedown(focus→show) → click。
            旧实现里 click 无条件 toggle ⇒ **第一次点击以"关"收场**
            （实测：data-state 被摘掉，第二次点击才开）。
            p.click() 走键盘激活，测不出这个序列 ⇒ 必须真坐标。
            期望：一击开、二击关，不是二击才开。 */
      '一次点击就开、再点才关（真鼠标序列）': async (p) => {
        await p.evaluate(() => {
          const btn = document.createElement('button');
          btn.id = 'tt-click-probe';
          btn.textContent = '点击探针';
          btn.style.cssText = 'position:fixed;top:16px;left:200px;z-index:99999';
          document.body.appendChild(btn);
          window.Tooltip.attach(btn, '点击探针的说明');
        });
        const at = await p.evaluate(() => {
          const b = document.getElementById('tt-click-probe')
            .getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        });
        await p.mouse.click(at.x, at.y);
        await new Promise((r) => setTimeout(r, 250));
        const opened = await p.evaluate(() =>
          !!document.querySelector('.tooltip[data-state="open"]'));
        await p.mouse.click(at.x, at.y);
        await new Promise((r) => setTimeout(r, 250));
        const closed = await p.evaluate(() =>
          !document.querySelector('.tooltip[data-state="open"]'));
        await p.evaluate(() => {
          const b = document.getElementById('tt-click-probe');
          window.Tooltip.detach(b);
          b.remove();
        });
        if (!opened) {
          return { ok: false, note: '🔴 第一次点击后气泡没开（focus 出 + click 翻转 ⇒ 双翻转，老缺陷）' };
        }
        if (!closed) {
          return { ok: false, note: '🔴 第二次点击后气泡没关（click 应翻转自己开的）' };
        }
        return { ok: true, note: '一击开、二击关 ✅' };
      },

      /* ⑧·2 所有权是**集合**：钉住的 / 聚焦持有中的，不能被 hover 顶掉。
         🔴 0.27.11 修出来的真缺陷（单值 openBy 时代实测）：
            · click 钉住 → 鼠标移入再移出 ⇒ 钉子被 hover 覆盖，气泡没了
            · focus 还在 → 鼠标移入再移出 ⇒ 气泡没了，但焦点从没移开
              （WCAG 1.4.13 明确要求"焦点未移开应持续可见"）
         ⚠️ 三条容易写歪的地方：
            1. 必须真鼠标（p.mouse.move）——`mouseenter` 是合成不出来的
            2. 判定要绑到**这个探针自己的** aria-describedby，
               不能查全页 `.tooltip[data-state=open]`：
               鼠标路过别的触发器会开别人的气泡 ⇒ 判据变成"页面上有气泡"，
               于是无论探针错成什么样都绿（典型的假绿）
            3. 探针按钮用 position:fixed 且留出 200px 上边距，
               否则移到"上方"会移出视口（mouseleave 都不会触发） */
      '钉住与聚焦不被 hover 顶掉（所有权是集合）': async (p) => {
        const mk = (id, left) => p.evaluate(([i, l]) => {
          const btn = document.createElement('button');
          btn.id = i;
          btn.textContent = '所有权探针';
          btn.style.cssText = 'position:fixed;top:420px;left:' + l + 'px;z-index:99999';
          document.body.appendChild(btn);
          window.Tooltip.attach(btn, '所有权探针的说明');
        }, [id, left]);
        const at = (id) => p.evaluate((i) => {
          const b = document.getElementById(i).getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }, id);
        const isOpen = (id) => p.evaluate((i) => {
          const b = document.getElementById(i);
          if (!b) return false;
          const ref = (b.getAttribute('aria-describedby') || '').split(' ').pop();
          const t = ref ? document.getElementById(ref) : null;
          return !!t && t.getAttribute('data-state') === 'open';
        }, id);
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const drop = (id) => p.evaluate((i) => {
          const b = document.getElementById(i);
          window.Tooltip.detach(b);
          b.remove();
        }, id);

        /* A：click 钉住 → 移出 / 移入 / 移出 ⇒ 必须还开着 */
        await mk('tt-own-a', 30);    /* ⚠️ 门禁视口只有 393px 宽——放到 400 会出屏，click 打空 */
        const a = await at('tt-own-a');
        await p.mouse.click(a.x, a.y);
        await wait(220);
        const aOn = await isOpen('tt-own-a');
        await p.mouse.move(a.x, a.y - 200);
        await wait(90);
        await p.mouse.move(a.x, a.y);
        await wait(90);
        await p.mouse.move(a.x, a.y - 200);
        await wait(220);
        const aAlive = await isOpen('tt-own-a');
        await drop('tt-own-a');

        /* B：focus 持有 → 鼠标进 / 出 ⇒ 必须还开着（焦点没移开） */
        await mk('tt-own-b', 190);
        const b = await at('tt-own-b');
        await p.evaluate(() => { document.getElementById('tt-own-b').focus(); });
        await wait(180);
        const bOn = await isOpen('tt-own-b');
        await p.mouse.move(b.x, b.y);
        await wait(90);
        await p.mouse.move(b.x, b.y - 200);
        await wait(220);
        const bAlive = await isOpen('tt-own-b');
        await p.evaluate(() => { document.getElementById('tt-own-b').blur(); });
        await wait(120);
        await drop('tt-own-b');

        if (!aOn) return { ok: false, note: '🔴 click 没能钉住（第一下就没开，A 段无从测）' };
        if (!aAlive) {
          return { ok: false, note: '🔴 click 钉住后被 hover 顶掉了（所有权又变回单值？）' };
        }
        if (!bOn) return { ok: false, note: '🔴 focus 没能打开（B 段无从测）' };
        if (!bAlive) {
          return { ok: false, note: '🔴 焦点未移开、鼠标移出就消失（违反 WCAG 1.4.13 的 persistent）' };
        }
        return { ok: true, note: 'click 钉住 / focus 持有 都没被 hover 顶掉 ✅' };
      },

      /* ⑨ 点外部能关（dismissable 核 —— 栈记录必须活着才守得住这条）
         ⚠️ 用 document.body.click() 而不是挑坐标：
            demo 下半屏全是 cmp 面板与其它触发器，真坐标可能点开**另一个**
            tooltip，让"关没关"变成"开的是哪家"。body 一定不在 inside 里
            （inside=[el, tip]），click 事件照样过 document 捕获判定。 */
      '点外部能关（dismissable 核）': async (p) => {
        await p.evaluate(() => {
          const btn = document.createElement('button');
          btn.id = 'tt-outside-probe';
          btn.textContent = '外部点击探针';
          btn.style.cssText = 'position:fixed;top:16px;left:300px;z-index:99999';
          document.body.appendChild(btn);
          window.Tooltip.attach(btn, '外部点击探针的说明');
          btn.click();                       // 直开（不经 focus/hover）
        });
        await new Promise((r) => setTimeout(r, 250));
        const opened = await p.evaluate(() =>
          !!document.querySelector('.tooltip[data-state="open"]'));
        await p.evaluate(() => { document.body.click(); });
        await new Promise((r) => setTimeout(r, 250));
        const closed = await p.evaluate(() =>
          !document.querySelector('.tooltip[data-state="open"]'));
        await p.evaluate(() => {
          const b = document.getElementById('tt-outside-probe');
          window.Tooltip.detach(b);
          b.remove();
        });
        if (!opened) return { ok: false, note: '🔴 探针气泡没开（无从测外部点击）' };
        if (!closed) return { ok: false, note: '🔴 点外部之后还开着（栈记录没接上）' };
        return { ok: true, note: '点外部已关 ✅' };
      },

      /* ⑩ detach 清理 + attach 幂等（0.27 修的泄漏）
         🔴 为什么要这条：attach 向共享 `window.__flDismiss.stack` 压入
            dismissable 记录，旧实现没有任何销毁路径 ⇒ 栈只增不减
            （drawer/popover 都 dm.destroy()，tooltip 没有）。
            期望：attach 后栈 +1；同元素重复 attach 不再 +1（幂等）；
            detach 后栈回到基线，aria-describedby 还原、气泡节点摘除。 */
      'detach 清理 __flDismiss 栈与 aria（attach 幂等）': async (p) => {
        const r = await p.evaluate(() => {
          const before = window.__flDismiss ? window.__flDismiss.stack.length : 0;
          const btn = document.createElement('button');
          btn.id = 'tt-detach-probe';
          btn.textContent = 'detach 探针';
          btn.style.cssText = 'position:fixed;top:16px;left:120px;z-index:99999';
          document.body.appendChild(btn);
          window.Tooltip.attach(btn, 'detach 探针的说明');
          const tipId = btn.getAttribute('aria-describedby');
          const afterAttach = window.__flDismiss.stack.length;
          window.Tooltip.attach(btn, 'detach 探针的说明');   // 同元素第二次
          const afterTwice = window.__flDismiss.stack.length;
          window.Tooltip.detach(btn);
          return {
            before: before,
            afterAttach: afterAttach,
            afterTwice: afterTwice,
            afterDetach: window.__flDismiss.stack.length,
            tipId: tipId,
            tipGone: document.getElementById(tipId) === null,
            ariaRestored: btn.getAttribute('aria-describedby') === null,
            instanceGone: !btn.tooltipInstance,
          };
        });
        await p.evaluate(() => {
          const b = document.getElementById('tt-detach-probe');
          if (b) b.remove();
        });
        const bad = [];
        if (r.afterAttach !== r.before + 1) {
          bad.push('attach 后栈 ' + r.afterAttach + '（基线 ' + r.before + '，应 +1）');
        }
        if (r.afterTwice !== r.afterAttach) {
          bad.push('重复 attach 又 +1（幂等失效，栈 ' + r.afterTwice + '）');
        }
        if (r.afterDetach !== r.before) {
          bad.push('detach 后栈没回基线（' + r.afterDetach + ' ≠ ' + r.before + '，泄漏）');
        }
        if (!r.tipGone) bad.push('气泡节点没摘');
        if (!r.ariaRestored) bad.push('aria-describedby 没还原');
        if (!r.instanceGone) bad.push('tooltipInstance 没清');
        return { ok: bad.length === 0,
                 note: bad.length ? '🔴 ' + bad.join('；') : '栈回基线、aria 还原、幂等生效 ✅' };
      },

      /* （历史 ⑦，已删，2026-10-25）
       *
       * 它查的是 tooltip.css 里**有没有 `@media (prefers-color-scheme: dark)` 段**——
       * 那是把判据绑在**实现形态**上（INVARIANT I-15 同一类），而不是绑在结果上。
       * 气泡改成令牌驱动（RFC-THEME-SCOPE D5）之后，这段 media 被删了，
       * 判据就报"🔴 无暗色段"，而**实际暗色下的表现一点没变**。
       *
       * 真正要守的东西由上面 ④ 用**实测值**守着：
       *   暗色下「文字 vs 自身底色」对比度 11.93:1、且底色确实从
       *   rgb(21,24,28) 切到了 rgb(35,40,48)。
       * 「组件里不许出现 prefers-color-scheme 分支」这条由 `theme-scope-gate`
       * 静态守着（它管全库 27 个组件，不是只这一个）。
       * ⇒ 这里不再重复一遍实现形态的检查。
       */
    },
  });
  process.exit(kit.report(r));
})();
