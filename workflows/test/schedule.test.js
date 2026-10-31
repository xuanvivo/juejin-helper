const { test } = require("node:test");
const assert = require("node:assert/strict");
const checkDailyCompletion = require("../../.github/scripts/daily-schedule.cjs");

function fixture({ artifacts = [], eventName = "schedule", now = "2026-10-30T22:30:00Z" } = {}) {
  const outputs = {};
  const messages = [];
  let queries = 0;
  const listArtifactsForRepo = () => {};
  return {
    outputs,
    messages,
    get queries() {
      return queries;
    },
    options: {
      now: new Date(now),
      context: {
        eventName,
        repo: { owner: "test", repo: "helper" },
        payload: { repository: { id: 42, default_branch: "main" } }
      },
      github: {
        rest: { actions: { listArtifactsForRepo } },
        paginate: async (endpoint, params) => {
          queries++;
          assert.equal(endpoint, listArtifactsForRepo);
          assert.equal(params.name, "juejin-daily-2026-10-31");
          return artifacts;
        }
      },
      core: {
        setOutput: (key, value) => {
          outputs[key] = value;
        },
        info: message => messages.push(message),
        summary: {
          addHeading() {
            return this;
          },
          addRaw() {
            return this;
          },
          async write() {}
        }
      }
    }
  };
}

const completed = {
  name: "juejin-daily-2026-10-31",
  expired: false,
  workflow_run: { head_branch: "main", head_repository_id: 42 }
};

test("the first daily attempt uses the Beijing date even while UTC is still yesterday", async () => {
  const f = fixture();
  await checkDailyCompletion(f.options);
  assert.equal(f.outputs.completion_name, "juejin-daily-2026-10-31");
  assert.equal(f.outputs.should_run, "true");
});

test("a backup schedule skips a successful task run on the same Beijing day", async () => {
  const f = fixture({ artifacts: [completed] });
  await checkDailyCompletion(f.options);
  assert.equal(f.outputs.should_run, "false");
  assert.match(f.messages[0], /已成功完成/);
});

test("yesterday, expired, feature-branch and fork records cannot suppress today's tasks", async () => {
  const f = fixture({
    artifacts: [
      { ...completed, name: "juejin-daily-2026-10-30" },
      { ...completed, expired: true },
      { ...completed, workflow_run: { head_branch: "feature", head_repository_id: 42 } },
      { ...completed, workflow_run: { head_branch: "main", head_repository_id: 99 } },
      { ...completed, workflow_run: undefined }
    ]
  });
  await checkDailyCompletion(f.options);
  assert.equal(f.outputs.should_run, "true");
});

test("manual run and inspect bypass the daily guard without querying artifacts", async () => {
  const f = fixture({ eventName: "workflow_dispatch", artifacts: [completed] });
  await checkDailyCompletion(f.options);
  assert.equal(f.outputs.should_run, "true");
  assert.equal(f.queries, 0);
});

test("the completion date changes exactly at Beijing midnight", async () => {
  for (const [now, expected] of [
    ["2026-10-31T15:59:59Z", "juejin-daily-2026-10-31"],
    ["2026-10-31T16:00:00Z", "juejin-daily-2026-11-01"]
  ]) {
    const f = fixture({ eventName: "workflow_dispatch", now });
    await checkDailyCompletion(f.options);
    assert.equal(f.outputs.completion_name, expected);
  }
});

test("a GitHub API failure stops the guard instead of silently executing duplicate tasks", async () => {
  const f = fixture();
  f.options.github.paginate = async () => {
    throw new Error("API unavailable");
  };
  await assert.rejects(checkDailyCompletion(f.options), /API unavailable/);
  assert.equal(f.outputs.should_run, undefined);
});
