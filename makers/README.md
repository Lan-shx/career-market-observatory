# 职业观测站：腾讯云 Makers 部署

## 兼容版说明
本目录保留 PostgreSQL 会话存储及浏览器执行工具的协议，状态标识为 `legacy-client`。新增的岗位数据库、服务端 SQL 和证据分页属于 Cloudflare D1 版，运行方式见根目录 [TEXT-TO-SQL.md](../TEXT-TO-SQL.md)。两套运行方式的 API 续接协议不同，请使用各自匹配的前端和服务入口。

本目录是职业观测站的独立 Makers 入口。保留 Sites 第 28 版前端及完整的 69,465 条历史招聘样本；不更新采集日期或更换数据。源码仓库为 `Lan-shx/career-market-observatory`，不使用 `resume-radar`。

## 当前进度与限制

适配代码已完成本地构建和测试，没有创建 Makers 项目、数据库或任何付费资源，没有部署线上网站。

- 前端、地图、查询、比较、导入导出、浏览器收藏与聊天界面沿用原版；静态资源从仓库 `public/` 原样生成。
- `/api/research/*` 使用 Makers Node.js Cloud Functions，调用原研究助手逻辑。
- 临时研究会话改用 PostgreSQL，共享数据库保留原子认领和重复请求保护；不用实例内存或临时磁盘冒充持久化存储。
- `DATABASE_URL` 留空时，本地分析仍可用；模型研究对话不可用。个人模型密钥连接测试不依赖数据库，但真正多轮研究需要数据库。
- 研究会话有效期仍为 60 分钟。过期数据在后续研究请求时清理，不保证到点即物理删除。
- 模型费用由配置的 DeepSeek 账户承担。没有复制原站点的密钥或在线会话。

## 在 Makers 导入

以下操作会创建并可能立即部署项目。用户明确确认部署后再执行。

| 设置 | 填写内容 |
| --- | --- |
| GitHub 仓库 | `Lan-shx/career-market-observatory` |
| 分支 | `main` |
| 项目根目录 | `makers` |
| 框架 | `Other` 或其他/自定义，不选 Next.js |
| 安装命令 | `npm ci` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 构建 Node.js | `22.11.0`（已写入 `edgeone.json`） |

`edgeone.json` 位于所选根目录 `makers/`，已声明构建配置和云函数 90 秒超时。浏览器静态输出与云函数分开打包，招聘数据不会打进函数代码包。

不要把 `public` 设为仓库根目录，也不要使用仓库顶层的 `npm run build`：顶层仍是原 Sites/Vinext/Cloudflare 构建。Makers 构建会读取上一级的 `public/` 和 `lib/research-server.mjs`，因此应导入整个 Git 仓库后将根目录设为 `makers`，不要只上传这个子文件夹。

## 研究助手配置

选定可从 Makers 云函数访问的 PostgreSQL 数据库后，再执行 `schema.sql`。本步骤只创建 `research_turns` 表和过期索引，不会将招聘数据导入数据库，也不会删除其他表。请使用独立数据库或独立访问账号，生产连接按数据库供应商要求启用证书校验，例如 `sslmode=verify-full`。

在 Makers 的服务端环境变量中配置：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串，作为密钥保存 |
| `DEEPSEEK_API_KEY` | 可选站点模型密钥，作为密钥保存；也支持用户在页面输入个人密钥 |
| `DEEPSEEK_MODEL` | 可选模型名；默认沿用原项目的 `deepseek-flash`，实际可用性取决于 DeepSeek 账户 |

变量不能使用 `NEXT_PUBLIC_`、`VITE_` 等浏览器公开前缀，也不能写进 `public/`、GitHub 或截图。仓库只有空的 `.env.example`。

数据库账号运行时需要 `research_turns` 表的 SELECT、INSERT、UPDATE、DELETE 权限。初始化表结构可由维护账号单独执行；应用不会自动创建表。`/api/research/status` 会检查数据库是否可连接且表已初始化，返回就绪状态，不返回数据库连接信息。

数据库选型、实际连接、生产环境变量和 DeepSeek 真实请求尚待确认与验证。测试使用本地 PGlite PostgreSQL 引擎和模拟模型响应，不调用真实模型，不产生模型账单。

## 本地验证

在 `makers/` 目录运行：

```sh
npm ci
npm test
npm run dev
```

`npm test` 会先构建，再检查 PostgreSQL 会话读写、并发重复请求、会话隔离、过期、模型错误隐藏、参数化 SQL 和缺失配置。构建逐块验证 JSON 的 SHA-256、gzip 一致性和总行数，并生成 `dist/` 与仅供服务端使用的 `runtime/`。

本地地址为 `http://127.0.0.1:8788`。未配置数据库或模型密钥时，状态接口明确返回未就绪。需要测试真实后端时，在忽略的本地 `.env` 中填写配置，再运行：

```sh
node --env-file=.env scripts/dev.mjs
```

`dist/`、`runtime/`、`node_modules/`、真实 `.env` 均不提交。生产库不使用本地测试引擎。

## 部署后的核对

1. 首页正常加载，数据说明仍显示原历史快照与 69,465 条记录。
2. 城市/岗位筛选、对比、地图、下载和浏览器收藏可用，数据分块请求成功。
3. `/api/research/status` 返回 JSON；配置齐全时 `ready` 为 `true`，未配置时明确提示原因。
4. 在页面用自己的模型配置测试一次连接，再完成一次研究问题和追问。真实模型请求可能收费，应由用户确认后执行。
5. 新域名与原 `chatgpt.site` 属于不同来源，浏览器收藏、IndexedDB 聊天和会话密钥不会自动跨站迁移。需要保留的记录应先从原网站导出。

上线成功后再处理域名、加速区域和备案条件。这些不由本适配代码自动修改。

## 官方参考

- [Makers Node.js Cloud Functions](https://pages.edgeone.ai/document/node-functions)
- [edgeone.json 配置](https://pages.edgeone.ai/document/edgeone-json)
- [导入 Git 仓库](https://pages.edgeone.ai/document/importing-a-git-repository)
- [node-postgres 参数化查询](https://node-postgres.com/features/queries)
