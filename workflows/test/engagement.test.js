const { test } = require("node:test");
const assert = require("node:assert/strict");
const { likeArticles, likePins, collectArticles, followUsers } = require("../tasks/engagement");

const articleIds = ["7100000000000000001", "7100000000000000002", "7100000000000000003"];
const authorIds = ["6100000000000000001", "6100000000000000002", "6100000000000000003"];
const pinIds = ["5100000000000000001", "5100000000000000002", "5100000000000000003"];
const ownId = "9100000000000000001";
const collectionIds = ["8100000000000000001", "8100000000000000002"];
const specs = [
  [likeArticles, "AUTO_LIKE_ARTICLES", 9],
  [likePins, "AUTO_LIKE_PINS", 10],
  [collectArticles, "AUTO_COLLECT_ARTICLES", 12],
  [followUsers, "AUTO_FOLLOW_USERS", 11]
];

function fixture({ done = {}, limits = {}, config = {} } = {}) {
  const state = {
    done: { 9: 0, 10: 0, 11: 0, 12: 0, ...done },
    score: 2.5,
    likedArticles: new Set(),
    likedPins: new Set(),
    followed: new Set(),
    collected: new Set(),
    members: new Set()
  };
  const events = [];
  const growth = {
    getGrowthTasks: async () => {
      events.push("tasks");
      return {
        growth_tasks: {
          4: [{ task_id: 1, done: 0, limit: -1 }],
          5: [9, 10, 11, 12].map(task_id => ({ task_id, done: state.done[task_id], limit: limits[task_id] ?? 2 }))
        },
        today_jscore: state.score
      };
    },
    getRecommendedArticles: async () => {
      events.push("articles");
      return articleIds.map((id, index) => ({
        item_type: 2,
        item_info: { article_id: id, author_user_info: { user_id: authorIds[index] } }
      }));
    }
  };
  const mutate = (taskId, id, values) => {
    events.push(`write:${taskId}:${id}`);
    values.add(id);
    state.done[taskId]++;
    state.score += taskId === 11 ? 4 : 1;
  };
  const interaction = {
    getCurrentUserId: () => ownId,
    getArticle: async id => {
      events.push(`article:${id}`);
      return {
        article_id: id,
        article_info: { article_id: id },
        user_interact: { is_digg: state.likedArticles.has(id), is_collect: state.collected.has(id) }
      };
    },
    getRecommendedPins: async () => {
      events.push("pins");
      return pinIds.map(id => ({ msg_id: id, msg_Info: { msg_id: id } }));
    },
    getPin: async id => {
      events.push(`pin:${id}`);
      return { msg_id: id, msg_Info: { msg_id: id }, user_interact: { is_digg: state.likedPins.has(id) } };
    },
    getUser: async id => {
      events.push(`user:${id}`);
      return { user_id: id, isfollowed: state.followed.has(id) };
    },
    getCollectionSets: async (articleId, cursor) => {
      events.push(`collections:${articleId}:${cursor}`);
      return {
        collections: collectionIds.map((id, index) => ({
          collection_id: id,
          is_default: index === 1,
          is_article_in: state.members.has(`${id}:${articleId}`)
        })),
        has_more: false,
        cursor: "end"
      };
    },
    likeArticle: async id => mutate(9, id, state.likedArticles),
    likePin: async id => mutate(10, id, state.likedPins),
    followUser: async id => mutate(11, id, state.followed),
    collectArticle: async (id, collectionId) => {
      events.push(`collect-target:${collectionId}`);
      state.members.add(`${collectionId}:${id}`);
      mutate(12, id, state.collected);
    }
  };
  const context = {
    growth,
    interaction,
    helper: { getUser: () => ({ user_id: ownId }), interaction: () => interaction },
    config,
    wait: async milliseconds => events.push(`wait:${milliseconds}`)
  };
  return { context, state, events };
}

const writes = events => events.filter(event => event.startsWith("write:"));

test("all four enabled tasks verify real state and task credit within the daily limit", async () => {
  for (const [run, , taskId] of specs) {
    const { context, events, state } = fixture({ limits: { [taskId]: 10 } });
    const result = await run(context);
    assert.equal(result.status, "success", result.detail);
    assert.match(result.detail, /已确认计分 2 次.*任务进度 2\/10/);
    assert.equal(state.done[taskId], 2);
    assert.equal(writes(events).length, 2);
    assert.equal(events.filter(event => event === "wait:3000").length, 2);
    assert.ok(events.indexOf("tasks") < events.findIndex(event => event.startsWith("write:")));
    assert.equal(events.at(-1), "tasks");
  }
});

