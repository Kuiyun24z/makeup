---
name: harness-memory
description: This skill should be used at the START of every conversation (to check for relevant past context) and at the END of every conversation (to save a summary). Also use when the user asks to "remember this", "recall past conversations", "what did we discuss before", "load previous context", or needs cross-session memory continuity. Based on Harness Engineering's three-layer memory architecture adapted for conversational AI.
version: 1.0.0
---

# Harness Memory — 对话记忆力机制

实现跨对话的记忆保持。核心设计理念来自 Harness Engineering 的三层记忆架构，但针对对话场景做了自适应简化：**索引层永远在上下文中，摘要层按需加载，完整日志不直接读取**。

## 三层记忆架构（对话适配版）

```
Layer 1: INDEX.md（指针索引）
  - 每次对话开始时必读
  - 目标大小: < 1KB（约 20-30 行）
  - 内容: 每条对话的一行摘要 + 日期 + 文件路径
  - 作用: 快速匹配当前话题与历史对话

Layer 2: 摘要文件（*.md）
  - 按需加载
  - 仅在 INDEX.md 中发现相关话题时才读取
  - 内容: 单次对话的结构化摘要

Layer 3: 完整对话记录（不直接读取）
  - 由框架自动保存
  - 仅在需要回溯详细对话时通过 grep 搜索
```

## 存储位置

```
~/.openharness/data/session-memory/<project-id>/
├── <hash1>.md                        # 单次对话摘要（由框架自动保存）
├── <hash2>.md                        # 单次对话摘要
├── INDEX.md                          # Layer 1: 索引文件（由本技能维护）
└── ...
```

> **注意**：`<project-id>` 为当前项目目录名 + 后缀哈希（如 `HKNU-OpenHarness-main-c61db5f1d75c`）。可通过 `~/.openharness/data/sessions/<project-id>/latest.json` 中的 `cwd` 字段匹配当前工作目录。

## 核心原则

1. **索引优先**：每次对话开始只读 INDEX.md（极低成本），不加载所有摘要。
2. **按需加载**：仅在 INDEX 中发现相关话题时，才读取对应的摘要文件。
3. **结构化摘要**：每条摘要必须包含关键词标签，方便后续匹配。
4. **去重更新**：相同主题的后续对话更新已有摘要，而不是创建新文件。
5. **token 高效**：INDEX.md 目标 < 1KB，单个摘要文件目标 < 2KB。

---

## 工作流 A：对话开始时（加载记忆）

### A1. 确定项目目录并读取索引

```bash
# 步骤 1: 查找当前项目对应的 session-memory 子目录
# 方法: 匹配 ~/.openharness/data/sessions/ 下的 latest.json 中的 cwd 字段
read_file ~/.openharness/data/session-memory/<project-id>/INDEX.md
```

如果 INDEX.md 不存在 → 扫描该目录下所有 `.md` 文件，从每个文件的 `## Current State` 和 `## Recent Conversation` 中提取摘要信息，生成 INDEX.md。

> 首次运行时，框架已自动保存了 `*.md` 会话摘要文件，只需扫描这些文件并建立索引即可。

### A2. 匹配相关话题

从 INDEX.md 中提取每条记录的摘要行，与当前对话进行关键词匹配：

```
INDEX.md 内容示例:
| 2026-05-29 | THU-HKNU对比分析 | thu-hknu-comparison.md | mission, skill, plan, eval, 架构 |
| 2026-05-28 | 翻译THU文档 | translate-thu-docs.md | 翻译, architecture, THU |
| 2026-05-27 | 修复engine超时bug | fix-engine-timeout.md | engine, timeout, bug, query |
```

**匹配策略**：
- 用户当前问题包含的关键词
- 当前任务名称/描述中的关键词
- 当前打开的文件路径中的关键词

**匹配阈值**：至少 1 个关键词命中即可视为相关。

### A3. 加载相关摘要

对于匹配到的每条记录，读取对应的摘要文件：

