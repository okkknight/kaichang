# 《开场》技术方案文档

版本：v0.1 MVP  
项目名：开场  
目标：构建一个中文优先、可扩展、非纯套壳式的“开头生成器”Web MVP

---

## 一、技术目标

“开场”的技术方案不能只是把用户输入直接丢给一个 LLM 再把结果展示出来。  
第一版虽然接入 MiniMax，但必须具备可演化的中间层能力，形成自己的产品壁垒。

第一版技术目标：
1. 打通可用的 Web MVP
2. 支持 MiniMax 模型接入
3. 建立可替换的 LLM Provider 抽象
4. 构建“输入理解 → 策略分配 → Prompt 构建 → 多候选生成 → 排序重排”的基础链路
5. 支持历史记录、反馈、复制事件、用量控制
6. 为后续评分优化、偏好学习、轻量微调预留结构

---

## 二、总体架构思路

推荐采用四层架构：

1. **接入层**
   - Web 前端页面
   - API / Server Actions
   - 认证与权限
   - 用量控制

2. **业务编排层**
   - 输入分析
   - 策略选择
   - Prompt 构建
   - 生成任务编排
   - 结果重排
   - 埋点记录

3. **模型能力层**
   - MiniMax Provider
   - 未来可扩展 OpenAI / Anthropic / 其他中文模型

4. **数据层**
   - PostgreSQL
   - Prisma
   - 用户、请求、候选、反馈、额度、埋点等数据持久化

---

## 三、推荐技术栈

### 3.1 前端
- Next.js 14+（App Router）
- TypeScript
- Tailwind CSS
- shadcn/ui

### 3.2 后端
- Next.js Route Handlers / Server Actions
- TypeScript
- Prisma ORM

### 3.3 数据库
- PostgreSQL
- 开发环境可用本地 Postgres 或 Supabase / Neon

### 3.4 鉴权
- NextAuth（推荐）
- 支持邮箱登录或 OAuth 登录

### 3.5 缓存 / 限流
- 第一版可先用数据库计数
- 后续可引入 Redis 做更稳定的限流与配额控制

### 3.6 部署
- 前后端：Vercel / Railway
- 数据库：Supabase Postgres / Neon / Railway Postgres

---

## 四、项目分层设计

建议目录结构如下：

```text
app/
components/
lib/
server/
  auth/
  db/
  llm/
    providers/
  opening/
  analytics/
types/
prisma/
```

### 4.1 `app/`
负责页面与路由：
- 首页
- 历史页
- 登录页
- 账户页
- API Route Handlers

### 4.2 `components/`
负责 UI 组件：
- 输入框
- 风格选择器
- 结果卡片
- Header
- 空状态
- 用量提示
- 历史列表

### 4.3 `server/llm/`
模型接入抽象层：
- provider interface
- minimax provider
- provider factory

### 4.4 `server/opening/`
开头生成核心逻辑：
- input analyzer
- strategy engine
- prompt builder
- candidate ranker
- refinement service
- generation orchestrator

### 4.5 `server/db/`
数据库访问封装：
- repositories
- Prisma client

### 4.6 `server/auth/`
认证与 session 获取

### 4.7 `server/analytics/`
埋点与行为记录

---

## 五、核心技术壁垒设计

第一版不建议直接训练模型，而是先做四个关键层。

### 5.1 Input Analysis Layer（输入分析层）
目标：在调用生成前，先把用户输入结构化理解。

分析维度：
- 文体类型：小说 / 随笔 / 公众号 / 小红书 / 其他
- 情绪基调：克制 / 伤感 / 冷静 / 强烈 / 宿命 / 明亮
- 风格偏好：抓人 / 文学 / 小说感 / 口语 / 画面感
- 诉求重点：钩子 / 画面 / 情绪 / 冲突 / 人物 / 问题
- 长度偏好：短 / 中 / 长

输出一个内部结构化对象，例如：

```json
{
  "contentType": "novel",
  "tone": ["宿命", "画面感"],
  "preferredStyles": ["小说感", "氛围"],
  "primaryNeeds": ["画面", "人物感"],
  "audience": "general",
  "lengthPreference": "medium"
}
```

实现方式：
- 第一版可由规则 + LLM 分类共同完成
- 如需简化，先使用轻量 Prompt 分析，再结构化解析 JSON 输出

---

### 5.2 Opening Strategy Engine（开头策略引擎）
目标：不要让模型“随机写几个版本”，而是明确用不同开头策略去生成。

推荐策略库：
- 画面切入型
- 情绪切入型
- 冲突切入型
- 提问切入型
- 人物状态切入型
- 反常识切入型
- 叙事悬念型
- 金句引入型
- 日常细节切入型

