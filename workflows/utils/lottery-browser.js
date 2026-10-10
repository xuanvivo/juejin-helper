const fs = require("node:fs");

const PAGE_URL = "https://juejin.cn/user/center/lottery";
const API_ORIGIN = "https://api.juejin.cn";
const CONFIG_PATH = "/growth_api/v1/lottery_config/get";
const DRAW_PATH = "/growth_api/v1/lottery/draw";
const SINGLE_BUTTON = "#turntable-item-0";
const DEFAULT_TIMEOUT = 30000;

class LotteryBrowserError extends Error {
  constructor(message, code = "LOTTERY_BROWSER_ERROR") {
    super(message);
    this.name = "LotteryBrowserError";
    this.code = code;
  }
}

function chromePath(options) {
  const env = options.env || process.env;
  const configured = options.executablePath || env.PUPPETEER_EXECUTABLE_PATH || env.CHROME_PATH;
  if (configured) return configured;
  const exists = options.existsSync || fs.existsSync;
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].find(exists);
}

/**
 * Opens the official page only when needed. Its own scripts handle requests normally;
 * this helper never creates signatures or retries a possibly completed draw.
 */
function createLotteryBrowser(helper, options = {}) {
  const timeout =
    Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
      ? Math.min(options.timeoutMs, 60000)
      : DEFAULT_TIMEOUT;
  let browser;
  let page;
  let opening;
  let closing;
  let closed = false;
  let busy = false;
  let visited = false;
  let permitSingleDraw = false;
  let permittedRequest;
  const disposed = new WeakSet();

  async function bounded(promise, message, duration = timeout) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new LotteryBrowserError(message)), duration);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function dispose(instance) {
    if (!instance || disposed.has(instance)) return;
    disposed.add(instance);
    try {
      await bounded(
        Promise.resolve().then(() => instance.close()),
        "关闭抽奖浏览器超时",
        Math.min(timeout, 5000)
      );
    } catch {
      // Only terminate the browser process created by this client.
      try {
        instance.process?.()?.kill("SIGKILL");
      } catch {}
    }
  }

  function close() {
    closed = true;
    permitSingleDraw = false;
    if (!closing) closing = dispose(browser);
    return closing;
  }

  function intercept(request) {
    let allow = !closed;
    try {
      const url = new URL(request.url());
      const isDraw = /(?:^|\/)[^/]*draw[^/]*(?:\/|$)/i.test(url.pathname);
      if (isDraw) {
        // The page can start lucky_draw on load at 6000 luck. It stays blocked
        // here, including while an ordinary free single draw is authorized.
        allow =
          !closed &&
          permitSingleDraw &&
          url.origin === API_ORIGIN &&
          url.pathname === DRAW_PATH &&
          request.method() === "POST" &&
          request.frame() === page.mainFrame();
        if (allow) {
          permitSingleDraw = false;
          permittedRequest = request;
        }
      }
    } catch {
      allow = false;
    }
    // Browser shutdown can cancel an interception; never log request objects or URLs.
    Promise.resolve()
      .then(() => (allow ? request.continue() : request.abort("blockedbyclient")))
      .catch(() => {});
  }

  async function ready() {
    if (page) return;
    if (!opening) {
      opening = (async () => {
        const executablePath = chromePath(options);
        if (!executablePath) {
          throw new LotteryBrowserError("未找到 Chrome，请配置 PUPPETEER_EXECUTABLE_PATH 或 CHROME_PATH");
        }
        const entries = Array.from(helper.cookie.entries());
        const cookies = entries.map(([name, value]) => {
          if (typeof name !== "string" || typeof value !== "string" || !name) {
            throw new LotteryBrowserError("浏览器 Cookie 格式无效，请更新掘金 Cookie");
          }
          return { name, value, domain: ".juejin.cn", path: "/", secure: true };
        });
        const launch = options.launch || (settings => require("puppeteer").launch(settings));
        const launched = Promise.resolve().then(() =>
          launch({
            executablePath,
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            timeout,
            protocolTimeout: timeout,
            dumpio: false
          })
        );
        // If startup finishes after a timeout/close, still reap that browser.
        launched.then(
          instance => (closed ? dispose(instance) : undefined),
          () => {}
        );
        browser = await bounded(launched, "启动抽奖浏览器超时");
        if (closed) throw new LotteryBrowserError("抽奖浏览器已关闭");
        page = await bounded(browser.newPage(), "创建抽奖页面超时");
        page.setDefaultTimeout(timeout);
        page.setDefaultNavigationTimeout(timeout);
        await bounded(page.setViewport({ width: 1280, height: 900 }), "设置抽奖页面超时");
        await bounded(page.setRequestInterception(true), "初始化抽奖请求校验超时");
        page.on("request", intercept);
        if (cookies.length) await bounded(page.setCookie(...cookies), "加载掘金 Cookie 超时");
      })();
    }
    await opening;
  }

  function observeResponse(path, method, matchRequest = false) {
    return page
      .waitForResponse(
        response => {
          try {
            const url = new URL(response.url());
            return (
              url.origin === API_ORIGIN &&
              url.pathname === path &&
              response.request().method() === method &&
              (!matchRequest || response.request() === permittedRequest)
            );
          } catch {
            return false;
          }
        },
        { timeout }
      )
      .then(
        response => ({ response }),
        () => ({ error: true })
      );
  }

  async function readResponse(pending, label) {
    const result = await bounded(pending, `${label}响应超时`);
    if (result.error) throw new LotteryBrowserError(`${label}响应超时或页面已关闭`);
    const response = result.response;
    if (response.status() < 200 || response.status() >= 300) {
      throw new LotteryBrowserError(`${label}请求失败，请稍后检查官网`);
    }
    const body = await bounded(response.json(), `${label}响应读取超时`);
    if (!body || typeof body !== "object" || !Number.isSafeInteger(body.err_no)) {
      throw new LotteryBrowserError(`${label}返回格式异常，请检查官网或登录状态`);
    }
    if (body.err_no !== 0) {
      throw new LotteryBrowserError(`${label}失败（错误码 ${body.err_no}），请检查官网或登录状态`);
    }
    return body.data;
  }

  async function freshConfig() {
    await ready();
    permitSingleDraw = false;
    permittedRequest = undefined;
    const response = observeResponse(CONFIG_PATH, "GET");
    const navigation = visited
      ? page.reload({ waitUntil: "domcontentloaded", timeout })
      : page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout });
    await bounded(navigation, "加载官网抽奖页面超时");
    visited = true;
    const config = await readResponse(response, "官网抽奖配置");
    if (
      !config ||
      !Number.isSafeInteger(config.free_count) ||
      config.free_count < 0 ||
      !Array.isArray(config.lottery) ||
      !Number.isFinite(config.point_cost) ||
      config.point_cost < 0
    ) {
      throw new LotteryBrowserError("官网免费抽奖配置不完整，已停止抽奖");
    }
    return config;
  }

  async function exclusive(action) {
    if (closed) throw new LotteryBrowserError("抽奖浏览器已关闭", "LOTTERY_BROWSER_CLOSED");
    if (busy) throw new LotteryBrowserError("抽奖浏览器正在处理请求，请勿并发抽奖");
    busy = true;
    try {
      return await action();
    } catch (error) {
      await close();
      // Puppeteer protocol errors may include cookie values or signed URLs.
      if (error instanceof LotteryBrowserError) throw error;
      throw new LotteryBrowserError("官网抽奖页面操作失败，已停止；请检查 Chrome、网络和登录状态");
    } finally {
      busy = false;
      permitSingleDraw = false;
    }
  }

  return {
    getLotteryConfig() {
      return exclusive(freshConfig);
    },
    drawLottery() {
      return exclusive(async () => {
        const config = await freshConfig();
        if (config.free_count === 0) {
          throw new LotteryBrowserError("官网已无免费抽奖次数，已停止抽奖", "NO_FREE_LOTTERY");
        }
        await bounded(
          page.waitForFunction(
            (selector, freeCount) => {
              const button = document.querySelector(selector);
              const text = button?.querySelector(".text-free")?.textContent || "";
              const count = text.match(/免费抽奖次数\s*[：:]\s*(\d+)\s*次/);
              return (
                button &&
                !button.classList.contains("loading") &&
                count &&
                Number(count[1]) === freeCount &&
                freeCount > 0
              );
            },
            { timeout },
            SINGLE_BUTTON,
            config.free_count
          ),
          "官网未显示可用的免费单抽按钮，已停止抽奖"
        );
        const result = observeResponse(DRAW_PATH, "POST", true);
        permittedRequest = undefined;
        permitSingleDraw = true;
        // Exactly one official click. The request gate consumes this allowance once.
        await bounded(page.click(SINGLE_BUTTON), "免费单抽点击超时，请到官网确认结果；不会自动重试");
        const draw = await readResponse(result, "官网免费单抽");
        if (
          !permittedRequest ||
          !draw ||
          !["string", "number"].includes(typeof draw.lottery_id) ||
          String(draw.lottery_id).trim() === ""
        ) {
          throw new LotteryBrowserError("官网抽奖结果未确认，请到官网检查；不会自动重试");
        }
        return draw;
      });
    },
    close
  };
}

module.exports = { createLotteryBrowser };