```bash
read_file ~/.openharness/data/session-memory/<project-id>/{filename}.md
```

**关键约束**：只加载匹配到的，不加载全部。如果目录有 50 个文件但只匹配到 2 个，只读取那 2 个。

### A4. 注入上下文

将加载的历史摘要内容总结为一句话或一个要点，在后续对话中使用。不需要逐字复述摘要，只需提取与当前任务相关的关键信息。

---

## 工作流 B：对话结束时（保存记忆）

### B1. 生成摘要

根据本次对话内容，生成结构化摘要：

```markdown
# 对话摘要: [简短标题]

**日期**: 2026-05-29
**任务**: [如果是 harness-mission 任务，填写任务名称]
**状态**: [completed / in_progress / blocked / 纯问答]

## 讨论内容
[2-3 句话概括本次对话的核心内容]

## 关键决策
- 决策1: [描述和理由]
- 决策2: [描述和理由]

## 产出文件
- [修改/创建的文件路径]: [做了什么]
- ...

## 未完成事项
- [如果有未完成的任务]
- ...

## 标签
`tag1`, `tag2`, `tag3`, `tag4`, `tag5`
```

> **标签是关键词匹配的核心**，必须认真填写，每个标签用反引号包裹、逗号分隔。

### B2. 生成文件名

格式：`YYYY-MM-DD-<简短slug>.md`

- 日期：当前日期
- slug：3-5 个英文单词，用连字符连接，概括核心话题
- 示例：`2026-05-29-thu-hknu-comparison.md`

### B3. 保存摘要文件

```bash
# 通过 write_file 创建摘要文件
write_file ~/.openharness/data/session-memory/<project-id>/YYYY-MM-DD-slug.md
```

### B4. 更新索引

读取 `~/.openharness/data/session-memory/<project-id>/INDEX.md` 的当前内容，追加一行：

```markdown
| 2026-05-29 | 简短标题 | YYYY-MM-DD-slug.md | tag1, tag2, tag3 |
```

如果 INDEX.md 不存在，先创建：

```markdown
# 对话记忆索引

| 日期 | 标题 | 文件 | 标签 |
|------|------|------|------|
| 2026-05-29 | 简短标题 | YYYY-MM-DD-slug.md | tag1, tag2 |
```

### B5. 去重

如果当前对话与已有摘要讨论的是同一任务/同一话题：
- 更新已有摘要文件（追加新进展），而不是创建新文件
- INDEX.md 中的日期更新为最新日期
- 新旧内容用 `---` 分隔

---

## 与 harness-mission 配合

当使用 `harness-mission` 进行多步骤任务时：
- 每次对话开始：`harness-memory` 先加载相关历史
- 每次对话结束：`harness-memory` 保存本次对话摘要
- 特定知识发现：更新 `.harness/knowledge/` 目录下的主题文件

---

## 常见问题

- **INDEX.md 膨胀**：超过 50 行 → 合并相同主题的行，只保留最近 30 条
- **摘要文件膨胀**：超过 3KB → 精简，只保留关键决策和未完成事项
- **忘记保存摘要**：对话结束前必须执行工作流 B
- **标签太泛**：写成 `code`, `bug`, `fix` → 应该写具体的如 `engine-query-timeout`, `harness-compare`
- **加载太多历史**：一次性读取 10+ 个摘要文件 → 只读取关键词匹配到的，通常 1-3 个

---

## token 消耗估算

| 操作 | 预估 token |
|------|-----------|
| 读取 INDEX.md（30 行） | ~200 tokens |
| 读取 1 个相关摘要（2KB） | ~600 tokens |
| 读取 3 个相关摘要 | ~1800 tokens |
| 保存摘要 + 更新 INDEX | ~500 tokens |

> 对比：如果每次加载所有历史摘要（假设 20 次对话），约 20 × 600 = 12000 tokens。采用索引匹配方案，通常只需 200 + 600 = 800 tokens，节省 93%。
