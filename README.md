# dsh-dian-du（点读笔）

DeepSeek Harness（DSH）插件：在对话里**点一下** AI 回答中的某个句子或代码行，然后在**右侧独立栏**里提问，让模型专门解释这一处。左侧原始回答不改动、不新增消息。

> English: A reading-pen plugin for DeepSeek Harness. Click a sentence or a code line in an answer, ask about it, and read the explanation in a docked right-hand column — the conversation itself is never rewritten.

## 状态

**实验性（v0.1.0）**：选中、右侧面板、右侧栏注册已经跑通；`/dian-du` 命令 + 独立会话的 AI 链路仍在校准 DSH 的 Remote 接口，可能报错。装到正式环境前请先本地验证。

## 功能

- **点选**：点击回答里的段落 / 标题 / 列表 / 引用切换选中；代码块里点哪一行就选哪一行
- **高亮**：淡蓝底 + 左侧竖条，代码块加左侧标记；不改写 DOM 结构，不影响排版
- **右侧栏**：选中后自动展开右侧栏的「点读」标签，左栏被挤窄，不遮挡
- **提问**：右栏底部输入框，回车发送；解释显示在右栏，和你问的内容放在一起
- **清空**：单独轻按一下 `Ctrl`，或按住 `Ctrl` 点击任意位置

## 安装

### 从 npm

```bash
dsh plugin --profile desktop add dsh-dian-du
```

`dsh plugin` 会把包装进 profile 并加入 `dsh.profile.bundles`。

### 从本地目录

```bash
dsh plugin --profile desktop add "link:C:/path/to/dsh-dian-du"
```

### 从 Git 仓库

```bash
dsh plugin --profile desktop add "git+https://github.com/<you>/dsh-dian-du.git"
```

装完**完全退出 DSH 再打开**（客户端 bundle 只在启动时扫描）。

## 使用

1. 在 AI 回答里点一下想弄懂的那一句（或代码块里的一行）
2. 右侧栏自动展开「点读」
3. 在右栏底部输入你的诉求，回车
4. 解释出现在右栏；左侧对话保持原样

## 工作原理

| 部分 | 说明 |
|---|---|
| `client.js` | 点选、高亮、右栏面板；注册到 `sidebar.right.pane.tab`（右侧栏）与 `shell.overlay`（兜底浮层） |
| `index.js` | Host 半边：注册 `/dian-du` 命令，用 `ctx.llm.stream` 调模型 |
| 调用链 | 右栏 → `ctx.remote.session.create`（独立「点读」会话）→ `ctx.remote.commands.execute('/dian-du …')` → 解释文本回显在右栏 |
| `cordis.patch.yml` | bundle 补丁；`provider` / `model` 可在这里改，默认 `deepseek-official` / `deepseek-flash` |

模型调用只走 Host，浏览器端不接触 API key；解释不会写入主对话的会话日志。

## 开发

```bash
node --check client.js
node --check index.js
```

目录结构：

```
client.js           浏览器端（选中 + 右栏 UI）
index.js            Host 端（/dian-du 命令 + 模型调用）
cordis.patch.yml    bundle 补丁与配置
locale/{zh,en}.json 插件列表里的标题和描述
icon.svg            插件图标
```

## 已知限制

- 主输入框的消息属于主对话，AI 会在左侧回答；要让解释只出现在右侧，请用右栏底部的输入框
- DSH 只在启动时扫描客户端 bundle：改完代码必须完全退出再打开
- 右侧栏依赖 DSH 的 `sidebarRight` 服务；不可用时退化为浮动面板

## 发布到 GitHub 与插件市场

1. 改掉 `package.json` 里的 `author`、`repository`、`homepage` 占位符
2. `git init && git add . && git commit -m "feat: initial dsh-dian-du"`，推到你自己的 GitHub 仓库
3. 发布 npm：`npm publish --access public`（名字 `dsh-dian-du` 若被占用，改成带 scope 的 `@you/dsh-dian-du` 并同步改 `package.json`）
4. 提交到 DSH 插件市场的索引（index format 1 JSON），每个插件条目形如：

```json
{
  "name": "dsh-dian-du",
  "title": { "en": "Reading Pen", "zh": "点读笔" },
  "description": { "en": "…", "zh": "…" },
  "repository": { "url": "https://github.com/<you>/dsh-dian-du" },
  "versions": [
    {
      "version": "0.1.0",
      "publishTimestamp": "2026-10-24T00:00:00.000Z",
      "engines": { "dsh": ">=0.2.0-rc.1" }
    }
  ]
}
```

索引的具体字段以 `@deepseek-ai/dsh-plugin-market-index` 的格式 1 为准；Git 安装也可直接写 `git+https://…git#<commit>`。

## 验证

`ash
npm test          # node test/host.test.mjs && node test/client.test.mjs
`

- Host 逻辑自测（命令注册、解析、流式拼接、错误路径）通过
- 客户端自测（注册、点选、Ctrl 清空）通过
- 在隔离的 DSH web 实例里用无头 Chrome 加载真实页面：插件样式注入、右侧栏注册、emote 注入均成功，控制台无异常（	est/e2e-load.mjs）

尚未验证：真实凭据下的端到端模型往返。

## 许可

MIT
