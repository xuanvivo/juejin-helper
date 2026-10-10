const { errorMessage, wait: defaultWait } = require("../utils/utils");

// Current official client: 323b510.js (digg/follow API and descriptor fields),
// @byted-juejin/article-suspended-panel@0.1.1 (collection selection payload).
// Never undo an existing interaction or retry a mutation to obtain task credit.
const DAILY_MAX = 2;
const MAX_CANDIDATES = 20;
const MAX_COLLECTION_PAGES = 5;
const INTERACTION_INTERVAL_MS = 3000;
const PROGRESS_INTERVAL_MS = 2000;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;

function identifier(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && /^[1-9]\d{0,31}$/.test(value) ? value : null;
}

function enabled(config, key) {
  const value = config[key];
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === "true";
  throw new Error(`${key} 仅支持 true 或 false`);
}

function configuredIds(value) {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string") throw new Error("FOLLOW_USER_IDS 必须为逗号或空白分隔的用户 ID");
  const ids = value.trim() ? value.trim().split(/[,\s]+/) : [];
  if (ids.some(id => !identifier(id))) throw new Error("FOLLOW_USER_IDS 含有无效用户 ID");
  const unique = [...new Set(ids)];
  if (unique.length > MAX_CANDIDATES) throw new Error(`FOLLOW_USER_IDS 最多支持 ${MAX_CANDIDATES} 个用户`);
  return unique;
}

function taskState(result, taskId) {
  if (!isRecord(result) || !isRecord(result.growth_tasks)) throw new Error("互动任务列表返回格式异常");
  if (!Number.isFinite(result.today_jscore) || result.today_jscore < 0) throw new Error("今日掘友分返回格式异常");
  let found;
  for (const group of Object.values(result.growth_tasks)) {
    if (!Array.isArray(group)) throw new Error("互动任务分组返回格式异常");
    for (const task of group) {
      if (!isRecord(task) || !isCount(task.task_id)) throw new Error("互动任务标识返回格式异常");
      if (task.task_id !== taskId) continue;
      if (found) throw new Error("互动任务出现重复定义，已停止执行");
      if (!isCount(task.done) || !isCount(task.limit)) throw new Error("互动任务次数返回格式异常");
      found = task;
    }
  }
  return { task: found, score: result.today_jscore };
}

function consistent(previous, next) {
  if (
    !next.task ||
    next.task.limit !== previous.task.limit ||
    next.task.done < previous.task.done ||
    next.score < previous.score
  ) {
    throw new Error("互动任务进度发生变化或跨日，已停止执行");
  }
}

function sameIdentity(result, id, nestedKey, idKey, label) {
  if (!isRecord(result)) throw new Error(`${label}详情返回格式异常`);
  const nested = nestedKey && isRecord(result[nestedKey]) ? result[nestedKey] : {};
  const returnedIds = [result[idKey], nested[idKey]].filter(value => value !== undefined);
  if (!returnedIds.length || returnedIds.some(value => identifier(value) !== id)) {
    throw new Error(`${label}详情与请求 ID 不一致，已停止操作`);
  }
}

function interactionFlag(result, key, label) {
  if (!isRecord(result.user_interact) || typeof result.user_interact[key] !== "boolean") {
    throw new Error(`${label}状态返回格式异常，未执行重复操作`);
  }
  return result.user_interact[key];
}

function articleCandidates(result, authors = false) {
  if (!Array.isArray(result)) throw new Error("推荐文章列表返回格式异常");
  const ids = new Set();
  for (const item of result.slice(0, MAX_CANDIDATES)) {
    if (!isRecord(item) || item.item_type !== 2 || !isRecord(item.item_info)) continue;
    const info = item.item_info;
    const value =
      authors && isRecord(info.author_user_info) ? info.author_user_info.user_id : authors ? null : info.article_id;
    const id = identifier(value);
    if (id) ids.add(id);
  }
  return [...ids];
}

function pinCandidates(result) {
  if (!Array.isArray(result)) throw new Error("推荐沸点列表返回格式异常");
  const ids = new Set();
  for (const item of result.slice(0, MAX_CANDIDATES)) {
    if (!isRecord(item)) continue;
    const id = identifier(item.msg_id || (isRecord(item.msg_Info) && item.msg_Info.msg_id));
    if (id) ids.add(id);
  }
  return [...ids];
}

