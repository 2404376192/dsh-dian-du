# 发布指南（GitHub + 插件市场）

> 结论：这个插件**不需要 npm 也能上市场**。市场收录看的是 GitHub 仓库，不是 npm 包。
> npm 只是让市场能显示下载量、并让安装跳过构建授权。

## 0. 先决条件

- 插件仓库的 `package.json` 必须声明 `dsh.bundle`（本仓库已声明）——只声明 `dsh.client` 会被 CI 拒绝
- 仓库要有**真实可用的代码**（占位/纯 README 不收）
- 仓库创建**满 1 天**（CI 自动检查）
- 给仓库加 `dsh-plugin` topic
- 描述必须与代码实际行为一致（维护者会读源码核对）

## 1. 传到 GitHub

这台机器没装 git，用网页或 GitHub Desktop 都行。

**网页上传：**

1. 登录 GitHub → 右上角 `+` → **New repository**
2. 名字填 `dsh-dian-du`，Public，不要勾选初始化 README
3. 创建后点 **uploading an existing file**
4. 把本目录里的这些文件/文件夹拖进去：
   `package.json`、`index.js`、`client.js`、`cordis.patch.yml`、`locale/`、`icon.svg`、`LICENSE`、`README.md`、`CHANGELOG.md`、`.gitignore`、`test/`
   （`market-entry.yml`、`STATUS.md` 可以不传）
5. Commit message 填 `feat: initial release` → Commit changes
6. 仓库页右上角 ⚙️ → Topics 里加 `dsh-plugin`

**用 GitHub Desktop：** Add existing repository → 选本地目录 → Publish repository。

传完后，把 `package.json` 里的 `author` / `repository` / `homepage` 三个 `TODO` 改成你自己的。

## 2. 验证能安装（可选但建议）

在 DSH 里试装你的仓库版本：

```bash
dsh plugin --profile desktop add "github:OWNER/dsh-dian-du"
```

装完完全退出 DSH 再打开，确认右侧栏「点读」能出现、能提问。
**功能没跑通之前先别提交市场**——描述与代码不符会被打回。

## 3. 提交到插件市场

市场的插件列表来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，不是 dshmarket 仓库本身。

**一个 PR 只加一个文件**：`data/plugins/<你的用户名>__dsh-dian-du.yml`

内容（本目录的 `market-entry.yml`，把 `OWNER` 换成你的 GitHub 用户名）：

```yaml
url: https://github.com/OWNER/dsh-dian-du
name: OWNER/dsh-dian-du
category: ui
description:
  en: 'Marks paragraphs or a single code line in an answer and asks the model about it in a docked right-hand column, leaving the conversation itself unmodified.'
  zh: '点选回答中的段落或某一行代码，在右侧独立栏里向模型提问；左侧对话内容不被修改。'
```

网页操作流程：

1. Fork [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
2. 在你的 fork 里进入 `data/plugins/` → **Add file → Create new file**
3. 文件名：`你的用户名__dsh-dian-du.yml`，粘贴上面的内容
4. Commit → 回到上游仓库点 **Compare & pull request** → 提交 PR
5. 等 CI（manifest / 仓库年龄 / 格式）通过，维护者读代码后合并，网站和 dshmarket 次日自动收录

## 4. 可选：发 npm

需要本机装 Node.js（DSH 自带运行时没有 npm）：

1. `npm login`
2. 在插件目录执行 `npm publish --access public`
3. 发布后到 npm 包设置里确认 `repository` 指向同一个 GitHub 仓库（否则市场不会把两者关联）

## 5. 可选：截图

在市场卡片里展示截图：在仓库根目录放 `screenshots.json`，列出 1-8 张图（相对路径，且不能跳出插件目录）：

```json
["assets/screenshot-1.png", "assets/screenshot-2.png"]
```

## 6. 可选：自建索引源

DSH 0.2.1 起支持在「设置 → 插件 → 发现 → 索引源」里添加任意 format 1 索引（一个 JSON）。适合内测分发，不进精选列表也能装。索引格式见 `@deepseek-ai/dsh-plugin-market-index` 的 format 1。
