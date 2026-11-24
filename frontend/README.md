<!--
  前端项目说明文档
  记录启动方式、代理配置和部署时的环境变量
-->

# Smart Data Querying Agent Frontend

`Smart Data Querying Agent` 的电商智能问数工作台，技术栈为 React + Vite + Tailwind CSS + pnpm。

当前前端包含：

- 两栏 BI 工作台，窄屏下历史栏切换为抽屉
- SSE 流式执行状态、折叠轨迹和中途停止
- MySQL 查询历史、同步状态与历史结果按需加载，支持加载失败重试
- 结果表格、指标卡、柱状图、折线图与指标选择
- 执行 SQL 查看和复制，结果复制与 CSV 导出
- 独立后台管理入口 `/#/admin`：六个管理页面，真实配置/元数据/知识库/查询管理接口，正文 14px

## 启动

```bash
cd frontend
pnpm install
pnpm dev
```

默认开发代理会把 `/api` 转发到 `http://127.0.0.1:8001`，对应后端的 `POST /api/query` SSE 接口。

历史列表 `GET /api/query/history` 只返回摘要；点击记录后使用 `GET /api/query/history/{history_id}` 获取结果与 SQL。升级时请同时更新前后端。本地存储仅保留最多 6 条摘要，后端不可用时仍可看到记录，但刷新后的完整结果需要后端详情接口。

在项目根目录用 `uv run fastapi dev main.py --port 8001` 启动后端。前端默认尝试 5173 端口，以终端实际输出为准；可用 `pnpm dev --port 5174 --strictPort` 固定端口，避免打开其他项目的页面。

如需修改后端地址：

```bash
cp .env.example .env
```

然后调整：

```bash
VITE_DEV_PROXY_TARGET=http://127.0.0.1:8001
```

如果前端与后端不在同一域部署，可设置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8001
```
