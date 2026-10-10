const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkInActivity, growthProgress } = require("../tasks/activity");

test("accounts without a check-in campaign do not call a completion endpoint", async () => {
  const result = await checkInActivity({
    growth: { getTodayStatusV2: async () => ({ check_in_done: true, lt_task_exist: false, extra: null }) }
  });
  assert.equal(result.status, "skipped");
  assert.match(result.detail, /暂无/);
});

test("an empty activity response is ineligible even when a campaign exists", async () => {
  const result = await checkInActivity({
    growth: {
      getTodayStatusV2: async () => ({ lt_task_exist: true }),
      getCheckInActivity: async () => ({})
    }
  });
  assert.equal(result.status, "skipped");
});

test("unknown campaign responses fail without attempting task completion", async () => {
  await assert.rejects(checkInActivity({ growth: { getTodayStatusV2: async () => ({}) } }), /状态返回格式异常/);
  await assert.rejects(
    checkInActivity({
      growth: {
        getTodayStatusV2: async () => ({ lt_task_exist: true }),
        getCheckInActivity: async () => []
      }
    }),
    /详情返回格式异常/
  );
});

test("eligible campaign synchronization reports only the observed balance increase", async () => {
  const events = [];
  let balance = 100;
  const result = await checkInActivity({
    growth: {
      getTodayStatusV2: async () => ({ lt_task_exist: true }),
      getCheckInActivity: async () => ({ lt_task_type: 1 }),
      getCurrentPoint: async () => {
        events.push("balance");
        return balance;
      },
      completeAvailableTasks: async () => {
        events.push("sync");
        balance += 20;
      }
    }
  });
  assert.match(result, /增加 20/);
  assert.deepEqual(events, ["balance", "sync", "balance"]);
});

test("a successful synchronization with no balance change does not claim a reward", async () => {
  const result = await checkInActivity({
    growth: {
      getTodayStatusV2: async () => ({ lt_task_exist: true }),
      getCheckInActivity: async () => ({ lt_task_type: 1 }),
      getCurrentPoint: async () => 100,
      completeAvailableTasks: async () => null
    }
  });
  assert.match(result, /未检测到矿石增加/);
});

test("an ambiguous activity synchronization is not retried", async () => {
  let attempts = 0;
  await assert.rejects(
    checkInActivity({
      growth: {
        getTodayStatusV2: async () => ({ lt_task_exist: true }),
        getCheckInActivity: async () => ({ lt_task_type: 1 }),
        getCurrentPoint: async () => 100,
        completeAvailableTasks: async () => {
          attempts++;
          throw new Error("请求超时");
        }
      }
    }),
    /超时/
  );
  assert.equal(attempts, 1);
});

test("growth summary preserves fractional scores from the official API", async () => {
  assert.equal(
    await growthProgress({ growth: { getGrowthProgress: async () => ({ current_level: 3, current_score: 100.5 }) } }),
    "等级 3，总掘友分 100.5"
  );
  await assert.rejects(growthProgress({ growth: { getGrowthProgress: async () => ({}) } }), /返回格式异常/);
});