策略引擎职责：
1. 根据输入分析结果选出最匹配的 3-5 个策略
2. 保证候选之间有差异
3. 避免全都写成一个味道

示例逻辑：
- 小说 + 宿命感 + 画面感 → 优先选：
  - 画面切入型
  - 人物状态切入型
  - 叙事悬念型
- 公众号 + 抓人 + 不夸张 → 优先选：
  - 提问切入型
  - 反常识切入型
  - 共鸣问题切入型

---

### 5.3 Prompt Builder（提示构建层）
目标：统一管理 Prompt，避免 Prompt 分散在页面或接口中。

建议拆分：
- `buildInputAnalysisPrompt(rawInput)`
- `buildOpeningPrompt(analysis, strategy, styleOptions)`
- `buildRefinementPrompt(candidate, refinementType)`

生成 Prompt 时需要明确要求：
- 输出自然中文
- 避免翻译腔
- 避免陈词滥调
- 输出必须像“开头”，不是普通中段段落
- 不要直接总结用户意图，而要进入文本状态
- 候选之间必须有明显差异

推荐加入负面约束：
- 不要使用空泛套话
- 不要使用“在这个快节奏的时代”这类无效句
- 不要过度鸡汤
- 不要为了文学而堆砌形容词

---

### 5.4 Candidate Ranking Layer（候选排序层）
目标：对多个候选做内部筛选，避免把明显弱的内容直接展示给用户。

评分维度建议：
- 中文自然度
- 开头吸引力
- 风格匹配度
- 是否具备继续展开的潜力
- 是否避免模板感/套话
- 是否符合用户要求

第一版实现方式：
- 规则评分为主
- 可加一次轻量 LLM 打分作为辅助手段
- 最终只展示 Top N

规则示例：
- 出现高频陈词滥调则扣分
- 缺乏具体意象则扣分
- 句式过于模板化则扣分
- 风格标签匹配加分
- 明显有钩子或画面感加分

---

## 六、为什么第一版不建议直接训练模型

用户提出“是否可以用文章、小说名著内容做小型训练或优化”，方向不算错，但第一版不建议直接上训练。

原因：
1. 成本高，且早期需求尚未验证
2. 数据清洗、版权、标注工作复杂
3. 很可能问题不在模型本体，而在提示与排序
4. 训练后也不一定比“结构化生成 + 重排”效果更好
5. MVP 的关键是验证产品价值，不是追求技术叙事

第一版更推荐：
- 高质量样本库
- few-shot 提示
- 策略化生成
- 多路候选
- 排序重排
- 用户反馈闭环

---

## 七、后续训练 / 优化路线

### 7.1 MVP 推荐路线
先做：
- 检索样本 + 提示工程
- 开头策略库
- 多候选生成
- 中文规则评分
- 行为反馈收集

### 7.2 可积累的数据资产
- 用户输入类型
- 风格偏好分布
- 被复制最多的开头类型
- 被点赞最多的策略
- 点踩原因标签
- 微调动作偏好
- 高质量开头样本池

### 7.3 后续可演进方向
当数据积累后，再考虑：
- 轻量微调
- 偏好学习
- 专门的 reranker
- 中文开头质量评分模型
- 小说 / 随笔 / 自媒体垂类生成器

更推荐先训练 **评分器 / reranker**，而不是一上来训练完整生成模型。

---

## 八、MiniMax 接入方案

### 8.1 原则
- MiniMax 作为默认模型提供方
- 通过抽象接口接入，不能写死在业务层
- 所有配置走环境变量
- provider 逻辑集中在 `server/llm/providers/minimax.ts`

### 8.2 推荐接口设计

```ts
interface LlmProvider {
  analyzeInput(input: string): Promise<InputAnalysisResult>;
  generateOpening(prompt: string): Promise<string>;
  rankCandidates?(items: Candidate[]): Promise<ScoredCandidate[]>;
}
```

如 MiniMax 不方便拆多个能力，可第一版退化为：
- `complete(prompt: string): Promise<string>`

但业务层仍应保留：
- analyze
- generate
- rank

这三个概念上的分层。

### 8.3 环境变量建议
- `MINIMAX_API_KEY`
- `MINIMAX_GROUP_ID`
- `MINIMAX_BASE_URL`
- `MINIMAX_MODEL`

---

## 九、数据库设计

建议核心表如下：

### 9.1 `users`
存储用户基础信息。

### 9.2 `sessions`
用于登录态管理（按鉴权方案决定是否需要）。

### 9.3 `generation_requests`
记录一次“生成开场”的请求。