test("the remaining daily quota is respected across repeated runs", async () => {
  for (const [run, , taskId] of specs) {
    const { context, events, state } = fixture({ done: { [taskId]: 1 }, limits: { [taskId]: 20 } });
    assert.equal((await run(context)).status, "success");
    assert.equal(state.done[taskId], 2);
    assert.equal((await run(context)).status, "skipped");
    assert.equal(writes(events).length, 1);
  }
});

test("disabled tasks perform no requests and malformed settings fail before account access", async () => {
  for (const [run, flag] of specs) {
    for (const value of [false, "false", " FALSE "]) {
      const { context, events } = fixture({ config: { [flag]: value } });
      assert.equal((await run(context)).status, "skipped");
      assert.deepEqual(events, []);
    }
    const invalid = fixture({ config: { [flag]: "sometimes" } });
    assert.equal((await run(invalid.context)).status, "failed");
    assert.deepEqual(invalid.events, []);
  }
  for (const ids of [
    "https://example.test",
    "123,not-a-user",
    123,
    Array.from({ length: 21 }, (_, index) => index + 1).join(",")
  ]) {
    const { context, events } = fixture({ config: { FOLLOW_USER_IDS: ids } });
    assert.equal((await followUsers(context)).status, "failed");
    assert.deepEqual(events, []);
  }
  const invalidCollection = fixture({ config: { COLLECTION_ID: "../private" } });
  assert.equal((await collectArticles(invalidCollection.context)).status, "failed");
  assert.deepEqual(invalidCollection.events, []);
});

test("missing or unavailable tasks skip without loading the interaction client", async () => {
  for (const result of [
    { growth_tasks: {}, today_jscore: 0 },
    { growth_tasks: { 5: [{ task_id: 9, done: 0, limit: 0 }] }, today_jscore: 0 }
  ]) {
    const { context, events } = fixture();
    context.growth.getGrowthTasks = async () => result;
    delete context.interaction;
    context.helper.interaction = () => {
      throw new Error("should not load");
    };
    assert.equal((await likeArticles(context)).status, "skipped");
    assert.deepEqual(events, []);
  }
});

test("a runnable task lazily obtains the helper interaction client", async () => {
  const { context } = fixture();
  delete context.interaction;
  assert.equal((await likeArticles(context)).status, "success");
});

test("existing likes are skipped and duplicate or unsafe recommendations never receive writes", async () => {
  const { context, state, events } = fixture();
  state.likedArticles.add(articleIds[0]);
  const recommendations = await context.growth.getRecommendedArticles();
  context.growth.getRecommendedArticles = async () => [
    { item_type: 14, item_info: { article_id: articleIds[2] } },
    { item_type: 2, item_info: { article_id: 7100000000000000001 } },
    recommendations[0],
    recommendations[0],
    recommendations[1],
    recommendations[1],
    recommendations[2]
  ];
  assert.equal((await likeArticles(context)).status, "success");
  assert.deepEqual(writes(events), [`write:9:${articleIds[1]}`, `write:9:${articleIds[2]}`]);
});

test("a timeout after an accepted interaction is resolved with reads, never a second write", async () => {
  const { context, events } = fixture({ limits: { 9: 1 } });
  const accepted = context.interaction.likeArticle;
  context.interaction.likeArticle = async id => {
    await accepted(id);
    throw new Error("request timed out");
  };
  const result = await likeArticles(context);
  assert.equal(result.status, "success", result.detail);
  assert.equal(writes(events).length, 1);
  assert.match(result.detail, /已确认计分 1 次/);
});

test("an accepted interaction without task credit stops instead of consuming more candidates", async () => {
  const { context, state, events } = fixture();
  context.interaction.likeArticle = async id => {
    events.push(`write:9:${id}`);
    state.likedArticles.add(id);
  };
  const result = await likeArticles(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /实际互动已完成.*未确认任务次数和掘友分同时增长/);
  assert.match(result.detail, /已确认点赞文章 1 次，已确认计分 0 次.*掘友分变化 \+0/);
  assert.equal(writes(events).length, 1);
  assert.equal(events.filter(event => event === "wait:2000").length, 2);
});

test("a task counter alone is not reported as a points award", async () => {
  const { context, state, events } = fixture();
  context.interaction.likeArticle = async id => {
    events.push(`write:9:${id}`);
    state.likedArticles.add(id);
    state.done[9]++;
  };
  const result = await likeArticles(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /已确认计分 0 次.*掘友分变化 \+0/);
  assert.equal(writes(events).length, 1);
});

test("a failed credit query preserves an interaction already confirmed by its actual state", async () => {
  const { context, state, events } = fixture();
  const getTasks = context.growth.getGrowthTasks;
  context.growth.getGrowthTasks = async () => {
    if (state.likedArticles.size) throw new Error("任务进度查询超时");
    return getTasks();
  };
  const result = await likeArticles(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /已确认点赞文章 1 次，已确认计分 0 次/);
  assert.equal(writes(events).length, 1);
});

