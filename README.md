<p align="center">
  <a href="https://github.com/xuanvivo/juejin-helper">
    <img src="./resources/logo.svg" alt="稀土掘金" width="260" />
  </a>
</p>

# JuejinHelper · 掘金助手

自动处理掘金每日签到、免费抽奖、阅读、点赞、收藏、关注及开放中的签到活动，达到条件后领取幸运值保底奖品，并通过 Telegram 等渠道推送结果。支持 GitHub Actions 定时运行与本地运行。

## 功能

| 功能           | 行为                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 每日签到       | 先检查今日状态，已签到时跳过，汇总接口返回的矿石奖励。                                                                          |
| 免费抽奖       | 每次抽奖前重新检查免费次数；没有免费机会时跳过。抽奖配置接口返回空响应时，通过官方抽奖页面处理免费单抽。                        |
| 阅读掘友分任务 | 按后台任务上限与已完成进度决定剩余数量；每篇获取真实文章内容后等待 90 秒，再提交阅读记录并检查进度。默认每个账号每次最多 5 篇。 |
| 签到活动       | 查询当前账号的限时签到活动，展示实际状态并同步服务端已满足条件的任务；额外奖励以官方返回为准。                                  |
| 统计与通知     | 汇总签到天数、矿石余额、幸运值以及各任务的成功、跳过、失败结果；发送通知并写入 Actions 运行摘要。                               |
| 多账号         | 支持 `COOKIE`、`COOKIE_2` 至 `COOKIE_5`，各账号独立处理；一个任务或账号失败后继续处理其余任务。                                 |

沾喜气、BugFix、海底掘金属于已下线的旧活动，相关代码仅保留用于历史兼容，当前每日流程不执行这些活动。

从 **v1.10.0** 开始，点赞文章、点赞沸点、收藏文章、关注掘友默认开启，每项每天最多 2 次，并受账号任务剩余额度限制。操作前查询已有状态，操作后核对真实状态及任务进度；不会取消已有操作后重新添加。推荐流决定默认候选内容，关注候选为推荐文章的作者；可通过下方变量关闭任务、指定作者或收藏夹。

幸运值达到 **6000** 时，每账号每次运行最多领取 1 次保底奖品，通知中提示到官网“我的收获”处理实物。此操作使用累计幸运值，不执行矿石付费抽奖，也不自动回收奖品或填写收货地址。接口结果不明确时会停止，不重复提交。

App 登录、头像/昵称/手机设置以及发文、发沸点、评论需要移动端会话、个人资料选择或具体内容，当前流程查询剩余进度并在通知中提醒手动参与。

## GitHub Actions 配置

