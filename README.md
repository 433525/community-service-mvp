# 社区服务演练原型（A+ 受理工作台 + B 受控社区）

Vue 3 + Vite + TypeScript + Pinia 的纯前端交互原型，双入口、全部为本机合成数据；无后端、无真实登录、无真实消息投递，**不能用于真实运营**。

- A+ 受理工作台：`http://127.0.0.1:5180/`
- B 社区演练：`http://127.0.0.1:5180/community.html`

## 启动

```sh
cd a-plus-app
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 5180 --strictPort
```

开发模式用 `npm run dev`（默认 5173），验收脚本默认以 `--base=http://127.0.0.1:5180` 运行。

## 验证

```sh
npm run build                 # vue-tsc + vite
npm run test:unit             # node:test 领域单测
node tools/audit-ui.mjs       # 对比度/触控/标签/溢出审计
node tools/probe-errors.mjs   # 控制台异常探测
```

`tools/check-*.mjs` 为逐项验收脚本（14 组门禁，串行运行，勿并发）；功能与命令清单见 [应用说明](a-plus-app/README.md)。

## 文档

设计与交付文档在 `docs/`，入口见 [交付-2026-10-21-产品级重构](docs/交付-2026-10-21-产品级重构.md)、[上线前检查-2026-10-22](docs/上线前检查-2026-10-22.md)、[部署说明-2026-10-22](docs/部署说明-2026-10-22.md)。仓库同步记录见 [私有仓库交付记录](docs/私有仓库交付记录.md)。

## 仓库约定

- 不入库：`node_modules`、`dist`、编辑器与本机配置、浏览器存档、验收截图（`docs/运营准备/evidence*`、`a-plus-app/.survey`）。
- 不引入外部字体/CDN/统计脚本；离线可用，根路径静态部署。
- 数据必须为合成演练数据，禁止真实个人信息。
