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

    const VERSION = 'v13';
    const TAB_ID = 'dsh-dian-du';
    const KIND = 'dian-du';
    const STORAGE_KEY = 'dian-du.v1';
    const COMMAND = 'dian-du';
    const INNER_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote';
    const BLOCK_SELECTOR = '[data-chat-group-part="response"] :is(' + INNER_SELECTOR + ')';

    const store = {
      marks: loadMarks(),
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
        if ('sideSessionId' in patch) saveSideSession();
      } catch {
        /* storage is optional */
      }
      notify();
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

    function toggleCodeLine(host, x, y) {
      const block = host.closest('pre, code') || host;
      const row = block.closest('[data-chat-group-part="response"]');
      if (!row) return;
      const found = codeLineAt(block, x, y);
      if (!found.line || !found.text) return;
      const nodeKey = row.closest('[data-chat-node-key]')?.dataset.chatNodeKey ?? 'answer';
      const id = nodeKey + '#L' + found.line;
      if (store.marks.some((m) => m.id === id)) {
        const marks = store.marks.filter((m) => m.id !== id);
        if (!marks.some((m) => m.id.startsWith(nodeKey + '#L'))) block.removeAttribute('data-dd-code');
        update({ marks, debug: '取消代码第 ' + found.line + ' 行' });
      } else {
        block.setAttribute('data-dd-code', '');
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
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) selection.removeAllRanges();
    }

    function reapplyMarks() {
      if (store.marks.length === 0) return;
      const wanted = new Set(store.marks.map((mark) => mark.id));
      for (const row of document.querySelectorAll('[data-chat-group-part="response"]')) {
        const nodeKey = row.closest('[data-chat-node-key]')?.dataset.chatNodeKey ?? 'answer';
        [...row.querySelectorAll(INNER_SELECTOR)].forEach((block, index) => {
          if (wanted.has(nodeKey + '#' + (index + 1))) block.setAttribute('data-dd-marked', '');
        });
        for (const pre of row.querySelectorAll('pre')) {
          if ([...wanted].some((id) => id.startsWith(nodeKey + '#L'))) pre.setAttribute('data-dd-code', '');
        }
      }
    }

    function clearMarks() {
      for (const element of document.querySelectorAll('[data-dd-marked], [data-dd-code]')) {
        element.removeAttribute('data-dd-marked');
        element.removeAttribute('data-dd-code');
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
[data-chat-group-part="response"] pre[data-dd-code] {
  box-shadow: inset 3px 0 0 var(--dsw-alias-brand-primary, #247bbf);
}
.dd-overlay { position: fixed; right: 16px; top: 74px; bottom: 118px; width: 380px; display: flex; flex-direction: column; z-index: 60; border-radius: 12px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-elevated, #1b1c1f); background: var(--dsw-alias-background-elevated, #1b1c1f); box-shadow: 0 12px 40px rgba(0,0,0,.35); overflow: hidden; color: var(--dsw-alias-label-primary, inherit); font-size: 13px; }
.dd-sidebar { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary, inherit); font-size: 13px; }
.dd-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.2)); }
.dd-title { font-weight: 600; font-size: 13px; }
.dd-count { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8f98); }
.dd-close { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #8a8f98); cursor: pointer; font-size: 15px; padding: 0 4px; }
.dd-scroll { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 9px; }
.dd-mark { border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.22)); border-radius: 8px; padding: 6px 8px; display: flex; gap: 7px; align-items: flex-start; }
.dd-label { font-size: 10px; color: var(--dsw-alias-label-tertiary, #8a8f98); white-space: nowrap; padding-top: 2px; }
.dd-text { flex: 1; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.5; }
.dd-x { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, #8a8f98); cursor: pointer; font-size: 13px; padding: 0 3px; }
.dd-qa { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.2)); padding-top: 8px; }
.dd-q { font-weight: 600; font-size: 11px; color: var(--dsw-alias-label-secondary, inherit); }
.dd-a { white-space: pre-wrap; line-height: 1.65; }
.dd-hint { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 11px; line-height: 1.55; }
.dd-error { font-size: 11px; color: var(--dsw-alias-danger, #e5484d); line-height: 1.5; }
.dd-loading { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8f98); }
.dd-compose { border-top: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.2)); padding: 9px 12px 11px; display: flex; flex-direction: column; gap: 7px; }
.dd-area { width: 100%; min-height: 54px; max-height: 140px; resize: none; box-sizing: border-box; border-radius: 8px; padding: 7px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); background: transparent; color: inherit; font: inherit; }
.dd-row { display: flex; gap: 7px; align-items: center; }
.dd-btn { border-radius: 8px; padding: 5px 11px; border: 1px solid var(--dsw-alias-border-secondary, rgba(128,128,128,.25)); background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 12px; }
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
          inline ? null : h('button', { className: 'dd-close', title: '收起', onClick: () => update({ open: false }) }, '×'),
        ),
        h(
          'div',
          { className: 'dd-scroll' },
          store.marks.length === 0
            ? h('div', { className: 'dd-hint' }, '在左边点一下想弄懂的句子或代码行。')
            : store.marks.map((mark) =>
                h(
                  'div',
                  { className: 'dd-mark', key: mark.id },
                  mark.label ? h('span', { className: 'dd-label' }, mark.label) : null,
                  h('span', { className: 'dd-text' }, mark.text),
                  h(
                    'button',
                    { className: 'dd-x', onClick: () => update({ marks: store.marks.filter((m) => m.id !== mark.id) }) },
                    '×',
                  ),
                ),
              ),
          store.thread.map((entry) =>
            h(
              'div',
              { className: 'dd-qa', key: entry.at },
              h('div', { className: 'dd-q' }, '问：' + entry.q),
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
          let timer = 0;
          const observer = new MutationObserver(() => {
            if (store.marks.length === 0) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(reapplyMarks, 200);
          });
          observer.observe(document.body, { childList: true, subtree: true });
          ctx.effect(() => () => {
            window.clearTimeout(timer);
            observer.disconnect();
          });
        } catch (error) {
          console.error('[dian-du] observer', error);
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
