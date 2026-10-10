const { test } = require("node:test");
const assert = require("node:assert/strict");
const Interaction = require("../../packages/juejin-helper/src/interaction").default;

const response = (data, config) => ({ data, config, status: 200, statusText: "OK", headers: {} });

function client() {
  return new Interaction({ getCookie: () => "session=private", getUser: () => ({ user_id: "123" }) });
}

test("interaction requests carry session headers and preserve official item types without any undo operation", async () => {
  const interaction = client();
  const requests = [];
  interaction.http.defaults.adapter = async config => {
    requests.push({
      method: config.method,
      url: config.url,
      params: config.params,
      headers: config.headers,
      body: config.data && JSON.parse(config.data)
    });
    return response({ err_no: 0, data: {} }, config);
  };
  await interaction.likeArticle("12345");
  await interaction.likePin("45678");
  await interaction.followUser("98765");
  await interaction.collectArticle("12345", "54321");
  assert.deepEqual(
    requests.map(({ url, body }) => ({ url, body })),
    [
      { url: "/interact_api/v1/digg/save", body: { item_id: "12345", item_type: 2, client_type: 2608 } },
      { url: "/interact_api/v1/digg/save", body: { item_id: "45678", item_type: 4, client_type: 2608 } },
      { url: "/interact_api/v1/follow/do", body: { id: "98765", type: 1 } },
      {
        url: "/interact_api/v2/collectionset/add_article",
        body: {
          article_id: "12345",
          select_collection_ids: ["54321"],
          unselect_collection_ids: [],
          is_collect_fast: false
        }
      }
    ]
  );
  for (const request of requests) {
    assert.equal(request.headers.cookie, "session=private");
    assert.deepEqual(request.params, { aid: "", uuid: "" });
    assert.doesNotMatch(request.url, /private|cancel|delete|create/);
  }
});

test("state reads use official article, pin and user detail endpoints without recording article visits", async () => {
  const interaction = client();
  const requests = [];
  interaction.http.defaults.adapter = async config => {
    requests.push({ url: config.url, params: config.params, body: config.data && JSON.parse(config.data) });
    return response({ err_no: 0, data: {} }, config);
  };
  await interaction.getArticle("12345");
  await interaction.getRecommendedPins();
  await interaction.getPin("45678");
  await interaction.getUser("98765");
  assert.equal(requests[0].url, "/content_api/v1/article/detail");
  assert.equal(requests[0].body.forbid_count, true);
  assert.equal(requests[0].body.is_pre_load, true);
  assert.deepEqual(requests[1].body, { id_type: 4, sort_type: 300, cursor: "0", limit: 20 });
  assert.equal(requests[1].url, "/recommend_api/v1/short_msg/recommend");
  assert.deepEqual(requests[2].body, { msg_id: "45678" });
  assert.equal(requests[3].url, "/user_api/v1/user/get");
  assert.equal(requests[3].params.user_id, "98765");
  assert.equal(requests[3].params.aid, "2608");
  assert.equal(requests[3].params.not_self, 1);
  assert.equal(interaction.getCurrentUserId(), "123");
});

test("collection list pagination survives shared response unwrapping and keeps the article filter", async () => {
  const interaction = client();
  let request;
  interaction.http.defaults.adapter = async config => {
    request = config;
    return response(
      JSON.stringify({
        err_no: 0,
        data: [{ collection_id: "54321", is_article_in: true }],
        has_more: true,
        cursor: "page2"
      }),
      config
    );
  };
  const result = await interaction.getCollectionSets("12345", "page1");
  assert.deepEqual(result, {
    collections: [{ collection_id: "54321", is_article_in: true }],
    has_more: true,
    cursor: "page2"
  });
  assert.deepEqual(JSON.parse(request.data), { article_id: "12345", cursor: "page1", limit: 20 });
});

test("collection transforms still reject challenge HTML and business errors", async () => {
  const interaction = client();
  interaction.http.defaults.adapter = async config => response("<html>challenge</html>", config);
  await assert.rejects(interaction.getCollectionSets(), /返回格式异常/);
  interaction.http.defaults.adapter = async config => response({ err_no: 403, err_msg: "登录过期" }, config);
  await assert.rejects(interaction.getCollectionSets(), /登录过期/);
});

test("SDK does not repeat a failed mutation", async () => {
  const interaction = client();
  let requests = 0;
  interaction.http.defaults.adapter = async () => {
    requests++;
    throw new Error("network timeout");
  };
  await assert.rejects(interaction.likeArticle("12345"), /network timeout/);
  assert.equal(requests, 1);
});
