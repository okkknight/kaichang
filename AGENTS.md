# AGENTS.md

## Project
开场（Kaichang）

中文优先的 AI 开头生成器。  
目标不是万能写作助手，而是专门解决“写不出来时，第一段起不来”的问题。

---

## Product North Star

帮助用户从一个模糊念头，快速拿到一个真正想继续写下去的开头。

优先级排序：
1. 主链路真实可跑
2. 中文结果质量自然、有区分度
3. 架构清晰，可继续演进
4. UI 克制、聚焦，不要像聊天机器人

---

## Core Product Rules

### 只做
- 开头 / 第一段生成
- 多候选结果
- 风格化差异
- 一键复制
- 历史记录
- 微调已有开头

### 不做
- 整篇文章生成
- 聊天式对话产品
- 知识问答
- 协作文档
- 社区平台
- 大而全写作助手

### 任何时候都不要偏离
这个产品不是 ChatGPT 套壳。  
不能做成“用户输入一句话，系统返回一大段泛泛内容”的聊天页。

---

## Coding Principles

### 1. Prefer clean layering
必须保持以下分层，避免业务混杂：
- UI layer
- API / route layer
- service layer
- opening generation domain layer
- llm provider layer
- persistence layer

### 2. Do not hardcode provider logic into business logic
MiniMax 只是默认 provider，不是唯一 provider。  
所有模型调用都要经过抽象层。

### 3. Keep the opening engine explicit
“开头生成”必须是显式策略驱动，而不是一次 prompt 全包。

至少保留这些模块：
- analyze-input
- strategy-engine
- prompt-builder
- rank-candidates

### 4. Favor server-first architecture
能放服务端的逻辑尽量放服务端。  
前端只负责体验，不负责核心业务判断。

### 5. Avoid overengineering
不需要为了未来设计十几个抽象工厂。  
只要做到：
- 当前清晰
- 后续可扩展
- 容易修改

---

## UX Principles

### 首页体验
首页必须极简，输入框是主角。  
不要做成聊天界面，不要有密集操作区，不要有后台系统感。

### 中文观感
文案、排版、错误提示、按钮文案优先中文自然度。  
避免英文产品直译气质。

### Result Cards
结果应该是“候选卡片”，而不是聊天消息气泡。  
每张卡片要独立、易读、可复制、可继续操作。

---

## Output Quality Principles

生成结果要尽量避免：
- 翻译腔
- 套话
- 空泛抒情
- 过度鸡汤
- 明显 AI 味
- 所有候选风格都差不多

候选结果需要体现出策略差异，例如：
- 画面切入
- 情绪切入
- 冲突切入
- 提问切入
- 人物状态切入

如果结果没有区分度，说明实现有问题，需要回头修正策略或 prompt。

---

## Implementation Priorities

### A 阶段（P0）
必须优先保证：
- 首页输入
- 开头生成链路
- MiniMax 接入
- 候选卡片展示
- 复制
- 落库
- 基础额度限制

### B 阶段（P1）
在 A 阶段闭环稳定后，再做：
- 登录
- 历史记录
- 点赞 / 点踩
- 微调
- 埋点

### C 阶段（P2）
最后再做：
- 排序优化
- 体验 polish
- 更细风格控制
- 订阅与商业化

---

## File / Module Expectations

建议的核心文件：

- `server/opening/analyze-input.ts`
- `server/opening/strategy-engine.ts`
- `server/opening/prompt-builder.ts`
- `server/opening/generate-openings.ts`
- `server/opening/rank-candidates.ts`
- `server/llm/provider.ts`
- `server/llm/providers/minimax.ts`

如果缺少这些文件中的关键模块，说明项目正在滑向“能跑但不可维护”的方向。

---

## Database Expectations

至少保留这些核心实体：
- GenerationRequest
- OpeningCandidate
- CopyEvent
- UsageRecord

后续可增加：
- Feedback
- RefinementRequest
- User-related tables

---

## Decision Rules for Codex

在实现时遇到岔路，按以下顺序判断：

1. 哪个方案更能保证主链路先跑通？
2. 哪个方案更符合“开头生成器”而不是“通用聊天工具”？
3. 哪个方案更容易在下一阶段扩展？
4. 哪个方案更少引入不必要复杂度？

如果一个功能不能明显提升当前阶段目标，就先不要做。

---

## Commit / Work Style

每次改动尽量围绕一个清晰目标：
- feat(home): build landing input flow
- feat(opening): add strategy engine
- feat(llm): add minimax provider
- feat(db): persist generation requests and candidates
- feat(copy): track copy events

避免一次提交里同时混入：
- UI 大改
- 数据库重构
- provider 改造
- prompt 重写

---

## Testing Guidance

每次完成一段工作后，至少用以下输入手测：

### 1. 小说感
“我想写一个关于海上女船长的故事，她表面强势，内心很重感情，开头要有宿命感和画面感。”

### 2. 随笔感
“最近总觉得时间过得很快，人也变得越来越沉默，想写一种有点伤感但不矫情的开头。”

### 3. 内容感
“我想写一篇关于拖延症的内容，开头要适合公众号，抓人一点，但不要太夸张。”

目标不是“有输出”就行，而是：
- 有差异
- 有中文味
- 能复制
- 能复用

---

## Final Reminder

这个项目的灵魂不是模型本身，  
而是：

- 对“起笔困难”场景的聚焦
- 对中文开头质感的追求
- 对生成策略的明确控制
- 对产品边界的克制

请始终记住：

> 开场是一个锋利的小产品，不是一个膨胀的大平台。
