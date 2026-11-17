# Changelog

## 0.2.0 — 2026-11-17

- 划词工具栏：在回答里拖选任意文字，上方浮出「在侧边提问 / 复制 / ×」，形态对齐 Codex 的划词交互
- 「在侧边提问」把选中的片段直接送进右侧「点读」面板并聚焦输入框
- 工具栏随滚动、失焦、按 Esc 自动收起；原有点整段 / 点代码行的手势保留
- 修复面板输入框无法被自动聚焦（新增 `id="dd-input"`）

## 0.1.0 — 2026-10-24

- 首个可安装版本
- 点选段落 / 标题 / 列表 / 引用，代码块按行点选
- 右侧栏「点读」面板：选中后自动展开，左栏被挤窄不遮挡
- 右栏底部提问，回车发送；解释显示在右栏
- `Ctrl` 轻按或 `Ctrl+点击` 清空选中
- Host 端 `/dian-du` 命令，`ctx.llm.stream` 调模型，解释在独立会话中完成
- 兜底：右侧栏不可用、或面板 1.2 秒内没挂载时，自动退回浮动面板

### 验证记录

- `node test/host.test.mjs`：命令注册、JSON 解析、流式文本拼接、默认问题、空输入、异常转错误 — 通过
- `node test/client.test.mjs`：模块 id、右侧栏类型注册、tab body/overlay 注册、点击选中/取消、`Ctrl+点击` 与单独 `Ctrl` 清空 — 通过
- `test/e2e-load.mjs`：在隔离的 DSH web 实例里用无头 Chrome 加载真实页面 —
  样式注入成功，控制台输出 `sidebar available: true`、`remote ready`，无异常
- 未验证：真实凭据下的模型往返（`session.create` → `commands.execute` → `ctx.llm.stream`）
