const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reading } = require("../tasks/growth");

const ids = Array.from({ length: 20 }, (_, index) => String(7000000000000000000n + BigInt(index)));
const candidate = id => ({ item_type: 2, item_info: { article_id: id } });

function fixture({ limit = 3, done = 0, score = 10, config = {}, candidates = ids.map(candidate) } = {}) {
  const state = { done, score };
  const events = [];
  const growth = {
    getGrowthTasks: async () => {
      events.push("tasks");
      return {
        growth_tasks: { 3: [{ task_id: 13, title: "阅读文章", limit, done: state.done }] },
        today_jscore: state.score
      };
    },
    getRecommendedArticles: async () => {
      events.push("recommend");
      return candidates;
    },
    getArticleDetail: async id => {
      events.push(`detail:${id}`);
      return { article_id: id, article_info: { mark_content: "实际文章正文" } };
    },
    reportArticleRead: async id => {
      events.push(`report:${id}`);
      state.done++;
      state.score += 2;
    }
  };
  const context = {
    growth,
    config,
    wait: async milliseconds => {
      events.push(`wait:${milliseconds}`);
    }
  };
  return { context, state, events };
}

test("reads a real article and waits 90 seconds before each report and progress check", async () => {
  const { context, events } = fixture({ limit: 2 });
  const result = await reading(context);
  assert.equal(result.status, "success");
  assert.match(result.detail, /已确认阅读 2 篇.*2\/2.*掘友分变化 \+4.*今日阅读任务已完成/);
  assert.deepEqual(events, [
    "tasks",
    "recommend",
    `detail:${ids[0]}`,
    "wait:90000",
    `report:${ids[0]}`,
    "tasks",
    `detail:${ids[1]}`,
    "wait:90000",
    `report:${ids[1]}`,
    "tasks"
  ]);
});

test("disabled reading performs no API calls", async () => {
  for (const flag of [false, "false", " FALSE "]) {
    const { context, events } = fixture({ config: { AUTO_READ_ARTICLES: flag } });
    assert.equal((await reading(context)).status, "skipped");
    assert.deepEqual(events, []);
  }
});

test("completed and unavailable reading tasks are skipped without article access", async () => {
  for (const options of [{ limit: 3, done: 3 }, { limit: 0 }]) {
    const { context, events } = fixture(options);
    assert.equal((await reading(context)).status, "skipped");
    assert.deepEqual(events, ["tasks"]);
  }
  const { context, events } = fixture();
  context.growth.getGrowthTasks = async () => ({ growth_tasks: {}, today_jscore: 0 });
  assert.equal((await reading(context)).status, "skipped");
  assert.deepEqual(events, []);
});

test("rejects unknown task shapes and invalid counts without article actions", async () => {
  const badTasks = [
    null,
    {},
    { growth_tasks: [], today_jscore: 0 },
    { growth_tasks: { 3: {} }, today_jscore: 0 },
    ...[undefined, "1", -1, 0.5, NaN, Infinity].flatMap(value => [
      { growth_tasks: { 3: [{ task_id: 13, limit: value, done: 0 }] }, today_jscore: 0 },
      { growth_tasks: { 3: [{ task_id: 13, limit: 3, done: value }] }, today_jscore: 0 }
    ]),
    { growth_tasks: { 3: [{ task_id: "13", limit: 3, done: 0 }] }, today_jscore: 0 },
    {
      growth_tasks: {
        3: [
          { task_id: 13, limit: 3, done: 0 },
          { task_id: 13, limit: 3, done: 0 }
        ]
      },
      today_jscore: 0
    }
  ];
  for (const result of badTasks) {
    const { context, events } = fixture();
    context.growth.getGrowthTasks = async () => result;
    assert.equal((await reading(context)).status, "failed");
    assert.deepEqual(events, []);
  }
});

