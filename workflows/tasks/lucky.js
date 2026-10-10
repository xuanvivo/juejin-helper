// Official rules: https://api.juejin.cn/growth_api/v1/lottery_config/rules_text
// Rule 2.3 and the official lottery page use 6000 for the guaranteed prize.
// This is separate from the 200-ore draw; never infer eligibility from ore balance.
const LUCKY_THRESHOLD = 6000;

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isLuckyValue = value => Number.isSafeInteger(value) && value >= 0;
const isNonemptyString = value => typeof value === "string" && value.trim().length > 0;

function enabled(config) {
  const value = config.AUTO_CLAIM_LUCKY;
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const flag = value.trim().toLowerCase();
    if (!flag || flag === "true") return true;
    if (flag === "false") return false;
  }
  throw new Error("AUTO_CLAIM_LUCKY 仅支持 true 或 false");
}

async function claimLucky({ growth, config = {} }) {
  if (!enabled(config)) return { status: "skipped", detail: "幸运值保底自动领奖已关闭" };

  const lucky = await growth.getMyLucky();
  if (!isRecord(lucky) || !isLuckyValue(lucky.total_value)) {
    throw new Error("幸运值返回格式异常，已停止保底领奖");
  }
  if (lucky.total_value < LUCKY_THRESHOLD) {
    return { status: "skipped", detail: `幸运值 ${lucky.total_value}/${LUCKY_THRESHOLD}，尚未达到保底领奖条件` };
  }

  let prize;
  try {
    // One submission per task, even if the remaining luck could fund another prize.
    // An unknown result may already be committed: do not retry or switch clients.
    prize = await growth.claimLuckyPrize();
    if (
      !isRecord(prize) ||
      !isNonemptyString(prize.history_id) ||
      !isNonemptyString(prize.lottery_name) ||
      !isLuckyValue(prize.lucky_total_value)
    ) {
      throw new Error("领奖结果返回格式异常");
    }
  } catch {
    throw new Error("保底领奖结果未确认，请到掘金官网“我的收获”核对；不会自动重试");
  }

  return `已领取幸运值保底奖品：${prize.lottery_name.trim()}；剩余幸运值 ${
    prize.lucky_total_value
  }；请到掘金官网“我的收获”查看，实物奖品需填写收货地址`;
}

module.exports = { claimLucky };
