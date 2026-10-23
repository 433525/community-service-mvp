# 进度

- [x] 读取最新版功能说明约束、README 与主链相关源码。
- [x] 确认本地合成数据原型范围及非 Git 工作目录边界。
- [x] 回收 DeepSeek 对主链阻断点的只读审查。
- [x] 实现居民端“我的/服务记录”和“消息/服务进度”的 A+ 只读状态投影与刷新。
- [x] 允许工作台读取社区已被本机演练接单的求助，并安全跳过无关非求助内容。
- [x] 依据 DeepSeek 复核收口帖子 ID 重置冲突、重开记录关联、居民端进度可见范围和重新读取时的旧确认状态。
- [x] 补齐 A+ 常规服务动作门槛：先确认演练同意，再按动作要求必填信息完整；允许未完整时请求补充信息，保留高风险人工交接和安全退出。
- [x] 统一领域校验、存储层和界面中的门槛提示；修正当前 TypeScript 下的时间戳类型收窄并确认生产构建通过（326 个模块）。
- [x] 更新 README 与实施记录，注明本地演练范围及不可运营边界。
- [x] `npm run build` 通过；未运行测试套件，也未执行 Git 操作。
- [x] 2026-10-21 补充复核：重新运行 `npm run build` 成功（326 个模块）；`/` 与 `/community.html` 均返回 HTTP 200；DeepSeek 本轮追加只读复核超时，未取得新结论。

## 2026-10-23：样式分层 / 视觉回归 / 筛选深链

- [x] B 端 `style.css` 拆为 14 个分层文件（`src/community/styles/`），入口 24 行；拼接内容与原文件逐字节一致。
- [x] 新增 `tools/check-visual.mjs` + `tools/visual-baseline/`：7 个固定状态截图 SHA-256 比对，`--update` 重建基线。
- [x] 社区筛选写入 `?filter=`（白名单、`replaceState`、未知值清理），新增“复制视图链接”。
- [x] 构建通过；14 个门禁 **119/119**、深链 **29/29**、视觉 **7/7**、补充回归 **47/47**、单测 **50/50**；`audit-ui` 0、`probe-errors` 0、可部署性 **6/6**。
- [ ] 未完成：`src/App.vue` 拆分、真实浏览器/读屏器/200% 缩放人工验收、部署与 Git 提交。

## 2026-10-23：A+ 端 App.vue 拆分

- [x] 调研：W3C APG Modal Dialog、Vue 官方 Composables 指南、`focus-trap/tabbable` 判定口径、`a11y-dialog` 生命周期。
- [x] `src/aplus/presentation.ts`：角色/动作/原因文案、`formatDate`/`toLocalInput`/`defaultDueDate`、状态派生，全部纯函数。
- [x] `src/aplus/dialog-focus.ts`：初始焦点优先级、Tab 循环、Esc、焦点归还；排除 disabled / 不可见 / inert。
- [x] `src/aplus/toast.ts`：单条提示与定时器清理，错误等级仍由文案推断。
- [x] `src/aplus/workbench.ts`：唯一状态源（1,311 行，含分组注释），经 `context.ts` 的 provide/inject 下发。
- [x] 22 个子组件：11 个版面 + 10 个对话框；`src/App.vue` 1,923 → **88** 行。
- [x] 三条 scoped 样式落点复核：`intake-gate .button` 与 `button:disabled:hover` 已由全局规则覆盖，仅 `.mobile-nav button:disabled` 补入 `src/style.css`。
- [x] 新增 `tools/snapshot-dom.mjs`：11 个固定状态的规范化 `outerHTML` 对比，拆分前后**逐字节一致**。
- [x] 新增 `tools/unit/presentation.test.mjs`（11 条），单测 50 → **61**。
- [x] 验证：14 门禁 **119/119**、深链 **29/29**、视觉 **7/7**、补充 **47/47**、单测 **61/61**、`audit-ui` 0、`probe-errors` 0、可部署 **6/6**。
- [ ] 未完成：workbench 的进一步切片（社区桥/备份各自成 composable）、真实读屏器验收、部署与 Git 提交。

## 2026-10-23：首页公告轮播

