const MANUAL_TASKS = new Map([
  [4, "登录 App"],
  [5, "发布文章"],
  [6, "发布沸点"],
  [7, "评论文章"],
  [8, "评论沸点"],
  [14, "绑定手机"],
  [15, "上传头像"],
  [16, "修改昵称"]
]);

// These tasks need the user's mobile session, profile choice or original content.
// Reading their state must never publish content or fabricate completion reports.
async function manualTasks({ growth }) {
  const result = await growth.getGrowthTasks();
  if (
    !result ||
    !result.growth_tasks ||
    typeof result.growth_tasks !== "object" ||
    Array.isArray(result.growth_tasks)
  ) {
    throw new Error("成长任务列表返回格式异常");
  }
  const pending = [];
  const seen = new Set();
  for (const group of Object.values(result.growth_tasks)) {
    if (!Array.isArray(group)) throw new Error("成长任务分组返回格式异常");
    for (const task of group) {
      if (!task || !MANUAL_TASKS.has(task.task_id)) continue;
      if (!Number.isSafeInteger(task.done) || task.done < 0 || !Number.isSafeInteger(task.limit) || task.limit < 0) {
        throw new Error("手动任务次数返回格式异常");
      }
      if (seen.has(task.task_id)) throw new Error("成长任务出现重复定义");
      seen.add(task.task_id);
      if (task.limit > task.done) pending.push(`${MANUAL_TASKS.get(task.task_id)} ${task.done}/${task.limit}`);
    }
  }
  return pending.length
    ? {
        status: "skipped",
        detail: `需手动参与：${pending.join("，")}；App 任务需在手机端完成，头像及创作互动需自行选择内容`
      }
    : { status: "success", detail: "当前没有待手动处理的成长任务" };
}

module.exports = { manualTasks };
