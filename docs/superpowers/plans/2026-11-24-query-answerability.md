# Query Answerability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在 SQL 生成前检查数据与口径，在缺少信息时明确说明，在含糊时沿原问题追问。

**Architecture:** 完整元数据目录与实际 dw 字段交叉核对，结构化模型评估后由程序验证引用与指标依据。LangGraph 增加评估与业务终态；SSE、历史和 React 保留正常查询能力并支持有后端历史依据的续问。

**Tech Stack:** Existing Python 3.14, FastAPI, LangGraph, Pydantic, SQLAlchemy, sqlglot, React/TypeScript/Vite; no new runtime dependency.

**Spec:** ../specs/2026-11-24-query-answerability-design.md

## Global Constraints

- 保留现有未提交的后台管理与界面代码；在隔离副本验证后仅同步本次文件差异。
- 缺少信息、待追问和无符合条件的记录分别处理；前两种不进入 SQL 链路。
- 指标采用一致的已配置定义或用户明确给出口径；禁止业务常识回退。
- POST /api/query 的 query 字段及当前长度限制保持，可选 parent_history_id。
- 后端读取追问历史；最多 5 轮补充，每轮至多 500 字；客户端不能提交审批过的计划。
- 历史状态 clarify、unsupported 使用现有 String(16)，新增可空 JSON response 字段，旧历史可读。
- 保留只读 AST/EXPLAIN、最多 2 次修正、1000 行、SQL 30 秒/链路 120 秒和取消处理。
- 客户界面复用现有卡片与输入框，不创建假结果表格。

## Review Focus

- 目录中已存在但向量未命中的必要字段必须补回，不能误报信息缺失（Task 2）。
- 模型返回 ready 但指标依赖/字段未知或用户显式口径证据不成立，必须阻断（Task 1/2）。
- 系统追问里的文字不能冒充用户确认的公式，证据只来自用户输入（Task 1/3）。
- 新建分析、切换历史或请求失败后，不能把下一条问题串到旧追问（Task 4）。
- 老记录 response=NULL、零行查询和取消时的历史状态保持兼容（Task 3/5）。

## Task 1: Catalog and assessed-query contract

**Files:** Create app/agent/query_assessment.py, app/agent/nodes/assess_query.py, prompts/assess_query.prompt; modify MetaMySQLRepository and DWMySQLRepository; create tests/test_query_assessment.py.

**Interfaces:** MetaMySQLRepository.get_query_catalog() -> dict with tables (full columns) and metrics (id/name/description/relevant_columns/alias); DWMySQLRepository.get_schema_columns() -> dict[str, dict[str,str]]. QueryAssessment strict Pydantic model: status ready/clarify/unsupported, reason, message, questions, missing_information, resolved_query, required_tables, required_columns, metrics. MetricUse carries name/source configured or user_explicit/metric_id/definition/evidence/required_columns. validate_assessment(assessment, catalog, user_statements) -> QueryAssessment; blocked decisions retain customer-facing content. assess_query(state, runtime) -> state assessment/query/required context, writes progress and assessment terminal event for blocked status.

- [x] Write tests for missing evaluation data, vague sales question, undefined ratio, AOV inconsistency, explicit formula, invalid ready references and invalid JSON. Tests assert a blocked assessment has concrete missing items/questions; invalid references cannot pass; user_explicit evidence cannot come from a system question.
- [x] Run `.venv/Scripts/python.exe -m pytest tests/test_query_assessment.py -q` and observe missing-feature failures.
- [x] Implement catalog reads, verified physical columns, strict response validation and assessment prompt. Existing catalog metric definitions replace model-provided reinterpretations; unresolved/inconsistent metrics require confirmation. Only actual user statements are accepted as explicit evidence.
- [x] Run the tests; expected all pass. Commit this independently tested component.

## Task 2: Graph routing and SQL context enforcement

**Files:** Modify app/agent/graph.py, state.py, merge_retrieved_info.py, filter_table.py, filter_metric.py, generate_sql.py, validate_sql.py, correct_sql.py; prompts/generate_sql.prompt and correct_sql.prompt; tests/test_graph_integration.py and tests/test_query_safety.py.

