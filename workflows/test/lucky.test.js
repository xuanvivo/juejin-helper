const { test } = require("node:test");
const assert = require("node:assert/strict");
const { claimLucky } = require("../tasks/lucky");

const prize = (remaining = 0) => ({
  history_id: "7250000000000000001",
  lottery_name: "掘金马克杯",
  lucky_total_value: remaining,
  recycle_point: 3000,
  donate_point: 2000
});

function harness(settings = {}) {
  const calls = [];
  const growth = {
    getMyLucky: async () => {
      calls.push("state");
      if (settings.stateError) throw settings.stateError;
      return Object.prototype.hasOwnProperty.call(settings, "state") ? settings.state : { total_value: 6000 };
    },
    claimLuckyPrize: async () => {
      calls.push("claim");
      if (settings.claimError) throw settings.claimError;
      return Object.prototype.hasOwnProperty.call(settings, "prize") ? settings.prize : prize();
    },
    drawLottery: async () => assert.fail("a guaranteed prize must never use an ore/free draw"),
    recycleLottery: async () => assert.fail("the prize must not be recycled for ore"),
    submitAddress: async () => assert.fail("shipping details must remain under user control")
  };
  return { growth, calls };
}

test("below 6000 luck, including the current 1970, only reads eligibility", async () => {
  for (const value of [0, 1970, 5999]) {
    const h = harness({ state: { total_value: value } });
    const result = await claimLucky(h);
    assert.equal(result.status, "skipped");
    assert.match(result.detail, new RegExp(`${value}/6000`));
    assert.deepEqual(h.calls, ["state"]);
  }
});

test("disabled claims make no requests, and invalid flags fail before querying the account", async () => {
  for (const flag of [false, "false", " FALSE "]) {
    const h = harness();
    const result = await claimLucky({ ...h, config: { AUTO_CLAIM_LUCKY: flag } });
    assert.equal(result.status, "skipped");
    assert.match(result.detail, /已关闭/);
    assert.deepEqual(h.calls, []);
  }
  for (const flag of [0, 1, "yes", "0", [], {}]) {
    const h = harness();
    await assert.rejects(claimLucky({ ...h, config: { AUTO_CLAIM_LUCKY: flag } }), /AUTO_CLAIM_LUCKY/);
    assert.deepEqual(h.calls, []);
  }
});

test("default and explicit true claim one prize and preserve the prize for the user", async () => {
  for (const flag of [undefined, null, "", " ", true, "true", " TRUE "]) {
    const h = harness();
    const result = await claimLucky({ ...h, config: { AUTO_CLAIM_LUCKY: flag } });
    assert.match(result, /已领取.*掘金马克杯/);
    assert.match(result, /剩余幸运值 0/);
    assert.match(result, /我的收获.*实物奖品需填写收货地址/);
    assert.deepEqual(h.calls, ["state", "claim"]);
    assert.doesNotMatch(result, /增加.*矿石|回收成功/);
  }
});

test("unknown or malformed lucky states never authorize claiming", async () => {
  const states = [
    undefined,
    null,
    [],
    {},
    6000,
    { total_value: "6000" },
    { total_value: -1 },
    { total_value: 5999.5 },
    { total_value: NaN },
    { total_value: Infinity },
    { total_value: Number.MAX_SAFE_INTEGER + 1 }
  ];
  for (const state of states) {
    const h = harness({ state });
    await assert.rejects(claimLucky(h), /幸运值返回格式异常/);
    assert.deepEqual(h.calls, ["state"]);
  }
});

test("an eligibility request failure does not attempt a claim or open another client", async () => {
  const error = Object.assign(new Error("官网响应异常"), { code: "INVALID_API_RESPONSE" });
  const h = harness({ stateError: error });
  await assert.rejects(
    claimLucky({ ...h, helper: {}, createLotteryBrowser: () => assert.fail("must not open a fallback") }),
    error
  );
  assert.deepEqual(h.calls, ["state"]);
});

test("remaining luck at or above 6000 does not trigger a second claim", async () => {
  const h = harness({ state: { total_value: 12010 }, prize: prize(6010) });
  const result = await claimLucky(h);
  assert.match(result, /已领取.*掘金马克杯/);
  assert.match(result, /剩余幸运值 6010/);
  assert.deepEqual(h.calls, ["state", "claim"]);
});

test("claim failures are never retried, do not expose request data, and cannot switch to a browser", async () => {
  for (const code of ["ECONNABORTED", "INVALID_API_RESPONSE", "API_ERROR"]) {
    const h = harness({
      claimError: Object.assign(new Error("Cookie: mock_secret; https://api.juejin.cn/?token=mock_secret"), { code })
    });
    await assert.rejects(
      claimLucky({ ...h, helper: {}, createLotteryBrowser: () => assert.fail("must not open a fallback") }),
      error => {
        assert.match(error.message, /领奖结果未确认.*我的收获.*不会自动重试/);
        assert.doesNotMatch(error.message, /mock_secret|token|Cookie/);
        assert.equal(error.cause, undefined);
        return true;
      }
    );
    assert.deepEqual(h.calls, ["state", "claim"]);
  }
});

test("a success response without an actual prize record stays unconfirmed and is not retried", async () => {
  const responses = [
    undefined,
    null,
    [],
    {},
    { lucky_total_value: 0 },
    { ...prize(), history_id: undefined },
    { ...prize(), history_id: 123 },
    { ...prize(), history_id: " " },
    { ...prize(), lottery_name: " " },
    { ...prize(), lottery_name: null },
    { ...prize(), lucky_total_value: undefined },
    { ...prize(), lucky_total_value: "0" },
    { ...prize(), lucky_total_value: -1 },
    { ...prize(), lucky_total_value: NaN },
    { ...prize(), lucky_total_value: 0.5 }
  ];
  for (const response of responses) {
    const h = harness({ prize: response });
    await assert.rejects(claimLucky(h), /领奖结果未确认.*不会自动重试/);
    assert.deepEqual(h.calls, ["state", "claim"]);
  }
});
