import path from "path";
import nodemailer from "nodemailer";
import axios from "axios";
import env from "./env";
import pkg from "../package.json";

export interface NotificationOptions {
  title: string;
  content: string;
  msgtype?: "text" | "html";
}

interface EmailOptions extends NotificationOptions {}
interface DingTalkOptions extends NotificationOptions {}
interface PushPlusOptions extends NotificationOptions {}
interface WeComOptions extends NotificationOptions {}
interface WeiXinOptions extends WeComOptions {}
interface FeiShuOptions extends NotificationOptions {}
interface BarkOptions extends NotificationOptions {}
interface TelegramOptions extends NotificationOptions {}

export interface NotificationResult {
  ok: boolean;
  sent: string[];
  failed: { channel: string; error: string }[];
  skipped: string[];
}

const REQUEST_TIMEOUT = 20000;
const TELEGRAM_MESSAGE_LIMIT = 4096;
const TELEGRAM_MAX_RETRIES = 1;
const TELEGRAM_MAX_RETRY_AFTER = 5;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => {
    const entities: { [character: string]: string } = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

/** Never log Axios errors directly: their config and URL may contain credentials. */
function safeErrorMessage(error: any): string {
  if (error && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")) {
    return "请求超时，请检查网络后重试。";
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return status ? `HTTP ${status}，请检查通知渠道配置。` : "网络请求失败，请检查通知配置和网络连接。";
  }

  let message = typeof error?.message === "string" ? error.message : "未知错误。";
  const secrets = [
    env.TELEGRAM_BOT_TOKEN,
    env.EMAIL_PASS,
    env.PUSHPLUS_TOKEN,
    env.SERVERPUSHKEY,
    env.DINGDING_WEBHOOK,
    env.WEIXIN_WEBHOOK,
    env.FEISHU_WEBHOOK,
    env.BARK_WEBHOOK
  ];
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[凭据已隐藏]");
  }
  return message
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL已隐藏]")
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "[凭据已隐藏]")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 200);
}

/** Check documented business codes without exposing response bodies or credentials. */
function assertResponseCodes(channel: string, data: any, successCodes: { [field: string]: number }) {
  for (const field of Object.keys(successCodes)) {
    const value = data?.[field];
    // Older webhook implementations may omit these fields; preserve their response contract.
    if (value === undefined || value === null) continue;
    const code = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
    if (code === successCodes[field]) continue;
    const detail = Number.isSafeInteger(code) ? `（错误码 ${code}）` : "";
    throw new Error(`${channel} 接口返回失败${detail}，请检查通知配置或服务状态。`);
  }
}

function splitTelegramMessage(message: string): string[] {
  // UTF-16 length is a conservative bound for Telegram's 4096-character limit.
  // Segmenter also keeps family, flag and skin-tone emoji together on Node 16+.
  const Segmenter = (Intl as any).Segmenter;
  const characters: string[] = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(message), (part: any) => part.segment)
    : Array.from(message);
  const chunks: string[] = [];
  let chunk = "";
  for (const character of characters) {
    if (character.length > TELEGRAM_MESSAGE_LIMIT) {
      throw new Error("Telegram 消息中单个组合字符超过长度限制。");
    }
    if (chunk.length + character.length > TELEGRAM_MESSAGE_LIMIT) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export class NotificationKit {
  /**
   * 邮件推送
   * @param options
   */
  async email(options: EmailOptions) {
    const auth: { user: string | undefined; pass: string | undefined } = {
      user: env.EMAIL_USER, // generated ethereal user
      pass: env.EMAIL_PASS // generated ethereal password
    };

    if (!auth.user || !auth.pass || !env.EMAIL_TO) {
      throw new Error("请同时配置 EMAIL_USER、EMAIL_PASS 和 EMAIL_TO。");
    }
    const domain = auth.user.match(/@([^@\s]+)$/);
    if (!domain) {
      throw new Error("EMAIL_USER 邮箱格式无效。");
    }

    const transporter = nodemailer.createTransport({
      host: "smtp." + domain[1],
      secure: true,
      port: 465,
      auth,
      connectionTimeout: REQUEST_TIMEOUT,
      greetingTimeout: REQUEST_TIMEOUT,
      socketTimeout: REQUEST_TIMEOUT,
      tls: {
        // do not fail on invalid certs
        rejectUnauthorized: false
      }
    });

    const template = `
<style>
  .jj-header {
    padding: 10px 0;
    border-bottom: 1px solid #f1f1f1;
  }
  .jj-update-tip {
    display: flex;
    justify-content: space-between;
    padding: 10px;
    font-size: 12px;
    background: #fff4e5;
    color: #663c00;
    text-decoration: none;
  }
  .jj-main {
    padding: 10px;
  }
  .jj-footer {
    padding: 10px 0;
    border-top: 1px solid #f1f1f1;
    text-align: center;
    font-size: 12px;
    color: #6e6e73;
  }
</style>
<section>
  <header class="jj-header">
    <img src="cid:logo.svg" width="120" height="24" alt="稀土掘金" />
  </header>
  ${
    this.newVersion.has
      ? `<a class="jj-update-tip" href="${escapeHtml(
          this.newVersion.url
        )}" target="_blank"><span>稀土掘金助手 ${escapeHtml(this.newVersion.name)} 现在可用 ›</span></a>`
      : ""
  }
  <main class="jj-main">
    ${options.msgtype === "html" ? options.content : `<pre style="margin: 0;">${escapeHtml(options.content)}</pre>`}
  </main>
  <footer class="jj-footer">
    <span>稀土掘金助手v${pkg.version}</span> |
    <span>Copyright © ${new Date().getFullYear()} Derek Li.</span>
  </footer>
