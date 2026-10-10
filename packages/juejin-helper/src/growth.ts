import JuejinHelper from "./index";
import { AxiosInstance } from "axios";
import { createApiClient } from "./services/api";

class Growth {
  http: AxiosInstance;

  constructor(juejin: JuejinHelper) {
    this.http = createApiClient();

    this.http.interceptors.request.use(
      function (config) {
        config.headers = config.headers || {};
        config.headers.cookie = juejin.getCookie();

        if (juejin.user) {
          const tokens = juejin.getCookieTokens();
          config.params = {
            ...config.params,
            aid: tokens?.aid || "2608",
            ...(tokens?.uuid ? { uuid: tokens.uuid } : {})
          };
        }
        return config;
      },
      function (error) {
        return Promise.reject(error);
      }
    );
  }

  /**
   * 获取统计签到天数
   * @returns {Promise<*>}
   * {
   *   cont_count 连续签到天数
   *   sum_count 累计签到天数
   * }
   */
  async getCounts(): Promise<{
    cont_count: number;
    sum_count: number;
  }> {
    return this.http.get("/growth_api/v1/get_counts");
  }

  /**
   * 获取当前矿石数
   * @returns {Promise<*>}
   * number 当前矿石数
   */
  async getCurrentPoint() {
    return this.http.get("/growth_api/v1/get_cur_point");
  }

  /**
   * 获取今日签到状态
   * @returns {Promise<*>}
   * boolean 是否签到
   */
  async getTodayStatus() {
    return this.http.get("/growth_api/v1/get_today_status");
  }

  /**
   * 获取月签到日历
   * @returns {Promise<*>}
   * [
   *   {
   *     date: timestamp(格式1646150400)
   *     point: number增加矿石数
   *     status: enum(1 今日, 4 未签到, 3 已签到)
   *   }
   * ]
   */
  async getByMonth() {
    return this.http.get("/growth_api/v1/get_by_month");
  }

  async getLotteryConfig() {
    return this.http.get("/growth_api/v1/lottery_config/get");
  }

  async drawLottery() {
    return this.http.post("/growth_api/v1/lottery/draw");
  }

  async checkIn() {
    return this.http.post("/growth_api/v1/check_in");
  }

  async getLotteriesLuckyUsers(data?: { page_no: number; page_size: number }): Promise<{
    count: number;
    lotteries: Array<{
      history_id: number;
      [prop: string]: any;
    }>;
  }> {
    const { page_no = 1, page_size = 5 } = data || {};
    return this.http.post("/growth_api/v1/lottery_history/global_big", {
      page_no: page_no,
      page_size: page_size
    });
  }

  async dipLucky(lottery_history_id: number): Promise<{
    has_dip: boolean;
    dip_value: number;
  }> {
    return this.http.post("/growth_api/v1/lottery_lucky/dip_lucky", {
      lottery_history_id
    });
  }

  async getMyLucky() {
    return this.http.post("/growth_api/v1/lottery_lucky/my_lucky");
  }

  /** 掘友分成长任务；task_id=13 为阅读文章任务。 */
  async getGrowthTasks() {
    return this.http.post("/growth_api/v1/user_growth/task_list", { growth_type: 1 });
  }

  async getGrowthProgress() {
    return this.http.post("/growth_api/v1/user_growth/progress", { growth_type: 1 });
  }

  async getCheckInActivity() {
    return this.http.post("/user_api/v1/task/get", { lt_task_type: 1 });
  }

  async getTodayStatusV2() {
    return this.http.get("/growth_api/v2/get_today_status");
  }

  /** Matches the site's task synchronization performed after login. */
  async completeAvailableTasks() {
    return this.http.post("/user_api/v1/task/complete", {});
  }

  async getRecommendedArticles() {
    return this.http.post("/recommend_api/v1/article/recommend_all_feed", {
      id_type: 2,
      client_type: 2608,
      sort_type: 300,
      cursor: "0",
      limit: 20
    });
  }

  async getArticleDetail(articleId: string) {
    return this.http.post("/content_api/v1/article/detail", {
      article_id: articleId,
      req_from: 1,
      client_type: 2608,
      forbid_count: false,
      is_pre_load: false,
      need_theme: true
    });
  }

  /** Call only after the article's required 90-second reading interval. */
  async reportArticleRead(articleId: string) {
    return this.http.post("/growth_api/v1/user_growth/add_point_report", {
      growth_type: 1,
      task_id: 13,
      item_id: articleId
    });
  }
}

export default Growth;
