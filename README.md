# dsh-dian-du · 点读笔 / Reading Pen

A reading-pen plugin for **DeepSeek Harness (DSH)**. Drag over any sentence in an answer, click 「在侧边提问」in the floating toolbar, and read the explanation in a docked right-hand column — the conversation itself is never rewritten.

![Reading Pen panel](assets/screenshot-1.png)

> 中文说明见下方 [中文](#中文).

## Features

- **Select text, get a toolbar** — drag over any sentence in an answer and a small floating toolbar appears right above it: 「在侧边提问」sends the snippet to the right column, 「复制」copies it.
- **Traces** — passages you have already asked about keep an amber marker, so an old "I once got stuck here" stays visible.
- **Docked right column** — asking opens the「点读」tab in DSH's right Sidebar. The conversation narrows instead of being covered.
- **Ask there** — type in the column's input, press Enter; the explanation appears in that column and the main transcript keeps its original answer.
- **Clear quickly** — tap `Ctrl` once, or `Ctrl`+click anywhere; 「查过 N 处」 clears all traces.
- **Same model as the chat** — the call follows the conversation's provider/model/reasoning effort, falling back to `high`.

## Requirements

- DSH `>= 0.2.0-rc.1` with the Web/Desktop client (the plugin registers a right-Sidebar tab and a Host command).
- A configured model provider — the explanation runs through the same LLM service as the chat.

## Install

```bash
# Desktop app profile
dsh plugin --profile desktop add github:2404376192/dsh-dian-du

# CLI / web profile
dsh plugin --profile web add github:2404376192/dsh-dian-du
```

Then **quit DSH completely and reopen it** — client bundles are scanned at startup only.

Verify: open the right Sidebar; the「点读」tab is there, and its footer shows the plugin version.

## Usage

1. Drag over the words you do not understand — a floating toolbar appears above them.
2. Click 「在侧边提问」; the right column opens with that snippet under「已选内容」.
3. Type your question under「我的提问」and press Enter.
4. Read the explanation in the same column; the left conversation is untouched.

## How it works

| Part | Role |
|---|---|
| `client.js` | Selection, the floating toolbar, highlighting and the right-column panel; registers into `sidebar.right.pane.tab`, with a `shell.overlay` fallback |
| `index.js` | Host half: registers the `/dian-du` command and calls `ctx.llm.stream` |
| Flow | panel → `ctx.remote.session.create` (a dedicated side session) → `ctx.remote.commands.execute('/dian-du …')` → text rendered in the column |
| `cordis.patch.yml` | Bundle patch; `provider`, `model`, `reasoningEffort` can be overridden here |

Model calls happen on the Host: the browser never sees an API key, and explanations are not appended to the main conversation's log.

## Known limitations

- The main composer belongs to the main conversation. Messages sent there are answered on the left; to keep the explanation on the right, use the right column's input.
- DSH scans client bundles only at startup, so updating the plugin requires a full restart.
- Traces and selections are keyed by message node plus position; if an answer is regenerated, old traces no longer attach to it.

## Development

```bash
npm test        # node test/host.test.mjs && node test/client.test.mjs
node --check client.js && node --check index.js
```

```
client.js            browser half: selection, highlight, right-column panel
index.js             host half: /dian-du command, model call
cordis.patch.yml     bundle patch and provider/model configuration
locale/{zh,en}.json  plugin list title and description
icon.svg             plugin icon
assets/              screenshots
```

## License

MIT

---

## 中文

DeepSeek Harness（DSH）插件：在对话里**划选** AI 回答中的任意文字，点浮出的「在侧边提问」，然后在**右侧独立栏**里提问，让模型专门解释这一处。左侧原始回答不改动、不新增消息。

![点读笔面板](assets/screenshot-1.png)

### 功能

- **划词即弹工具栏**：在回答里拖选任意一段文字，上方浮出小工具栏——「在侧边提问」把这段送进右栏，「复制」复制原文
- **问过的痕迹**：问过的段落保留琥珀色标记（这里曾经不会），随时可清
- **右栏是聊天**：问题和解释都按气泡排——你的问题靠右（实色、加粗），解释靠左，每轮之间虚线分隔
- **右侧栏**：选中后自动展开「点读」标签，左侧对话被挤窄，不遮挡
- **提问**：右栏底部输入，回车发送。发出后输入框**立即清空**，思考时显示「正在思考…」气泡，可以接着打下一句
- **清空**：轻按一下 `Ctrl`，或 `Ctrl` + 点击任意位置；「查过 N 处」可清空全部痕迹
- **跟随当前模型**：provider / model / reasoning effort 跟随对话，兜底 `high`

### 安装

```bash
# 桌面端
dsh plugin --profile desktop add github:2404376192/dsh-dian-du

# 命令行 / web
dsh plugin --profile web add github:2404376192/dsh-dian-du
```

装完**完全退出 DSH 再打开**（客户端 bundle 只在启动时扫描）。

### 使用

1. 在回答里拖选不懂的那句话，上方浮出工具栏
2. 点「在侧边提问」，右栏「点读」展开，这段文字进入「已选内容」
3. 在「我的提问」输入框里说诉求，回车
4. 解释出现在右栏，左侧对话不动

### 原理

| 部分 | 说明 |
|---|---|
| `client.js` | 划词工具栏、点选、高亮、右栏面板；注册到 `sidebar.right.pane.tab`，另有 `shell.overlay` 兜底 |
| `index.js` | Host 半边：注册 `/dian-du` 命令，用 `ctx.llm.stream` 调模型 |
| 调用链 | 面板 → `ctx.remote.session.create`（独立「点读」会话）→ `ctx.remote.commands.execute('/dian-du …')` → 文本回显在右栏 |
| `cordis.patch.yml` | bundle 补丁；`provider` / `model` / `reasoningEffort` 可在这里改 |

模型调用只走 Host，浏览器端不接触 API key，解释也不会写进主对话的会话日志。

### 已知限制

- 主输入框属于主对话，发出去的内容由左侧回答；要解释只在右边，请用右栏底部的输入框
- DSH 只在启动时扫描客户端 bundle，更新插件必须完全退出再打开
- 痕迹和选中按「消息节点 + 位置」记录，回答被重新生成后旧痕迹挂不上

### 开发

```bash
npm test
node --check client.js && node --check index.js
```

### 许可

MIT