1. 打开本仓库的 [Actions Secrets 设置](https://github.com/xuanvivo/juejin-helper/settings/secrets/actions)，添加下面的 Repository secrets。使用 Fork 时，请在你自己的仓库配置。
2. 打开 [Actions → Auto](https://github.com/xuanvivo/juejin-helper/actions/workflows/auto.yml)，如页面提示，启用工作流。
3. 点击 **Run workflow**，选择 `run` 执行任务，或选择 `inspect` 只查看任务与活动状态。

`Auto` 每天按北京时间 **06:30** 调度，GitHub 排队可能使实际开始时间延后。手动和定时运行使用同一并发组，避免同时处理同一批账号。

| Secret                                         | 用途                                                    |
| ---------------------------------------------- | ------------------------------------------------------- |
| `COOKIE`                                       | 掘金登录 Cookie，运行任务必需。                         |
| `COOKIE_2`、`COOKIE_3`、`COOKIE_4`、`COOKIE_5` | 可选的其他掘金账号，每项放一个账号的 Cookie。           |
| `TELEGRAM_BOT_TOKEN`                           | Telegram 机器人 Token，与 `TELEGRAM_CHAT_ID` 一起配置。 |
| `TELEGRAM_CHAT_ID`                             | 接收通知的私聊、群组或频道 ID；群组 ID 可以是负数。     |
| `TELEGRAM_MESSAGE_THREAD_ID`                   | 可选，群组论坛话题 ID，填写正整数。                     |

Telegram 机器人可通过 [BotFather](https://t.me/BotFather) 创建。私聊接收通知前，先向机器人发送 `/start`；群组或频道接收通知时，先加入机器人并授予发送消息的权限。Token 和 Chat ID 都配置后，`run` 模式会推送任务汇总。

兼容 `TG_BOT_TOKEN`、`TG_CHAT_ID` 和 `TG_USER_ID`；同时配置时，优先使用 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`。长通知会自动分段，支持中文和 emoji。

### 阅读任务设置

在 [Actions Variables 设置](https://github.com/xuanvivo/juejin-helper/settings/variables/actions) 添加普通 Repository variables 即可调整，不需要把它们设为 Secrets。

| Variable               | 默认值 | 说明                                                    |
| ---------------------- | ------ | ------------------------------------------------------- |
| `AUTO_READ_ARTICLES`   | `true` | 设置为 `false` 关闭自动阅读。                           |
| `READING_MAX_ARTICLES` | `5`    | 每个账号每次运行的阅读上限，取值为 `1` 至 `10` 的整数。 |

实际执行数量还受后台剩余任务限制。当天任务已完成时会跳过，提交后会重新读取进度；进度没有增加时会在结果中说明，不把单次 HTTP 请求成功当成任务完成。每篇至少等待 90 秒，默认 5 篇约需 7.5 分钟；增加账号或篇数会相应延长运行。

### 点赞、收藏、关注与保底领奖

在同一处 **Actions Variables** 设置以下选项。所有开关仅接受 `true` 或 `false`。

| Variable                | 默认值 | 说明                                                                |
| ----------------------- | ------ | ------------------------------------------------------------------- |
| `AUTO_LIKE_ARTICLES`    | `true` | 自动点赞推荐文章，每天最多 2 次。                                   |
| `AUTO_LIKE_PINS`        | `true` | 自动点赞推荐沸点，每天最多 2 次。                                   |
| `AUTO_COLLECT_ARTICLES` | `true` | 自动收藏推荐文章，每天最多 2 次。                                   |
| `AUTO_FOLLOW_USERS`     | `true` | 自动关注推荐文章作者，每天最多 2 位，跳过自己和已关注作者。         |
| `AUTO_CLAIM_LUCKY`      | `true` | 幸运值达到 6000 时领取一次保底奖品。                                |
| `FOLLOW_USER_IDS`       | 空     | 可填写作者用户 ID，以逗号或空格分隔；配置后只使用指定名单。         |
| `COLLECTION_ID`         | 空     | 可指定本人收藏夹 ID；留空时使用本人的已有默认收藏夹或第一个收藏夹。 |

脚本会产生真实点赞、收藏和关注记录。收藏不创建新收藏夹，也不更改已有收藏夹的公开范围。多账号默认各自选择已有收藏夹；指定 ID 时，需确保对应账号有权使用。

任务接口的分值与额度可能调整，通知只报告后台确认的完成进度及实际掘友分变化。写请求失败或结果不明确时不会重发；可到掘金页面核对对应操作。

### 其他通知渠道

以下渠道仍可使用，可与 Telegram 同时配置。未配置的渠道会跳过；一个渠道发送失败后仍会等待其他渠道发送完毕。

| Secret             | 用途                                                         |
| ------------------ | ------------------------------------------------------------ |
| `EMAIL_USER`       | 发件邮箱，需要开启 SMTP。                                    |
| `EMAIL_PASS`       | 邮箱的 SMTP 授权码或对应凭据。                               |
| `EMAIL_TO`         | 收件邮箱；多个地址用逗号分隔。邮件通知需同时配置上述三项。   |
| `DINGDING_WEBHOOK` | 钉钉机器人 Webhook。                                         |
| `PUSHPLUS_TOKEN`   | [PushPlus](https://www.pushplus.plus/) Token。               |
| `WEIXIN_WEBHOOK`   | 企业微信机器人 Webhook。                                     |
| `SERVERPUSHKEY`    | [Server 酱](https://sct.ftqq.com/) SendKey。                 |
| `FEISHU_WEBHOOK`   | 飞书机器人 Webhook。                                         |
| `BARK_WEBHOOK`     | [Bark](https://bark.day.app/) 完整推送地址，支持自部署地址。 |

### 查看结果与排错

- `run` 会实际执行任务、发送已配置的通知，并生成 Actions 摘要。任务、登录或通知失败时，工作流会显示失败，请查看对应条目。
- `inspect` 只读取任务、进度和活动状态，在任务步骤日志中输出检查结果；不会执行签到、阅读上报、点赞、收藏、关注、抽奖、领奖或发送通知。
- 显示“暂无签到限时活动”时，表示账号当前未开放对应活动，不代表每日签到失败。
- Cookie 过期时，在 Secrets 中更新对应账号的 Cookie 后重新运行。
- Telegram 未收到通知时，检查任务日志中的 Telegram 结果、两个必填 Secrets、接收会话 ID 和机器人的发言权限；话题 ID 仅用于支持话题的群组。

### 获取 Cookie

登录 [掘金](https://juejin.cn/)，打开浏览器开发者工具的 **Network** 面板，选择一个发送到 `api.juejin.cn` 的请求，在 **Request Headers** 中复制完整的 `Cookie` 值。Cookie 有效期由登录状态决定，过期后需要重新获取。

只把 Cookie 和机器人 Token 放入 Actions Secrets 或本机环境变量；不要写入 `workflows/utils/env.js`、提交到 Git，也不要贴到公开日志或 Issue。

## 本地运行

使用 **Node.js 24 LTS**，在完整仓库的根目录执行。以下交互示例适用于 Bash：

```bash
git clone https://github.com/xuanvivo/juejin-helper.git
cd juejin-helper
PUPPETEER_SKIP_DOWNLOAD=true npm ci
npm run build
npm test
read -rsp '掘金 Cookie: ' COOKIE
printf '\n'
export COOKIE
npm run checkin
```

通知配置同样通过环境变量提供。只检查状态时使用 `TASK_MODE=inspect npm run checkin`；详细设置见 [本地工作流说明](./workflows/README.md)。

工作流使用 npm workspaces 链接并构建本仓库的 SDK。依赖以根目录 `package-lock.json` 为准；两个 `yarn.lock` 仅作为历史文件保留，不再维护。

常规任务直接调用 API；抽奖配置接口返回空响应时，会通过 Puppeteer 打开官方页面，由官网脚本处理请求，并检查免费次数后执行免费单抽。GitHub 托管的 Ubuntu 运行器已带 Chrome，安装时使用 `PUPPETEER_SKIP_DOWNLOAD=true` 跳过重复下载。本地如需使用该页面流程，应安装 Chrome 或 Chromium；可通过 `PUPPETEER_EXECUTABLE_PATH` 或 `CHROME_PATH` 指定浏览器可执行文件，详见 [本地工作流说明](./workflows/README.md#浏览器配置)。

## 开发与致谢

开发说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)，自定义脚本见 [SDK 使用说明](./packages/juejin-helper/README.md)。问题与建议可提交到本仓库的 [Issues](https://github.com/xuanvivo/juejin-helper/issues) 或 [Pull requests](https://github.com/xuanvivo/juejin-helper/pulls)。

本项目基于 [iDerekLi/juejin-helper](https://github.com/iDerekLi/juejin-helper)，感谢原作者 Derek Li 及所有贡献者。

## 许可

[Apache License 2.0](./LICENSE)
