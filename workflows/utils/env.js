const env = process.env || {};
const firstValue = (...values) => values.map(value => (typeof value === "string" ? value.trim() : "")).find(Boolean);

module.exports = {
  /* 掘金Cookie */
  COOKIE: env.COOKIE,
  /* 多用户掘金Cookie, 当有1名以上用户时填写, 支持同时最多可配置5名用户 */
  COOKIE_2: env.COOKIE_2,
  COOKIE_3: env.COOKIE_3,
  COOKIE_4: env.COOKIE_4,
  COOKIE_5: env.COOKIE_5,
  /* run 执行任务，inspect 只读取状态 */
  TASK_MODE: env.TASK_MODE || "run",
  AUTO_READ_ARTICLES: env.AUTO_READ_ARTICLES || "true",
  READING_MAX_ARTICLES: env.READING_MAX_ARTICLES || "5",
  AUTO_LIKE_ARTICLES: env.AUTO_LIKE_ARTICLES || "true",
  AUTO_LIKE_PINS: env.AUTO_LIKE_PINS || "true",
  AUTO_COLLECT_ARTICLES: env.AUTO_COLLECT_ARTICLES || "true",
  AUTO_FOLLOW_USERS: env.AUTO_FOLLOW_USERS || "true",
  AUTO_CLAIM_LUCKY: env.AUTO_CLAIM_LUCKY || "true",
  FOLLOW_USER_IDS: env.FOLLOW_USER_IDS || "",
  COLLECTION_ID: env.COLLECTION_ID || "",
  /**
   * 邮箱配置
   * user 发件人邮箱, pass, 发件人密码, to收件人
   */
  EMAIL_USER: env.EMAIL_USER,
  EMAIL_PASS: env.EMAIL_PASS,
  EMAIL_TO: env.EMAIL_TO,
  /**
   * Telegram Bot 配置；兼容常用的 TG_* 环境变量。
   * 群组 ID 可以是负数；论坛话题可额外配置 message_thread_id。
   */
  TELEGRAM_BOT_TOKEN: firstValue(env.TELEGRAM_BOT_TOKEN, env.TG_BOT_TOKEN),
  TELEGRAM_CHAT_ID: firstValue(env.TELEGRAM_CHAT_ID, env.TG_CHAT_ID, env.TG_USER_ID),
  TELEGRAM_MESSAGE_THREAD_ID: firstValue(env.TELEGRAM_MESSAGE_THREAD_ID),
  /**
   * 钉钉配置
   * https://open.dingtalk.com/document/robots/custom-robot-access
   */
  DINGDING_WEBHOOK: env.DINGDING_WEBHOOK,
  /**
   * PushPlus配置
   * http://www.pushplus.plus/doc/guide/openApi.html
   */
  PUSHPLUS_TOKEN: env.PUSHPLUS_TOKEN,
  /**
   * 企业微信机器人配置
   * https://developer.work.weixin.qq.com/document/path/91770
   */
  WEIXIN_WEBHOOK: env.WEIXIN_WEBHOOK,
  /**
   * server酱推送key
   * https://sct.ftqq.com/sendkey
   */
  SERVERPUSHKEY: env.SERVERPUSHKEY,
  /**
   * 飞书配置
   */
  FEISHU_WEBHOOK: env.FEISHU_WEBHOOK,
  /**
   * Bark配置
   */
  BARK_WEBHOOK: env.BARK_WEBHOOK
};
