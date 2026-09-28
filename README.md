# 开场

中文优先的开头生成器。MVP 目标是把“输入内容 -> 生成 3-5 个开头 -> 展示结果 -> 一键复制 -> 落库”这条主链路跑通。

## 现在有什么

- Next.js App Router Web MVP
- 输入分析、策略选择、Prompt 构建、候选排序四层分离
- MiniMax provider 抽象，默认走 Anthropic 兼容接口
- SQLite + Prisma 的本地数据层
- A 阶段首页、结果卡片和复制事件
- compact handoff pack

## 安装

```bash
npm install
```

## 环境变量

复制 `.env.example` 为 `.env`，最少配置：

```bash
DATABASE_URL="file:./dev.db"
MINIMAX_API_KEY="your-key"
MINIMAX_BASE_URL="https://api.minimaxi.com/anthropic"
MINIMAX_MODEL="MiniMax-M2.5"
```

如果暂时没有真实模型 Key，可以保留 `MOCK_LLM="1"` 走本地模拟输出。

本地 `.env`、生成内容数据库和运行日志不应提交到仓库。

## 初始化数据库

```bash
npx prisma generate
npm run db:push
```

`npm run db:push` 会初始化本地 SQLite 表结构，便于在当前环境直接跑 MVP。
默认数据库文件位于 `prisma/dev.db`，初始化脚本会按照 Prisma 的 SQLite 相对路径规则放到这里。

## 启动

```bash
npm run dev
```

打开 `http://localhost:3000`。

## 主流程自测

推荐输入：

1. 小说感
   - `我想写一个关于海上女船长的故事，她表面强势，内心很重感情，开头要有宿命感和画面感。`
2. 随笔感
   - `最近总觉得时间过得很快，人也变得越来越沉默，想写一种有点伤感但不矫情的开头。`
3. 公众号感
   - `我想写一篇关于拖延症的内容，开头要适合公众号，抓人一点，但不要太夸张。`

## 设计原则

- 保持“开头生成器”而不是“聊天机器人”
- 保持输入分析、策略分配、Prompt 构建、排序层清晰
- 不要把业务逻辑塞进 route handler
- 不要把所有候选写成一个味道

## 许可证

代码采用 [MIT 许可证](LICENSE)。
