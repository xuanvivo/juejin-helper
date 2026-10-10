module.exports = {
  async wait(time = 0) {
    return new Promise(resolve => setTimeout(resolve, time));
  },
  randomRangeNumber(start = 500, end = 1000) {
    return (Math.random() * (end - start) + start) >> 0;
  },
  getUsersCookie(env) {
    const users = [env.COOKIE];
    const keys = Object.keys(env)
      .filter(key => /^COOKIE_[0-9]+$/.test(key))
      .sort((left, right) => Number(left.slice(7)) - Number(right.slice(7)));
    keys.forEach(key => users.push(env[key]));
    return [
      ...new Set(
        users
          .filter(cookie => typeof cookie === "string")
          .map(cookie => cookie.trim())
          .filter(Boolean)
      )
    ];
  },
  errorMessage(error) {
    // Axios errors can contain Cookie headers and token-bearing notification URLs.
    if (error && error.isAxiosError) {
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") return "请求超时，请稍后重试";
      return error.response ? `请求失败 (HTTP ${error.response.status})` : "网络请求失败，请稍后重试";
    }
    return String(error && error.message ? error.message : "任务执行异常")
      .replace(/https?:\/\/\S+/gi, "[链接已隐藏]")
      .replace(/(?:cookie|authorization)\s*[:=][^\r\n]*/gi, "[凭据已隐藏]")
      .replace(/token\s*[:=]\s*[^\s]+/gi, "[凭据已隐藏]")
      .slice(0, 240);
  },
  escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      character =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[character])
    );
  }
};
