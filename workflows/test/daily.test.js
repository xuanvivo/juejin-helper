const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkIn, freeLottery, runAccount } = require("../tasks/daily");
const { run, inspect } = require("../checkin");
const utils = require("../utils/utils");

const delivered = { ok: true, sent: ["Telegram"], failed: [], skipped: [] };
const noWait = async () => {};

function helper(overrides = {}) {
  return {
    login: async () => {},
    getUser: () => ({ user_id: "123", user_name: "测试掘友" }),
    growth: () => ({}),
    logout: async () => {},
    ...overrides
  };
}

test("already checked in never submits another check-in", async () => {
  assert.equal(await checkIn({ growth: { getTodayStatus: async () => true } }), "今日已签到");
});

test("check-in reports the actual reward and rejects malformed status", async () => {
  const result = await checkIn({
    growth: { getTodayStatus: async () => false, checkIn: async () => ({ incr_point: 10 }) }
  });
  assert.match(result, /\+10/);
  await assert.rejects(checkIn({ growth: { getTodayStatus: async () => ({}) } }), /状态返回格式异常/);
});

test("zero or unknown free chances never trigger a paid draw", async () => {
  const result = await freeLottery({ growth: { getLotteryConfig: async () => ({ free_count: 0 }) }, wait: noWait });
  assert.equal(result.status, "skipped");
  await assert.rejects(freeLottery({ growth: { getLotteryConfig: async () => ({}) }, wait: noWait }), /停止抽奖/);
});

test("rechecks free chances before every draw, stopping if another session consumed them", async () => {
  let checks = 0;
  let draws = 0;
  const result = await freeLottery({
    growth: {
      getLotteryConfig: async () => ({
        free_count: checks++ === 0 ? 2 : 0,
        lottery: [{ lottery_id: 7, lottery_name: "矿石" }]
      }),
      drawLottery: async () => {
        draws++;
        return { lottery_id: "7" };
      }
    },
    wait: noWait
  });
  assert.equal(checks, 2);
  assert.equal(draws, 1);
  assert.match(result, /矿石 ×1/);
});

test("stale free-count responses cannot cause an unbounded lottery loop", async () => {
  let draws = 0;
  await freeLottery({
    growth: {
      getLotteryConfig: async () => ({ free_count: 1 }),
      drawLottery: async () => {
        draws++;
        return { lottery_id: 7 };
      }
    },
    wait: noWait
  });
  assert.equal(draws, 1);
});

test("an ambiguous failed lottery request is never automatically retried", async () => {
  let draws = 0;
  await assert.rejects(
    freeLottery({
      growth: {
        getLotteryConfig: async () => ({ free_count: 2 }),
        drawLottery: async () => {
          draws++;
          throw new Error("timeout");
        }
      },
      wait: noWait
    }),
    /timeout/
  );
  assert.equal(draws, 1);
});

test("lottery failures retain the prizes already confirmed in this run", async () => {
  let draws = 0;
  await assert.rejects(
    freeLottery({
      growth: {
        getLotteryConfig: async () => ({ free_count: 2 }),
        drawLottery: async () => {
          if (++draws === 2) throw new Error("请求超时");
          return { lottery_id: 7, lottery_name: "随机矿石" };
        }
      },
      wait: noWait
    }),
    /已确认 1 次免费抽奖.*随机矿石 ×1.*请求超时/
  );
  assert.equal(draws, 2);
});

test("a failed task does not prevent subsequent tasks and the session is always cleared", async () => {
  let loggedOut = false;
  const account = await runAccount("test-cookie", 0, {
    createHelper: () =>
      helper({
        logout: async () => {
          loggedOut = true;
        }
      }),
    tasks: [
      {
        name: "失败任务",
        run: async () => {
          throw new Error("服务暂不可用");
        }
      },
      { name: "后续任务", run: async () => "已完成" }
    ]
  });
  assert.equal(account.ok, false);
  assert.deepEqual(
    account.tasks.map(task => task.status),
    ["failed", "success"]
  );
  assert.equal(loggedOut, true);
});

