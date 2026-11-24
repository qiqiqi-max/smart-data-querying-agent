# 后台管理台实施计划与接口约定

用户要求：增加完整后台，管理真实数据源、模型、元数据、知识库和运行记录。沿用现有 React 19 / TypeScript / Tailwind / FastAPI / MySQL；正文 14px。

## 边界与架构

- 后台地址 `/#/admin`，可从问数工作台进入并返回；采用独立导航与响应式侧栏。
- 管理现有系统的 meta/dw 两个数据源，不承诺任意数据库类型或多租户。可编辑并测试 MySQL 连接，查看真实表结构。
- 不新增运行时依赖。管理 API 本机访问并验证 Host/Origin；用户可改选管理员登录。
- 模型与数据源配置写入 `.local-data/admin/settings.json`，启动时加载；页面区分生效配置与待重启配置。秘密不回显，空白表示保留；不修改用户 `.env`。
- 元数据通过结构化表单 CRUD，持久化 `conf/meta_config.yaml`，校验重名、标识符、指标引用和版本冲突；保存后待构建。
- 知识库后台任务复用进程内客户端，避免 Qdrant 文件锁冲突；全量重建，校验真实表列后才写入；构建时阻止新查询，活动查询时拒绝构建；失败后进入维护状态，成功重建解除。不能虚构百分比，按已完成阶段展示。
- 查询记录支持分页/关键词/状态筛选、详情、SQL、结果导出、删除；运行中不可删除。操作日志只记录操作与状态，不记录凭据。
- 启动清理未结束构建记录并标记中断；最多保留 50 个构建任务。后台轮询仅在页面需要时运行。

## 分工与接口

Root：settings/config startup overrides；admin router、host/origin gate、概览、查询分页、审计读取；前端入口；集成验收。

Metadata agent：`app/services/admin_knowledge.py`, `app/api/schemas/admin_knowledge_schema.py`, `app/core/maintenance.py`, tests；修改 `meta_knowledge_service.py` 支持全量替换及阶段回调。

Frontend agent：`frontend/src/admin/*`，`frontend/src/lib/adminApi.ts`，`frontend/src/types/admin.ts`；不修改 App/main/styles，由 root 集成。

### API JSON 约定

全部 `/api/admin`，错误 `{detail: string}`，变更需 `Content-Type: application/json`（无请求体 POST 也发送 `{}`）。

- `GET /overview` → `{mode:'local', demo_mode:boolean, maintenance:{building:boolean,blocked:boolean,active_queries:number}, counts:{tables:number,columns:number,metrics:number,queries:number}, query_status:Record<string,number>, services:Array<{name:string,status:'ready'|'error'|'unconfigured',message:string}>, knowledge:{revision:string,built_revision:string|null,dirty:boolean}, restart_required:boolean}`
- `GET /settings` → `{revision:string,restart_required:boolean,effective:Settings,saved:Settings}`。Settings=`{db_meta:DatabaseSettings,db_dw:DatabaseSettings,llm:ModelSettings}`；DatabaseSettings=`{host,port,user,database,password_set:boolean}`；ModelSettings=`{model_name,base_url,api_key_set:boolean}`。
- `PUT /settings` body `{revision,db_meta:{host,port,user,database,password?:string},db_dw:{...},llm:{model_name,base_url,api_key?:string}}` → GET settings shape。空密码保留当前值。
- `POST /test-database/{meta|dw}` body `{host,port,user,database,password?:string}` → `{ok:boolean,message:string,latency_ms:number}`。
- `POST /test-model` body `{model_name,base_url,api_key?:string}` → `{ok:boolean,message:string,latency_ms:number}`。
- `GET /schema` → `{tables:Array<{name:string,columns:Array<{name:string,type:string,nullable:boolean,primary_key:boolean,comment:string}>}>}`。使用当前运行 dw。
- `GET /metadata` → `{revision:string,built_revision:string|null,dirty:boolean,tables:Table[],metrics:Metric[]}`
- `PUT /metadata` body `{revision:string,tables:Table[],metrics:Metric[]}` → metadata shape。
- Table=`{name:string,role:'fact'|'dim',description:string,columns:Column[]}`；Column=`{name,role:'primary_key'|'foreign_key'|'measure'|'dimension',description,alias:string[],sync:boolean}`；Metric=`{name,description,relevant_columns:string[],alias:string[]}`。
- `GET /builds` → `{items:Build[]}`；`POST /builds` body `{}` → Build（202）。Build=`{id,status:'queued'|'running'|'done'|'error'|'interrupted',stage:string,completed_stages:number,total_stages:number,created_at,updated_at,error:string|null,revision:string}`。
- `GET /queries?page=1&page_size=20&q=&status=` → `{items:QueryHistorySummary[],total:number,page:number,page_size:number}`
- `GET /queries/{id}` → 现有 QueryHistoryItem；`DELETE /queries/{id}` → 204；调用返回详情供复制/导出。
- `GET /audit?limit=50` → `{items:Array<{id,at,action,status,message}>}`，所有字段为字符串。

