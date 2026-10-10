const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const axios = require("axios");
const nodemailer = require("nodemailer");
const env = require("../utils/env");
const { NotificationKit } = require("../utils/notification-kit");

const TOKEN = "123456789:mock_bot_token_never_sent_to_telegram";
const MESSAGE = { title: "掘金任务结果", content: "签到成功；用户名 <测试> & [emoji] 🙂" };
const original = {
  post: axios.post,
  get: axios.get,
  createTransport: nodemailer.createTransport,
  log: console.log,
  setTimeout: global.setTimeout,
  env: { ...env }
};
let logs;

beforeEach(() => {
  for (const key of Object.keys(env)) env[key] = undefined;
  logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  // Every network entry point is blocked unless a test explicitly mocks its response.
  axios.post = async () => {
    throw new Error("Unexpected HTTP POST in notification test");
  };
  axios.get = async () => {
    throw new Error("Unexpected HTTP GET in notification test");
  };
  nodemailer.createTransport = () => {
    throw new Error("Unexpected SMTP connection in notification test");
  };
});

afterEach(() => {
  axios.post = original.post;
  axios.get = original.get;
  nodemailer.createTransport = original.createTransport;
  console.log = original.log;
  global.setTimeout = original.setTimeout;
  Object.assign(env, original.env);
});

function telegramConfig() {
  env.TELEGRAM_BOT_TOKEN = TOKEN;
  env.TELEGRAM_CHAT_ID = "-1001234567890";
}

function kitWithoutUpdateCheck() {
  const kit = new NotificationKit();
  kit.checkupdate = async () => {};
  return kit;
}

function successfulResponse() {
  return { status: 200, data: { ok: true, result: { message_id: 1 } } };
}

test("Telegram configuration accepts aliases while canonical values take priority", () => {
  const source = fs.readFileSync(require.resolve("../utils/env"), "utf8");
  const readEnv = values => {
    const context = { process: { env: values }, module: { exports: {} } };
    vm.runInNewContext(source, context);
    return context.module.exports;
  };
  const alias = readEnv({ TG_BOT_TOKEN: ` ${TOKEN} `, TG_USER_ID: " 42 " });
  assert.equal(alias.TELEGRAM_BOT_TOKEN, TOKEN);
  assert.equal(alias.TELEGRAM_CHAT_ID, "42");
  const canonical = readEnv({
    TELEGRAM_BOT_TOKEN: TOKEN,
    TG_BOT_TOKEN: "ignored",
    TELEGRAM_CHAT_ID: "-1001",
    TG_CHAT_ID: "-1002",
    TG_USER_ID: "42",
    TELEGRAM_MESSAGE_THREAD_ID: " 17 "
  });
  assert.equal(canonical.TELEGRAM_BOT_TOKEN, TOKEN);
  assert.equal(canonical.TELEGRAM_CHAT_ID, "-1001");
  assert.equal(canonical.TELEGRAM_MESSAGE_THREAD_ID, "17");
  assert.equal(readEnv({ TELEGRAM_CHAT_ID: " ", TG_CHAT_ID: "-1002" }).TELEGRAM_CHAT_ID, "-1002");
});

test("unconfigured channels are skipped without making any requests", async () => {
  let requests = 0;
  axios.get = axios.post = async () => {
    requests++;
    throw new Error("No request should be made");
  };
  const result = await new NotificationKit().pushMessage(MESSAGE);
  assert.equal(requests, 0);
  assert.equal(result.ok, true);
  assert.deepEqual(result.sent, []);
  assert.deepEqual(result.failed, []);
  assert.equal(result.skipped.length, 8);
  assert.equal(logs.length, 0);
});