test("requires an actual numeric daily score instead of coercing strings or missing fields", async () => {
  for (const score of [undefined, "10", -1, NaN, Infinity]) {
    const { context, events } = fixture();
    context.growth.getGrowthTasks = async () => ({
      growth_tasks: { 3: [{ task_id: 13, limit: 3, done: 0 }] },
      today_jscore: score
    });
    const result = await reading(context);
    assert.equal(result.status, "failed");
    assert.match(result.detail, /今日掘友分返回格式异常/);
    assert.deepEqual(events, []);
  }
});

test("default budget reports partial progress honestly and configuration cannot exceed ten reads", async () => {
  const first = fixture({ limit: 7 });
  const partial = await reading(first.context);
  assert.equal(partial.status, "success");
  assert.match(partial.detail, /5\/7.*达到本次 5 篇上限.*还需 2 篇/);
  assert.doesNotMatch(partial.detail, /今日阅读任务已完成/);
  assert.equal(first.events.filter(event => event.startsWith("report:")).length, 5);

  const second = fixture({ limit: 20, config: { READING_MAX_ARTICLES: "999" } });
  const capped = await reading(second.context);
  assert.match(capped.detail, /10\/20.*本次 10 篇上限/);
  assert.equal(second.events.filter(event => event.startsWith("report:")).length, 10);
});

test("rejects invalid reading configuration before making requests", async () => {
  for (const config of [
    { AUTO_READ_ARTICLES: "maybe" },
    ...[0, -1, "2.5", "3oops", Infinity].map(maximum => ({ READING_MAX_ARTICLES: maximum }))
  ]) {
    const { context, events } = fixture({ config });
    assert.equal((await reading(context)).status, "failed");
    assert.deepEqual(events, []);
  }
});

test("deduplicates real article IDs and ignores advertisements and unsafe IDs", async () => {
  const candidates = [
    { item_type: 14, item_info: { article_id: ids[2] } },
    candidate("https://example.test/article"),
    candidate(7000000000000000000),
    candidate(ids[0]),
    candidate(ids[0]),
    candidate(ids[1])
  ];
  const { context, events } = fixture({ limit: 3, candidates });
  const result = await reading(context);
  assert.equal(result.status, "success");
  assert.match(result.detail, /2\/3.*可用推荐文章不足.*还需 1 篇/);
  assert.deepEqual(
    events.filter(event => event.startsWith("report:")),
    [`report:${ids[0]}`, `report:${ids[1]}`]
  );
});

test("only task 13 is actionable even when other tasks are incomplete", async () => {
  const { context, events } = fixture();
  context.growth.getGrowthTasks = async () => ({
    growth_tasks: {
      1: [
        { task_id: 9, limit: 3, done: 0 },
        { task_id: 11, limit: 3, done: 0 }
      ]
    },
    today_jscore: 10
  });
  assert.equal((await reading(context)).status, "skipped");
  assert.deepEqual(events, []);
});

test("supports the live five-read task alongside unrelated unlimited tasks", async () => {
  const { context, state, events } = fixture({ limit: 5, score: 0 });
  context.growth.getGrowthTasks = async () => ({
    growth_tasks: {
      1: [1, 2, 3].map(task_id => ({ task_id, limit: -1, done: 0 })),
      3: [{ task_id: 13, limit: 5, done: state.done, score: 0.5 }]
    },
    today_jscore: state.score
  });
  context.growth.reportArticleRead = async id => {
    events.push(`report:${id}`);
    state.done++;
    state.score += 0.5;
  };
  const result = await reading(context);
  assert.equal(result.status, "success");
  assert.match(result.detail, /已确认阅读 5 篇.*5\/5.*掘友分变化 \+2\.5.*今日阅读任务已完成/);
  assert.equal(events.filter(event => event.startsWith("report:")).length, 5);
});

test("unlimited unrelated tasks do not prevent skipping an unavailable reading task", async () => {
  const { context, events } = fixture();
  context.growth.getGrowthTasks = async () => ({
    growth_tasks: { 1: [1, 2, 3].map(task_id => ({ task_id, limit: -1, done: 0 })) },
    today_jscore: 0
  });
  const result = await reading(context);
  assert.equal(result.status, "skipped");
  assert.match(result.detail, /未开放/);
  assert.deepEqual(events, []);
});

