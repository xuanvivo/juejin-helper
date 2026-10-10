const axios = require("axios");
const { errorMessage } = require("./utils");

/** Response metadata only: never log authentication headers, URLs or article contents. */
function describeResponse(response) {
  const body = response.data;
  return {
    status: response.status,
    content_type: response.headers["content-type"],
    body_type: typeof body,
    body_length: typeof body === "string" ? body.length : undefined,
    keys: body && typeof body === "object" ? Object.keys(body) : [],
    err_no: body && (typeof body.err_no === "number" || /^-?\d+$/.test(body.err_no)) ? body.err_no : undefined,
    data_keys: body && body.data && typeof body.data === "object" ? Object.keys(body.data) : [],
    free_count: body && body.data && Number.isSafeInteger(body.data.free_count) ? body.data.free_count : undefined
  };
}

async function inspectHttp(helper, log) {
  const tokens = helper.getCookieTokens();
  const variants = [
    ["current", { aid: tokens?.aid || "2608", ...(tokens?.uuid ? { uuid: tokens.uuid } : {}) }],
    ["legacy_optional_ids", { aid: "", uuid: "" }]
  ];
  for (const [name, params] of variants) {
    try {
      const response = await axios.get("https://api.juejin.cn/growth_api/v1/lottery_config/get", {
        params,
        headers: { cookie: helper.getCookie(), referer: "https://juejin.cn/", origin: "https://juejin.cn" },
        timeout: 20000,
        maxRedirects: 0
      });
      log(JSON.stringify({ lottery_response: name, ...describeResponse(response) }));
    } catch (error) {
      log(`抽奖配置检查 ${name}：${errorMessage(error)}`);
    }
  }
}

module.exports = { inspectHttp, describeResponse };
