const utils = require("../utils/utils");
const { reading } = require("./growth");
const { checkInActivity, growthProgress } = require("./activity");

async function checkIn({ growth }) {
  const checkedIn = await growth.getTodayStatus();
  if (typeof checkedIn !== "boolean") throw new Error("签到状态返回格式异常");
  if (checkedIn) return "今日已签到";

  const result = await growth.checkIn();
  if (!result || !Number.isFinite(result.incr_point)) throw new Error("签到结果返回格式异常，请到掘金确认");
  return `签到成功，+${result.incr_point} 矿石`;
}

async function freeLottery({ growth, helper, wait, createLotteryBrowser, log = () => {} }) {
  const prizes = new Map();
  let drawn = 0;
  let budget;
  let client = growth;
  let browser;

  const getConfig = async () => {
    try {
      return await client.getLotteryConfig();
    } catch (error) {
      if (client !== growth || error.code !== "INVALID_API_RESPONSE" || !helper) throw error;
      log("抽奖配置需要官网页面处理，正在打开抽奖页");
      const create = createLotteryBrowser || require("../utils/lottery-browser").createLotteryBrowser;
      browser = create(helper);
      client = browser;
      return client.getLotteryConfig();
    }
  };

  try {
    // Do not retry a draw on network failure: it may already have consumed the free attempt.
    while (drawn < 10 && (budget === undefined || drawn < budget)) {
      const config = await getConfig();
      if (!config || !Number.isSafeInteger(config.free_count) || config.free_count < 0) {
        throw new Error("免费抽奖次数返回格式异常，已停止抽奖");
      }
      if (budget === undefined) budget = Math.min(config.free_count, 10);
      if (config.free_count === 0 || drawn >= budget) break;

      let result;
      try {
        result = await client.drawLottery();
      } catch (error) {
        if (error.code === "NO_FREE_LOTTERY") break;
        throw error;
      }
      if (!result || result.lottery_id === undefined) throw new Error("抽奖结果返回格式异常，请到掘金确认");
      drawn++;
      const prize = (Array.isArray(config.lottery) ? config.lottery : []).find(
        item => String(item.lottery_id) === String(result.lottery_id)
      );
      const name = result.lottery_name || (prize && prize.lottery_name) || `奖品 ${result.lottery_id}`;
      prizes.set(name, (prizes.get(name) || 0) + 1);
      if (drawn < budget) await wait(1000);
    }
  } catch (error) {
    const completed = drawn
      ? `已确认 ${drawn} 次免费抽奖（${[...prizes].map(([name, count]) => `${name} ×${count}`).join("，")}）；`
      : "";
    throw new Error(`${completed}${utils.errorMessage(error)}`);
  } finally {
    if (browser) await browser.close();
  }

  if (!drawn) return { status: "skipped", detail: "今日暂无免费次数" };
  return `已使用 ${drawn} 次免费机会：${[...prizes].map(([name, count]) => `${name} ×${count}`).join("，")}`;
}

async function counts({ growth }) {
  const result = await growth.getCounts();
  if (!result || !Number.isFinite(result.cont_count) || !Number.isFinite(result.sum_count)) {
    throw new Error("签到统计返回格式异常");
  }
  return `连续 ${result.cont_count} 天，累计 ${result.sum_count} 天`;
}

async function balance({ growth }) {
  const point = await growth.getCurrentPoint();
  if (!Number.isFinite(point)) throw new Error("矿石余额返回格式异常");
  return `${point} 矿石`;
}

async function lucky({ growth }) {
  const result = await growth.getMyLucky();
  if (!result || !Number.isFinite(result.total_value)) throw new Error("幸运值返回格式异常");
  return `${result.total_value}`;
}

const dailyTasks = [
  { name: "每日签到", run: checkIn },
  { name: "签到活动", run: checkInActivity },
  { name: "免费抽奖", run: freeLottery },
  { name: "阅读成长任务", run: reading },
  { name: "掘友成长", run: growthProgress },
  { name: "签到统计", run: counts },
  { name: "矿石余额", run: balance },
  { name: "幸运值", run: lucky }
];

async function runAccount(cookie, index, options = {}) {
  const createHelper = options.createHelper || (() => new (require("juejin-helper"))());
  const account = { name: `账号 ${index + 1}`, tasks: [], ok: true };
  const helper = createHelper();
  const log = options.log || (() => {});

  try {
    try {
      await helper.login(cookie);
      const user = helper.getUser();
      if (!user || !user.user_id) throw new Error("登录失败，请更新掘金 Cookie");
      account.name = user.user_name || account.name;
    } catch (error) {
      account.ok = false;
      account.tasks.push({ name: "登录", status: "failed", detail: `${utils.errorMessage(error)}；请检查 COOKIE` });
      return account;
    }

    const context = {
      growth: helper.growth(),
      helper,
      wait: options.wait || utils.wait,
      config: options.config || {},
      log
    };
    for (const task of options.tasks || dailyTasks) {
      let result;
      try {
        const output = await task.run(context);
        result = typeof output === "string" ? { status: "success", detail: output } : output;
      } catch (error) {
        result = { status: "failed", detail: utils.errorMessage(error) };
      }
      account.tasks.push({ name: task.name, ...result });
      if (result.status === "failed") account.ok = false;
      log(`[${account.name}] ${task.name}：${result.detail}`);
    }
    return account;
  } finally {
    // logout() only clears this helper's local cookie; it does not invalidate the web session.
    try {
      await helper.logout();
    } catch (error) {
      account.ok = false;
      account.tasks.push({ name: "清理会话", status: "failed", detail: utils.errorMessage(error) });
    }
  }
}

module.exports = { checkIn, freeLottery, counts, balance, lucky, dailyTasks, runAccount };
