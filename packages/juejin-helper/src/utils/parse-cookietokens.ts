import Cookie from "./cookie";

function parseCookieTokens(cookie: Cookie) {
  const cookieTokens = {
    aid: "2608",
    uuid: "",
    user_unique_id: "",
    web_id: ""
  };

  const tokensReg = /^__tea_cookie_tokens_(\d+)$/;
  for (const [key, value] of Array.from(cookie.entries())) {
    const match = key.match(tokensReg);
    if (match && typeof value === "string") {
      cookieTokens.aid = match[1];
      try {
        const json = JSON.parse(decodeURIComponent(decodeURIComponent(value)));
        cookieTokens.uuid = json.user_unique_id || "";
        cookieTokens.user_unique_id = json.user_unique_id || "";
        cookieTokens.web_id = json.web_id || "";
        break;
      } catch {
        // Analytics cookies are optional and must not prevent account login.
      }
    }
  }

  return cookieTokens;
}

export { parseCookieTokens };
