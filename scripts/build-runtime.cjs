const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function buildRuntime(destination = path.join(root, "runtime")) {
  const sdk = JSON.parse(fs.readFileSync(path.join(root, "packages/juejin-helper/package.json"), "utf8"));
  const workflow = JSON.parse(fs.readFileSync(path.join(root, "workflows/package.json"), "utf8"));
  const write = (relative, content) => {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const copy = (source, target = source) => write(target, fs.readFileSync(path.join(root, source)));

  copy("workflows/checkin.js");
  copy("workflows/package.json");
  for (const directory of ["workflows/tasks", "workflows/utils"]) {
    for (const filename of fs.readdirSync(path.join(root, directory))) {
      const relative = `${directory}/${filename}`;
      if (filename.endsWith(".js")) copy(relative);
      if (filename.endsWith(".ts")) {
        const result = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
          fileName: relative,
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
        });
        write(relative.replace(/\.ts$/, ".js"), result.outputText);
      }
    }
  }
  copy("packages/juejin-helper/build/juejin-helper.c.js");
  write(
    "packages/juejin-helper/package.json",
    JSON.stringify(
      {
        name: sdk.name,
        version: sdk.version,
        main: sdk.main,
        license: sdk.license,
        dependencies: sdk.dependencies
      },
      null,
      2
    ) + "\n"
  );
  write(
    "package.json",
    JSON.stringify(
      {
        name: "juejin-helper-runtime",
        version: workflow.version,
        private: true,
        engines: { node: ">=22" },
        scripts: { checkin: "node workflows/checkin.js" },
        dependencies: {
          axios: workflow.dependencies.axios,
          "juejin-helper": "file:packages/juejin-helper",
          nodemailer: workflow.dependencies.nodemailer
        }
      },
      null,
      2
    ) + "\n"
  );
  copy("scripts/qinglong.sh", "qinglong.sh");
  fs.chmodSync(path.join(destination, "qinglong.sh"), 0o755);
  return destination;
}

if (require.main === module) console.log(buildRuntime(process.argv[2]));
module.exports = { buildRuntime };
