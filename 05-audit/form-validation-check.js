const kit = require('./contract-kit.js');
const path = require('path');
// ⭐ 库根用 __dirname 推导，不写死绝对路径（否则会泄漏本地目录结构）
const REPO = path.resolve(__dirname, '..');

/**
 * form-validation-check.js — 表单校验契约（总 A5）
 *
 * ⭐ 核心风险：**错误只画了红框/红字，读屏完全不知道**
 *   ⇒ 必须 aria-invalid="true" + aria-describedby 指向错误文案。
 */
(async () => {
  const r = await kit.check({
    name: 'form-validation',
    url: 'http://127.0.0.1:8000/03-patterns/form-validation/demo.html',
    dir: REPO + '/03-patterns/form-validation',
    primary: '.field',
    interactive: '.field input, .field select, .field textarea, .field button',

    extra: {
      '错误字段有 aria-invalid': async (p) => {
        const r = await p.evaluate(() => {
          const all = document.querySelectorAll('[aria-invalid]');
          const bad = [...all].filter((e) => {
            const v = e.getAttribute('aria-invalid');
            return v !== 'true' && v !== 'false';
          });
          return { ok: bad.length === 0,
                   note: all.length + ' 个字段标了，' + bad.length + ' 个值不合法' };
        });
        return r;
      },

      '错误文案被 aria-describedby 关联': async (p) => {
        const r = await p.evaluate(() => {
          const inv = [...document.querySelectorAll('[aria-invalid="true"]')];
          if (!inv.length) return { ok: true, note: 'demo 无错误态（跳过）' };
          const bad = inv.filter((e) => {
            const d = e.getAttribute('aria-describedby');
            return !d || !document.getElementById(d);
          });
          return { ok: bad.length === 0,
                   note: inv.length + ' 个错误字段，' + bad.length + ' 个未关联错误文案' };
        });
        return r;
      },

      /* ⭐ "输入有误" 是废话；"邮箱格式不对，应为 a@b.com" 才有用 */
      '错误文案具体（能说出怎么改）': async (p) => {
        const r = await p.evaluate(() => {
          const vague = ['有误', '错误', '无效', '不合法', 'error', 'invalid'];
          /* 🔴 0.25.2 修两个错（都会**稳定误报**，实测）：
             ① **范围错**：原来扫"所有 aria-describedby 指向的文本"，
                于是帮助文字（.field__hint）和"校验中"提示
                （.field__checking-hint）也被当成错误文案审 ——
                可它们根本不是错误。这条判据只管**错误文案**：
                .field__error / role=alert / aria-invalid 字段所指向的说明。
             ② **阈值错**：原来用 `t.length <= 最长含糊词长度 + 2`
                （= 9）当"含糊"的判据，等于"凡是 ≤9 字都算含糊"，
                与内容无关。实测把 8 个字的正常提示判成了"太含糊"。
                改成：太短（<4 字）或**只由含糊词构成**（≤6 字且含含糊词）。 */
          const nodes = [...document.querySelectorAll('.field__error, [role="alert"]')];
          [...document.querySelectorAll('[aria-invalid="true"][aria-describedby]')]
            .forEach((e) => {
              (e.getAttribute('aria-describedby') || '').split(/\s+/).forEach((id) => {
                const el = id ? document.getElementById(id) : null;
                if (el) nodes.push(el);
              });
            });
          const texts = [...new Set(nodes)]
            .map((el) => (el.textContent || '').trim())
            .filter((t) => t.length > 0);
          if (!texts.length) return { ok: true, note: '无错误文案（跳过）' };
          const tooShort = texts.filter((t) => t.length < 4);
          const tooVague = texts.filter((t) =>
            t.length <= 6 && vague.some((v) => t.toLowerCase().indexOf(v) >= 0));
          return { ok: tooShort.length === 0 && tooVague.length === 0,
                   note: tooVague.length ? '🔴 太含糊：' + tooVague.join(' | ')
                        : (tooShort.length ? '🔴 太短：' + tooShort.join(' | ')
                                          : texts.length + ' 条错误文案都具体') };
        });
        return r;
      },

      '必填有 required 或 aria-required': async (p) => {
        const r = await p.evaluate(() => {
          const marked = document.querySelectorAll('[required], [aria-required="true"]');
          const inputs = document.querySelectorAll('.field input, .field select, .field textarea');
          const labelRequired = [...document.querySelectorAll('label')]
            .filter((l) => /[＊*]必填|required/i.test(l.textContent || ''));
          const unmark = labelRequired.filter((l) => {
            const f = l.getAttribute('for');
            const el = f ? document.getElementById(f) : l.querySelector('input,select,textarea');
            return el && !el.hasAttribute('required') &&
                   el.getAttribute('aria-required') !== 'true';
          });
          return { ok: unmark.length === 0,
                   note: inputs.length + ' 个输入，' + marked.length + ' 个标了必填，' +
                         unmark.length + ' 个视觉标了但语义没标' };
        });
        return r;
      },

      '错误态不能只靠颜色': async () => {
        const fs = require('fs');
        const raw = kit.stripComments(
          fs.readFileSync(REPO + '/03-patterns/form-validation/form-validation.css', 'utf8'));
        const errRules = raw.match(/[^{}]*(?:invalid|error)[^{}]*\{[^{}]*\}/gi) || [];
        if (!errRules.length) return { ok: true, note: '无错误态规则（跳过）' };
        const onlyColor = errRules.filter((r) => {
          const b = r.slice(r.indexOf('{') + 1);
          return /color\s*:/.test(b) && !/border|background|icon|content/.test(b);
        });
        return { ok: onlyColor.length === 0,
                 note: errRules.length + ' 条错误态规则，' +
                       (onlyColor.length ? '🔴 ' + onlyColor.length + ' 条只改颜色'
                                         : '都配合了边框/背景') };
      },

      /* ⭐ 对外有 destroy() 且真的摘干净（与 select / combobox / drawer 同一契约）
         🔴 0.27.11 加：此前本组件**没有** destroy —— 监听全用匿名函数挂上去，
            装得上、摘不下。SPA 换页 / 表单被替换时，旧 DOM 不释放。
         ⚠️ 判据必须看"摘掉之后的行为"，不能只看"有没有这个函数"：
            函数存在但摘不干净（比如只清了一半监听）也算过，那就成了假绿。
            ⇒ 先证明没摘之前 submit 会被拦，再 destroy，再证明**不再被拦**。 */
      '对外有 destroy() 且真的摘干净': async (p) => {
        const r = await p.evaluate(() => {
          const host = document.createElement('div');
          host.innerHTML =
            '<form id="fv-destroy-probe">' +
            '<div class="field" data-validate="required" data-name="测试字段">' +
            '<label class="field__label" for="fv-dp-i">测试</label>' +
            '<input class="field__input" id="fv-dp-i">' +
            '<p class="field__error"></p></div>' +
            '<div data-summary-slot></div>' +
            '<button type="submit">提交</button></form>';
          const form = host.firstChild;
          document.body.appendChild(form);
          if (!window.FormValidation) return { err: 'FormValidation 未加载' };

          const inst = window.FormValidation.init(form);
          const fire = () => {
            const ev = new window.Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(ev);
            return ev.defaultPrevented;
          };

          const before = fire();                   /* 空必填 ⇒ 应被拦下 */
          const hadFn = typeof inst.destroy === 'function';
          if (hadFn) inst.destroy();
          const after = fire();                    /* 摘干净后 ⇒ 不该再被拦 */

          /* 顺带验字段监听：blur 不再写 data-dirty。
             ⚠️ 必须**先清掉**上一段 submit 留下的标记 —— 否则读到的是残留，
                整条判据会永远红（第一次跑就是这么红的）。 */
          const field = form.querySelector('.field');
          const input = form.querySelector('.field__input');
          field.removeAttribute('data-dirty');
          input.focus(); input.blur();
          const dirty = field.hasAttribute('data-dirty');

          form.remove();
          return { before, after, hadFn, dirty };
        });
        if (r.err) return { ok: false, note: '🔴 ' + r.err };
        if (!r.hadFn) return { ok: false, note: '🔴 实例上没有 destroy()' };
        if (!r.before) return { ok: false, note: '🔴 探针前提不成立：destroy 前 submit 就没被拦' };
        if (r.after) return { ok: false, note: '🔴 destroy 之后 submit 仍被拦 ⇒ form 上的监听没摘' };
        if (r.dirty) return { ok: false, note: '🔴 destroy 之后字段 blur 仍写 data-dirty ⇒ 字段监听没摘' };
        return { ok: true, note: 'destroy 前拦、后不拦；字段 blur 也不再留痕 ✅' };
      },
    },
  });
  process.exit(kit.report(r));
})();