### Knowledge agent Python 接口

- `class AdminKnowledgeService(config_path: Path, state_dir: Path)`：`read_metadata()->dict`; `save_metadata(payload: MetadataUpdate)->dict`; `list_builds()->dict`; `async start_build()->dict`; `async close()->None`; `recover()->None`。文件 I/O 内部有锁及原子写入，异常 HTTPException 可直接抛出。
- `MetadataUpdate` 位于 `app/api/schemas/admin_knowledge_schema.py`，结构见上。
- `maintenance` singleton from `app/core/maintenance.py`：`query()` async context manager（计数和维护检查）；`start_build()` 同步原子地检查 active_queries/building 并设 building/blocked；`finish_build(success:bool)`；`snapshot()->dict`。冲突抛 HTTPException(409)。Root 在 query router 的流式 generator 里使用 `async with maintenance.query()`，并在 handler 预检查 blocked 返回 409。
- Root 负责将 service 全局实例 `.recover()` 接 lifespan，shutdown await `.close()`；start_build 的工作必须 await/追踪任务并捕捉异常。

## 验收

- [x] 配置读取无秘密、保存/重启语义、输入校验、原子写、并发版本冲突、连接失败超时及脱敏。
- [x] 元数据 CRUD、重复/引用/标识符校验、保存/构建状态、真实表列预检、失败维护锁与成功恢复、任务历史。
- [x] 概览真实统计、分页过滤、详情/删除、审计；后台 Host/Origin 请求边界。
- [x] 全部页面实际接口；表单错误、空状态、加载、确认、保存反馈、未保存切页提示；手机抽屉。
- [x] 单元/集成测试、类型检查、构建、独立审查、真实后端和浏览器验收。
- [x] README 与管理台文档、截图、所有生成的测试记录清理；不改真实凭据、不清空用户历史、不推送。


## 执行记录

- 访问方式：沿用此前已明确的本机使用，不加账号系统；管理员登录问题未收到新选择。Vite 默认 loopback + 转发真实来源；管理 API 检查客户端、Host、Origin，外部来源拒绝。
- 完成：六个真实页面、独立懒加载入口、设置保存/测试/待重启、元数据结构化编辑与真实表列导入、知识库后台任务/阶段/维护状态、分页查询与审计。
- 配置覆盖在原 YAML 解析后作为字面值应用，避免把管理员输入当作 OmegaConf 表达式。凭据不回显，变更目标服务须重新输入凭据。
- 审查修复：Vite 来源透传、配置插值、响应前原子预约查询、重读期间禁用编辑、ES 全部 bulk 后统一刷新。新增回归测试覆盖相关行为。
- 最终 Python：138 tests passed，78 条 LangChain 弃用警告；Ruff check/format 通过，99 个 Python 文件。
- 前端：pnpm lint/build 通过；新增后台独立 chunk，正文 14px。
- 真实服务：5 表、24 字段、2 指标、17 条查询；MySQL 连接与模型调用测试成功；7 组管理读取接口均 200。
- Edge：六页导航，真实数仓结构/历史/详情/审计、草稿新增与取消、未保存离开保护、390/768/900/1440px 导航与布局、刷新期间锁定表单。受控响应验证设置保存/待重启、元数据 409 保留草稿、任务启动/轮询/完成。
- 隔离构建：真实 MySQL 数仓 + 真实 BGE，输出到临时 SQLite/内存 Qdrant/临时取值文件；六阶段通过，生成 5 表/24 字段/2 指标并召回 6 个字段结果。没有覆盖当前使用的知识库。
- 数据保留：未写真实连接凭据或元数据配置，17 条原查询保持不变；只留下真实连接测试的操作审计。代码未提交或推送。
- 使用文档：docs/admin-console.md；入口 http://127.0.0.1:5174/#/admin。