async function findCollection(interaction, articleId, collectionId) {
  let cursor = "0";
  const cursors = new Set([cursor]);
  for (let page = 0; page < MAX_COLLECTION_PAGES; page++) {
    const result = await interaction.getCollectionSets(articleId, cursor);
    if (!isRecord(result) || !Array.isArray(result.collections) || typeof result.has_more !== "boolean") {
      throw new Error("收藏夹列表返回格式异常");
    }
    for (const item of result.collections) {
      if (!isRecord(item) || !identifier(item.collection_id)) throw new Error("收藏夹标识返回格式异常");
    }
    const collection = collectionId
      ? result.collections.find(item => identifier(item.collection_id) === collectionId)
      : result.collections.find(item => item.is_default === true) || result.collections[0];
    if (collection) return collection;
    if (!result.has_more) return null;
    if (
      typeof result.cursor !== "string" ||
      !result.cursor ||
      result.cursor.length > 512 ||
      cursors.has(result.cursor)
    ) {
      throw new Error("收藏夹分页返回格式异常");
    }
    cursor = result.cursor;
    cursors.add(cursor);
  }
  throw new Error("前 100 个收藏夹中未找到指定收藏夹，请检查 COLLECTION_ID");
}

async function runtime(context, interaction, kind, settings) {
  const articleState = async (id, key) => {
    const result = await interaction.getArticle(id);
    sameIdentity(result, id, "article_info", "article_id", "文章");
    return interactionFlag(result, key, "文章互动");
  };
  if (kind === "pins") {
    return {
      candidates: pinCandidates(await interaction.getRecommendedPins()),
      state: async id => {
        const result = await interaction.getPin(id);
        sameIdentity(result, id, "msg_Info", "msg_id", "沸点");
        return interactionFlag(result, "is_digg", "沸点点赞");
      },
      perform: id => interaction.likePin(id)
    };
  }
  if (kind === "follow") {
    const user = context.helper && context.helper.getUser ? context.helper.getUser() : null;
    const ownId =
      identifier(user && user.user_id) || identifier(interaction.getCurrentUserId && interaction.getCurrentUserId());
    if (!ownId) throw new Error("无法确认当前账号 ID，已停止关注任务");
    const ids = settings.userIds.length
      ? settings.userIds
      : articleCandidates(await context.growth.getRecommendedArticles(), true);
    return {
      candidates: ids.filter(id => id !== ownId),
      state: async id => {
        const result = await interaction.getUser(id);
        sameIdentity(result, id, null, "user_id", "用户");
        if (typeof result.isfollowed !== "boolean") throw new Error("用户关注状态返回格式异常");
        return result.isfollowed;
      },
      perform: id => interaction.followUser(id)
    };
  }
  if (kind === "collect") {
    const collection = await findCollection(interaction, "", settings.collectionId);
    if (!collection) {
      if (settings.collectionId) throw new Error("当前账号没有指定的 COLLECTION_ID 收藏夹");
      return { skip: "当前账号没有可用收藏夹，请先在掘金创建收藏夹" };
    }
    const collectionId = identifier(collection.collection_id);
    return {
      candidates: articleCandidates(await context.growth.getRecommendedArticles()),
      state: async (id, afterWrite = false) => {
        const collected = await articleState(id, "is_collect");
        // Existing collections are left untouched, including other collections.
        if (collected && !afterWrite) return true;
        const member = await findCollection(interaction, id, collectionId);
        if (!member || typeof member.is_article_in !== "boolean") throw new Error("收藏夹成员状态返回格式异常");
        return afterWrite ? collected && member.is_article_in : collected || member.is_article_in;
      },
      perform: id => interaction.collectArticle(id, collectionId)
    };
  }
  return {
    candidates: articleCandidates(await context.growth.getRecommendedArticles()),
    state: id => articleState(id, "is_digg"),
    perform: id => interaction.likeArticle(id)
  };
}

