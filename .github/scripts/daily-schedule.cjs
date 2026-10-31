// Called inside the workflow's concurrency group, so the lookup and task run are serialized.
module.exports = async function checkDailyCompletion({ github, context, core, now = new Date() }) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const completionName = `juejin-daily-${date}`;
  core.setOutput("completion_name", completionName);

  // Explicit manual runs always execute, including inspect and retries after fixing a failure.
  if (context.eventName !== "schedule") {
    core.setOutput("should_run", "true");
    return;
  }

  const artifacts = await github.paginate(github.rest.actions.listArtifactsForRepo, {
    ...context.repo,
    name: completionName,
    per_page: 100
  });
  const completed = artifacts.some(
    artifact =>
      artifact.name === completionName &&
      !artifact.expired &&
      artifact.workflow_run?.head_branch === context.payload.repository.default_branch &&
      artifact.workflow_run?.head_repository_id === context.payload.repository.id
  );
  core.setOutput("should_run", String(!completed));
  const message = completed
    ? `北京时间 ${date} 已成功完成每日任务，本次备用检查跳过。`
    : `北京时间 ${date} 尚无成功记录，执行每日任务。`;
  core.info(message);
  await core.summary.addHeading("每日调度检查").addRaw(message).write();
};
