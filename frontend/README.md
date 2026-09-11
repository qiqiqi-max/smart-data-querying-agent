<!--
  前端项目说明文档
  记录启动方式、代理配置和部署时的环境变量
-->

# Smart Data Querying Agent Frontend

`Smart Data Querying Agent` 的电商智能问数工作台，技术栈为 React + Vite + Tailwind CSS + pnpm。

当前前端包含：

- 三栏工作台布局
- SSE 流式执行状态
- MySQL 查询历史展示
- 历史结果恢复
- 结果表格和轻量柱状图

## 启动

```bash
cd frontend
pnpm install
pnpm dev
```

默认开发代理会把 `/api` 转发到 `http://127.0.0.1:8001`，对应后端的 `POST /api/query` SSE 接口。

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
