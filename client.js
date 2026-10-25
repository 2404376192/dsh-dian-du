/**
 * 点读笔 — Client half (v9).
 *
 * Flow:
 *   1. click a paragraph / heading / list item / quote — or one line inside a
 *      code block — to select it;
 *   2. the panel slides out on the right by itself (no button anywhere);
 *   3. type the question in the panel's bottom input and press Enter;
 *   4. the explanation appears in that panel; the transcript is never touched.
 *
 * The panel is registered in `shell.overlay`, a root-level overlay seat, so it
 * does not depend on the right Sidebar plugin or on any tab registry.
 */

window.__ModuleLoader__.load({
  id: 'dsh-dian-du',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const VERSION = 'v16';
    const TAB_ID = 'dsh-dian-du';
    const KIND = 'dian-du';
    const STORAGE_KEY = 'dian-du.v1';
    const COMMAND = 'dian-du';
    const INNER_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote';
    const BLOCK_SELECTOR = '[data-chat-group-part="response"] :is(' + INNER_SELECTOR + ')';

    const store = {
      marks: loadMarks(),
      asked: loadAsked(),
      question: '',
      busy: false,
      status: '',
      error: '',
      debug: '',
      open: false,
      useSidebar: false,
      sidebarAvailable: false,
      thread: [],
      sideSessionId: loadSideSession(),
    };

    function withTimeout(promise, ms, label) {
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(label + '超时（' + Math.round(ms / 1000) + ' 秒）')), ms);
        promise.then(
          (value) => {
            window.clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            window.clearTimeout(timer);
            reject(error);
          },
        );
      });
    }

    const listeners = new Set();
    let dockCtx = null;
    let remoteCtx = null;
    let sidebarBodyMounted = false;
    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
    function notify() {
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch {
          /* one bad listener must not stop the rest */
        }
      }
    }
    function update(patch) {
      Object.assign(store, patch);
      try {
        if ('marks' in patch) saveMarks();
        if ('asked' in patch) saveAsked();
        if ('sideSessionId' in patch) saveSideSession();
      } catch {
        /* storage is optional */
      }
      notify();
      if ('marks' in patch || 'asked' in patch) {
        try {
          paintCodeHighlights();
          if ('asked' in patch) reapplyMarks();
        } catch {
          /* painting is best effort */
        }
      }
    }

    function loadMarks() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed && parsed.marks) ? parsed.marks : [];
      } catch {
        return [];
      }
    }
    function saveMarks() {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ marks: store.marks }));
    }
    function loadAsked() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY + '.asked');
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    function saveAsked() {
      window.localStorage.setItem(STORAGE_KEY + '.asked', JSON.stringify(store.asked));
    }
    function rememberAsked() {
      const known = new Set(store.asked.map((entry) => entry.id));
      const added = store.marks
        .filter((mark) => !known.has(mark.id))
        .map((mark) => ({ id: mark.id, text: mark.text, label: mark.label || '', at: Date.now() }));
      if (added.length === 0) return;
      update({ asked: store.asked.concat(added) });
    }
    function forgetAsked() {
      update({ asked: [] });
    }
    function loadSideSession() {
      try {
        return window.localStorage.getItem(STORAGE_KEY + '.side') || '';
      } catch {
        return '';
      }
    }
    function saveSideSession() {
      window.localStorage.setItem(STORAGE_KEY + '.side', store.sideSessionId);
    }

    function textOf(element) {
      const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
      return text.length > 800 ? text.slice(0, 800) + '…' : text;
    }

    function blockIndex(element) {
      const row = element.closest('[data-chat-group-part="response"]');
      if (!row) return 0;
      return [...row.querySelectorAll(INNER_SELECTOR)].indexOf(element) + 1;
    }

    function toggleMark(element) {
      const row = element.closest('[data-chat-group-part="response"]');
      if (!row) return;
      const nodeKey = row.closest('[data-chat-node-key]')?.dataset.chatNodeKey ?? 'answer';
      const text = textOf(element);
      if (!text) return;
      const id = nodeKey + '#' + blockIndex(element);
      if (store.marks.some((m) => m.id === id)) {
        element.removeAttribute('data-dd-marked');
        update({ marks: store.marks.filter((m) => m.id !== id), debug: '取消 <' + element.tagName.toLowerCase() + '>' });
      } else {
        element.setAttribute('data-dd-marked', '');
        update({
          marks: store.marks.concat({ id, text, at: Date.now() }),
          debug: '已选 <' + element.tagName.toLowerCase() + '>',
        });
        openPanel();
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    }

    function codeHostOf(element) {
      return element.closest('pre') || element.closest('code') || null;
    }

    function codeLineAt(host, x, y) {
      const text = host.textContent || '';
      const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (range && host.contains(range.startContainer)) {
        const probe = document.createRange();
        probe.selectNodeContents(host);
        probe.setEnd(range.startContainer, range.startOffset);
        const line = probe.toString().split('\n').length;
        return { line, text: (text.split('\n')[line - 1] || '').trim() };
      }
      const style = window.getComputedStyle(host);
      const lineHeight = parseFloat(style.lineHeight);
      const top = host.getBoundingClientRect().top + parseFloat(style.paddingTop);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return { line: 0, text: '' };
      const line = Math.max(1, Math.floor((y - top) / lineHeight) + 1);
      return { line, text: (text.split('\n')[line - 1] || '').trim() };
    }

    function preIndexIn(row, pre) {
      return [...row.querySelectorAll('pre')].indexOf(pre);
    }

    function toggleCodeLine(host, x, y) {
      const block = host.closest('pre, code') || host;
      const row = block.closest('[data-chat-group-part="response"]');
      if (!row) return;
      const pre = block.closest('pre') || block;
      const found = codeLineAt(block, x, y);
      if (!found.line || !found.text) return;
      const nodeKey = row.closest('[data-chat-node-key]')?.dataset.chatNodeKey ?? 'answer';
      const preIndex = Math.max(0, preIndexIn(row, pre));
      const id = nodeKey + '#P' + preIndex + 'L' + found.line;
      if (store.marks.some((m) => m.id === id)) {
        update({ marks: store.marks.filter((m) => m.id !== id), debug: '取消代码第 ' + found.line + ' 行' });
      } else {
        update({
          marks: store.marks.concat({
            id,
            label: '代码第 ' + found.line + ' 行',
            text: found.text.length > 800 ? found.text.slice(0, 800) + '…' : found.text,
            at: Date.now(),
          }),
          debug: '已选代码第 ' + found.line + ' 行',
        });
        openPanel();
      }
      paintCodeHighlights();
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    }

    /** Paint exactly the selected lines (blue) and previously asked lines (amber). */
    function paintCodeHighlights() {
      for (const pre of document.querySelectorAll('[data-chat-group-part="response"] pre')) {
        const row = pre.closest('[data-chat-group-part="response"]');
        if (!row) continue;
        const nodeKey = row.closest('[data-chat-node-key]')?.dataset.chatNodeKey ?? 'answer';
        const preIndex = Math.max(0, preIndexIn(row, pre));
        const prefix = nodeKey + '#P' + preIndex + 'L';
        const linesOf = (list) =>
          list
            .filter((entry) => entry.id.startsWith(prefix))
            .map((entry) => Number(entry.id.slice(prefix.length)))
            .filter((line) => Number.isFinite(line) && line > 0);
        const selected = new Set(linesOf(store.marks));
        const asked = new Set(linesOf(store.asked));
        if (selected.size === 0 && asked.size === 0) {
          pre.style.backgroundImage = '';
          continue;
        }
        const style = window.getComputedStyle(pre);
        const lineHeight = parseFloat(style.lineHeight);
        const paddingTop = parseFloat(style.paddingTop) || 0;
        if (!Number.isFinite(lineHeight) || lineHeight <= 0) continue;
        const stops = [];
        const all = [...new Set([...selected, ...asked])].sort((a, b) => a - b);
        for (const line of all) {
          const top = paddingTop + (line - 1) * lineHeight;
          if (selected.has(line)) {
            stops.push(
              'transparent ' + top + 'px',
              'rgba(36,123,191,.20) ' + top + 'px',
              'rgba(36,123,191,.20) ' + (top + lineHeight) + 'px',
              'transparent ' + (top + lineHeight) + 'px',
            );
          } else {
            stops.push(
              'transparent ' + (top + lineHeight - 2) + 'px',
              'rgba(209,154,58,.75) ' + (top + lineHeight - 2) + 'px',
              'rgba(209,154,58,.75) ' + (top + lineHeight) + 'px',
              'transparent ' + (top + lineHeight) + 'px',
            );
          }
        }
        pre.style.backgroundImage = 'linear-gradient(' + stops.join(',') + ')';
        pre.style.backgroundRepeat = 'no-repeat';
      }
    }

    function reapplyMarks() {
      const asked = new Set(store.asked.map((entry) => entry.id));
      if (store.marks.length === 0 && asked.size === 0) return;
      const wanted = new Set(store.marks.map((mark) => mark.id));
      for (const row of document.querySelectorAll('[data-chat-group-part="response"]')) {
        const nodeKey = row.closest('[data-chat-node-key]')?.dataset.chatNodeKey ?? 'answer';
        [...row.querySelectorAll(INNER_SELECTOR)].forEach((block, index) => {
          const id = nodeKey + '#' + (index + 1);
          if (wanted.has(id)) block.setAttribute('data-dd-marked', '');
          if (asked.has(id)) block.setAttribute('data-dd-asked', '');
        });
      }
      paintCodeHighlights();
    }

    function clearMarks() {
      for (const element of document.querySelectorAll('[data-dd-marked], [data-dd-code]')) {
        element.removeAttribute('data-dd-marked');
        element.removeAttribute('data-dd-code');
      }
      for (const pre of document.querySelectorAll('[data-chat-group-part="response"] pre')) {
        if (pre.style) pre.style.backgroundImage = '';
      }
      update({ marks: [], thread: [], error: '', status: '已清除选择' });
    }

    /** Show the panel: the docked right column when it is available, the overlay otherwise. */
    function openPanel() {
      let docked = false;
      if (store.sidebarAvailable && dockCtx) {
        try {
          dockCtx.sidebarRight.openTab(KIND);
          docked = dockCtx.sidebarRight.isExpanded() === true;
          if (docked) {
            window.setTimeout(() => {
              if (!sidebarBodyMounted) update({ useSidebar: false });
            }, 1200);
          }
        } catch (error) {
          console.error('[dian-du] openTab', error);
          update({ debug: '右侧栏打开失败：' + ((error && error.message) || String(error)) });
        }
      }
      update({ open: true, useSidebar: docked });
    }

    function currentSessionId() {
      return document.querySelector('[data-sidebar-right-session]')?.dataset.sidebarRightSession ?? '';
    }

    async function ensureSideSession() {
      if (store.sideSessionId) return store.sideSessionId;
      const remote = remoteCtx && remoteCtx.remote;
      if (!remote || !remote.session) throw new Error('AI 服务未就绪（remote 未注入）');
      update({ status: '正在创建点读会话…' });
      const created = await withTimeout(remote.session.create({}), 15000, '创建点读会话');
      if (!created || created.ok !== true) {
        throw new Error((created && created.error && (created.error.message || created.error.code)) || '无法创建点读会话');
      }
      const id = created.value?.sessionId;
      if (!id) throw new Error('创建点读会话失败');
      update({ sideSessionId: id, status: '已创建点读会话' });
      return id;
    }

    async function ask() {
      if (store.busy) {
        update({ status: '上一次请求还在进行，点「停止」可以取消' });
        return;
      }
      if (store.marks.length === 0) {
        update({ error: '先在左边点选一段内容' });
        return;
      }
      const question = store.question.trim();
      update({ busy: true, error: '', status: '准备发送…' });
      const payload = { items: store.marks.map((m) => ({ text: m.text })), question };
      const line = '/' + COMMAND + ' ' + JSON.stringify(payload);

      let sid = '';
      try {
        sid = await ensureSideSession();
      } catch (error) {
        sid = currentSessionId();
        if (!sid) {
          update({ busy: false, status: '', error: (error && error.message) || String(error) });
          return;
        }
      }

      try {
        const remote = remoteCtx && remoteCtx.remote;
        if (!remote || !remote.commands) throw new Error('AI 服务未就绪（remote 未注入）');
        update({ status: '正在执行 /dian-du…' });
        const execution = await withTimeout(remote.commands.execute(sid, line, []), 120000, '模型解释');
        if (!execution || execution.ok !== true) {
          throw new Error((execution && execution.error && (execution.error.message || execution.error.code)) || '执行失败');
        }
        const value = execution.value;
        if (!value || !value.result) throw new Error('/' + COMMAND + ' 没有注册（Host 半边未加载）');
        if (value.result.kind !== 'success') throw new Error(value.result.text || '解释失败');
        update({
          busy: false,
          status: '',
          error: '',
          thread: store.thread.concat({ q: question || '解释选中的内容', a: value.result.text, at: Date.now() }),
          question: '',
        });
        rememberAsked();
      } catch (error) {
        update({ busy: false, status: '', error: (error && error.message) || String(error) });
      }
    }

    const CSS = `
[data-chat-group-part="response"] :is(pre, code),
[data-chat-group-part="response"] :is(pre, code) * {
  -webkit-user-select: text !important;
  user-select: text !important;
}
[data-chat-group-part="response"] :is(p, h1, h2, h3, h4, h5, h6, li, blockquote, pre) {
  border-radius: 6px;
  transition: background .12s ease, box-shadow .12s ease;
}
[data-chat-group-part="response"] :is(p, h1, h2, h3, h4, h5, h6, li, blockquote, pre):hover {
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #9aa0a6) 8%, transparent);
}
[data-chat-group-part="response"] [data-dd-marked] {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #247bbf) 14%, transparent);
  box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary, #247bbf);
}
[data-chat-group-part="response"] [data-dd-asked]:not([data-dd-marked]) {
  box-shadow: inset 3px 0 0 rgba(209,154,58,.85);
}

.dd-overlay { position: fixed; right: 16px; top: 74px; bottom: 118px; width: 400px; display: flex; flex-direction: column; z-index: 60; border-radius: 12px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-elevated, #1b1c1f); background: var(--dsw-alias-background-elevated, #1b1c1f); box-shadow: 0 12px 40px rgba(0,0,0,.35); overflow: hidden; color: var(--dsw-alias-label-primary, inherit); font-size: 14px; }
.dd-sidebar { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary, inherit); font-size: 14px; }
.dd-head { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-bottom: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.22)); }
.dd-title { font-weight: 600; font-size: 15px; }
.dd-count { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8f98); }
.dd-asked-clear { margin-left: auto; border: 0; background: transparent; color: rgba(209,154,58,.95); cursor: pointer; font: inherit; font-size: 11px; padding: 0 4px; }
.dd-asked-tag { font-size: 10px; line-height: 16px; color: rgba(209,154,58,.95); border: 1px solid rgba(209,154,58,.45); border-radius: 999px; padding: 0 5px; white-space: nowrap; }
.dd-close { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #8a8f98); cursor: pointer; font-size: 16px; padding: 0 4px; }
.dd-scroll { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.dd-section { margin-top: 2px; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--dsw-alias-label-tertiary, #8a8f98); text-transform: none; }
.dd-mark { border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.26)); border-radius: 8px; padding: 8px 10px; display: flex; gap: 8px; align-items: flex-start; background: color-mix(in srgb, var(--dsw-alias-label-tertiary, #9aa0a6) 5%, transparent); }
.dd-label { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8f98); white-space: nowrap; padding-top: 3px; }
.dd-text { flex: 1; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; line-height: 1.6; font-size: 13px; }
.dd-x { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #8a8f98); cursor: pointer; font-size: 14px; padding: 0 3px; }
.dd-qa { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.22)); border-radius: 10px; padding: 10px 12px; background: color-mix(in srgb, var(--dsw-alias-brand-primary, #247bbf) 4%, transparent); }
.dd-q { font-weight: 600; font-size: 13px; color: var(--dsw-alias-label-secondary, inherit); }
.dd-a { white-space: pre-wrap; line-height: 1.8; font-size: 14px; }
.dd-hint { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 12px; line-height: 1.6; }
.dd-error { font-size: 12px; color: var(--dsw-alias-danger, #e5484d); line-height: 1.55; }
.dd-loading { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8a8f98); }
.dd-compose { border-top: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.22)); padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 8px; }
.dd-area { width: 100%; min-height: 64px; max-height: 160px; resize: none; box-sizing: border-box; border-radius: 8px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); background: transparent; color: inherit; font: inherit; font-size: 14px; line-height: 1.6; }
.dd-row { display: flex; gap: 8px; align-items: center; }
.dd-btn { border-radius: 8px; padding: 6px 14px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 13px; }
.dd-btn.primary { background: var(--dsw-alias-brand-primary, #247bbf); border-color: transparent; color: #fff; }
.dd-btn:disabled { opacity: .5; cursor: default; }
.dd-debug { font-size: 10px; color: var(--dsw-alias-label-tertiary, #8a8f98); font-family: ui-monospace, Consolas, monospace; }
`;

    function Panel({ variant }) {
      const [, setTick] = React.useState(0);
      React.useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
      const [ctxRef] = React.useState(() => Panel.ctx);
      const inline = variant === 'sidebar';

      React.useEffect(() => {
        if (inline || !store.open) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') update({ open: false });
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
      }, [inline, store.open]);

      if (!inline && (!store.open || store.useSidebar)) return null;

      const send = () => ask();

      React.useEffect(() => {
        if (inline) sidebarBodyMounted = true;
      }, [inline]);

      return h(
        'div',
        { className: inline ? 'dd-sidebar' : 'dd-overlay' },
        h(
          'div',
          { className: 'dd-head' },
          h('span', { className: 'dd-title' }, '点读'),
          h('span', { className: 'dd-count' }, store.marks.length ? store.marks.length + ' 处已选' : '未选择'),
          store.asked.length
            ? h(
                'button',
                {
                  className: 'dd-asked-clear',
                  title: '清除所有「查过」痕迹',
                  onClick: forgetAsked,
                },
                '查过 ' + store.asked.length + ' 处',
              )
            : null,
          inline ? null : h('button', { className: 'dd-close', title: '收起', onClick: () => update({ open: false }) }, '×'),
        ),
        h(
          'div',
          { className: 'dd-scroll' },
          h('div', { className: 'dd-section' }, '已选内容'),
          store.marks.length === 0
            ? h('div', { className: 'dd-hint' }, '在左边点一下想弄懂的句子或代码行。')
            : store.marks.map((mark) =>
                h(
                  'div',
                  { className: 'dd-mark', key: mark.id },
                  mark.label ? h('span', { className: 'dd-label' }, mark.label) : null,
                  h('span', { className: 'dd-text' }, mark.text),
                  store.asked.some((entry) => entry.id === mark.id)
                    ? h('span', { className: 'dd-asked-tag' }, '查过')
                    : null,
                  h(
                    'button',
                    { className: 'dd-x', onClick: () => update({ marks: store.marks.filter((m) => m.id !== mark.id) }) },
                    '×',
                  ),
                ),
              ),
          h('div', { className: 'dd-section' }, '我的提问'),
          store.thread.length === 0
            ? h('div', { className: 'dd-hint' }, '选好内容后，在下面的框里说你的诉求，回车发送。')
            : null,
          store.thread.map((entry) =>
            h(
              'div',
              { className: 'dd-qa', key: entry.at },
              h('div', { className: 'dd-q' }, entry.q),
              h('div', { className: 'dd-a' }, entry.a),
            ),
          ),
          store.busy ? h('div', { className: 'dd-loading' }, store.status || '正在解释…') : null,
          !store.busy && store.status ? h('div', { className: 'dd-hint' }, store.status) : null,
          store.error ? h('div', { className: 'dd-error' }, store.error) : null,
          store.debug ? h('div', { className: 'dd-debug' }, store.debug) : null,
        ),
        h(
          'div',
          { className: 'dd-compose' },
          h('textarea', {
            className: 'dd-area',
            placeholder: '说出你的诉求，回车发送（Shift+回车换行）',
            value: store.question,
            onChange: (e) => update({ question: e.target.value }),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            },
          }),
          h(
            'div',
            { className: 'dd-row' },
            h('button', { className: 'dd-btn primary', disabled: store.busy, onClick: send }, store.busy ? '解释中…' : '发送'),
            store.busy
              ? h(
                  'button',
                  {
                    className: 'dd-btn',
                    onClick: () => update({ busy: false, status: '已取消（后台请求可能仍在继续）' }),
                  },
                  '停止',
                )
              : null,
            h(
              'button',
              {
                className: 'dd-btn',
                disabled: store.busy || (store.marks.length === 0 && store.thread.length === 0),
                onClick: () => update({ marks: [], thread: [], error: '', question: '' }),
              },
              '清空',
            ),
            h('span', { className: 'dd-hint' }, VERSION),
          ),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        Panel.ctx = ctx;

        try {
          const style = document.createElement('style');
          style.setAttribute('data-dian-du', '');
          style.textContent = CSS;
          document.head.appendChild(style);
          ctx.effect(() => () => style.remove());
        } catch (error) {
          console.error('[dian-du] style', error);
        }

        try {
          let down = null;
          const onDown = (event) => {
            down = { x: event.clientX, y: event.clientY };
          };
          const onClick = (event) => {
            if (!(event.target instanceof Element)) return;
            if (event.target.closest('a, button, summary, input, textarea, select, [contenteditable="true"]')) return;
            const dragged = down && (Math.abs(event.clientX - down.x) > 5 || Math.abs(event.clientY - down.y) > 5);
            down = null;
            if (dragged) return;
            if (event.ctrlKey) {
              event.preventDefault();
              event.stopPropagation();
              clearMarks();
              return;
            }
            const row = event.target.closest('[data-chat-group-part="response"]');
            if (!row) return;
            const code = codeHostOf(event.target);
            if (code) {
              event.preventDefault();
              event.stopPropagation();
              toggleCodeLine(code, event.clientX, event.clientY);
              return;
            }
            const block = event.target.closest(BLOCK_SELECTOR);
            if (!block) {
              update({ debug: '点了 <' + event.target.tagName.toLowerCase() + '>，没匹配到段落/代码块' });
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            toggleMark(block);
          };
          let ctrlDownAt = 0;
          let ctrlUsed = false;
          const onKeyDown = (event) => {
            if (event.key === 'Control') {
              ctrlDownAt = Date.now();
              ctrlUsed = false;
            } else if (ctrlDownAt) {
              ctrlUsed = true;
            }
          };
          const onKeyUp = (event) => {
            if (event.key !== 'Control') return;
            const tapped = ctrlDownAt > 0 && !ctrlUsed && Date.now() - ctrlDownAt < 350;
            ctrlDownAt = 0;
            if (tapped && store.marks.length > 0) clearMarks();
          };
          document.addEventListener('pointerdown', onDown, true);
          document.addEventListener('click', onClick, true);
          document.addEventListener('keydown', onKeyDown, true);
          document.addEventListener('keyup', onKeyUp, true);
          ctx.effect(() => () => {
            document.removeEventListener('pointerdown', onDown, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
          });
        } catch (error) {
          console.error('[dian-du] click', error);
        }

        try {
          // No document-wide MutationObserver: streaming answers mutate the DOM
          // hundreds of times per second, and rescanning on every batch froze the
          // renderer. Repaint lazily on scroll/focus instead.
          let timer = 0;
          const schedule = () => {
            if (store.marks.length === 0) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(reapplyMarks, 250);
          };
          document.addEventListener('scroll', schedule, true);
          window.addEventListener('focus', schedule);
          ctx.effect(() => () => {
            window.clearTimeout(timer);
            document.removeEventListener('scroll', schedule, true);
            window.removeEventListener('focus', schedule);
          });
        } catch (error) {
          console.error('[dian-du] repaint hooks', error);
        }

        try {
        ctx.inject(['sidebarRightTabs', 'sidebarRight'], (child) => {
          const dock = child || ctx;
          dockCtx = dock;
          try {
            dock.effect(() =>
              dock.sidebarRightTabs.register({
                id: TAB_ID,
                kind: KIND,
                priority: 'extension',
                title: () => '点读',
                guide: [
                  {
                    id: TAB_ID,
                    order: 90,
                    title: () => '点读',
                    description: () => '点一句，右边问 AI',
                  },
                ],
              }),
            );
            dock.effect(() =>
              dock.slots.inject('sidebar.right.pane.tab', () =>
                dock.slots.register(
                  { name: 'sidebar.right.pane.tab', key: TAB_ID },
                  () => h(Panel, { variant: 'sidebar' }),
                ),
              ),
            );
            update({ sidebarAvailable: true });
            console.log('[dian-du] sidebar available: true');
          } catch (error) {
            console.error('[dian-du] sidebar', error);
            update({ sidebarAvailable: false });
          }
        });

        } catch (error) {
          console.error('[dian-du] inject sidebar', error);
        }

        try {
        const attachRemote = (child) => {
          remoteCtx = child || ctx;
          console.log('[dian-du] remote ready');
        };
        ctx.inject(['remote'], (child) => attachRemote(child || ctx));
        ctx.inject(['remote', 'remote.session', 'remote.commands'], (child) => attachRemote(child || ctx));
        } catch (error) {
          console.error('[dian-du] inject remote', error);
        }

        try {
          ctx.effect(() =>
            ctx.slots.inject('shell.overlay', () =>
              ctx.slots.register({ name: 'shell.overlay', id: 'dian-du-panel' }, () => h(Panel, { variant: 'overlay' })),
            ),
          );
        } catch (error) {
          console.error('[dian-du] overlay', error);
        }
      },
    };
  },
});