test("a failed second mutation preserves the first confirmed action and does not try a third", async () => {
  const { context, events } = fixture();
  const accepted = context.interaction.likeArticle;
  context.interaction.likeArticle = async id => {
    if (id === articleIds[0]) return accepted(id);
    events.push(`write:9:${id}`);
    throw new Error("connection lost");
  };
  const result = await likeArticles(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /已确认点赞文章 1 次，已确认计分 1 次.*1\/2/);
  assert.deepEqual(writes(events), [`write:9:${articleIds[0]}`, `write:9:${articleIds[1]}`]);
});

test("bounded progress lag repeats only reads", async () => {
  const { context, events, state } = fixture({ limits: { 9: 1 } });
  const getTasks = context.growth.getGrowthTasks;
  let laggedReads = 0;
  context.growth.getGrowthTasks = async () => {
    const result = await getTasks();
    if (state.done[9] && laggedReads++ < 2) {
      result.growth_tasks[5].find(task => task.task_id === 9).done = 0;
      result.today_jscore = 2.5;
    }
    return result;
  };
  assert.equal((await likeArticles(context)).status, "success");
  assert.equal(writes(events).length, 1);
  assert.equal(events.filter(event => event === "wait:2000").length, 2);
});

test("quota is read again before a mutation if another action has completed the task", async () => {
  const { context, state, events } = fixture();
  const detail = context.interaction.getArticle;
  context.interaction.getArticle = async id => {
    state.done[9] = 2;
    return detail(id);
  };
  assert.equal((await likeArticles(context)).status, "skipped");
  assert.deepEqual(writes(events), []);
});

test("unknown state fields and mismatched response IDs cannot trigger interactions", async () => {
  for (const response of [
    {},
    { article_id: articleIds[1], user_interact: { is_digg: false } },
    { article_id: articleIds[0], article_info: { article_id: articleIds[1] }, user_interact: { is_digg: false } },
    ...[undefined, null, 0, "false"].map(is_digg => ({ article_id: articleIds[0], user_interact: { is_digg } }))
  ]) {
    const { context, events } = fixture();
    context.interaction.getArticle = async () => response;
    assert.equal((await likeArticles(context)).status, "failed");
    assert.deepEqual(writes(events), []);
  }
});

test("malformed task lists and counters cannot trigger interactions", async () => {
  for (const response of [
    null,
    { growth_tasks: [], today_jscore: 0 },
    { growth_tasks: { 5: {} }, today_jscore: 0 },
    ...[-1, 0.5, "2", undefined].map(limit => ({
      growth_tasks: { 5: [{ task_id: 9, limit, done: 0 }] },
      today_jscore: 0
    })),
    { growth_tasks: { 5: [{ task_id: 9, limit: 2, done: -1 }] }, today_jscore: 0 },
    { growth_tasks: { 5: [{ task_id: 9, limit: 2, done: 0 }] }, today_jscore: "0" },
    {
      growth_tasks: {
        5: [
          { task_id: 9, limit: 2, done: 0 },
          { task_id: 9, limit: 2, done: 0 }
        ]
      },
      today_jscore: 0
    }
  ]) {
    const { context, events } = fixture();
    context.growth.getGrowthTasks = async () => response;
    assert.equal((await likeArticles(context)).status, "failed");
    assert.deepEqual(writes(events), []);
  }
});

test("a task reset or points decrease after a write stops further interaction", async () => {
  const { context, state, events } = fixture({ done: { 9: 1 } });
  context.interaction.likeArticle = async id => {
    events.push(`write:9:${id}`);
    state.likedArticles.add(id);
    state.done[9] = 0;
    state.score = 0;
  };
  const result = await likeArticles(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /进度发生变化或跨日/);
  assert.equal(writes(events).length, 1);
});

test("pin recommendations use the official msg_Info shape and never article IDs", async () => {
  const { context, state, events } = fixture();
  state.likedPins.add(pinIds[0]);
  context.interaction.getRecommendedPins = async () => [
    { msg_Info: { msg_id: pinIds[0] } },
    { msg_Info: { msg_id: pinIds[1] } },
    { msg_Info: { msg_id: pinIds[1] } },
    { msg_Info: { msg_id: pinIds[2] } }
  ];
  assert.equal((await likePins(context)).status, "success");
  assert.deepEqual(writes(events), [`write:10:${pinIds[1]}`, `write:10:${pinIds[2]}`]);
  assert.ok(!events.includes("articles"));
});