test("an empty candidate list is skipped and an unknown recommendation shape fails", async () => {
  const empty = fixture({ candidates: [] });
  assert.equal((await reading(empty.context)).status, "skipped");
  assert.deepEqual(empty.events, ["tasks", "recommend"]);
  const malformed = fixture({ candidates: { data: [] } });
  assert.equal((await reading(malformed.context)).status, "failed");
  assert.deepEqual(malformed.events, ["tasks", "recommend"]);
});

test("accepts the official alternative content fields without requiring markdown", async () => {
  for (const field of ["mark_content", "web_html_content", "app_html_content", "content"]) {
    const { context } = fixture({ limit: 1 });
    context.growth.getArticleDetail = async id => ({ article_info: { article_id: id, [field]: "<p>文章正文</p>" } });
    assert.equal((await reading(context)).status, "success");
  }
});

test("missing body or mismatched article identity cannot generate a completion report", async () => {
  for (const detail of [
    { article_id: ids[0], article_info: { mark_content: " ", web_html_content: null } },
    { article_id: ids[1], article_info: { mark_content: "其他文章正文" } },
    { article_info: { mark_content: "没有文章 ID 的响应" } },
    { article_id: ids[0] }
  ]) {
    const { context, events } = fixture();
    context.growth.getArticleDetail = async () => detail;
    assert.equal((await reading(context)).status, "failed");
    assert.ok(!events.some(event => event.startsWith("report:") || event.startsWith("wait:")));
  }
});

test("a successful report with unchanged server progress is not treated as task completion", async () => {
  const { context, events } = fixture();
  context.growth.reportArticleRead = async id => {
    events.push(`report:${id}`);
  };
  const result = await reading(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /次数未增长.*已确认阅读 0 篇.*0\/3/);
  assert.equal(events.filter(event => event.startsWith("report:")).length, 1);
});

test("an ambiguous report failure stops without retries and retains confirmed partial progress", async () => {
  const { context, events } = fixture();
  const report = context.growth.reportArticleRead;
  context.growth.reportArticleRead = async id => {
    if (id === ids[1]) {
      events.push(`report:${id}`);
      throw { isAxiosError: true, code: "ETIMEDOUT", config: { headers: { Cookie: "SECRET" } } };
    }
    return report(id);
  };
  const result = await reading(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /超时.*已确认阅读 1 篇.*1\/3.*掘友分变化 \+2.*上报结果未确认/);
  assert.doesNotMatch(result.detail, /SECRET/);
  assert.equal(events.filter(event => event.startsWith("report:")).length, 2);
});

test("article fetch failures after a completed read retain the verified result", async () => {
  const { context } = fixture();
  const detail = context.growth.getArticleDetail;
  context.growth.getArticleDetail = async id => {
    if (id === ids[1]) throw new Error("文章暂不可访问");
    return detail(id);
  };
  const result = await reading(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /文章暂不可访问.*已确认阅读 1 篇.*1\/3.*掘友分变化 \+2/);
  assert.doesNotMatch(result.detail, /最近一次上报结果未确认/);
});

test("failure to verify a submitted read cannot inflate the confirmed count", async () => {
  const { context } = fixture();
  const tasks = context.growth.getGrowthTasks;
  let checks = 0;
  context.growth.getGrowthTasks = async () => {
    if (++checks === 2) throw new Error("进度查询失败");
    return tasks();
  };
  const result = await reading(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /查询失败.*已确认阅读 0 篇.*0\/3.*上报结果未确认/);
});

test("a daily reset or score decrease stops further reads without reporting a false gain", async () => {
  const { context, state, events } = fixture({ done: 1 });
  context.growth.reportArticleRead = async id => {
    events.push(`report:${id}`);
    state.done = 0;
    state.score = 0;
  };
  const result = await reading(context);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /跨日.*已确认阅读 0 篇.*掘友分变化 \+0/);
  assert.equal(events.filter(event => event.startsWith("report:")).length, 1);
});