- [x] 调研 W3C APG Carousel、APG 示例、`bluecadet/embla-carousel-a11y`、`nwidynski/embla-carousel-aria` 与 Embla Autoplay 文档；确认「焦点进入停止后是否自动恢复」存在分歧，按 APG 文档实现为不自动恢复。
- [x] 新增 `src/community/banner-slides.ts`（5 条合成公告 + 索引/滑动/暂停/文案纯函数）与 `src/community/components/HomeBanner.vue`（状态机、Pointer、键盘、ARIA）。
- [x] 首页在「我的待办」后插入公告轮播；桌面约 205px、390px 约 236px；四色调、Grid 同格堆叠避免切换回流。
- [x] 无障碍：`region`/`carousel`、`tabpanel`/`slide`、圆点 `tablist`、`aria-live` off↔polite、非当前页 `aria-hidden` + `inert` + `visibility:hidden`、播放按钮首个可聚焦。
- [x] 手势：40px 阈值、竖向意图让位滚动、滑动后 400ms 误触 click 拦截；`prefers-reduced-motion` 默认不播放，显式播放可覆盖。
- [x] 修复两个真实问题：方向键切换后原幻灯片变 `inert` 导致焦点掉到 `body`；鼠标点「暂停」被 `focusin` 先停播再反转。
- [x] 新增 11 条单测（50 → **72/72**）与 `tools/check-home-banner.mjs`（**24/24**）。
- [x] 视觉基线 7 → **8** 个状态（新增第三张 clay 色调、暂停态）；全量回归 14 门禁 **119/119**、补充 **47/47**、深链 **29/29**、视觉 **8/8**、`audit-ui` 0、`probe-errors` 0、可部署 **6/6**。
- [ ] 未完成：真机触屏/读屏器人工验收、跨浏览器矩阵、体积预算门禁、部署与 Git 提交。

## 2026-10-23：性能预算与资源自愈

- [x] 调研 Vite「Load Error Handling」、`ai/size-limit`、`bundlewatch`、`GoogleChrome/web-vitals`、web.dev CLS 会话窗口与 Vite 8 的浏览器兼容目标；确认 `event.payload` 与旧写法 `event.detail.payload` 的差异，主路径按文档并兼容两者。
- [x] 新增 `src/shared/chunk-recovery.ts`：`vite:preloadError` 一次性整页刷新（60s 冷却，sessionStorage 记时，隐私模式退化为内存）+ `loadWithRetry`（额外 1 次、400ms）。
- [x] `asyncView()` 接入重试；两个入口注入 `installChunkRecovery()`；冷却期内不 `preventDefault`，交由 `ViewError` 错误态处理。
- [x] 两个入口补 `<noscript>` 品牌化兜底（内联样式、零外链）与 `format-detection=telephone=no`。
- [x] 新增 `tools/check-budget.mjs` + `tools/budget.json`：入口 script + modulepreload + 样式表，raw/gzip 双指标，入口级/单资源/全站共 **14 项**。
- [x] 新增 `tools/check-web-vitals.mjs`：6 状态 CLS/LCP/FCP/长任务/TBT，采集器自检（人为偏移 0 → 1）；CLS 算法抽到 `tools/lib/web-vitals.mjs` 供单测复用。
- [x] 新增 `tools/check-noscript.mjs`：真禁用页面脚本后校验兜底页（可见/文案/链接/320px/居中）**20/20**；修正 `check-deployability` 把目录型路径 `/` 当文件的误报，归一化为 `index.html`。
- [x] 单测 72 → **85/85**（自愈 7 条 + Vitals 口径 6 条）。
- [x] 视觉基线 8 → **11** 个状态（B 审核 1440、B 消息 390、A+ 说明弹层 1440）；原 8 张哈希不变，新状态连续两次一致。
- [x] 实测：A+ 首屏 JS 254.3 kB（gzip 79.8）/ CSS 32.4 kB（7.4）；B 首屏 JS 190.5 kB（66.1）/ CSS 71.9 kB（14.4）；CLS 0、LCP 32–64ms、长任务 0。
- [ ] 未完成：真实弱网与真机（iOS Safari / 微信 X5）验证、Service Worker 离线缓存、视觉基线扩到弹层与审核页、部署与 Git 提交。

## 2026-10-23：离线可用与版本更新

