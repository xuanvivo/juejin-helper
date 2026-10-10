const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApiClient } = require("../../packages/juejin-helper/src/services/api");
const Cookie = require("../../packages/juejin-helper/src/utils/cookie").default;
const { parseCookieTokens } = require("../../packages/juejin-helper/src/utils/parse-cookietokens");
const Growth = require("../../packages/juejin-helper/src/growth").default;

const response = (data, config) => ({ data, config, status: 200, statusText: "OK", headers: {} });

test("API responses reject login challenge HTML and business errors instead of reporting success", async () => {
  const client = createApiClient();
  client.defaults.adapter = async config => response("<html>challenge</html>", config);
  await assert.rejects(client.get("/test"), /返回格式异常/);
  client.defaults.adapter = async config => response({ err_no: 403, err_msg: "登录过期" }, config);
  await assert.rejects(client.get("/test"), /登录过期/);
  client.defaults.adapter = async config => response({ err_no: 0, data: false }, config);
  assert.equal(await client.get("/test"), false);
  assert.equal(client.defaults.timeout, 20000);
});

test("cookies preserve embedded equals signs and do not require spaces after semicolons", () => {
  const cookie = new Cookie("session=token==;other=value; third=three");
  assert.equal(cookie.get("session"), "token==");
  assert.equal(cookie.get("other"), "value");
  assert.equal(cookie.get("third"), "three");
});

test("missing or malformed optional analytics tokens do not prevent login", () => {
  assert.equal(parseCookieTokens(new Cookie("session=valid")).aid, "2608");
  const tokens = parseCookieTokens(new Cookie("session=valid; __tea_cookie_tokens_2608=invalid%"));
  assert.equal(tokens.uuid, "");
});

test("encoded analytics identifiers are parsed without corrupting cookies", () => {
  const value = encodeURIComponent(encodeURIComponent(JSON.stringify({ user_unique_id: "uid", web_id: "web" })));
  const tokens = parseCookieTokens(new Cookie(`__tea_cookie_tokens_2608=${value}`));
  assert.equal(tokens.uuid, "uid");
  assert.equal(tokens.web_id, "web");
});

test("growth client carries auth only in headers and uses the official reading payload", async () => {
  let request;
  const growth = new Growth({ user: {}, getCookie: () => "session=private", getCookieTokens: () => null });
  growth.http.defaults.adapter = async config => {
    request = config;
    return response({ err_no: 0, data: null }, config);
  };
  await growth.reportArticleRead("12345");
  assert.equal(request.headers.cookie, "session=private");
  assert.equal(request.params.aid, "2608");
  assert.equal(request.url, "/growth_api/v1/user_growth/add_point_report");
  assert.deepEqual(JSON.parse(request.data), { growth_type: 1, task_id: 13, item_id: "12345" });
  assert.doesNotMatch(request.url, /private/);
});

test("article content and view tracking use the separate official request modes", async () => {
  const requests = [];
  const growth = new Growth({ user: {}, getCookie: () => "session=private", getCookieTokens: () => null });
  growth.http.defaults.adapter = async config => {
    requests.push(JSON.parse(config.data));
    return response({ err_no: 0, data: {} }, config);
  };
  await growth.getArticleDetail("12345");
  await growth.recordArticleVisit("12345");
  assert.deepEqual(requests, [
    {
      article_id: "12345",
      req_from: 0,
      client_type: 2608,
      forbid_count: true,
      is_pre_load: true,
      need_theme: true,
      prefer_html: true
    },
    { article_id: "12345", req_from: 1, client_type: 2608, forbid_count: false, is_pre_load: false, need_theme: true }
  ]);
});

test("existing v1 calls retain legacy identifiers while new task calls use parsed identifiers", async () => {
  const requests = [];
  const growth = new Growth({
    user: {},
    getCookie: () => "session=private",
    getCookieTokens: () => ({ aid: "2608", uuid: "parsed-id" })
  });
  growth.http.defaults.adapter = async config => {
    requests.push({ url: config.url, params: config.params });
    return response({ err_no: 0, data: {} }, config);
  };
  await growth.getCounts();
  await growth.getCurrentPoint();
  await growth.getTodayStatus();
  await growth.getByMonth();
  await growth.getLotteryConfig();
  await growth.drawLottery();
  await growth.checkIn();
  await growth.getLotteriesLuckyUsers();
  await growth.dipLucky(123);
  await growth.getMyLucky();
  await growth.getGrowthTasks();
  await growth.getTodayStatusV2();
  assert.deepEqual(
    requests.map(request => request.params),
    [
      ...Array.from({ length: 10 }, () => ({ aid: "", uuid: "" })),
      { aid: "2608", uuid: "parsed-id" },
      { aid: "2608", uuid: "parsed-id" }
    ]
  );
});