test("Telegram sends plain text to a group topic with a timeout and no redirects", async () => {
  telegramConfig();
  env.TELEGRAM_MESSAGE_THREAD_ID = "17";
  const requests = [];
  axios.post = async (...args) => {
    requests.push(args);
    return successfulResponse();
  };
  assert.deepEqual(await new NotificationKit().telegram({ ...MESSAGE, msgtype: "html" }), { messages: 1 });
  assert.equal(requests.length, 1);
  const [url, payload, config] = requests[0];
  assert.equal(url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(payload.chat_id, "-1001234567890");
  assert.equal(payload.message_thread_id, 17);
  assert.equal(payload.text, `${MESSAGE.title}\n${MESSAGE.content}`);
  assert.equal(payload.parse_mode, undefined);
  assert.equal(config.timeout, 20000);
  assert.equal(config.maxRedirects, 0);
});

test("long Telegram messages preserve Unicode and complete emoji at chunk boundaries", async () => {
  telegramConfig();
  const family = "👨‍👩‍👧‍👦";
  const flag = "🇨🇳";
  const content = "a".repeat(4090) + family + flag + "👍🏽".repeat(2050);
  const messages = [];
  axios.post = async (_url, payload) => {
    assert.equal(payload.message_thread_id, undefined);
    messages.push(payload.text);
    return successfulResponse();
  };
  const result = await new NotificationKit().telegram({ title: "标题", content });
  assert.equal(messages.join(""), `标题\n${content}`);
  assert.ok(messages.length > 1);
  assert.equal(result.messages, messages.length);
  assert.equal(messages[0], `标题\n${"a".repeat(4090)}`);
  assert.ok(messages[1].startsWith(family + flag));
  for (const message of messages) {
    assert.ok(message.length <= 4096);
    assert.equal(message.replace(family, "").replace(flag, "").replaceAll("👍🏽", "").includes("\u200d"), false);
    assert.equal(/[\ud800-\udbff]$/.test(message), false);
    assert.equal(/^[\udc00-\udfff]/.test(message), false);
    assert.equal(message.endsWith("👍"), false);
    assert.equal(message.startsWith("🏽"), false);
  }
});

test("incomplete Telegram settings report a failure without blocking another channel", async () => {
  env.TELEGRAM_BOT_TOKEN = TOKEN;
  env.DINGDING_WEBHOOK = "https://example.invalid/dingtalk";
  const requests = [];
  axios.post = async url => {
    requests.push(url);
    return successfulResponse();
  };
  const result = await kitWithoutUpdateCheck().pushMessage(MESSAGE);
  assert.equal(result.ok, false);
  assert.deepEqual(result.sent, ["钉钉"]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].channel, "Telegram");
  assert.match(result.failed[0].error, /TELEGRAM_CHAT_ID/);
  assert.deepEqual(requests, [env.DINGDING_WEBHOOK]);
});

test("invalid Telegram topic IDs are rejected before sending", async () => {
  telegramConfig();
  for (const value of ["0", "-1", "1.5", "abc", "9007199254740992"]) {
    env.TELEGRAM_MESSAGE_THREAD_ID = value;
    await assert.rejects(new NotificationKit().telegram(MESSAGE), /TELEGRAM_MESSAGE_THREAD_ID/);
  }
});

test("Telegram API ok:false is a failure even for HTTP 200 and logs contain no credentials", async () => {
  telegramConfig();
  axios.post = async () => ({
    status: 200,
    data: {
      ok: false,
      error_code: 400,
      description: `Bad Request at https://api.telegram.org/bot${TOKEN}/sendMessage using ${TOKEN}`
    }
  });
  const result = await kitWithoutUpdateCheck().pushMessage(MESSAGE);
  assert.equal(result.ok, false);
  assert.equal(result.failed[0].channel, "Telegram");
  assert.match(result.failed[0].error, /400/);
  const reported = JSON.stringify(result) + logs.join("\n");
  assert.equal(reported.includes(TOKEN), false);
  assert.equal(reported.includes("api.telegram.org"), false);
  assert.equal(
    logs.some(line => line.includes("消息推送成功")),
    false
  );
});

