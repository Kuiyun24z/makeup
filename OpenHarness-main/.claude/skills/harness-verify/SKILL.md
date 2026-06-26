---
name: harness-verify
description: This skill should be used when the user asks to "verify the output", "run evaluation", "check if the task is complete", "validate results", "run the eval loop", or when a harness-mission step has been completed and needs external validation before marking it as done. Also used for circuit breaker checks and failure analysis.
version: 1.0.0
---

# Harness Verify — 外部验证循环

对任务输出进行独立的外部验证。核心原则来自 Harness Engineering：**验证必须被外部化，作为一个独立的反馈循环**——不能让执行者自己判定自己的工作是否完成。

## 核心原则

1. **外部化**：验证逻辑必须独立于执行逻辑，在单独的文件或检查步骤中定义。
2. **可机器执行**：所有验证标准必须能被 `bash`/`grep`/`read_file` 自动检查，不依赖人类主观判断。
3. **通过才继续**：只有验证 PASS 的步骤才能标记为 `completed`。
4. **连续失败熔断**：同一任务连续验证失败 3 次后，自动阻塞，防止无限重试消耗 token。
5. **分级验证**：区分"自动检查"（必须全部 PASS）和"内容质量检查"（AI 辅助判断）。

## 验证分级

### Level 1：自动检查（MUST PASS）

完全由脚本自动检查，不需要 AI 判断：

| 检查项 | 方法 | 示例 |
|--------|------|------|
| 文件存在 | `bash: test -f .harness/output/X` | 输出文件必须存在 |
| 文件非空 | `bash: test -s .harness/output/X` | 输出文件不能是空文件 |
| 包含关键词 | `grep "pattern" .harness/output/X` | 输出必须包含特定内容 |
| 文件数量 | `bash: ls .harness/output/*.json | wc -l` | 必须有 N 个输出文件 |
| 格式合法 | `python -c "import json; json.load(open('X'))"` | JSON/CSV 格式必须合法 |
| 大小合理 | `bash: stat -c%s .harness/output/X` | 文件大小 > 阈值 |

### Level 2：内容质量检查（AI 辅助判断）

需要 AI 进行语义理解：

| 检查项 | 方法 | 标准 |
|--------|------|------|
| 内容相关性 | `read_file` 后判断 | 输出内容与 mission 目标匹配 |
| 完整性 | `read_file` 后判断 | 没有明显遗漏 |
| 一致性 | `read_file` 多个文件后对比 | 多个输出之间没有矛盾 |
| 代码正确性 | 查看代码逻辑 | 代码逻辑正确，无明显 bug |

## 工作流

### 第一步：读取验证标准

```bash
# 读取验证标准文件
read_file .harness/eval_criteria.md
```

如果 `.harness/eval_criteria.md` 不存在，则根据 `.harness/mission.md` 中的"可机器验证的完成标准"自动生成验证标准。

### 第二步：执行 Level 1 自动检查

**逐项执行**所有的自动检查，记录 PASS/FAIL：

```
📋 自动检查结果：

  ✅ 输出目录存在                    .harness/output/ 存在
  ✅ 文件非空                        大小: 1234 bytes
  ✅ 包含关键词 "result"             grep 找到 3 处匹配
  ✅ JSON 格式合法                   json.load 成功
  ❌ 文件数量 >= 3                   当前只有 2 个文件 (需要 3+)

  PASS: 4/5 | FAIL: 1/5
```

### 第三步：执行 Level 2 内容质量检查

如果 Level 1 全部 PASS，继续 Level 2：

1. 用 `read_file` 读取输出文件内容
2. 对照 mission.md 中的目标描述进行语义检查
3. 判断内容是否满足任务需求

### 第四步：生成验证报告

写入 `.harness/logs/verify_report.md`：

