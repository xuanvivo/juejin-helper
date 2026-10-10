const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { createLotteryBrowser } = require("../utils/lottery-browser");

const API = "https://api.juejin.cn";
const CONFIG = "/growth_api/v1/lottery_config/get";
const DRAW = "/growth_api/v1/lottery/draw";
const SECRET = "mock_cookie_secret=with_equals";
const configuration = free_count => ({ free_count, point_cost: 200, lottery: [{ lottery_id: "prize-1" }] });

function harness(settings = {}) {
  const page = new EventEmitter();
  const frame = {};
  const pending = new Set();
  const state = {
    launches: [],
    cookies: [],
    navigations: [],
    clicks: [],
    requests: [],
    closes: 0,
    kills: 0,
    domChecks: 0
  };
  let index = 0;
  let current;
  function respond(request, body, status = 200) {
    const response = { url: request.url, request: () => request, status: () => status, json: async () => body };
    for (const waiter of pending) {
      if (waiter.predicate(response)) {
        pending.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(response);
      }
    }
  }
  function request(url, method = "GET", requestFrame = frame) {
    return new Promise(resolve => {
      const record = { path: new URL(url).pathname, method, decision: undefined };
      state.requests.push(record);
      const item = {
        url: () => url,
        method: () => method,
        frame: () => requestFrame,
        continue: async () => {
          record.decision = "continue";
          if (record.path === CONFIG) {
            respond(item, { err_no: 0, data: current });
          } else if (record.path === DRAW && !settings.noDrawResponse) {
            respond(item, settings.drawBody || { err_no: 0, data: { lottery_id: "prize-1", lottery_name: "矿石" } });
          }
          resolve(record.decision);
        },
        abort: async () => {
          record.decision = "abort";
          resolve(record.decision);
        }
      };
      page.emit("request", item);
    });
  }
  page.mainFrame = () => frame;
  page.setDefaultTimeout = () => {};
  page.setDefaultNavigationTimeout = () => {};
  page.setViewport = async () => {};
  page.setRequestInterception = async enabled => assert.equal(enabled, true);
  page.setCookie = async (...cookies) => {
    state.cookies = cookies;
    if (settings.cookieError) throw new Error(`Protocol error containing ${SECRET}`);
  };
  page.waitForResponse = (predicate, { timeout }) =>
    new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      waiter.timer = setTimeout(() => {
        pending.delete(waiter);
        reject(new Error(`Timeout waiting at ${API}${DRAW}?signed=${SECRET}`));
      }, timeout);
      pending.add(waiter);
    });
  async function navigate(kind) {
    state.navigations.push(kind);
    if (settings.navigationError) throw new Error(`Navigation error ${SECRET}`);
    if (settings.luckyOnVisit) await request(`${API}/growth_api/v1/lottery_lucky/lucky_draw`, "POST");
    const configs = settings.configs || [configuration(1)];
    current = configs[Math.min(index++, configs.length - 1)];
    await request(`${API}${CONFIG}?aid=2608&a_bogus=mock_signature`);
  }
  page.goto = async url => {
    assert.equal(url, "https://juejin.cn/user/center/lottery");
    await navigate("goto");
  };
  page.reload = async () => navigate("reload");
  page.waitForFunction = async (predicate, _options, selector, freeCount) => {
    state.domChecks++;
    const document = {
      querySelector: queried => {
        assert.equal(queried, "#turntable-item-0");
        return {
          classList: { contains: () => !!settings.domLoading },
          querySelector: () => ({
            textContent: settings.domText === undefined ? `免费抽奖次数：${current.free_count}次` : settings.domText
          })
        };
      }
    };
    const matches = vm.runInNewContext(`(${predicate.toString()})(selector, freeCount)`, {
      document,
      selector,
      freeCount
    });
    if (!matches) throw new Error(`DOM wait failed with ${SECRET}`);
  };
  page.click = async selector => {
    state.clicks.push(selector);
    assert.equal(selector, "#turntable-item-0");
    if (settings.luckyOnClick) await request(`${API}/growth_api/v1/lottery_lucky/lucky_draw`, "POST");
    if (settings.extraRequests) {
      await request(`${API}/growth_api/v1/lottery/ten_draw`, "POST");
      await request(`https://example.invalid${DRAW}`, "POST");
      await request(`${API}${DRAW}`, "GET");
      await request(`${API}${DRAW}`, "POST", {});
    }
    await request(`${API}${DRAW}?a_bogus=mock_signature`, "POST");
    if (settings.extraRequests) await request(`${API}${DRAW}`, "POST");
  };
  const browser = {
    newPage: async () => page,
    close: async () => {
      state.closes++;
      for (const waiter of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Browser closed"));
      }
      pending.clear();
      if (settings.closeError) throw new Error(`Close failed ${SECRET}`);
    },
    process: () => ({
      kill: signal => {
        assert.equal(signal, "SIGKILL");
        state.kills++;
      }
    })
  };
  const helper = {
    cookie: new Map([
      ["sessionid", SECRET],
      ["other", "value"]
    ])
  };
  const options = {
    executablePath: "/mock/chrome",
    timeoutMs: 100,
    launch: async settings => {
      state.launches.push(settings);
      return browser;
    }
  };
  return { state, page, browser, helper, options, request };
}

