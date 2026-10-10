class Cookie {
  cookie: string = "";
  stack: Map<string, unknown> = new Map();

  constructor(cookie: string = "") {
    if (cookie) {
      this.setCookieValue(cookie);
    }
  }

  setCookieValue(cookie: string = "") {
    this.stack.clear();
    this.cookie = cookie;
    cookie.split(";").forEach(part => {
      const separator = part.indexOf("=");
      if (separator > 0) {
        this.stack.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
      }
    });
  }

  get(key: string) {
    return this.stack.get(key);
  }

  has(key: string) {
    return this.stack.has(key);
  }

  set(key: string, value: unknown) {
    return this.stack.set(key, value);
  }

  entries() {
    return this.stack.entries();
  }

  clear(): void {
    this.cookie = "";
    this.stack.clear();
  }

  toString(): string {
    return this.cookie;
  }
}

export default Cookie;