**Interfaces:** New START -> assess_query; route on assessment.status to extract_keywords or END. Ready state carries validated required columns and canonical metric context. check_sql_context(sql, tables) in query_assessment.py validates SQL identifiers against supplied context with sqlglot before repository EXPLAIN. Legacy repository validate(sql)/run(sql) signatures remain unchanged.

- [x] Add graph tests asserting no recall/generate/validate/run calls after clarify/unsupported; add retrieval-miss recovery and wrong-column SQL tests.
- [x] Run focused tests and observe failures.
- [x] Wire assessment, preserve mandatory columns/metric dependencies across merge and filter, constrain SQL and correction prompts, remove common-sense metric fallback. Do not introduce fallback for evaluator errors.
- [x] Run focused graph/safety/assessment tests; expect all pass and ordinary happy path and 2-correction path preserved. Commit.

## Task 3: History, SSE and trusted follow-up

**Files:** Modify QueryService, query_router.py, query_schema.py, query_history ORM/entity/API/repository, sql/meta.sql and admin_router.py; tests/test_query_service.py, test_query_history_api.py, test_query_history_migration.py and new tests/test_query_clarification.py.

**Interfaces:** QueryHistory.response: dict|None=None. Repository.mark_response(history_id,response). QueryService.prepare_clarification(parent_history_id, answer) -> dict, validating a prior clarify record and <=5 turns; QueryService.query(query, clarification_context=None). QuerySchema.parent_history_id optional UUID string. SSE assessment terminal contains status/reason/message/questions/missing_information/history_id; persisted response also holds original_query/answered turns. Existing result/error handling unchanged.

- [x] Add failing tests for assessment persistence without mark_error, old migration/records, valid multi-turn continuation, absent/non-clarify parent and overlong chain, and original user evidence preserved separately from system questions.
- [x] Run focused tests and observe failures.
- [x] Implement nullable migration and history serialization; resolve parent before streaming; include answered context in historical question and graph state. Assessment counts as terminal response. Return clear HTTP errors for invalid parents; existing query-only requests remain supported.
- [x] Run service/history/API/clarification tests; expect all pass. Commit.

## Task 4: Customer follow-up and history restoration

**Files:** Modify frontend/src/types/agent.ts, lib/agentApi.ts, App.tsx, MessageBubble.tsx, Composer.tsx, Sidebar.tsx, StepRail.tsx, admin/QueriesPage.tsx and admin/shared.tsx. Add a focused browser smoke script in the ignored plan workspace.

**Interfaces:** AssessmentEvent new AgentEvent member; QueryResponse and RunStatus clarify/unsupported. streamQuery options.parentHistoryId. App stores pending parent from authoritative assessment history_id, clears it on new analysis/history switch, restores it on opening clarify details. MessageBubble displays message/questions/missing information without ResultPanel for assessment.

- [x] Write and run browser checks against mocked SSE/history for clarification -> answer request parent linkage, new analysis clearing linkage, unsupported rendering and historical clarification restoration. Observe the current frontend fail those checks before editing.
- [x] Implement visible business replies, continuation hint in existing composer, status labels and admin detail/filter support. Never cache full server response in browser summary storage; load details when restoring.
- [x] Run `pnpm lint` and `pnpm build`, then browser checks; expect pass. Commit.

## Task 5: Review, runtime validation and delivery

**Files:** README.md, approved spec/plan, ignored progress ledger, any fixes justified by a reproduced failure.

- [x] Run entire pytest suite, ruff check and ruff format --check, frontend lint/build. Expect all pass; investigate new failures against the preserved baseline.
- [x] Obtain one fresh whole-branch review per executing-plans; address important findings with RED -> GREEN regression tests and full suite.
- [x] Check root source baseline hashes, copy only this feature's changed/new files back, preserving unrelated user files. Update docs to explain statuses/continuation and constraints.
- [x] Restart only this project's backend when no query is active; verify startup migration and frontend proxy. Run real missing-data, ambiguity, undefined-metric, inconsistent-AOV and normal/empty-result scenarios; check replies, absence of SQL for blocked cases, persisted history and follow-up.
- [x] Report changed behavior, verification evidence, runtime URL and material semantic-model limits. Mark all task ledger entries complete with evidence; no push, PR or deletion of user data.
