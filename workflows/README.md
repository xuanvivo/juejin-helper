# 掘金自动化工作流

本目录包含每日任务编排和通知模块，运行时通过 npm workspaces 使用本仓库构建的 SDK。GitHub Actions 的 Secrets 配置及功能介绍见 [主 README](../README.md)。

## 本地安装

使用 Node.js 24 LTS 和 npm，保留完整仓库结构，在仓库根目录执行：

```bash
git clone https://github.com/xuanvivo/juejin-helper.git
cd juejin-helper
PUPPETEER_SKIP_DOWNLOAD=true npm ci
npm run build
npm test
```

`npm ci` 根据根 `package-lock.json` 安装所有工作区；根目录和 `workflows/` 下的 `yarn.lock` 是不再维护的历史文件。`PUPPETEER_SKIP_DOWNLOAD=true` 只跳过安装时的浏览器下载，不会关闭运行时的浏览器流程。

## 浏览器配置

常规任务通过 API 执行。抽奖配置 API 返回空响应时，工作流会用 Puppeteer 打开官方抽奖页面，由官网脚本处理请求；在页面中确认免费次数后，只执行免费单抽，没有免费机会时跳过。已提交抽奖后的响应异常不会触发浏览器切换或重试。

GitHub 托管的 Ubuntu 运行器已预装 Chrome，因此工作流保持 `PUPPETEER_SKIP_DOWNLOAD=true`，无需在 `npm ci` 时重复下载浏览器。本地运行应准备可用的 Chrome 或 Chromium；自动定位不到浏览器时，用以下任一环境变量指定可执行文件：

| 环境变量                    | 说明                                      |
| --------------------------- | ----------------------------------------- |
| `PUPPETEER_EXECUTABLE_PATH` | Chrome 或 Chromium 可执行文件的完整路径。 |
| `CHROME_PATH`               | 同样可用于指定浏览器可执行文件。          |

例如，已安装浏览器的 Linux 系统可以这样运行；请把路径换成本机实际位置：

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome npm run checkin
```

该页面流程使用工作流专用的浏览器封装，独立于 SDK 中为历史兼容保留的 `browser()` 接口。

## 配置凭据

程序读取环境变量，不需要修改 `utils/env.js`。以下 Bash 示例使用隐藏输入，避免把真实凭据写进命令历史：

```bash
read -rsp '掘金 Cookie: ' COOKIE
printf '\n'
export COOKIE
read -rsp 'Telegram Bot Token: ' TELEGRAM_BOT_TOKEN
printf '\n'
export TELEGRAM_BOT_TOKEN
read -rp 'Telegram Chat ID: ' TELEGRAM_CHAT_ID
export TELEGRAM_CHAT_ID
```

不使用 Telegram 时，只设置 `COOKIE` 即可。其他账号使用同样方式设置 `COOKIE_2` 至 `COOKIE_5`，最多五个账号。不要把 Cookie、Token 或邮件授权码写入受版本控制的配置文件。

| 环境变量                                   | 说明                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `COOKIE`、`COOKIE_2` 至 `COOKIE_5`         | 各账号的完整掘金登录 Cookie。                                |
| `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`   | Telegram 通知的两个必填配置，支持私聊、群组和频道。          |
| `TELEGRAM_MESSAGE_THREAD_ID`               | 可选的群组话题 ID，正整数。                                  |
| `TG_BOT_TOKEN`、`TG_CHAT_ID`、`TG_USER_ID` | Telegram 配置别名；优先使用 `TELEGRAM_*`。                   |
| `AUTO_READ_ARTICLES`                       | 默认 `true`；设为 `false` 关闭阅读任务。                     |
| `READING_MAX_ARTICLES`                     | 每个账号每次最多阅读的篇数，默认 `5`，有效范围 `1` 至 `10`。 |
| `TASK_MODE`                                | `run` 执行任务，`inspect` 只检查状态，默认 `run`。           |

邮箱、钉钉、PushPlus、企业微信、Server 酱、飞书和 Bark 的环境变量名称与 [Actions Secrets 表](../README.md#其他通知渠道) 相同。

## 运行

在仓库根目录执行：

```bash
npm run checkin
```

脚本检查每日签到、免费抽奖、阅读掘友分任务及账号开放的签到活动，并汇总统计和通知。各账号依次执行；单项失败会记录错误并继续处理后续任务。登录、任务或已配置的通知渠道失败时，进程返回非零退出码。

只读取任务和活动状态：

```bash
TASK_MODE=inspect npm run checkin
```

`inspect` 会访问官方查询接口并输出状态，不会签到、抽奖、提交阅读、领奖或发送通知。它适合在更换 Cookie、排查活动未开放或查看后台任务进度时使用。

关闭阅读或修改篇数可只影响本次运行：

```bash
AUTO_READ_ARTICLES=false npm run checkin
```

```bash
READING_MAX_ARTICLES=2 npm run checkin
```

阅读任务会先查询后台上限与已完成数量，仅处理尚未完成的部分；每篇读取文章实际内容后等待 90 秒，提交后再次核对进度。若账号没有相应任务、当天已完成或功能被关闭，会记录跳过原因。签到活动的开放时间、资格和额外奖励以账号的官方返回结果为准。

每篇阅读至少需要 90 秒，默认每账号 5 篇约需 7.5 分钟；多账号和较高篇数会延长总运行时间。本地终端会持续显示任务结果；GitHub Actions 还会把汇总写入该次运行的摘要页。

## 定时运行

仓库的 [Auto 工作流](../.github/workflows/auto.yml) 每天北京时间 06:30 调度，也支持手动选择 `run` 或 `inspect`；GitHub 排队可能延后执行时间。Actions 中把账号及通知凭据设为 Secrets，把阅读开关及篇数设为普通 Variables。

本机可以通过系统的定时任务调用 `npm run checkin`；工作目录应为仓库根目录，并向进程传入需要的环境变量。凭据管理方式应避免把值写进可公开读取的脚本或任务日志。

## 排错与旧活动

- 登录失败：更新对应账号的 Cookie，再用 `inspect` 检查登录和任务状态。
- 通知失败：检查相应配置和网络；Telegram 私聊需先向机器人发送 `/start`，群组或频道需有发送权限。
- 阅读进度未增加：以重新查询的后台进度为准，查看任务结果，不要通过反复并发运行刷同一任务。
- 活动未开放：该账号当前没有可处理活动时跳过，不保证每个账号都有额外奖励。
- 本地抽奖页面流程无法启动浏览器：确认 Chrome 或 Chromium 已安装且可运行，并检查 `PUPPETEER_EXECUTABLE_PATH` 或 `CHROME_PATH` 指向实际可执行文件。
- 本地无法找到 SDK 构建文件：确认已从根目录执行 `npm ci` 和 `npm run build`。

沾喜气、BugFix 和海底掘金是已下线的旧活动。旧 `seagold.js`、相关 SDK 模块和脚本只保留历史兼容用途，当前每日工作流不会执行，不再需要旧版文档中的游戏授权步骤。
