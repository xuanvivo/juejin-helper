const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildRuntime } = require("../../scripts/build-runtime.cjs");

test("the compiled runtime loads notifications and runs an account without a TypeScript interpreter", t => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "juejin-runtime-"));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  buildRuntime(destination);
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, ...args) {
      if (name === 'typescript' || name.startsWith('ts-node')) throw new Error('Runtime must not compile TypeScript');
      return load.call(this, name, ...args);
    };
    const notification = require('./workflows/utils/notification-kit');
    assert.equal(typeof notification.default.pushMessage, 'function');
    const { run } = require('./workflows/checkin');
    run({
      env: { COOKIE: 'test-only' }, tasks: [], log() {}, writeSummary: false,
      notification: { async pushMessage() { return { ok: true, sent: [], failed: [], skipped: [] }; } },
      createHelper: () => ({
        async login() {}, getUser: () => ({ user_id: '1' }), growth: () => ({}), async logout() {}
      })
    }).then(result => assert.equal(result.ok, true)).catch(error => { console.error(error); process.exitCode = 1; });
  `
    ],
    {
      cwd: destination,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: path.resolve(__dirname, "../../node_modules") }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(fs.readFileSync(path.join(destination, "package.json")));
  assert.equal(pkg.dependencies.typescript, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test("the QingLong launcher skips a completed Beijing day before accessing account APIs", t => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "juejin-guard-"));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  fs.writeFileSync(path.join(destination, `${today}.success`), "completed");
  const result = spawnSync("bash", [path.resolve(__dirname, "../../scripts/qinglong.sh")], {
    encoding: "utf8",
    env: { ...process.env, JUEJIN_STATE_DIR: destination }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /已成功完成掘金任务/);
});
