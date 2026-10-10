const { errorMessage } = require("../utils/utils");

// Official article client: ba68fbb.js reports ViewContent (13), JScore (1)
// after 90 seconds of visible reading; 739e8f7.js defines the API and enums.
// https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/ba68fbb.js
const READING_INTERVAL_MS = 90_000;
const MAX_ARTICLES = 10;
const MAX_CANDIDATES = 20;

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;

function taskState(result) {
  if (!isRecord(result) || !isRecord(result.growth_tasks)) {
    throw new Error("阅读任务列表返回格式异常");
  }
  if (!Number.isFinite(result.today_jscore) || result.today_jscore < 0) {
    throw new Error("今日掘友分返回格式异常");
  }

  let readingTask;
  for (const group of Object.values(result.growth_tasks)) {
    if (!Array.isArray(group)) throw new Error("阅读任务分组返回格式异常");
    for (const task of group) {
      if (!isRecord(task) || !isCount(task.task_id)) throw new Error("阅读任务标识返回格式异常");
      if (task.task_id !== 13) continue;
      if (!isCount(task.limit) || !isCount(task.done)) throw new Error("阅读任务次数返回格式异常");
      if (readingTask) throw new Error("阅读任务出现重复定义，已停止执行");
      readingTask = task;
    }
  }
  return { task: readingTask, score: result.today_jscore };
}

function articleId(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && /^[1-9]\d{0,31}$/.test(value) ? value : null;
}

function articleCandidates(result) {
  if (!Array.isArray(result)) throw new Error("推荐文章列表返回格式异常");
  const ids = new Set();
  for (const item of result.slice(0, MAX_CANDIDATES)) {
    if (!isRecord(item) || item.item_type !== 2 || !isRecord(item.item_info)) continue;
    const id = articleId(item.item_info.article_id);
    if (id) ids.add(id);
  }
  return [...ids];
}

function validateArticle(result, id) {
  if (!isRecord(result) || !isRecord(result.article_info)) throw new Error("文章详情返回格式异常");
  const info = result.article_info;
  const returnedIds = [result.article_id, info.article_id].filter(value => value !== undefined);
  if (!returnedIds.length || returnedIds.some(value => articleId(value) !== id)) {
    throw new Error("文章详情与请求的文章不一致，已停止阅读");
  }
  const fields = ["mark_content", "web_html_content", "app_html_content", "content"];
  if (!fields.some(field => Object.prototype.hasOwnProperty.call(info, field))) {
    throw new Error("文章正文返回格式异常");
  }
  if (fields.some(field => info[field] !== undefined && info[field] !== null && typeof info[field] !== "string")) {
    throw new Error("文章正文返回格式异常");
  }
  return fields.some(field => typeof info[field] === "string" && info[field].trim().length > 0);
}

function readingConfig(config) {
  const flag = config.AUTO_READ_ARTICLES;
  if (flag === false || (typeof flag === "string" && flag.trim().toLowerCase() === "false")) {
    return { enabled: false };
  }
  if (
    flag !== undefined &&
    flag !== null &&
    flag !== "" &&
    flag !== true &&
    !(typeof flag === "string" && flag.trim().toLowerCase() === "true")
  ) {
    throw new Error("AUTO_READ_ARTICLES 仅支持 true 或 false");
  }
  const value = config.READING_MAX_ARTICLES;
  const empty = value === undefined || value === null || (typeof value === "string" && !value.trim());
  const maximum = empty ? 5 : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("READING_MAX_ARTICLES 必须为正整数");
  return { enabled: true, maximum: Math.min(maximum, MAX_ARTICLES) };
}

async function reading({ growth, wait, config = {}, log = () => {} }) {
  let initial;
  let current;
  let confirmed = 0;
  let emptyArticles = 0;
  let reportPending = false;
  const progress = () =>
    current && current.task
      ? `已确认阅读 ${confirmed} 篇，任务进度 ${current.task.done}/${current.task.limit}，掘友分变化 +${
          current.score - initial.score
        }`
      : "尚未确认阅读进度";

  try {
    const settings = readingConfig(config);
    if (!settings.enabled) return { status: "skipped", detail: "自动阅读已关闭" };

    initial = current = taskState(await growth.getGrowthTasks());
    if (!current.task || current.task.limit === 0) return { status: "skipped", detail: "当前未开放可执行的阅读任务" };
    if (current.task.done >= current.task.limit) {
      return { status: "skipped", detail: `今日阅读任务已完成（${current.task.done}/${current.task.limit}）` };
    }

    const budget = Math.min(settings.maximum, current.task.limit - current.task.done);
    const candidates = articleCandidates(await growth.getRecommendedArticles());
    if (!candidates.length) return { status: "skipped", detail: `暂无有效推荐文章；${progress()}` };

    for (const id of candidates) {
      if (confirmed >= budget || current.task.done >= current.task.limit) break;
      if (!validateArticle(await growth.getArticleDetail(id), id)) {
        emptyArticles++;
        log(`文章 ${id} 没有有效正文，已跳过`);
        continue;
      }
      await growth.recordArticleVisit(id);
      log(`阅读文章 ${id}，停留 90 秒后核对任务进度`);
      await wait(READING_INTERVAL_MS);

      // Never retry an ambiguous report: the server may already have counted it.
      reportPending = true;
      await growth.reportArticleRead(id);
      const next = taskState(await growth.getGrowthTasks());
      if (!next.task || next.task.limit === 0 || next.task.done < current.task.done || next.score < current.score) {
        throw new Error("阅读任务进度发生变化或跨日，最近一次阅读结果未确认");
      }
      const increased = next.task.done > current.task.done;
      current = next;
      if (!increased) throw new Error("服务端阅读次数未增长，未确认最近一次阅读完成");
      confirmed++;
      reportPending = false;
    }

    if (!confirmed) return { status: "failed", detail: `候选文章均无有效正文，未上报阅读完成；${progress()}` };
    const remaining = Math.max(0, current.task.limit - current.task.done);
    const ending =
      remaining === 0
        ? "今日阅读任务已完成"
        : confirmed >= budget
        ? `达到本次 ${budget} 篇上限，今日还需 ${remaining} 篇`
        : `可用推荐文章不足，今日还需 ${remaining} 篇`;
    const skipped = emptyArticles ? `；跳过 ${emptyArticles} 篇无正文文章` : "";
    return { status: "success", detail: `${progress()}；${ending}${skipped}` };
  } catch (error) {
    const uncertainty = reportPending ? "；最近一次上报结果未确认，请查看掘金任务页" : "";
    return { status: "failed", detail: `${errorMessage(error)}；${progress()}${uncertainty}` };
  }
}

module.exports = { reading };
