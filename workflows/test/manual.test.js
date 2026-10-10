const { test } = require("node:test");
const assert = require("node:assert/strict");
const { manualTasks } = require("../tasks/manual");

test("manual task reminders only read state and list pending profile/mobile/content tasks", async () => {
  let reads = 0;
  const result = await manualTasks({
    growth: {
      getGrowthTasks: async () => {
        reads++;
        return {
          growth_tasks: {
            1: [{ task_id: 15, done: 0, limit: 1 }],
            3: [{ task_id: 13, done: 5, limit: 5 }],
            4: [{ task_id: 1, done: 0, limit: -1 }],
            5: [
              { task_id: 4, done: 0, limit: 1 },
              { task_id: 5, done: 1, limit: 2 },
              { task_id: 7, done: 2, limit: 2 },
              { task_id: 9, done: 0, limit: 2 }
            ]
          }
        };
      }
    }
  });
  assert.equal(reads, 1);
  assert.equal(result.status, "skipped");
  assert.match(result.detail, /上传头像 0\/1/);
  assert.match(result.detail, /登录 App 0\/1/);
  assert.match(result.detail, /发布文章 1\/2/);
  assert.doesNotMatch(result.detail, /评论文章|点赞|阅读/);
});

test("completed manual tasks do not generate reminders and malformed state is rejected", async () => {
  const run = growth_tasks => manualTasks({ growth: { getGrowthTasks: async () => ({ growth_tasks }) } });
  assert.equal((await run({ 1: [{ task_id: 15, done: 1, limit: 1 }] })).status, "success");
  for (const state of [null, [], { 1: {} }, { 1: [{ task_id: 15, done: "0", limit: 1 }] }]) {
    await assert.rejects(run(state), /格式异常/);
  }
});
