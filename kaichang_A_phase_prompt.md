# 《开场》A阶段工程包 Prompt（给 Codex）

你现在要为项目 **《开场》** 执行 **A 阶段（P0 核心链路阶段）** 开发。  
请严格聚焦最小可运行闭环，不要发散，不要提前做大而全功能。

---

## 一、阶段目标

本阶段目标只有一个：

> **把“输入内容 -> 调用模型 -> 返回 3~5 个开头 -> 展示结果 -> 可复制 -> 可落库”这条主链路完整打通。**

只要这条链路真实可跑、结构清晰、后续可扩展，本阶段就算成功。

---

## 二、本阶段必须完成的范围

### 1. 首页 MVP
实现一个可用首页，包含：
- 产品名：开场
- 一句话说明：写不出来时，先写出第一段
- 多行输入框
- 风格选择器
- 生成按钮
- 结果展示区

### 2. 输入与校验
支持用户输入一段主题、情绪、构思或要求。

要求：
- 最少 20 字
- 最多 2000 字
- 前端和后端都做校验
- 错误提示用中文

### 3. 风格选择
先实现以下风格标签：
- 抓人
- 氛围
- 克制
- 文学感
- 小说感
- 随笔感
- 公众号感
- 小红书感

要求：
- 支持多选
- 不选也可生成
- 前端交互简单清晰

### 4. 开头生成主链路
实现主接口：`POST /api/generate-openings`

输入：
- `rawInput: string`
- `styleOptions: string[]`
- `candidateCount?: number`

输出：
- `requestId`
- `candidates: []`

每个 candidate 至少包含：
- `id`
- `openingStrategy`
- `styleLabel`
- `content`
- `qualityScore`

### 5. LLM Provider 抽象
必须实现统一模型接口，不允许业务代码直接写死 MiniMax。

要求至少有：
- `server/llm/types.ts`
- `server/llm/provider.ts`
- `server/llm/providers/minimax.ts`

需要有统一方法，例如：
- `generateText(...)`
- `generateOpenings(...)`

默认 provider 用 MiniMax，通过环境变量配置。

### 6. 输入分析层（简版）
本阶段不要做复杂智能体，但必须有最基础的输入分析函数。

例如：
- 判断更像小说 / 随笔 / 内容文案
- 判断情绪偏向（克制 / 浓烈 / 伤感 / 冷静）
- 判断是否强调画面感 / 钩子 / 冲突

要求：
- 放在 `server/opening/analyze-input.ts`
- 可先用规则 + 轻量 prompt 实现
- 不能直接省略这一层

### 7. 开头策略引擎（简版）
本阶段至少实现 5 种显式策略：
- 画面切入型
- 情绪切入型
- 冲突切入型
- 提问切入型
- 人物状态切入型

要求：
- 放在 `server/opening/strategy-engine.ts`
- 根据输入分析结果分配 3~5 个策略
- 不能简单写成“随机生成 3 条”

### 8. Prompt Builder
实现独立 Prompt 构建层：
- `server/opening/prompt-builder.ts`

功能：
- 接收原始输入、分析结果、策略类型、风格偏好
- 生成结构化 prompt
- 显式要求：
  - 自然中文
  - 避免套话
  - 避免翻译腔
  - 保持风格差异化

### 9. 候选排序层（简版）
实现一个独立的候选评分/排序模块：
- `server/opening/rank-candidates.ts`

可先用规则评分，但必须独立存在。

评分维度可先包括：
- 长度是否合适
- 是否包含明显套话
- 是否重复
- 是否更像自然中文
- 是否有钩子/画面/张力

### 10. 结果卡片
前端结果区需要把候选结果渲染成卡片。

每张卡片展示：
- 策略标签
- 风格标签
- 开头正文
- 复制按钮

本阶段先不强求点赞/点踩/微调完整交互，但卡片结构要为后续保留扩展空间。

### 11. 一键复制
实现复制功能，并记录复制事件。

### 12. 数据库存储
必须接好数据库，并落以下数据：
- `GenerationRequest`
- `OpeningCandidate`
- `CopyEvent`

要求：
- Prisma schema 可运行
- 本地可迁移
- 一次生成要能完整落库

### 13. 基础额度控制
实现最简额度控制：
- 游客：每日 3 次
- 登录用户可先不做，或预留接口
- 可以先基于 cookie/session id + usage_records 统计

目标不是做完整鉴权，而是防止无限白嫖，验证主流程。

---

## 三、本阶段明确不做

以下内容这阶段不要展开：

- 完整登录系统
- 历史页完整体验
- 点赞 / 点踩
- 微调能力
- 收藏夹
- 支付订阅
- App 适配
- 后台管理系统
- 复杂埋点平台
- 高级模型训练
- RAG / 知识库
- 社区内容