test("configured follow targets replace recommendations and skip self or existing follows", async () => {
  const { context, state, events } = fixture({
    config: { FOLLOW_USER_IDS: `${ownId},${authorIds[0]},${authorIds[1]}\n${authorIds[1]} ${authorIds[2]}` }
  });
  state.followed.add(authorIds[0]);
  assert.equal((await followUsers(context)).status, "success");
  assert.deepEqual(writes(events), [`write:11:${authorIds[1]}`, `write:11:${authorIds[2]}`]);
  assert.ok(!events.includes("articles"));
  assert.ok(!events.includes(`user:${ownId}`));
});

test("default follow targets are recommended article authors", async () => {
  const { context, events } = fixture();
  assert.equal((await followUsers(context)).status, "success");
  assert.deepEqual(writes(events), [`write:11:${authorIds[0]}`, `write:11:${authorIds[1]}`]);
});

test("follow fails safely when the current identity or followed state is unknown", async () => {
  const missingViewer = fixture();
  missingViewer.context.helper.getUser = () => null;
  missingViewer.context.interaction.getCurrentUserId = () => undefined;
  assert.equal((await followUsers(missingViewer.context)).status, "failed");
  assert.deepEqual(writes(missingViewer.events), []);
  const missingState = fixture();
  missingState.context.interaction.getUser = async user_id => ({ user_id });
  assert.equal((await followUsers(missingState.context)).status, "failed");
  assert.deepEqual(writes(missingState.events), []);
});

test("collection uses the existing default and verifies its membership without moving existing articles", async () => {
  const { context, events, state } = fixture();
  state.collected.add(articleIds[0]);
  assert.equal((await collectArticles(context)).status, "success");
  assert.deepEqual(writes(events), [`write:12:${articleIds[1]}`, `write:12:${articleIds[2]}`]);
  assert.deepEqual(
    events.filter(event => event.startsWith("collect-target:")),
    Array(2).fill(`collect-target:${collectionIds[1]}`)
  );
  assert.ok(state.collected.has(articleIds[0]));
  assert.ok(!state.members.has(`${collectionIds[1]}:${articleIds[0]}`));
});

test("a configured collection can be found on later pages without creating a new collection", async () => {
  const { context, state, events } = fixture({ limits: { 12: 1 }, config: { COLLECTION_ID: collectionIds[1] } });
  context.interaction.getCollectionSets = async (articleId, cursor) => {
    events.push(`collections:${articleId}:${cursor}`);
    const id = cursor === "0" ? collectionIds[0] : collectionIds[1];
    return {
      collections: [{ collection_id: id, is_default: false, is_article_in: state.members.has(`${id}:${articleId}`) }],
      has_more: cursor === "0",
      cursor: cursor === "0" ? "next" : "end"
    };
  };
  assert.equal((await collectArticles(context)).status, "success");
  assert.ok(events.includes("collections::next"));
  assert.ok(events.includes(`collections:${articleIds[0]}:next`));
  assert.deepEqual(
    events.filter(event => event.startsWith("collect-target:")),
    [`collect-target:${collectionIds[1]}`]
  );
});

test("no existing collection skips and an absent configured collection fails without writing", async () => {
  for (const configured of [false, true]) {
    const { context, events } = fixture({ config: configured ? { COLLECTION_ID: collectionIds[0] } : {} });
    context.interaction.getCollectionSets = async () => ({ collections: [], has_more: false });
    assert.equal((await collectArticles(context)).status, configured ? "failed" : "skipped");
    assert.deepEqual(writes(events), []);
  }
});

test("unknown collection membership and cyclic pagination stop before any write", async () => {
  const missingMembership = fixture();
  missingMembership.context.interaction.getCollectionSets = async () => ({
    collections: [{ collection_id: collectionIds[0] }],
    has_more: false
  });
  assert.equal((await collectArticles(missingMembership.context)).status, "failed");
  assert.deepEqual(writes(missingMembership.events), []);
  const cycle = fixture({ config: { COLLECTION_ID: collectionIds[1] } });
  cycle.context.interaction.getCollectionSets = async () => ({
    collections: [{ collection_id: collectionIds[0] }],
    has_more: true,
    cursor: "0"
  });
  assert.equal((await collectArticles(cycle.context)).status, "failed");
  assert.deepEqual(writes(cycle.events), []);
});

test("global collection status alone cannot confirm placement in the selected collection", async () => {
  const { context, state, events } = fixture();
  context.interaction.collectArticle = async id => {
    events.push(`write:12:${id}`);
    state.collected.add(id);
    state.done[12]++;
    state.score++;
  };
  const result = await collectArticles(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /未确认实际互动成功/);
  assert.equal(writes(events).length, 1);
});