建议字段：
- id
- user_id
- raw_input
- style_options
- detected_intent
- detected_tone
- content_type
- candidate_count
- provider_name
- model_name
- latency_ms
- status
- created_at

### 9.4 `opening_candidates`
记录该请求生成的多个候选开头。

建议字段：
- id
- generation_request_id
- rank_order
- opening_strategy
- style_label
- content
- quality_score
- is_copied
- is_selected
- created_at

### 9.5 `refinement_requests`
记录基于某个候选进行二次微调的请求。

### 9.6 `feedbacks`
记录用户对候选的点赞 / 点踩与原因。

### 9.7 `copy_events`
记录复制行为，是判断价值的关键事件。

### 9.8 `usage_records`
记录游客/用户额度消耗。

### 9.9 `subscriptions`
可后置实现，用于后续付费能力。

---

## 十、API 设计建议

### 10.1 `POST /api/generate-openings`
输入：
- rawInput
- styleOptions
- candidateCount

流程：
1. 校验输入
2. 检查额度
3. 输入分析
4. 策略分配
5. 构建 Prompt
6. 调用 MiniMax 分别生成
7. 候选评分与重排
8. 持久化 request 与 candidate
9. 返回结果

### 10.2 `POST /api/refine-opening`
输入：
- candidateId
- refinementType

流程：
1. 查询原候选
2. 构建 refinement prompt
3. 调用模型生成
4. 存储 refinement request
5. 返回新候选

### 10.3 `POST /api/feedback`
记录点赞/点踩与原因。

### 10.4 `POST /api/copy-event`
记录复制行为，并更新候选状态。

### 10.5 `GET /api/history`
返回当前用户历史生成记录。

### 10.6 `GET /api/usage`
返回当前用户当日剩余额度。

---

## 十一、用量控制方案

### 11.1 MVP 简化方案
- 游客按 session / device 标识计数
- 注册用户按 user_id 计数
- 每次生成消耗一次额度
- 复制/点赞不消耗额度
- 微调可以算单独额度，也可首版算作生成额度

### 11.2 配额建议
- 游客：3 次 / 天
- 注册用户：10 次 / 天
- Pro：后续开放更高配额

---

## 十二、埋点与分析方案

建议将关键行为先落数据库，而不是一开始接复杂分析平台。

必备事件：
- page_view_home
- input_started
- generate_clicked
- generate_success
- generate_failed
- opening_copied
- opening_liked
- opening_disliked
- opening_regenerated
- opening_refined
- login_success
- history_viewed

关键属性：
- input_length
- selected_styles
- opening_strategy
- response_time_ms
- copied_flag
- liked_flag
- user_type

---

## 十三、前端交互实现建议

### 13.1 首页
重点突出：
- 产品名
- slogan
- 输入框
- 风格选择
- 生成按钮
- 结果卡片

### 13.2 结果卡片
每张卡片至少包含：
- 策略标签
- 风格标签
- 正文
- 复制按钮
- 点赞 / 点踩
- 微调菜单
- 继续生成按钮

### 13.3 UI 原则
- 极简
- 安静
- 中文排版舒适
- 不要后台系统感
- 不要聊天泡泡
- 聚焦输入与结果
- 有一点文学气质，但不过度装饰

---

## 十四、错误处理建议

需要处理的错误：
- 输入为空
- 输入太短
- 模型响应失败
- 模型超时
- 数据库存储失败
- 候选不存在
- 用户额度耗尽
- 登录态失效

错误返回应统一封装，不要直接暴露底层异常堆栈。

---

## 十五、开发阶段建议

### P0
- 首页输入与结果展示
- MiniMax 接入
- 开头生成链路打通
- 结果复制
- 数据库存储
- 基础额度控制

### P1
- 登录
- 历史记录
- 点赞点踩
- 微调按钮
- 埋点

### P2
- 更细排序优化
- 更完整错误态
- UI 打磨
- 更丰富策略库

---

## 十六、最终技术原则

“开场”的第一版核心技术，不是训练自己的中文大模型，而是这四件事：

1. 输入理解  
2. 开头策略分配  
3. 中文风格优化  
4. 候选结果排序  

这四件事做好了，它就已经不再是简单套壳。

---

## 十七、结论

第一版建议采用：

- MiniMax 作为默认生成模型
- Next.js + TypeScript + Prisma + PostgreSQL 作为工程基础
- 通过“输入分析 → 策略引擎 → Prompt 构建 → 多候选生成 → 排序重排”的链路建立产品核心

等 MVP 跑通后，再根据真实行为数据决定是否进入：
- 偏好学习
- 轻量微调
- 垂类开头生成器
- 专门的中文评分模型

这才是更稳、更现实、也更适合独立开发者的路线。