你可以预留扩展接口，但不要为了“以后”把当前实现搞复杂。

---

## 四、目录与架构要求

请按下面思路组织代码：

- `app/`
  - `page.tsx`
  - `api/generate-openings/route.ts`
  - `api/copy-event/route.ts`
- `components/`
  - `hero-input.tsx`
  - `style-selector.tsx`
  - `opening-card.tsx`
  - `opening-results.tsx`
- `server/llm/`
  - `types.ts`
  - `provider.ts`
  - `providers/minimax.ts`
- `server/opening/`
  - `analyze-input.ts`
  - `strategy-engine.ts`
  - `prompt-builder.ts`
  - `generate-openings.ts`
  - `rank-candidates.ts`
- `server/db/`
  - `prisma.ts`
  - `generation-repo.ts`
- `prisma/`
  - `schema.prisma`

要求：
- 不要把业务全塞进 route.ts
- 不要把 prompt 直接写在前端
- 不要写成单文件 demo

---

## 五、UI 要求

首页要做到：
- 极简
- 安静
- 聚焦
- 中文观感舒服
- 不像后台
- 不像聊天机器人

建议布局：
1. 顶部：开场 + 右侧预留登录按钮
2. 中间 hero：
   - 标题
   - 副标题
   - 输入框
   - 风格选择
   - 生成按钮
3. 下方结果区：
   - 卡片式展示 3~5 个开头

视觉重点：
- 输入框是主角
- 结果卡片要清爽、有呼吸感
- 不要加花哨大动画

---

## 六、数据库最低要求

### GenerationRequest
字段建议：
- id
- rawInput
- styleOptions (Json)
- detectedIntent
- detectedTone
- contentType
- candidateCount
- providerName
- modelName
- latencyMs
- status
- createdAt

### OpeningCandidate
字段建议：
- id
- generationRequestId
- rankOrder
- openingStrategy
- styleLabel
- content
- qualityScore
- isCopied
- createdAt

### CopyEvent
字段建议：
- id
- candidateId
- createdAt

### UsageRecord
字段建议：
- id
- guestId / userId（二选一或都支持）
- actionType
- usageDate
- creditsUsed
- createdAt

---

## 七、工程实现原则

### 1. 先打通闭环，再优化
只要闭环没通，不要花太多时间在样式抛光和扩展功能上。

### 2. 先规则化，再智能化
A 阶段允许输入分析、评分排序带有明显规则成分，不要求一开始就极度智能。

### 3. 不做“套壳感”
即便底层是 LLM，也要体现出以下独立层次：
- 输入分析
- 策略分配
- Prompt 构建
- 候选排序

### 4. 保持可扩展性
后续 B 阶段会接：
- 登录
- 历史
- 反馈
- 微调

所以这阶段数据结构和组件设计不要堵死后路。

---

## 八、交付物要求

本阶段完成后，请输出：

1. 完整目录结构
2. Prisma schema
3. 首页页面代码
4. 核心组件代码
5. generate-openings API
6. MiniMax provider 实现
7. analyze-input / strategy-engine / prompt-builder / rank-candidates 实现
8. README

README 至少写清：
- 如何安装依赖
- 如何配置环境变量
- 如何初始化数据库
- 如何启动本地开发
- 如何测试主流程

---

## 九、自测要求

交付前请自测以下主流程：

### Case 1
输入：
“我想写一个关于海上女船长的故事，她表面强势，内心很重感情，开头要有宿命感和画面感。”

预期：
- 能成功生成 3~5 条开头
- 风格有区分
- 至少有一条明显偏画面感
- 页面可正常复制

### Case 2
输入：
“最近总觉得时间过得很快，人也变得越来越沉默，想写一种有点伤感但不矫情的开头。”

预期：
- 结果不能太鸡汤
- 不能出现明显翻译腔
- 至少有一条偏克制表达

### Case 3
输入：
“我想写一篇关于拖延症的内容，开头要适合公众号，抓人一点，但不要太夸张。”

预期：
- 至少有一条明显适合内容开头
- 不能全都写成小说腔

---

## 十、完成定义（Definition of Done）

只有以下条件都满足，A 阶段才算完成：

- 首页可访问
- 可输入内容并生成开头
- 已真实接入 MiniMax
- 结果能显示为卡片
- 可复制
- 生成请求与候选结果已落库
- 有基础额度限制
- 核心逻辑已按分层拆开
- README 可指导别人本地跑起来

---

## 十一、最后提醒

A 阶段不是做“完整产品”，而是做 **最关键主链路**。

请不要发散到太多“看起来以后会需要”的东西。  
请把注意力集中在：

> 输入体验是否顺  
> 开头结果是否有区分度  
> 架构是否足够干净  
> 主闭环是否真实可跑

现在请直接开始实现 A 阶段。
