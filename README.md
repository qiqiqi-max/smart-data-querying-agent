<div align="center">
  <h1 style="margin-top: 15px;">Smart Data Querying Agent</h1>
  <h3>电商智能问数系统</h3>
  <p><em>面向电商数仓的自然语言数据查询工作台，串联元数据检索、SQL 生成与校验、MySQL 查询和结果展示。</em></p>
</div>

<div align="center">

![Python](https://img.shields.io/badge/Python-3.14-3776AB.svg?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-005571.svg?logo=fastapi&logoColor=white)
![LangGraph](https://img.shields.io/badge/LangGraph-Agentic%20Workflow-1C3C3C.svg)
![React](https://img.shields.io/badge/React-61DAFB.svg?logo=react&logoColor=000)
![MySQL](https://img.shields.io/badge/MySQL-4479A1.svg?logo=mysql&logoColor=white)
![Qdrant](https://img.shields.io/badge/Qdrant-FF6F61.svg)
![Elasticsearch](https://img.shields.io/badge/Elasticsearch-005571.svg?logo=elasticsearch&logoColor=white)

</div>

![两栏电商问数工作台，左侧历史记录，右侧业务分析场景和输入区](docs/images/smart-data-querying-agent-home.png)

![查询结果页，展示折叠执行轨迹、图表、数据报表和 SQL 标签页](docs/images/smart-data-querying-agent-query-result.png)

![Smart Data Querying Agent 系统架构](docs/images/smart-data-querying-agent-system-architecture.svg)

## 项目简介

这个项目面向电商数据分析场景，解决业务人员查询数据时需要依赖 SQL 和数据开发的问题。用户输入自然语言问题，系统根据元数据和字段取值生成查询上下文，再生成经过安全校验的 SQL，从 MySQL 数仓返回结果。

现在这版已经把召回、生成、校验、执行和展示串成了一条完整链路:

- 用户输入自然语言问题
- 系统召回相关字段、指标和字段取值
- LangGraph 组织多阶段问数流程
- 生成 SQL、校验 SQL、执行 SQL
- 结果通过 SSE 流式返回到前端

前端采用两栏 BI 工作台:

- 左侧是新建分析、最近查询历史和历史同步状态
- 右侧是业务样例、对话、折叠执行轨迹和查询结果
- 结果支持图表、表格和 SQL 切换，以及复制和 CSV 导出

## 现在的前端

前端界面围绕一次查询所需的信息组织布局:

1. 左侧提供新建会话、历史记录及同步结果，支持恢复和删除查询。
2. 右侧展示对话、可折叠执行进度、SQL 和查询结果；可以中途停止查询。
3. 空状态提供业务样例，点击只填入输入框，发送前可修改。
4. 结果自动识别数值和时间维度，支持指标卡、柱状图、折线图与指标切换。
5. 支持复制结果、复制 SQL 和带 UTF-8 BOM 的 CSV 导出；截断结果会明确提示。

宽度小于 1024px 时，历史侧栏改为抽屉，可通过顶部菜单打开，支持 Escape 关闭和键盘焦点管理。

## 核心能力

- 问数前检查：核对真实表字段，数据不足时说明缺少的信息；问题含糊或指标口径未明确时先追问，并支持原会话补充和历史恢复。详见 [信息检查与追问](docs/query-answerability.md)。

- 后台管理: 独立 `/#/admin` 管理台，支持数据源/模型配置与测试、表字段和指标维护、知识库构建、查询筛选与操作审计。详见 [后台管理台](docs/admin-console.md)。

- 混合检索: 默认本地模式使用嵌入式 `Qdrant` 完成字段和指标语义召回，并使用本地持久化字段值索引；外部模式可切换到 `Elasticsearch`。
- 本地检索缓存: 跨请求复用字段值索引和分词结果，文件变化或索引重建时失效；最多一秒重新读取一次内容，覆盖保留时间戳的外部改写。
- 流程编排: `LangGraph` 负责把召回、过滤、生成、校验和执行串起来。
- 实时返回: 后端通过 `SSE` 推送节点进度、结果和错误信息。
- 结果展示: 支持结果表格、柱状图、折线图、单值指标卡、SQL 查看与 CSV 导出。
- 历史追踪: 问题、结果及 SQL 持久化到 MySQL；列表只加载摘要，打开时再读取详情，浏览器缓存也只保留摘要。
- 历史管理: 支持打开历史结果和删除单条查询记录，运行中的任务不会被误删。
- 数据落地: 元数据库和教学数仓都接到本地 MySQL，Navicat 里可以直接看 `meta` 和 `dw` 两个库。
- 运行模式: 默认配置为完整 API 模式；只有显式设置 `SMART_DATA_QUERYING_AGENT_DEMO_MODE=true` 时才启用本地演示链路。
- 安全边界: SQL 经过 `sqlglot` AST 解析和 MySQL `EXPLAIN` 双重校验，只允许单条只读 `SELECT`。
- 纠错闭环: SQL 校验失败后最多自动修正 2 次，每次修正都会重新经过 AST 和 `EXPLAIN` 校验，超过上限则明确失败。
- 稳定性: 查询设置服务端超时，启动时检查外部依赖，并清理遗留的运行中历史记录。
- 可复现召回: 关键词和扩展词采用保序去重，避免集合遍历造成召回顺序不稳定。

## 技术栈

| 模块 | 技术 | 作用 |
| --- | --- | --- |
| 智能体编排 | `LangGraph` | 组织多阶段问数流程 |
| 后端接口 | `FastAPI` | 提供问数 API 和生命周期管理 |
| 流式协议 | `SSE` | 推送执行进度和结果 |
| 元数据存储 | `MySQL` / `SQLAlchemy` | 保存表、字段、指标等结构化信息 |
| 查询历史 | `MySQL` | 保存问题、状态、摘要、结果和错误信息 |
| SQL 安全 | `sqlglot` + `EXPLAIN` | 限制只读查询并在执行前校验 |
| 向量检索 | `Qdrant` | 本地模式使用嵌入式存储，外部模式连接 Qdrant 服务 |
| 字段值检索 | 本地索引 / `Elasticsearch` | 本地模式无需额外服务，外部模式支持 Elasticsearch |
| 本地 Embedding | `PyTorch` / `Transformers` | 加载 BGE 模型生成 1024 维向量 |
| 前端 | `React` / `Vite` / `Tailwind CSS` | 提供两栏工作台、移动端抽屉和结果展示 |
| 依赖管理 | `uv` / `pnpm` | 管理后端和前端依赖 |

## 项目结构

```text
smart-data-querying-agent/
├── app/                  # 后端业务代码、智能体、接口、服务和仓储
├── conf/                 # app_config.yaml、meta_config.yaml
├── docs/                 # 项目截图和架构图
├── frontend/             # React + Vite + Tailwind CSS 前端
├── prompts/              # SQL 生成、修正和过滤模板
├── sql/                  # meta 和 dw 数据库初始化脚本
├── models/               # 本地 BGE 模型目录（不提交到仓库）
├── main.py               # FastAPI 应用入口
└── pyproject.toml        # Python 依赖和工具配置
```

## 本地运行

项目默认使用完整 API 模式和本地原生模式，所有组件都直接运行在本机，不依赖容器环境。真实数据来自本地 MySQL，字段和指标向量写入本地嵌入式 Qdrant，字段取值写入本地索引文件，Embedding 直接加载本地 BGE 模型，大模型使用兼容 OpenAI 的 API。`SMART_DATA_QUERYING_AGENT_DEMO_MODE` 默认保持关闭；只有显式设置为 `true` 才会进入演示链路。

### API 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/query` | 提交自然语言问题，返回 SSE 流 |
| `GET` | `/api/query/history` | 获取最近查询摘要，不包含 `result` 和 `sql` |
| `GET` | `/api/query/history/{history_id}` | 按需获取结果和 SQL；记录不存在时返回 404 |
| `DELETE` | `/api/query/history/{history_id}` | 删除单条查询历史 |

完整模式下，外部服务或本地索引缺失会返回明确错误，不会静默生成演示结果。

### 1. 准备环境

- Python `>= 3.14`
- `uv`
- Node.js
- `pnpm`
- 本地 BGE 模型文件（默认路径为 `models/bge-large-zh-v1.5`）

### 2. 克隆项目

```bash
git clone https://github.com/qiqiqi-max/smart-data-querying-agent.git
cd smart-data-querying-agent
```

### 3. 安装后端依赖

```bash
uv sync
```

### 4. 准备本地数据库

先把 [sql/meta.sql](sql/meta.sql) 和 [sql/dw.sql](sql/dw.sql) 导入本地 MySQL。脚本会创建 `meta`、`dw` 两个库和项目专属账号 `smart-data-querying-agent` / `123456`，需要使用有建库和授权权限的账号执行：

```bash
mysql -u root -p < sql/meta.sql
mysql -u root -p < sql/dw.sql
```

也可以在 Navicat 中连接本机 MySQL 后依次运行这两个 SQL 文件。

复制 `.env.example` 为 `.env`，确认以下配置保持为本地完整模式：

```env
SMART_DATA_QUERYING_AGENT_DEMO_MODE=false
SMART_DATA_QUERYING_AGENT_LOCAL_MODE=true
EMBEDDING_MODEL_PATH=models/bge-large-zh-v1.5
```

项目仓库不会提交体积较大的模型文件。可以从 [BAAI/bge-large-zh-v1.5](https://huggingface.co/BAAI/bge-large-zh-v1.5) 下载后放到 `EMBEDDING_MODEL_PATH` 指定的目录。

### 5. 构建本地知识库

```bash
uv run python -m app.scripts.build_meta_knowledge -c conf/meta_config.yaml
```

这一步会从 `dw` 读取真实表结构和字段值，将结构化元数据写入 `meta`，并生成 `.local-data/qdrant` 和 `.local-data/value_index.json`。构建脚本可以重复执行。

### 6. 启动后端

```bash
uv run fastapi dev main.py --port 8001
```

### 7. 启动前端

```bash
cd frontend
pnpm install
pnpm dev
```

默认前端通过 `/api` 代理到 `http://127.0.0.1:8001`。需要手动改地址时，调整 `frontend/.env` 里的 `VITE_DEV_PROXY_TARGET` 或 `VITE_API_BASE_URL`。完整模式下不提供公网认证能力，建议仅在本地或受保护网络中运行。

如果需要连接独立的 Qdrant、Elasticsearch 和 Embedding 服务，将 `SMART_DATA_QUERYING_AGENT_LOCAL_MODE` 设置为 `false`，并按 `conf/app_config.yaml` 配置对应地址。

## 数据库说明

当前配置使用本地 MySQL。

- 元数据库: `meta`
- 教学数仓: `dw`
- 查询历史表: `meta.query_history`
- 账号: `smart-data-querying-agent`
- 密码: `123456`

Navicat 里直接连本机 `3306` 就能看到这两个库。

## 项目现状

当前版本已经打通本地 MySQL、元数据构建、本地向量检索、字段值检索、问数链路、SQL 历史留存，以及前端两栏工作台、图表、结果表格和 CSV 导出。完整模式依赖缺失时会在启动阶段明确报错，不会自动降级到演示链路。

现已提供本机后台管理台，从侧栏进入“后台管理”即可使用。数据源和模型配置保存后需要重启后端，元数据保存后需要构建知识库才会应用到问数。默认单个后端进程运行。

验证命令：`uv run pytest -q`、`uv run ruff check .`、`uv run ruff format --check .`；前端在 `frontend` 目录执行 `pnpm lint` 和 `pnpm build`。本轮验收范围及结果见 [优化收尾实施记录](docs/superpowers/plans/2026-11-02-optimization-followup.md)。项目适合本地演示和二次开发；登录鉴权与数据库权限收紧暂未纳入本轮。
