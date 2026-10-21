# 社区服务 MVP

Vue 3 + Vite + Vant，本地合成数据交互原型。

## 启动

```sh
cd a-plus-app
npm ci
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

- 社区入口：http://127.0.0.1:5180/community.html
- A+ 受理工作台：http://127.0.0.1:5180/

功能与使用限制详见 [应用说明](a-plus-app/README.md)。当前没有后端、真实登录或真实消息发送；浏览器本地存储只适合合成数据演示。JSON 下载在自动化浏览器中尚未完成成功落盘验收。

此仓库保存 MVP 源码及选定的方案文档；不包含 node_modules、dist、本机配置、浏览器存档或验收截图。