test("login failure still clears local credentials", async () => {
  let cleared = false;
  const account = await runAccount("test-cookie", 0, {
    createHelper: () =>
      helper({
        login: async () => {
          throw new Error("登录过期");
        },
        logout: async () => {
          cleared = true;
        }
      })
  });
  assert.equal(account.ok, false);
  assert.equal(cleared, true);
  assert.match(account.tasks[0].detail, /COOKIE/);
});

test("missing cookies fails explicitly and still sends a notification", async () => {
  let message;
  const result = await run({
    env: {},
    log: () => {},
    writeSummary: false,
    notification: {
      pushMessage: async options => {
        message = options;
        return delivered;
      }
    }
  });
  assert.equal(result.ok, false);
  assert.match(message.content, /未配置有效的 COOKIE/);
  assert.equal(message.msgtype, "text");
});

test("multi-account runner continues after login failure and awaits notification delivery", async () => {
  let count = 0;
  let sent = false;
  const result = await run({
    env: { COOKIE: "expired", COOKIE_2: "valid" },
    log: () => {},
    writeSummary: false,
    createHelper: () =>
      helper({
        login: async () => {
          if (count++ === 0) throw new Error("登录过期");
        }
      }),
    tasks: [{ name: "任务", run: async () => "已完成" }],
    notification: {
      pushMessage: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        sent = true;
        return delivered;
      }
    }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.accounts.map(account => account.ok),
    [false, true]
  );
  assert.equal(sent, true);
  assert.match(result.message, /登录过期/);
  assert.match(result.message, /已完成/);
});

test("delivery failure makes the run fail while retaining successful task results", async () => {
  const result = await run({
    env: { COOKIE: "valid" },
    log: () => {},
    writeSummary: false,
    createHelper: () => helper(),
    tasks: [{ name: "任务", run: async () => "已完成" }],
    notification: {
      pushMessage: async () => ({ ...delivered, ok: false, failed: [{ channel: "Telegram", error: "HTTP 403" }] })
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.accounts[0].ok, true);
});

test("cookie inputs are trimmed, sorted and deduplicated", () => {
  assert.deepEqual(
    utils.getUsersCookie({ COOKIE: " a ", COOKIE_10: "c", COOKIE_2: "b", COOKIE_3: "a", COOKIE_4: " " }),
    ["a", "b", "c"]
  );
});

test("inspect only reads account task status and never calls notification or action methods", async () => {
  const calls = [];
  const data = {
    growth_tasks: { 3: [{ task_id: 13, title: "阅读", done: 0, limit: 5, score: 0.5 }] },
    today_jscore: 0
  };
  const result = await inspect({
    env: { COOKIE: "valid" },
    log: () => {},
    inspectHttp: async () => {},
    createHelper: () =>
      helper({
        growth: () => ({
          getGrowthTasks: async () => {
            calls.push("tasks");
            return data;
          },
          getGrowthProgress: async () => {
            calls.push("progress");
            return { current_level: 3, current_score: 98 };
          },
          getCheckInActivity: async () => {
            calls.push("activity");
            return {};
          },
          getTodayStatusV2: async () => {
            calls.push("status");
            return { check_in_done: true, lt_task_exist: false };
          }
        })
      }),
    notification: {
      pushMessage: async () => {
        throw new Error("inspect must not notify");
      }
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["tasks", "progress", "activity", "status"]);
});

test("network errors never expose authentication headers or token-bearing URLs", () => {
  const message = utils.errorMessage({
    isAxiosError: true,
    message: "https://example.test/secret",
    config: { headers: { Cookie: "secret" } },
    response: { status: 403 }
  });
  assert.equal(message, "请求失败 (HTTP 403)");
  assert.doesNotMatch(utils.errorMessage(new Error("Cookie: first=SECRET; second=ANOTHER")), /SECRET|ANOTHER/);
});