```markdown
# 验证报告

**时间**: 2026-05-29 15:30:00
**任务**: [任务名称]
**步骤**: Step 2
**验证结果**: ❌ FAIL

## Level 1 自动检查 (4/5 PASS)
- ✅ 输出目录存在
- ✅ 文件非空
- ✅ 包含关键词 "result"
- ✅ JSON 格式合法
- ❌ 文件数量不足：当前 2 个，需要 3+

## Level 2 内容质量检查 (SKIPPED)
Level 1 未通过，跳过内容质量检查。

## 建议修复
- 需要额外生成 X 文件
```

### 第五步：根据验证结果决定下一步

#### ✅ 全部 PASS

```
→ 更新 heartbeat.md:
  Current Status → completed
  Consecutive Failures → 0
  Circuit Breaker → off
  Last Successful Artifact → [产出描述]
```

#### ❌ Level 1 有 FAIL

```
→ 不更新 heartbeat（保持 running 状态）
→ 分析失败原因
→ 尝试修复后重新验证（最多重试 2 次）
→ 如果重试后仍 FAIL → 进入熔断检查
```

#### ⚠️ Level 1 PASS 但 Level 2 有问题

```
→ 不标记为 completed
→ 列出需要改进的具体问题
→ 修复后重新验证
```

---

## 熔断机制

### 熔断触发条件

以下任一条件满足时触发熔断：

1. **连续验证失败 ≥ 3 次**：同一任务/步骤连续 3 次验证不通过
2. **同一修复策略重复失败 ≥ 2 次**：用同样的方法修复了 2 次仍未通过

### 熔断后操作

```
更新 heartbeat.md:
  Circuit Breaker → tripped
  Current Status → blocked
  Blocking Reason → "连续验证失败 3 次：[简要描述最后一次失败]"
```

**熔断后的正确行为**：
- 立即停止执行
- 向用户报告：
  - 哪个步骤的什么验证失败
  - 已尝试的修复方法
  - 建议的解决方向
- **不要**自动重试或尝试"换个方法再试一次"

### 熔断重置

仅当以下情况发生时重置熔断：
- 用户手动确认"已修复问题，可以重试"
- 用户修改了 `.harness/heartbeat.md` 中的 `Circuit Breaker = off`
- 换了一个完全不同的步骤执行且验证通过

---

## 与 harness-mission 配合

`harness-mission` 每完成一个步骤后，应调用本 skill 进行验证：

```
harness-mission 执行 Step N
  ↓
skill(name="harness-verify")  → 验证 Step N 的输出
  ↓
PASS → harness-mission 标记 completed，进入 Step N+1
FAIL → harness-mission 修复问题后重新验证
FATAL（熔断） → harness-mission 标记 blocked，通知用户
```

---

## 快速验证命令参考

```bash
# 检查文件存在
test -f .harness/output/result.json && echo "PASS" || echo "FAIL"

# 检查文件非空
test -s .harness/output/result.json && echo "PASS" || echo "FAIL"

# 检查包含关键词
grep -q "target_pattern" .harness/output/result.json && echo "PASS" || echo "FAIL"

# 检查 JSON 格式
python3 -c "import json; json.load(open('.harness/output/result.json'))" && echo "PASS" || echo "FAIL"

# 检查文件数量
test $(ls .harness/output/*.json 2>/dev/null | wc -l) -ge 3 && echo "PASS" || echo "FAIL"

# 检查文件大小（> 100 bytes）
test $(stat -c%s .harness/output/result.json 2>/dev/null || echo 0) -gt 100 && echo "PASS" || echo "FAIL"
```

---

## 常见问题

- **验证标准太模糊**：写成"输出质量好" → 必须改为可自动检查的条件
- **只做 Level 2 跳过 Level 1**：AI 直接读文件判断 → 先用脚本做自动检查，更客观
- **失败后直接重试不做修改**：逻辑不变就重新验证 → 必须先分析失败原因，修改后再验证
- **忽略熔断**：失败了第 3 次还继续尝试 → 第 3 次失败必须触发熔断
- **验证脚本本身有 bug**：验证失败可能是脚本写错了 → 先排除脚本自身问题
