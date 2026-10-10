# 参与贡献

欢迎通过本仓库的 [Issue](https://github.com/xuanvivo/juejin-helper/issues) 或 [Pull request](https://github.com/xuanvivo/juejin-helper/pulls) 提交问题和改进。

## 项目结构

| 路径                                       | 用途                               |
| ------------------------------------------ | ---------------------------------- |
| `packages/juejin-helper/src/`              | 掘金 API SDK 源码。                |
| `workflows/checkin.js`、`workflows/tasks/` | 账号编排、任务执行和运行结果汇总。 |
| `workflows/utils/`                         | 环境变量、通知与通用工具。         |
| `workflows/test/`                          | 使用模拟响应的离线单元测试。       |
| `.github/workflows/`                       | 构建测试及定时任务。               |

## 开发环境

使用 Node.js 24 LTS，在仓库根目录安装、构建和测试：

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm ci
npm run build
npm test
```

监听 SDK 源码变化并持续构建：

```bash
npm run dev
```

根 npm workspaces 同时包含 SDK 和 `workflows`。工作流依赖本地 SDK，修改 SDK 后应重新构建；依赖变更需要同步根 `package-lock.json`。两个 `yarn.lock` 仅用于历史保留，不再维护，也不用于当前 CI 安装。

## 验证改动

`npm test` 运行 `workflows/test/*.test.js`，使用 Node.js 原生测试运行器及 `ts-node/register`。测试应模拟 HTTP、SMTP、计时和账号数据，不依赖真实 Cookie，也不向外部发送通知或提交任务。

修改通知、账号编排或 SDK 时，补充能覆盖行为的测试，特别是异常响应、接口超时、已完成任务和重复执行场景。CI 会先构建本地 SDK，再执行离线测试；不要用捕获全部异常或跳过断言的方式掩盖失败。

需要手动检查账号状态时，按 [本地工作流说明](./workflows/README.md) 设置环境变量，再运行：

```bash
TASK_MODE=inspect npm run checkin
```

`npm run checkin` 默认会执行真实任务并发送已配置的通知。SDK 目录下原有 `test:*` 示例也可能访问真实接口，与根 `npm test` 的离线测试用途不同。

阅读任务应遵循官方的阅读间隔，并在提交后查询后台进度。发现新活动时，先核对官方页面、接口数据及账号开放条件，再决定是否支持；已下线的旧游戏不应重新列入默认任务。

## 凭据和文档

通过环境变量或 Actions Secrets 提供 Cookie、Telegram Token、SMTP 授权码等凭据。不要把真实值写进源码、测试夹具、提交记录或 Issue，也不要直接打印包含认证头或 Token URL 的请求错误对象。

新增配置或改变任务行为时，同步更新主 README 和工作流说明；SDK 方法的调用约束写入 SDK README。保留原作者及贡献者的署名，遵循 [Apache License 2.0](./LICENSE)。