- [x] 调研：MDN《Service Worker API》《ServiceWorkerRegistration.update()》《Cache.addAll()》、vite-plugin-pwa《Prompt for update》、Workbox `NetworkFirst` 的 `networkTimeoutSeconds`、Vite《Load Error Handling》。
- [x] 新增 `public/sw.js`（导航 network-first + 3s 超时、`/assets/*` cache-first、其余 SWR、`activate` 清旧缓存）与 `vite.config.ts` 的 `offline-sw` 插件（注入版本号与 16 项预缓存）。
- [x] 新增 `src/shared/offline-policy.ts`（纯函数）、`src/shared/offline.ts`（注册/在线状态/waiting 追踪/SKIP_WAITING）、`src/shared/components/OfflineNotice.vue`（两入口共用提示条）。
- [x] 两个入口接入 `installOfflineSupport()`；提示条 `role=status`、44px 按钮、390px 避开底栏、减少动效与强制配色。
- [x] 修掉两个真实缺陷：缓存读取忽略 `Vary`（断网后资源全 `ERR_FAILED`）、双入口用单 `index.html` 兜底导致串入口。
- [x] 新增 `tools/check-offline.mjs` **21/21**：独立端口起预览、断网即 kill 进程、先用 `127.0.0.1:1` 证明请求确实失败；覆盖注册/预缓存/断网两入口/按需分块/兜底页/恢复在线/390px/无 SW 降级/更新等待→稍后→再提示→立即更新→旧缓存清除。
- [x] 新增 `tools/unit/offline.test.mjs`（11 条），单测 85 → **96/96**。
- [x] 载荷预算按实测 +10% 调整（共享组件 CSS 进两入口）；实测 A+ 首屏 JS 257.1 kB（gzip 81.0）/ CSS 34.8 kB（8.2），B 193.3（67.2）/ 74.3（15.2）。
- [x] 回归：14 门禁 **119/119**、深链 **29/29**、轮播 **24/24**、视觉 **11/11**（哈希不变）、载荷 **14/14**、Vitals **6/6+自检**、无脚本 **20/20**、`audit-ui` 0、`probe-errors` 0、可部署 **6/6**。
- [x] 新增文档 `docs/离线可用与版本更新-2026-10-23.md`；README/progress 已同步。
- [ ] 未完成：真实设备（iOS Safari / 微信 X5）与真实弱网矩阵、存储配额耗尽场景、后台同步；部署与 Git 提交仍未做。

## 2026-10-23：缓存淘汰与弹层视觉基线

- [x] 调研：Workbox《Understanding storage quota》《Caching resources during runtime》（ExpirationPlugin 的 maxEntries / maxAgeSeconds / purgeOnQuotaError）、MDN《QuotaExceededError》三形态。
- [x] 新增 `src/shared/cache-expiration.ts`（纯函数：上限 64、7 天、`x-sw-cached-at` 时间戳头、两段式淘汰、配额错误判定）。
- [x] `public/sw.js`：写入加盖时间戳头、`trimCache`（先过期后最旧、预缓存跳过）、配额写满清空运行时条目后重试一次、`activate` 家政、`TRIM_CACHE` 消息通道。
- [x] 视觉基线 11 → **15**：新增 A+ 新建/状态流转/高风险/投诉四个弹层（1440）；钉死 `datetime-local` 默认值消除逐日漂移；原 11 张哈希逐张比对不变。
- [x] 单测 96 → **106/106**（新增 10 条）；离线门禁 21 → **24/24**（OF22 时间戳头、OF23 TRIM 精确删 10 条、OF24 配额重试路径）。
- [x] 回归：14 门禁 **119/119**、深链 **29/29**、轮播 **24/24**、视觉 **15/15**、补充 **47/47**、载荷 **14/14**、Vitals **6/6+自检**、无脚本 **20/20**、`audit-ui` 0、`probe-errors` 0、可部署 **6/6**。
- [x] 新增文档 `docs/缓存淘汰与弹层视觉基线-2026-10-23.md`；README/progress 已同步。
- [ ] 未完成：真实配额耗尽与真机（iOS Safari / 微信 X5）/弱网矩阵、A+ 其余 6 个业务弹层视觉基线、workbench 按域切片；部署与 Git 提交仍未做。