test("browser client is lazy, scopes cookies to Juejin, and refreshes config on each read", async t => {
  const h = harness({ configs: [configuration(2), configuration(1)] });
  const client = createLotteryBrowser(h.helper, h.options);
  t.after(() => client.close());
  assert.equal(h.state.launches.length, 0);
  assert.equal((await client.getLotteryConfig()).free_count, 2);
  assert.equal((await client.getLotteryConfig()).free_count, 1);
  assert.deepEqual(h.state.navigations, ["goto", "reload"]);
  assert.equal(h.state.launches.length, 1);
  assert.equal(h.state.launches[0].executablePath, "/mock/chrome");
  assert.equal(h.state.launches[0].dumpio, false);
  assert.ok(h.state.cookies.every(cookie => cookie.domain === ".juejin.cn" && cookie.path === "/" && cookie.secure));
  assert.equal(h.state.cookies[0].value, SECRET);
  assert.equal(h.state.clicks.length, 0);
});

test("without a fresh positive free count the browser never authorizes a draw", async () => {
  const h = harness({ configs: [configuration(1), configuration(0)] });
  const client = createLotteryBrowser(h.helper, h.options);
  assert.equal((await client.getLotteryConfig()).free_count, 1);
  await assert.rejects(client.drawLottery(), error => error.code === "NO_FREE_LOTTERY");
  assert.deepEqual(h.state.navigations, ["goto", "reload"]);
  assert.equal(h.state.clicks.length, 0);
  assert.equal(h.state.requests.filter(request => request.path === DRAW).length, 0);
  assert.equal(h.state.closes, 1);
});

test("invalid config or a paid/loading/mismatched DOM button prevents clicking", async () => {
  for (const settings of [
    { configs: [{ free_count: 1 }] },
    { configs: [{ ...configuration(1), free_count: "1" }] },
    { domText: "单抽 200" },
    { domText: "免费抽奖次数：0次" },
    { domText: "免费抽奖次数：2次" },
    { domLoading: true }
  ]) {
    const h = harness(settings);
    const client = createLotteryBrowser(h.helper, h.options);
    await assert.rejects(client.drawLottery());
    assert.equal(h.state.clicks.length, 0);
    assert.equal(h.state.closes, 1);
  }
});

test("request interception blocks unsolicited draws and consumes one single-draw allowance", async t => {
  const h = harness({ extraRequests: true });
  const client = createLotteryBrowser(h.helper, h.options);
  t.after(() => client.close());
  await client.getLotteryConfig();
  assert.equal(await h.request(`${API}${DRAW}`, "POST"), "abort");
  assert.equal(await h.request(`${API}/growth_api/v1/lottery_lucky/lucky_draw`, "POST"), "abort");

  const result = await client.drawLottery();
  assert.equal(result.lottery_id, "prize-1");
  assert.equal(h.state.domChecks, 1);
  assert.equal(h.state.clicks.length, 1);
  const attempts = h.state.requests.filter(request => /draw/.test(request.path));
  assert.equal(attempts.filter(request => request.decision === "continue").length, 1);
  assert.equal(attempts.filter(request => request.decision === "abort").length, 7);
  assert.equal(await h.request(`${API}${DRAW}`, "POST"), "abort");
});

test("automatic lucky prizes stay blocked during page initialization and a free-draw allowance", async t => {
  const h = harness({ luckyOnVisit: true, luckyOnClick: true });
  const client = createLotteryBrowser(h.helper, h.options);
  t.after(() => client.close());
  await client.getLotteryConfig();
  const result = await client.drawLottery();
  assert.equal(result.lottery_id, "prize-1");
  const luckyRequests = h.state.requests.filter(request => request.path.endsWith("/lucky_draw"));
  assert.equal(luckyRequests.length, 3);
  assert.ok(luckyRequests.every(request => request.decision === "abort"));
  assert.equal(h.state.requests.filter(request => request.path === DRAW && request.decision === "continue").length, 1);
});