</section>
`.trim();

    await transporter.sendMail({
      from: `稀土掘金助手 <${auth.user}>`, // sender address（'"Fred Foo 👻" <foo@example.com>'）
      to: env.EMAIL_TO, // list of receivers
      subject: options.title, // Subject line
      // text, // plain text body
      html: template, // html body
      attachments: [
        {
          filename: "logo.svg",
          path: path.resolve(__dirname, "../resources/logo.svg"),
          cid: "logo.svg" //same cid value as in the html img src
        }
      ]
    });
  }

  /** Telegram Bot API: plain text, bounded retries and credential-safe errors. */
  async telegram(options: TelegramOptions) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      throw new Error("请同时配置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID。");
    }
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error("TELEGRAM_BOT_TOKEN 格式无效，请使用 BotFather 提供的 Token。");
    }
    const threadValue = env.TELEGRAM_MESSAGE_THREAD_ID;
    const threadId = threadValue ? Number(threadValue) : undefined;
    if (threadValue && (!/^[1-9]\d*$/.test(threadValue) || !Number.isSafeInteger(threadId))) {
      throw new Error("TELEGRAM_MESSAGE_THREAD_ID 必须是正整数。");
    }

    const message = `${options.title}\n${options.content}`;
    if (!message.trim()) throw new Error("Telegram 通知内容不能为空。");
    const chunks = splitTelegramMessage(message);
    for (let index = 0; index < chunks.length; index++) {
      let retries = 0;
      while (true) {
        let response;
        try {
          response = await axios.post(
            `https://api.telegram.org/bot${token}/sendMessage`,
            {
              chat_id: chatId,
              text: chunks[index],
              disable_web_page_preview: true,
              ...(threadId === undefined ? {} : { message_thread_id: threadId })
            },
            {
              timeout: REQUEST_TIMEOUT,
              maxRedirects: 0,
              validateStatus: () => true
            }
          );
        } catch (error) {
          // Do not attach the original Axios error as a cause; it contains the Bot Token.
          throw new Error(`Telegram 第 ${index + 1}/${chunks.length} 段发送失败：${safeErrorMessage(error)}`);
        }
        if (response.status >= 200 && response.status < 300 && response.data?.ok === true) break;

        const code = response.status === 429 ? 429 : response.data?.error_code || response.status;
        const retryAfter = response.data?.parameters?.retry_after;
        if (
          code === 429 &&
          retries < TELEGRAM_MAX_RETRIES &&
          Number.isInteger(retryAfter) &&
          retryAfter >= 0 &&
          retryAfter <= TELEGRAM_MAX_RETRY_AFTER
        ) {
          retries++;
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
        const reason = safeErrorMessage({
          message:
            code === 429
              ? "触发限流，已达到自动重试次数或等待时间上限。"
              : response.data?.description || "服务未返回成功状态。"
        });
        // Only accept numeric API error codes; untrusted response text is sanitized above.
        const status = typeof code === "number" ? `（${code}）` : "";
        throw new Error(`Telegram 第 ${index + 1}/${chunks.length} 段发送失败${status}：${reason}`);
      }
    }
    return { messages: chunks.length };
  }

  /**
   * PushPlus推送
   * @param options
   */
  async pushplus(options: PushPlusOptions) {
    const token: string | unknown = env.PUSHPLUS_TOKEN;
    if (!token || token === "") {
      throw new Error("未配置PushPlus Token。");
    }

    const config = {
      token,
      title: options.title,
      content: options.content,
      topic: "",
      template: "html",
      channel: "wechat",
      webhook: "",
      callbackUrl: "",
      timestamp: ""
    };

    const response = await axios.post("http://www.pushplus.plus/send", config, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        "Content-Type": "application/json"
      }
    });
    assertResponseCodes("PushPlus", response.data, { code: 200 });
    return response;
  }

  /**
   * serverPush推送
   * @param options
   */
  async serverPush(options: PushPlusOptions) {
    const token: string | unknown = env.SERVERPUSHKEY;
    if (!token || token === "") {
      throw new Error("未配置Server酱 key。");
    }

    const config = {
      title: options.title,
      desp: options.content,
      channel: "9"
    };

    const response = await axios.post(`https://sctapi.ftqq.com/${token}.send`, config, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        "Content-Type": "application/json"
      }
    });
    assertResponseCodes("Server酱", response.data, { code: 0 });
    return response;
  }

  /**
   * 钉钉Webhook
   * @param options
   */
  async dingtalkWebhook(options: DingTalkOptions) {
    const url: string | unknown = env.DINGDING_WEBHOOK;
    if (!url || url === "") {
      throw new Error("未配置钉钉Webhook。");
    }

    const response = await axios.post(
      url as string,
      {
        msgtype: "text",
        text: {
          content: `${options.title}\n${options.content}`
        }
      },
      { timeout: REQUEST_TIMEOUT }
    );
    assertResponseCodes("钉钉", response.data, { errcode: 0 });
    return response;
  }

  /**
   * 飞书Webhook
   * @param options
   */
  async feishuWebhook(options: FeiShuOptions) {
    const url: string | unknown = env.FEISHU_WEBHOOK;
    if (!url || url === "") {
      throw new Error("未配置飞书Webhook。");
    }

    const response = await axios.post(
      url as string,
      {
        msg_type: "interactive",
        card: {
          elements: [
            {
              tag: "markdown",
              content: options.content,
              text_align: "left"
            }
          ],
          header: {
            template: "blue",
            title: {
              content: options.title,
              tag: "plain_text"
            }
          }
        }
      },
      { timeout: REQUEST_TIMEOUT }
    );
    assertResponseCodes("飞书", response.data, { code: 0, StatusCode: 0 });
    return response;
  }

  /**
   * 企业微信Webhook
   * @param options
   */
  async wecomWebhook(options: WeComOptions) {
    const url: string | unknown = env.WEIXIN_WEBHOOK;
    if (!url || url === "") {
      throw new Error("未配置企业微信Webhook。");
    }

    const response = await axios.post(
      url as string,
      {
        msgtype: "text",
        text: {
          content: `${options.title}\n${options.content}`
        }
      },
      { timeout: REQUEST_TIMEOUT }
    );
    assertResponseCodes("微信", response.data, { errcode: 0 });
    return response;
  }

  async weixinWebhook(options: WeiXinOptions) {
    return this.wecomWebhook(options);
  }

  newVersion = {
    has: false,
    name: pkg.version,
    url: pkg.homepage
  };

  /**
   * BarkWebhook
   * @param options
   */
  async barkWebhook(options: BarkOptions) {
    const url: string | unknown = env.BARK_WEBHOOK;
    if (!url || url === "") {
      throw new Error("未配置BarkWebhook。");
    }

    const barkUrl = url as string;

    const title = encodeURIComponent(options.title);
    const content = encodeURIComponent(options.content);

    const baseUrl = barkUrl.endsWith("/") ? barkUrl : barkUrl + "/";

    const pushUrl = `${baseUrl}${title}/${content}`;

    const response = await axios.get(pushUrl, { timeout: REQUEST_TIMEOUT });
    assertResponseCodes("Bark", response.data, { code: 200 });
    return response;
  }

  async checkupdate() {
    try {
      const result = await axios.get(pkg.releases_url, { timeout: 5000 });
      const data = result.data[0];
      this.newVersion.has = pkg.version < data.tag_name.replace(/^v/, "");
      this.newVersion.name = data.tag_name;
    } catch (e) {}
  }

  async pushMessage(options: NotificationOptions): Promise<NotificationResult> {
    const channels = [
      { name: "邮件", configured: env.EMAIL_USER || env.EMAIL_PASS || env.EMAIL_TO, send: this.email.bind(this) },
      {
        name: "Telegram",
        configured: env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_CHAT_ID || env.TELEGRAM_MESSAGE_THREAD_ID,
        send: this.telegram.bind(this)
      },
      { name: "钉钉", configured: env.DINGDING_WEBHOOK, send: this.dingtalkWebhook.bind(this) },
      { name: "微信", configured: env.WEIXIN_WEBHOOK, send: this.wecomWebhook.bind(this) },
      { name: "PushPlus", configured: env.PUSHPLUS_TOKEN, send: this.pushplus.bind(this) },
      { name: "Server酱", configured: env.SERVERPUSHKEY, send: this.serverPush.bind(this) },
      { name: "飞书", configured: env.FEISHU_WEBHOOK, send: this.feishuWebhook.bind(this) },
      { name: "Bark", configured: env.BARK_WEBHOOK, send: this.barkWebhook.bind(this) }
    ];
    const result: NotificationResult = { ok: true, sent: [], failed: [], skipped: [] };

    if (channels.some(channel => channel.configured)) {
      await this.checkupdate();
      if (this.newVersion.has) {
        console.log(`稀土掘金助手 ${this.newVersion.name} 现在可用`);
      }
    }

    // Await every configured channel, so one failure cannot prevent other deliveries.
    await Promise.all(
      channels.map(async channel => {
        if (!channel.configured) {
          result.skipped.push(channel.name);
          return;
        }
        try {
          await channel.send(options);
          result.sent.push(channel.name);
          console.log(`[${channel.name}]: 消息推送成功!`);
        } catch (error) {
          const message = safeErrorMessage(error);
          result.failed.push({ channel: channel.name, error: message });
          console.log(`[${channel.name}]: 消息推送失败! 原因: ${message}`);
        }
      })
    );
    result.ok = result.failed.length === 0;
    return result;
  }
}

export default new NotificationKit();