async function engagement(context, spec) {
  const { growth, config = {}, log = () => {} } = context;
  const wait = context.wait || defaultWait;
  let initial;
  let current;
  let applied = 0;
  let credited = 0;
  let pending = false;
  const progress = () =>
    current && current.task
      ? `已确认${spec.label} ${applied} 次，已确认计分 ${credited} 次；任务进度 ${current.task.done}/${
          current.task.limit
        }，掘友分变化 +${Number((current.score - initial.score).toFixed(6))}`
      : "尚未确认任务进度";

  try {
    if (!enabled(config, spec.flag)) return { status: "skipped", detail: `自动${spec.label}已关闭` };
    const settings = {};
    if (spec.kind === "follow") settings.userIds = configuredIds(config.FOLLOW_USER_IDS);
    if (spec.kind === "collect") {
      const value = config.COLLECTION_ID;
      settings.collectionId =
        value === undefined || value === null || value === ""
          ? null
          : identifier(typeof value === "string" ? value.trim() : value);
      if (value !== undefined && value !== null && value !== "" && !settings.collectionId)
        throw new Error("COLLECTION_ID 必须为有效收藏夹 ID");
    }

    initial = current = taskState(await growth.getGrowthTasks(), spec.taskId);
    if (!current.task || current.task.limit === 0)
      return { status: "skipped", detail: `当前未开放可执行的${spec.label}任务` };
    const ceiling = Math.min(DAILY_MAX, current.task.limit);
    if (current.task.done >= ceiling) {
      return {
        status: "skipped",
        detail: `今日${spec.label}已完成或达到每日 ${DAILY_MAX} 次上限（${current.task.done}/${current.task.limit}）`
      };
    }
    const budget = ceiling - current.task.done;
    const interaction = context.interaction || (context.helper && context.helper.interaction());
    if (!interaction) throw new Error("互动客户端不可用");
    const operation = await runtime(context, interaction, spec.kind, settings);
    if (operation.skip) return { status: "skipped", detail: operation.skip };

    let attempted = 0;
    for (const id of operation.candidates) {
      if (attempted >= budget || current.task.done >= ceiling) break;
      if (await operation.state(id)) continue;

      // A previous manual or concurrent action may have consumed the remaining quota.
      const fresh = taskState(await growth.getGrowthTasks(), spec.taskId);
      consistent(current, fresh);
      current = fresh;
      if (current.task.done >= ceiling) break;
      await wait(INTERACTION_INTERVAL_MS);
      const before = current;
      pending = true;
      attempted++;
      let writeError;
      try {
        await operation.perform(id);
      } catch (error) {
        // A timeout can follow a successful write. Resolve only with read requests.
        writeError = errorMessage(error);
      }

      let stateConfirmed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const active = await operation.state(id, true);
        if (active && !stateConfirmed) {
          applied++;
          stateConfirmed = true;
        }
        if (!active && stateConfirmed) throw new Error("刚完成的互动状态发生变化，已停止执行");
        const next = taskState(await growth.getGrowthTasks(), spec.taskId);
        consistent(current, next);
        current = next;
        if (active && next.task.done > before.task.done && next.score > before.score) {
          credited++;
          pending = false;
          break;
        }
        if (attempt < 2) await wait(PROGRESS_INTERVAL_MS);
      }
      if (pending) {
        const reason = stateConfirmed ? "实际互动已完成，但未确认任务次数和掘友分同时增长" : "未确认实际互动成功";
        throw new Error(`${reason}${writeError ? `（${writeError}）` : ""}，已停止且不会重复提交`);
      }
      log(`${spec.label} ${id}：已核验实际状态和任务计分`);
    }

    if (!attempted) return { status: "skipped", detail: `没有需要新增的${spec.label}操作；${progress()}` };
    const ending = current.task.done >= ceiling ? "已达到今日任务或每日上限" : "可用候选不足，保留已完成进度";
    return { status: "success", detail: `${progress()}；${ending}` };
  } catch (error) {
    return {
      status: "failed",
      detail: `${errorMessage(error)}；${progress()}${
        pending ? "；最近一次操作的任务计分尚未确认，请查看掘金任务页" : ""
      }`
    };
  }
}

const likeArticles = context =>
  engagement(context, { taskId: 9, kind: "articles", label: "点赞文章", flag: "AUTO_LIKE_ARTICLES" });
const likePins = context =>
  engagement(context, { taskId: 10, kind: "pins", label: "点赞沸点", flag: "AUTO_LIKE_PINS" });
const collectArticles = context =>
  engagement(context, { taskId: 12, kind: "collect", label: "收藏文章", flag: "AUTO_COLLECT_ARTICLES" });
const followUsers = context =>
  engagement(context, { taskId: 11, kind: "follow", label: "关注用户", flag: "AUTO_FOLLOW_USERS" });

module.exports = { likeArticles, likePins, collectArticles, followUsers };