test("an unsuccessful or unknown draw response closes the client without another click", async () => {
  for (const settings of [
    { drawBody: { err_no: 7003, err_msg: SECRET } },
    { drawBody: { err_no: 0, data: {} } },
    { noDrawResponse: true }
  ]) {
    const h = harness(settings);
    const client = createLotteryBrowser(h.helper, h.options);
    await assert.rejects(client.drawLottery(), error => {
      assert.equal(error.message.includes(SECRET), false);
      assert.equal(error.message.includes("a_bogus"), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    await assert.rejects(client.drawLottery(), error => error.code === "LOTTERY_BROWSER_CLOSED");
    assert.equal(h.state.clicks.length, 1);
    assert.equal(
      h.state.requests.filter(request => request.path === DRAW && request.decision === "continue").length,
      1
    );
    assert.equal(h.state.closes, 1);
  }
});

test("startup/page errors are sanitized and every created browser is closed", async () => {
  for (const settings of [{ cookieError: true }, { navigationError: true }]) {
    const h = harness(settings);
    const client = createLotteryBrowser(h.helper, h.options);
    await assert.rejects(client.getLotteryConfig(), error => !error.message.includes(SECRET));
    await client.close();
    assert.equal(h.state.closes, 1);
    assert.equal(h.state.clicks.length, 0);
  }
  const h = harness();
  const client = createLotteryBrowser(h.helper, {
    ...h.options,
    launch: async () => {
      throw new Error(`Chrome protocol error ${SECRET}`);
    }
  });
  await assert.rejects(client.getLotteryConfig(), error => !error.message.includes(SECRET));
  await client.close();
  assert.equal(h.state.closes, 0);
});

test("close is idempotent, forbids later startup, and can stop its failed browser process", async () => {
  const unused = harness();
  const cold = createLotteryBrowser(unused.helper, unused.options);
  await cold.close();
  await assert.rejects(cold.getLotteryConfig(), error => error.code === "LOTTERY_BROWSER_CLOSED");
  assert.equal(unused.state.launches.length, 0);

  const h = harness({ closeError: true });
  const client = createLotteryBrowser(h.helper, h.options);
  await client.getLotteryConfig();
  await client.close();
  await client.close();
  assert.equal(h.state.closes, 1);
  assert.equal(h.state.kills, 1);
});

test("a browser that finishes starting after a timeout is still reclaimed", async () => {
  const h = harness();
  let completeLaunch;
  const client = createLotteryBrowser(h.helper, {
    ...h.options,
    timeoutMs: 10,
    launch: () => new Promise(resolve => (completeLaunch = resolve))
  });
  await assert.rejects(client.getLotteryConfig(), /启动抽奖浏览器超时/);
  completeLaunch(h.browser);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.closes, 1);
  assert.equal(h.state.navigations.length, 0);
});

test("browser path configuration is honored without depending on this machine's cache", async t => {
  for (const env of [{ PUPPETEER_EXECUTABLE_PATH: "/custom/chrome" }, { CHROME_PATH: "/custom/chrome" }]) {
    const h = harness();
    const client = createLotteryBrowser(h.helper, { ...h.options, executablePath: undefined, env });
    t.after(() => client.close());
    await client.getLotteryConfig();
    assert.equal(h.state.launches[0].executablePath, "/custom/chrome");
  }
  const h = harness();
  const client = createLotteryBrowser(h.helper, {
    ...h.options,
    executablePath: undefined,
    env: {},
    existsSync: () => false
  });
  await assert.rejects(client.getLotteryConfig(), /PUPPETEER_EXECUTABLE_PATH/);
  assert.equal(h.state.launches.length, 0);
});

test("a concurrent call cannot reuse or interrupt the active client's draw allowance", async t => {
  const h = harness();
  const client = createLotteryBrowser(h.helper, h.options);
  t.after(() => client.close());
  const first = client.getLotteryConfig();
  await assert.rejects(client.drawLottery(), /并发抽奖/);
  assert.equal((await first).free_count, 1);
  assert.equal(h.state.closes, 0);
  assert.equal(h.state.clicks.length, 0);
});
