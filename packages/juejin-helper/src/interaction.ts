import JuejinHelper from "./index";
import { AxiosInstance } from "axios";
import { createApiClient } from "./services/api";

/** Official web interactions. No mutation in this client is retried. */
class Interaction {
  http: AxiosInstance;
  private helper: JuejinHelper;

  constructor(juejin: JuejinHelper) {
    this.helper = juejin;
    this.http = createApiClient();
    this.http.interceptors.request.use(config => {
      config.headers = config.headers || {};
      config.headers.cookie = juejin.getCookie();
      // Retain the original SDK's optional identifiers on these v1 endpoints.
      // The web client type belongs in the request body, independently of these.
      config.params = { aid: "", uuid: "", ...config.params };
      return config;
    });
  }

  getCurrentUserId() {
    return this.helper.getUser()?.user_id;
  }

  async getArticle(articleId: string) {
    return this.http.post("/content_api/v1/article/detail", {
      article_id: articleId,
      req_from: 0,
      client_type: 2608,
      forbid_count: true,
      is_pre_load: true,
      need_theme: true,
      prefer_html: true
    });
  }

  async getRecommendedPins() {
    return this.http.post("/recommend_api/v1/short_msg/recommend", {
      id_type: 4,
      sort_type: 300,
      cursor: "0",
      limit: 20
    });
  }

  async getPin(pinId: string) {
    return this.http.post("/content_api/v1/short_msg/detail", { msg_id: pinId });
  }

  async likeArticle(articleId: string) {
    return this.http.post("/interact_api/v1/digg/save", {
      item_id: articleId,
      item_type: 2,
      client_type: 2608
    });
  }

  async likePin(pinId: string) {
    return this.http.post("/interact_api/v1/digg/save", {
      item_id: pinId,
      item_type: 4,
      client_type: 2608
    });
  }

  async getUser(userId: string) {
    return this.http.get("/user_api/v1/user/get", {
      params: { user_id: userId, not_self: 1, need_badge: 0, need_dislike_status: 0 }
    });
  }

  async followUser(userId: string) {
    return this.http.post("/interact_api/v1/follow/do", { id: userId, type: 1 });
  }

  /** Existing collections owned by the logged-in user; never creates a collection. */
  async getCollectionSets(articleId = "", cursor = "0") {
    return this.http.post(
      "/interact_api/v2/collectionset/list",
      { article_id: articleId, cursor, limit: 20 },
      {
        // The shared API client unwraps data. Preserve this endpoint's pagination
        // alongside its list so a configured collection can be found safely.
        transformResponse: [
          value => {
            let body = value;
            if (typeof body === "string") {
              try {
                body = JSON.parse(body);
              } catch (_) {
                return body;
              }
            }
            if (body && typeof body === "object" && Array.isArray(body.data)) {
              return {
                ...body,
                data: { collections: body.data, has_more: body.has_more, cursor: body.cursor }
              };
            }
            return body;
          }
        ]
      }
    );
  }

  async collectArticle(articleId: string, collectionId: string) {
    return this.http.post("/interact_api/v2/collectionset/add_article", {
      article_id: articleId,
      select_collection_ids: [collectionId],
      unselect_collection_ids: [],
      is_collect_fast: false
    });
  }
}

export default Interaction;