test("Telegram timeout errors omit Axios config, request URL, and the token", async () => {
  telegramConfig();
  axios.post = async () => {
    const error = new Error(`timeout at https://api.telegram.org/bot${TOKEN}/sendMessage`);
    error.code = "ECONNABORTED";
    error.isAxiosError = true;
    error.config = { url: `https://api.telegram.org/bot${TOKEN}/sendMessage` };
    throw error;
  };
  await assert.rejects(new NotificationKit().telegram(MESSAGE), error => {
    assert.match(error.message, /超时/);
    assert.equal(String(error.stack).includes(TOKEN), false);
    assert.equal(error.config, undefined);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("Telegram honors a short retry_after once and awaits the retried request", async () => {
  telegramConfig();
  let requests = 0;
  const delays = [];
  global.setTimeout = (callback, delay) => {
    delays.push(delay);
    callback();
    return 0;
  };
  axios.post = async () => {
    requests++;
    return requests === 1
      ? { status: 429, data: { ok: false, error_code: 429, parameters: { retry_after: 2 } } }
      : successfulResponse();
  };
  await new NotificationKit().telegram(MESSAGE);
  assert.equal(requests, 2);
  assert.deepEqual(delays, [2000]);
});

test("Telegram does not retry indefinitely or wait beyond the configured bound", async () => {
  telegramConfig();
  const delays = [];
  global.setTimeout = (callback, delay) => {
    delays.push(delay);
    callback();
    return 0;
  };
  let requests = 0;
  axios.post = async () => {
    requests++;
    return { status: 429, data: { ok: false, parameters: { retry_after: 1 } } };
  };
  await assert.rejects(new NotificationKit().telegram(MESSAGE), /限流/);
  assert.equal(requests, 2);
  assert.deepEqual(delays, [1000]);

  for (const retryAfter of [6, 120, -1, "2", undefined]) {
    requests = 0;
    delays.length = 0;
    axios.post = async () => {
      requests++;
      return { status: 429, data: { ok: false, parameters: { retry_after: retryAfter } } };
    };
    await assert.rejects(new NotificationKit().telegram(MESSAGE), /限流/);
    assert.equal(requests, 1);
    assert.deepEqual(delays, []);
  }
});

test("Telegram rejects HTTP errors without retrying an uncertain delivery", async () => {
  telegramConfig();
  for (const status of [401, 403, 500]) {
    let requests = 0;
    axios.post = async () => {
      requests++;
      return { status, data: { ok: false, description: "Request failed" } };
    };
    await assert.rejects(new NotificationKit().telegram(MESSAGE), new RegExp(String(status)));
    assert.equal(requests, 1);
  }
});

test("pushMessage waits for successful channels even when another channel fails", async () => {
  telegramConfig();
  env.EMAIL_USER = "sender@example.invalid";
  env.EMAIL_PASS = "mock_smtp_password";
  env.EMAIL_TO = "reader@example.invalid";
  const kit = kitWithoutUpdateCheck();
  let finishTelegram;
  let startedTelegram;
  const started = new Promise(resolve => {
    startedTelegram = resolve;
  });
  const pending = new Promise(resolve => {
    finishTelegram = resolve;
  });
  kit.telegram = async () => {
    startedTelegram();
    await pending;
  };
  kit.email = async () => {
    throw new Error(`SMTP failed for ${env.EMAIL_PASS}`);
  };
  let settled = false;
  const sending = kit.pushMessage(MESSAGE).then(result => {
    settled = true;
    return result;
  });
  await started;
  assert.equal(settled, false);
  finishTelegram();
  const result = await sending;
  assert.equal(result.ok, false);
  assert.deepEqual(result.sent, ["Telegram"]);
  assert.equal(result.failed[0].channel, "邮件");
  assert.equal(JSON.stringify(result).includes(env.EMAIL_PASS), false);
  assert.equal(logs.join("\n").includes(env.EMAIL_PASS), false);
});

test("email escapes plain text and legacy channels retain bounded requests", async () => {
  telegramConfig();
  Object.assign(env, {
    EMAIL_USER: "sender@example.invalid",
    EMAIL_PASS: "mock_smtp_password",
    EMAIL_TO: "reader@example.invalid",
    DINGDING_WEBHOOK: "https://example.invalid/dingtalk",
    WEIXIN_WEBHOOK: "https://example.invalid/wecom",
    PUSHPLUS_TOKEN: "mock_pushplus_token",
    SERVERPUSHKEY: "mock_server_key",
    FEISHU_WEBHOOK: "https://example.invalid/feishu",
    BARK_WEBHOOK: "https://example.invalid/bark"
  });
  const timeouts = [];
  let email;
  nodemailer.createTransport = config => {
    assert.equal(config.connectionTimeout, 20000);
    assert.equal(config.greetingTimeout, 20000);
    assert.equal(config.socketTimeout, 20000);
    return {
      sendMail: async message => {
        email = message;
      }
    };
  };
  axios.post = async (_url, _payload, config) => {
    timeouts.push(config.timeout);
    return successfulResponse();
  };
  axios.get = async (_url, config) => {
    timeouts.push(config.timeout);
    return successfulResponse();
  };
  const result = await kitWithoutUpdateCheck().pushMessage(MESSAGE);
  assert.equal(result.ok, true);
  assert.equal(result.sent.length, 8);
  assert.equal(result.skipped.length, 0);
  assert.equal(timeouts.length, 7);
  assert.ok(timeouts.every(timeout => timeout === 20000));
  assert.ok(email.html.includes("&lt;测试&gt; &amp;"));
  assert.equal(email.html.includes("用户名 <测试>"), false);
});

test("legacy channels reject documented business errors even when HTTP succeeds", async () => {
  const cases = [
    ["serverPush", "SERVERPUSHKEY", { code: 40001 }],
    ["dingtalkWebhook", "DINGDING_WEBHOOK", { errcode: 310000 }],
    ["wecomWebhook", "WEIXIN_WEBHOOK", { errcode: 40058 }],
    ["weixinWebhook", "WEIXIN_WEBHOOK", { errcode: 40058 }],
    ["pushplus", "PUSHPLUS_TOKEN", { code: 401 }],
    ["barkWebhook", "BARK_WEBHOOK", { code: 400 }],
    ["feishuWebhook", "FEISHU_WEBHOOK", { code: 9499 }],
    ["feishuWebhook", "FEISHU_WEBHOOK", { StatusCode: 9499 }],
    ["feishuWebhook", "FEISHU_WEBHOOK", { code: 0, StatusCode: 9499 }]
  ];
  for (const [method, setting, data] of cases) {
    env[setting] = "https://example.invalid/mock-credential";
    axios.post = axios.get = async () => ({ status: 200, data });
    await assert.rejects(new NotificationKit()[method](MESSAGE), /接口返回失败/);
  }
});

test("legacy successful or omitted business codes preserve the original response", async () => {
  const cases = [
    ["serverPush", "SERVERPUSHKEY", { code: 0 }],
    ["dingtalkWebhook", "DINGDING_WEBHOOK", { errcode: 0 }],
    ["wecomWebhook", "WEIXIN_WEBHOOK", { errcode: 0 }],
    ["pushplus", "PUSHPLUS_TOKEN", { code: 200 }],
    ["barkWebhook", "BARK_WEBHOOK", { code: 200 }],
    ["feishuWebhook", "FEISHU_WEBHOOK", { code: 0 }],
    ["feishuWebhook", "FEISHU_WEBHOOK", { StatusCode: 0 }],
    ["feishuWebhook", "FEISHU_WEBHOOK", { code: 0, StatusCode: 0 }]
  ];
  for (const [method, setting, success] of cases) {
    env[setting] = "https://example.invalid/mock-credential";
    const stringCodes = Object.fromEntries(Object.entries(success).map(([key, value]) => [key, String(value)]));
    for (const data of [success, stringCodes, {}]) {
      const response = { status: 200, data };
      axios.post = axios.get = async () => response;
      assert.equal(await new NotificationKit()[method](MESSAGE), response);
    }
  }
});

test("a Server酱 business error is reported safely while Telegram still succeeds", async () => {
  telegramConfig();
  env.SERVERPUSHKEY = "mock_server_key";
  axios.post = async url => {
    if (url.startsWith("https://sctapi.ftqq.com/")) {
      return {
        status: 200,
        data: { code: 40001, message: `Invalid key ${env.SERVERPUSHKEY}; token ${TOKEN}; URL ${url}` }
      };
    }
    assert.equal(url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
    return successfulResponse();
  };
  const result = await kitWithoutUpdateCheck().pushMessage(MESSAGE);
  assert.equal(result.ok, false);
  assert.deepEqual(result.sent, ["Telegram"]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].channel, "Server酱");
  assert.match(result.failed[0].error, /40001/);
  const reported = JSON.stringify(result) + logs.join("\n");
  assert.equal(reported.includes(env.SERVERPUSHKEY), false);
  assert.equal(reported.includes(TOKEN), false);
  assert.equal(reported.includes("sctapi.ftqq.com"), false);
});
