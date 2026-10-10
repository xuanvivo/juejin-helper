/**
 * The web client checks get_today_status v2 and task/get (lt_task_type=1).
 * Its signed-in layout calls task/complete with an empty body; the server
 * decides which conditions are satisfied. There is no fabricated claim API.
 */
async function checkInActivity({ growth }) {
  const status = await growth.getTodayStatusV2();
  if (!status || typeof status.lt_task_exist !== "boolean") {
    throw new Error("签到活动状态返回格式异常");
  }
  if (!status.lt_task_exist) return { status: "skipped", detail: "当前账号暂无签到限时活动" };

  const activity = await growth.getCheckInActivity();
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    throw new Error("签到活动详情返回格式异常");
  }
  if (Object.keys(activity).length === 0) return { status: "skipped", detail: "当前没有适用的签到活动任务" };

  const before = await growth.getCurrentPoint();
  if (!Number.isFinite(before)) throw new Error("活动前矿石余额返回格式异常，未执行同步");
  await growth.completeAvailableTasks();
  const after = await growth.getCurrentPoint();
  if (!Number.isFinite(after)) throw new Error("活动已同步，矿石变化暂未确认");
  const change = after - before;
  return change > 0
    ? `已同步符合条件的活动，矿石余额增加 ${change}`
    : "已同步符合条件的活动，未检测到矿石增加；活动进度以掘金页面为准";
}

async function growthProgress({ growth }) {
  const progress = await growth.getGrowthProgress();
  if (!progress || !Number.isSafeInteger(progress.current_level) || !Number.isFinite(progress.current_score)) {
    throw new Error("掘友成长数据返回格式异常");
  }
  return `等级 ${progress.current_level}，总掘友分 ${progress.current_score}`;
}

module.exports = { checkInActivity, growthProgress };
