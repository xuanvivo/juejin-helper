const fs = require("node:fs/promises");
const utils = require("./utils/utils");
const { runAccount } = require("./tasks/daily");

function formatAccount(account) {
  const icons = { success: "✅", skipped: "⏭", failed: "❌" };
  return [
    `掘友：${account.name}`,
    ...account.tasks.map(task => `${icons[task.status]} ${task.name}：${task.detail}`)
  ].join("\n");
}

async function inspect(options = {}) {
  const env = options.env || require("./utils/env");
  const log = options.log || console.log;
  const cookies = utils.getUsersCookie(env);
  if (!cookies.length) throw new Error("未配置有效的 COOKIE");
  const createHelper = options.createHelper || (() => new (require("juejin-helper"))());
  let ok = true;
  for (let index = 0; index < cookies.length; index++) {
    const helper = createHelper();
    try {
      await helper.login(cookies[index]);
      const growth = helper.growth();
      const tasks = await growth.getGrowthTasks();
      const progress = await growth.getGrowthProgress();
      log(
        JSON.stringify(
          { account: index + 1, growth_tasks: tasks.growth_tasks, today_jscore: tasks.today_jscore, progress },
          null,
          2
        )
      );
      for (const [name, fetch] of [
        ["checkin_activity", () => growth.getCheckInActivity()],
        ["today_status_v2", () => growth.getTodayStatusV2()]
      ]) {
        try {
          log(JSON.stringify({ account: index + 1, [name]: await fetch() }, null, 2));
        } catch (error) {
          ok = false;
          log(`${name} 检查失败：${utils.errorMessage(error)}`);
        }
      }
    } catch (error) {
      ok = false;
      log(`账号 ${index + 1} 检查失败：${utils.errorMessage(error)}`);
    } finally {
      try {
        await helper.logout();
      } catch (error) {
        ok = false;
        log(`账号 ${index + 1} 清理会话失败：${utils.errorMessage(error)}`);
      }
    }
  }
  return { ok };
}

async function run(options = {}) {
  const env = options.env || require("./utils/env");
  const notification = options.notification || require("./utils/notification-kit").default;
  const log = options.log || console.log;
  const cookies = utils.getUsersCookie(env);
  const accounts = [];

  for (let index = 0; index < cookies.length; index++) {
    try {
      accounts.push(await runAccount(cookies[index], index, { ...options, log, config: env }));
    } catch (error) {
      accounts.push({
        name: `账号 ${index + 1}`,
        ok: false,
        tasks: [{ name: "运行", status: "failed", detail: utils.errorMessage(error) }]
      });
    }
  }

  const taskSuccess = accounts.length > 0 && accounts.every(account => account.ok);
  const time = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const content = accounts.length
    ? accounts.map(formatAccount).join("\n\n---------------\n\n")
    : "❌ 未配置有效的 COOKIE，请在仓库 Actions Secrets 中添加掘金 Cookie。";
  const message = `${content}\n\n北京时间：${time}`;
  log(message);

  // Wait for every configured channel, including on login/task failure.
  let delivery;
  try {
    delivery = await notification.pushMessage({
      title: taskSuccess ? "掘金每日任务" : "掘金每日任务：需要处理",
      content: message,
      msgtype: "text"
    });
  } catch (error) {
    delivery = { ok: false, sent: [], failed: [{ channel: "通知", error: utils.errorMessage(error) }], skipped: [] };
  }

  if (process.env.GITHUB_STEP_SUMMARY && options.writeSummary !== false) {
    const channels = delivery.sent.length ? `已发送：${delivery.sent.join("、")}` : "没有成功发送的通知渠道";
    const failures = delivery.failed.map(item => `${item.channel}：${item.error}`).join("\n");
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## 掘金每日任务\n\n<pre>${utils.escapeHtml(message)}</pre>\n\n<pre>${utils.escapeHtml(
        channels + (failures ? "\n" + failures : "")
      )}</pre>\n`
    );
  }

  return { ok: taskSuccess && delivery.ok, accounts, delivery, message };
}

if (require.main === module) {
  const env = require("./utils/env");
  (env.TASK_MODE === "inspect" ? inspect() : run())
    .then(result => {
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch(error => {
      console.error(`运行失败：${utils.errorMessage(error)}`);
      process.exitCode = 1;
    });
}

module.exports = { run, inspect, formatAccount };
