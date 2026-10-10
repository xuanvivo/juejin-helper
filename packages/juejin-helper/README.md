# JuejinHelper SDK

本仓库维护的掘金 API SDK，供每日工作流及自定义脚本使用。完整自动任务与 Telegram 配置见 [主文档](https://github.com/xuanvivo/juejin-helper#readme)。

## 使用本仓库版本

使用 Node.js 24 LTS，在完整仓库的根目录执行：

```bash
PUPPETEER_SKIP_DOWNLOAD=true npm ci
npm run build
```

npm workspaces 会把 `juejin-helper` 链接到本目录。仓库内脚本使用 `require("juejin-helper")` 加载本地构建；无需单独安装远端 npm 包。依赖以根 `package-lock.json` 为准，旧 `yarn.lock` 不再维护。

## 签到示例

先通过环境变量提供 `COOKIE`，再在仓库中运行示例。不要把真实 Cookie 写进脚本。

```javascript
const JuejinHelper = require("juejin-helper");

async function main() {
  const cookie = process.env.COOKIE;
  if (!cookie) throw new Error("请通过环境变量提供 COOKIE");

  const helper = new JuejinHelper();
  try {
    await helper.login(cookie);
    const growth = helper.growth();
    const checkedIn = await growth.getTodayStatus();
    if (typeof checkedIn !== "boolean") throw new Error("签到状态返回格式异常");

    if (checkedIn) {
      console.log("今日已签到");
    } else {
      const result = await growth.checkIn();
      console.log("本次签到增加矿石：", result.incr_point);
    }
    console.log("签到统计：", await growth.getCounts());
  } finally {
    await helper.logout();
  }
}

main().catch(() => {
  // 不直接打印请求错误对象，避免输出认证头或凭据。
  console.error("运行失败，请检查 Cookie、网络或官方接口状态");
  process.exitCode = 1;
});
```

每个账号应使用独立的 `JuejinHelper` 实例。`logout()` 清理该实例中的本地 Cookie 和用户状态，不会退出浏览器中的掘金会话。

## 任务与查询接口

通过 `helper.growth()` 获取成长任务接口。API 客户端会检查官方响应中的 `err_no`；登录验证页、异常响应和业务错误会作为失败处理。

| 方法                                               | 用途与调用约束                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `getTodayStatus()`、`checkIn()`                    | 查询今日签到状态、执行签到。先查状态，避免重复提交。                                                              |
| `getLotteryConfig()`、`drawLottery()`              | 查询抽奖配置、提交真实抽奖请求。使用前应检查 `free_count`，每次抽奖前重新确认；不要自动重试结果不明确的抽奖请求。 |
| `getCounts()`、`getCurrentPoint()`、`getMyLucky()` | 查询签到统计、矿石余额和幸运值。                                                                                  |
| `claimLuckyPrize()`                                | 领取幸运值保底奖品。先确认幸运值达到 6000；每次最多一次，不自动重试、不回收奖品。                                 |
| `getGrowthTasks()`、`getGrowthProgress()`          | 读取掘友分任务及进度，用于判断任务上限、已完成数量和提交后的进展。                                                |
| `getRecommendedArticles()`                         | 获取推荐文章。                                                                                                    |
| `getArticleDetail(articleId)`                      | 使用官方服务端渲染阶段的请求参数（`req_from: 0`、`is_pre_load: true`）获取实际正文。                              |
| `recordArticleVisit(articleId)`                    | 正文读取成功后，使用客户端阶段的请求参数（`req_from: 1`、`is_pre_load: false`）记录文章访问。                     |
| `reportArticleRead(articleId)`                     | 提交 `growth_type: 1`、`task_id: 13` 的阅读记录。先获取正文、记录访问，再等待至少 90 秒后调用，随后重新核对进度。 |
| `getCheckInActivity()`、`getTodayStatusV2()`       | 查询账号的签到活动及新版签到状态。                                                                                |
| `completeAvailableTasks()`                         | 按官方页面的流程同步当前可完成任务；是否生效及奖励情况取决于账号活动状态。                                        |

签到活动查询使用官方 `/user_api/v1/task/get` 的 `lt_task_type: 1`，同步接口为 `/user_api/v1/task/complete`。这些接口不保证所有账号都有活动，也不能只根据同步请求成功就认定获得奖励。

SDK 的阅读方法只负责单次 API 调用。仓库 [每日工作流](https://github.com/xuanvivo/juejin-helper/tree/main/workflows) 先获取真实正文，再记录文章访问，随后等待 90 秒并上报、核验进度；同时按剩余任务控制篇数，跳过已完成任务并发送通知。默认每账号每次最多 5 篇，可通过 `READING_MAX_ARTICLES` 设置为 `1` 至 `10`，或用 `AUTO_READ_ARTICLES=false` 关闭。

正文获取与访问记录的两阶段参数见 [官方文章页面脚本](https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/27c3bf4.js)。阅读间隔依据 [官方阅读计时脚本](https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/ba68fbb.js)：停留时间达到 `90000` 毫秒后才提交阅读记录；相关接口与任务枚举见 [官方公共模块](https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/739e8f7.js)。任务同步调用见 [官方页面布局脚本](https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/3d600ad.js)，其用途是同步已满足条件的任务，不能据此推断获得了额外奖励。

## 互动接口

`helper.interaction()` 提供点赞、收藏和关注所需的官方查询与写入接口，任务编排见 `workflows/tasks/engagement.js`。使用前必须查询现有状态，写入后重新检查状态和成长任务进度；SDK 单次请求成功不代表任务已经计分。工作流默认每项每次最多 2 次，可通过 `AUTO_LIKE_ARTICLES`、`AUTO_LIKE_PINS`、`AUTO_COLLECT_ARTICLES`、`AUTO_FOLLOW_USERS` 关闭，或通过 `FOLLOW_USER_IDS`、`COLLECTION_ID` 指定目标。

## 历史活动与兼容接口

沾喜气、BugFix、海底掘金是已下线的旧活动。`dipLucky()`、`bugfix()`、`seagold()` 等旧接口仅为历史兼容保留，当前工作流不会执行，也不再提供游戏授权指引。

`browser()` 与旧埋点 `sdk()` 接口仍保留供已有调用方使用。每日工作流在抽奖配置 API 返回空响应时，使用专用的 Puppeteer 封装打开官方页面，由官网脚本处理请求，并在确认免费机会后执行免费单抽；该封装独立于 SDK 的旧 `browser()` 接口。

GitHub 托管的 Ubuntu 运行器已带 Chrome，安装依赖时保持 `PUPPETEER_SKIP_DOWNLOAD=true`，避免重复下载浏览器。本地如需使用抽奖页面流程，应准备 Chrome 或 Chromium，并可通过 `PUPPETEER_EXECUTABLE_PATH` 或 `CHROME_PATH` 指定可执行文件，配置方法见 [工作流说明](https://github.com/xuanvivo/juejin-helper/blob/main/workflows/README.md#浏览器配置)。

## 开发与许可

离线测试从仓库根目录运行 `npm test`；本目录原有的 `test:*` 示例可能访问真实接口，不属于该离线测试集合。贡献流程见 [CONTRIBUTING.md](https://github.com/xuanvivo/juejin-helper/blob/main/CONTRIBUTING.md)。

基于 [iDerekLi/juejin-helper](https://github.com/iDerekLi/juejin-helper)，感谢 Derek Li 和所有贡献者。

[Apache License 2.0](./LICENSE)
