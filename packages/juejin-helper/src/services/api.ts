import axios from "axios";

/** Shared API envelope validation. Never accept a login/challenge HTML page as success. */
export function createApiClient() {
  const instance = axios.create({
    baseURL: "https://api.juejin.cn",
    timeout: 20000,
    headers: {
      referer: "https://juejin.cn/",
      origin: "https://juejin.cn"
    }
  });

  instance.interceptors.response.use(response => {
    const body = response.data;
    if (!body || typeof body !== "object" || typeof body.err_no !== "number") {
      throw new Error("掘金接口返回格式异常，请检查网络或登录状态");
    }
    if (body.err_no !== 0) {
      const error = new Error(body.err_msg || `掘金接口错误 (${body.err_no})`);
      Object.assign(error, { code: body.err_no });
      throw error;
    }
    return body.data;
  });

  return instance;
}

export default createApiClient();
