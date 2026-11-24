# 优化收尾实施记录

> 执行方式：使用 executing-plans，当前会话逐条实施并验证。

**Goal:** 修复新版 UI 的可见回归，完成可复现验收，并降低字段值检索和历史列表的重复开销。

**Architecture:** 沿用 React、FastAPI、SQLAlchemy 和本地文件索引。状态只描述已验证的接口行为；列表只传摘要，打开时单独获取详情；文件缓存按路径及文件版本失效。

**Tech Stack:** React 19 / TypeScript / Tailwind 3 / Python 3.14 / FastAPI / SQLAlchemy 2。

**Spec:** 本会话核查的四项收尾清单，用户已要求“逐条进行”。

## 约束与执行决定

- 保持现有 BI 视觉方向；不新增运行时依赖，不改数据库权限。
- 鉴权和权限调整沿用此前本地使用、暂缓的决定。
- 在用户当前项目中连续实施；不推送、不操作其他项目服务或用户历史记录。
- 页面小范围样式和文案修复以构建及浏览器检查验证；缓存和 API 行为先写失败测试。
- 验收产生的数据单独标记并清理，记录真实服务与受控场景各自的覆盖范围。

## Review Focus

- 负数及零值柱条可读，旧主题类不再造成透明柱条。
- 接口失败时不能显示已连接，也不能假称结果已加载。
- 缓存跨请求复用；普通外部改写及重建按文件版本失效，保留时间戳的原地改写最多一秒后重新读取；坏文件明确报错。
- 历史摘要 SQL 不读取 result/sql 大字段；详情 404、点击竞态和失败可恢复。
- 手机抽屉关闭时不能获得焦点；窄屏页面和结果表不能撑宽视口。

## Task 1：修复图表配色

Files: `frontend/src/components/ResultChart.tsx`。

- [x] 替换已删除的 moss/tomato 配色及焦点样式，零值不显示伪造长度。
- [x] 前端构建；浏览器检查正数、负数与零值的颜色及长度。

## Task 2：真实状态与基础交互

Files: `frontend/src/App.tsx`, `components/Sidebar.tsx`, `components/ResultPanel.tsx`, `components/EmptyState.tsx`, `components/MessageBubble.tsx`。

- [x] 删除硬编码连接、模型、数据库名和聚合类型。
- [x] 历史服务状态来自请求结果；复制成功状态来自剪贴板调用结果。
- [x] 关闭抽屉不可聚焦；适配窄屏布局。
- [x] 构建并通过浏览器检查初始、失败、成功和窄屏状态。

## Task 3：验收及文档

Files: `README.md`, `frontend/README.md`, `docs/images/*`。

- [x] 确认服务进程路径和端口，启动本项目服务。
- [x] 验证查询、图表、SQL、CSV、停止、历史打开；记录桌面与手机截图。
- [x] 将文档更新为两栏 BI 工作台，纠正代理配置与端口说明。

## Task 4：本地值索引缓存

Files: `app/repositories/es/value_es_repository.py`, `tests/test_local_value_repository.py`。

- [x] 先写测试：重复检索只读取一次、跨实例复用、重建和外部改写失效、损坏文件明确报错、并发读取结果一致。
- [x] 实现有容量上限的进程缓存、文件版本检测、线程锁及预分词复用。
- [x] 跑仓储测试，记录冷读与重复检索的读取/分词次数。

## Task 5：历史结果按需加载

Files: history entity/schema/repository/router；前端 `agentApi.ts`, `agent.ts`, `App.tsx`, `Sidebar.tsx`；`tests/test_query_history_api.py`。

- [x] 先写测试：列表不返回 result/sql、数据库不选大字段、详情完整、缺失 404、limit 校验。
- [x] 列表保持 `/api/query/history`，增加 `GET /api/query/history/{history_id}` 详情。
- [x] 前端摘要只存轻量字段；点击加载详情，处理加载、失败及过期响应。
- [x] 全量测试、静态检查、构建、浏览器回归，再做独立代码审查。

## 验证记录

- 基线：84 tests passed；Ruff check/format 通过；pnpm build 通过。
- 根因：构建 CSS 没有 `bg-moss/75` 与 `bg-tomato/60`；状态与元信息为硬编码。
- 缓存回归：新增场景最初 3 项失败，修复后通过；4 次短间隔跨实例检索由 4 次文件读取降为 1 次，8 次并发检索由 8 次读取降为 1 次，重复关键词分词复用。
- 历史接口回归：新增 7 项测试，最初 5 项失败，修复后全部通过。通过真实 SQLite 执行 SQL 验证列表不选择 `result`/`sql` 列。
- 真实服务：本项目 `127.0.0.1:5174` → `127.0.0.1:8774`，完整模式，本地 MySQL、Qdrant 与 Embedding；品类查询 6 行、月度趋势 3 行、华东销售总额 1 行，结果和 SQL 均持久化。
- 真实取消：SSE 客户端断开后历史为 `stopped`；页面 ABORT 按钮可停止并展示已停止的执行轨迹。
- 浏览器：Edge，验证图表配色和零值、指标选择、折线/柱状切换、表格、SQL、CSV BOM、复制拒绝不假报成功、历史故障/恢复、详情按需请求/404/重试/快速切换。检查 360、390、768、1024、1440px 视口；390px 检查抽屉焦点及查询中/停止后布局。
- 独立审查：发现两项 Important，均已复现并修复，无 Critical。删除 A 与加载 B 的竞态通过浏览器先失败后通过；Windows 保留 mtime 的同尺寸原地改写通过新增测试先失败后通过。
- Ruling：采用最多一秒的内容复核而非平台专用文件监控；普通文件变更和仓储内重建立即失效，特殊时间戳保留写入可能有不足一秒的旧快照。
- 截图：README 使用本轮桌面首页和真实查询结果 PNG；详细过程保存在忽略提交的 `output/playwright/`。

- 最终检查：98 tests passed（78 条上游弃用警告）；Ruff check 与 format check 通过，80 个 Python 文件格式一致；pnpm lint/build 通过；git diff --check 通过。
- 清理：仅删除本轮生成的 5 条验收历史，原有 17 条记录完整保留。代码和文档保留在当前工作区，未推送。
