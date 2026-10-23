# 修复轮问题清单 · A+ 受理端

> 先说结论：`run-record-all.json` 的 24 个步骤中有 5 项失败（A1、A4、B1c、B4、B6）。按当前源码判断，其中 4 项已在代码中加入约束、属于**待复验**；B6 仍可在未保留原文的情况下覆盖不可读旧存档，属于**未闭环缺陷**。本轮只做证据整理与源码比对，没有复跑浏览器，**不构成验收结论**。

## 0. 文档信息

| 项 | 内容 |
| --- | --- |
| 本清单 | `D:\Users\10974\Documents\ChatGPT\网页开发\docs\修复轮问题清单-A+端.md` |
| 项目 | `D:\Users\10974\Documents\ChatGPT\网页开发\a-plus-app`（Vue 3 + Vite，本机合成数据 MVP） |
| 审计记录 | `D:\Users\10974\Documents\ChatGPT\网页开发\docs\运营准备\evidence-audit-aplus-prefix\run-record-all.json` |
| 记录时间 | 2026-10-21T12:36:00.469Z（本地 20:36） |
| 运行地址 | `http://127.0.0.1:5180` |
| 规模 | 24 步 / 5 项失败；`pageErrors=0`、`consoleErrors=0` |
| 同目录证据 | 审计记录所在目录下的步骤 PNG；`run-record-actions.json`、`run-record-backup.json`、`run-record-community.json`、`run-error.txt` |
| 源码读取 | 2026-10-21 20:54 起；文件 mtime：`src/App.vue` 20:53:56、`src/stores/intake.ts` 20:46:38、`src/domain/intake.ts` 20:46:38、`src/domain/intake-backup.ts` 20:53:37 |

**状态口径**

- **实测缺陷**：审计证据中失败，且当前源码仍存在可复现路径。
- **已修复待复验**：当前源码已加入对应校验/处理，但本轮未在浏览器重放，不能视为通过。

**严重度口径**：高＝数据丢失、来源伪造或流程阻断；中＝误导或一致性风险；低＝提示/体验问题。

## 1. 失败项

### 1.1 总览

| 编号 | 标题 | 严重度 | 状态 |
| --- | --- | --- | --- |
| A1 | 手动登记的来源渠道校验 | 中 | 已修复待复验 |
| A4 | 投诉复核角色闭环（死锁） | 高 | 已修复待复验 |
| B1c | 导入成功后备份文本面板未同步 | 中 | 已修复待复验 |
| B4 | 来源渠道与社区帖子 ID 的一致性校验 | 高 | 已修复待复验 |
| B6 | 无法读取旧存档时的保护 | 高 | **实测缺陷** |

---

### A1 手动登记的来源渠道校验

- **严重度**：中
- **状态**：已修复待复验
- **复现步骤**
  1. 打开“新建演练记录”，填写模拟登记摘要；
  2. “来源渠道演练标记”选择“社区入口演练（仅本机）”；
  3. 不提供社区帖子 ID（表单也没有该输入项），提交。
- **期望**：合法来源可以保存；“社区入口”缺少社区帖子 ID 时应被拒绝或明确提示。
- **实际**（`run-record-all.json` → `steps[A1]`、`observations.sourceChannel`）：生成了 `SYNTH-010`，`sourceChannel=community-entry-local`、`sourcePostId=null`，toast 仍为“演练记录已加入队列”；同轮 `other-fictional` 的 `SYNTH-009` 正常保存。
- **源码位置**
  - `src/stores/intake.ts:createCase()` 465–496：现在要求渠道值合法（488–490）、`community-entry-local` 必须带 `sourcePostId`（491–493）、帖子 ID 只能用于社区入口（494–496）。
  - `src/App.vue:createForm` 206–215、模板 1595–1600：表单只有渠道下拉，没有帖子 ID 输入，也没有就地提示。
  - 导入侧的同源规则见 B4。
- **证据文件**：`a1-manual-source-channel.png`
- **判断依据**：审计后源码在 `createCase` 增加了上述约束。按当前逻辑，同一操作会返回“选择‘社区入口演练（仅本机）’时必须关联社区帖子 ID；没有来源帖子请改选人工录入演练。”，不会落库。
- **复验要点**：重跑原步骤，确认被拒且提示可见；另测 `community-entry-local` + 合法帖子 ID 仍可创建，`other-fictional` 不受影响。
- **残余风险**：表单没有帖子 ID 字段，选错渠道只能在提交后看到报错；选项旁缺少常驻说明，属体验问题，本轮不要求改。

---

### A4 投诉复核角色闭环（死锁）

- **严重度**：高
- **状态**：已修复待复验
- **复现步骤**
  1. 以“演示 · 复核席”选中任意记录，提交投诉，被投诉角色选“演示 · 转介席”；
  2. 生成 `CMP-001`（待复核）；
  3. 依次切换“演示 · 转介席 / 复核席 / 受理席”尝试“确认复核”。
- **期望**：任一可达演示角色都应能完成复核，或在提交时阻止形成无人可复核的投诉。
- **实际**（`steps[A4]`、`observations.complaintDeadlock`）：`CMP-001` 的 `submittedByRole=demo-review`、`targetRole=demo-referral`；三个角色分别提示“被投诉角色不能复核针对自己的投诉”“投诉提交人不能复核自己的投诉”“只有 demo-review 或 demo-referral 演示角色可以复核”，`confirmDisabled=true/true/true`，投诉永久停在待复核。
- **源码位置**
  - `src/domain/intake.ts:createComplaintRecord()` 501–527：516–525 计算可用复核人，若过滤后为空则拒绝提交。
  - `src/domain/intake.ts:reviewComplaintRecord()` 536–571：542–550 仍保留复核角色与回避校验。
  - `src/domain/intake.ts:validateComplaint()` 440–490：只校验已记录字段，未校验“是否存在可达复核人”。
  - `src/App.vue:selectedComplaintReviewBlockedReason` 351–361、模板 1454–1460：按钮禁用逻辑未变。
- **证据文件**：`a4-complaint-deadlock.png`
- **判断依据**：`COMPLAINT_REVIEWER_ROLES` 仅 `demo-review`、`demo-referral`（`src/domain/intake.ts:404`）。CMP-001 的组合过滤掉提交人与被投诉角色后为空，当前代码会在提交阶段直接返回“该投诉组合没有可用的复核角色……请调整投诉对象或切换提交角色后再试。”，原死锁路径不再可达。
- **复验要点**：重跑原组合，确认无法提交；再回归 A5（受理席投诉复核席、由转介席复核）仍可完成。
- **残余风险**：`validateComplaint` 没有“可达复核人”约束，历史备份/旧存档里的死锁投诉仍可导入并永久卡在待复核；详情面板对这类记录还会先显示“当前演示角色可复核（仍受提交人 / 被投诉角色回避限制）”，再显示不可复核原因，文案自相矛盾。

---

### B1c 导入成功后备份文本面板未同步

- **严重度**：中
- **状态**：已修复待复验
- **复现步骤**
  1. 点“查看备份文本”，面板展开并生成导入前快照（17,783 B）；
  2. 导入一份合法备份（其导出快照 16,935 B）。
- **期望**：面板应关闭或刷新为导入后的快照，不能继续展示导入前的旧 JSON。
- **实际**（`steps[B1c]`、`observations.importRoundTrip`）：导入 toast 成功，但 `stalePanel=true`、`panelOpen=true`、`panelBytes=17783`、`exportedBytes=16935`，面板仍是旧内容。
- **源码位置**
  - `src/App.vue:importBackupFile()` 569–597：导入成功后 `backupText.value = ''`（587）。
  - `src/App.vue:viewBackupText()` 534–541：每次点击重新 `store.exportBackup()`。
  - `src/App.vue` 备份面板 1220–1230：`v-if="backupText"`，清空即关闭。
- **证据文件**：`b1c-stale-backup-text.png`
- **判断依据**：当前导入成功分支会清空 `backupText`，面板随 `v-if` 关闭；不存在“导入后仍保留旧快照”的路径。
- **复验要点**：展开面板 → 导入 → 确认面板关闭；再次点“查看备份文本”应显示导入后的数据。
- **残余风险**：**重置**路径没有清空 `backupText`（同目录分组记录 B8 已记录，未并入本轮 5 项），见第 3 节。

---

### B4 来源渠道与社区帖子 ID 的一致性校验

- **严重度**：高
- **状态**：已修复待复验
- **复现步骤**
  1. 取一份合法备份，把 `SYNTH-001` 改成 `sourceChannel=manual-entry`、`sourcePostId=AUDIT-POST-accepted`；
  2. 导入该备份；
  3. 打开社区桥查看 `AUDIT-POST-accepted` 对应求助。
- **期望**：导入应拒绝 `manual-entry` 渠道携带社区帖子 ID，避免伪造“已登记”并阻断真实登记。
- **实际**（`steps[B4]`、`observations.forgedLink`）：`toast=已导入并保存演练备份`；社区桥显示“已登记 · SYNTH-001 · 初筛中 · 已停止常规初筛 · 风险未解除”，`hasRegisterButton=false`，真实登记入口被占位。
- **源码位置**
  - `src/domain/intake-backup.ts:parseIntakeBackup()` 322–344：遍历 case 时校验帖子 ID 重复（326–329）与来源渠道一致性（330–333），错误汇总后整体拒绝（360）。
  - `src/stores/intake.ts:createCase()` 494–496：创建侧的同一规则。
  - `src/domain/intake.ts:validateIntakeCase()` 915–921：只校验渠道值合法与帖子 ID 非空，不做交叉校验（交叉规则放在备份层）。
- **证据文件**：`b4-forged-link.png`
- **判断依据**：当前导入会返回“SYNTH-001：社区来源帖子 ID 只适用于‘社区入口演练（仅本机）’来源。”并拒绝整份备份，不再接受伪造关联。
- **复验要点**：重跑伪造备份导入，确认被拒且原数据不变；另测合法 `community-entry-local` + 帖子 ID 可导入。
- **残余风险（同根因，当前未覆盖）**
  1. 反向缺口：`community-entry-local` 且**没有** `sourcePostId` 的备份仍可导入（创建侧已禁止，导入侧未禁止）。
  2. 缺省渠道：`sourceChannel` 缺失但带 `sourcePostId` 的历史记录仍可导入（330 只在 `sourceChannel !== undefined` 时校验），同样会被社区桥识别为“已登记”并占位。

---

### B6 无法读取旧存档时的保护

- **严重度**：高
- **状态**：**实测缺陷**（未闭环，详见“判断依据”）
- **复现步骤**
  1. 向 `localStorage['a-plus.synthetic-intake.v1']` 写入不可解析的内容，刷新页面；
  2. 界面显示“发现无法读取的旧存档，尚未覆盖”，并提供“下载无法读取的旧存档”；
  3. 不下载，直接点“重置演练”并确认。
- **期望**：界面声明“尚未覆盖”，重置/新建不应在未保留原文的情况下丢弃不可读旧存档。
- **实际**（`steps[B6]`、`observations.recovery`）：`download=true`、`createOpened=true`（新建可打开，保存时才被 `createError=旧存档无法读取，请先导出旧存档或恢复备份后再修改。` 拦住）；但 `resetValid=true`、`unreadableLost=true`，重置后状态变为“已保存在当前浏览器 · 最近保存 2026/10/21 20:35”，不可读原文被初始数据覆盖。
- **源码位置**
  - `src/App.vue:resetDemo()` 1121–1138：新增了不可读存档专用确认文案（1122–1126，明确“会覆盖且无法恢复，请先下载”），但确认后仍直接 `store.reset()`（1127）。
  - `src/App.vue:importBackupFile()` 569–597：只有通用替换确认，没有不可读存档分支。
  - `src/stores/intake.ts:replaceSnapshot()` 356–365：绕过 `commitSnapshot()` 对 `recovery-required` 的拦截（342–344）；`reset()` 457–463、`importBackup()` 423–435 都走这条路径。
  - `src/stores/intake.ts:writeSnapshot()` 271–313：写入成功后 `unreadableBackup.value = null`（307），内存里的原文也不再保留。
  - `src/stores/intake.ts:loadInitialState()` 173–185：不可读时保留 `unreadableBackup`，这是当前唯一的原文来源。
- **证据文件**：`b6-recovery-reset.png`
- **判断依据**：与审计时相比，源码增加了“覆盖不可恢复”的确认提示和下载入口（`src/App.vue:1122–1126`、1215），属于**缓解**；但没有任何强制或自动保留动作，用户确认后仍会丢失唯一原文，未满足“不应在未保留原文的情况下丢弃”的原期望。
- **复验要点**：构造不可读存档 → 不下载直接重置 → 检查原文是否仍可取回（当前会丢失）；再测导入覆盖路径。
- **残余风险**：`importBackup()` 同样可以覆盖不可读存档，且提示比重置更弱（通用“完整替换”）；建议重置/导入前强制导出或增加“已保存原文”二次确认。本轮只归档，不改源码。

## 2. 通过项（简述）

> “通过”仅指该轮证据中该步骤未失败，**不等于验收通过**。

### 2.1 登记与社区桥容错（C1–C8）

| 编号 | 场景 | 结果摘要 | 证据 |
| --- | --- | --- | --- |
| C1 | 社区读取器接受 6 种订单状态 | 9 条合成求助全部列出，6 类状态标签齐全，非求助动态忽略 | `c1-bridge-all-statuses.png` |
| C2 | 首次登记社区求助 | 生成 `SYNTH-006`（`community-entry-local` + `AUDIT-POST-open`），社区原文未写回 | `c2-registered.png` |
| C3 | 进度回显与重复打开去重 | 显示“已登记 · SYNTH-006”，再打开不新增（`sourceCases=1`） | `c3-reopen-no-duplicate.png` |
| C4a | 重复候选进入人工复核 | 暂停创建，展示复核说明与 2 个确认框，候选未合并/覆盖 | `c4a-duplicate-review.png` |
| C4b | 复核后创建独立记录 | 生成 `SYNTH-008`，含 `duplicate-review` 事件并关联 `SYNTH-007` | `c4b-duplicate-created.png` |
| C5 | A+ 进度回显到社区“服务记录” | 本人求助行显示状态、已收件/已登记与最近更新时间 | `c5-progress.png` |
| C6 | 单条损坏记录跳过 | 有效 9 条照常列出，提示“跳过 1 条无法解析的记录”，原始存档未改 | `c6-malformed-skipped.png` |
| C7 | 社区存档整体损坏 | 停止读取并提示，不展示列表，A+ 记录与原文均不变 | `c7-community-bad-json.png` |
| C8 | 社区存档版本不符 | 提示版本/结构不兼容，停止读取，不写回 | `c8-community-bad-version.png` |

### 2.2 高风险、投诉与暂停（A2/A3、A5/A6）

| 编号 | 场景 | 结果摘要 | 证据 |
| --- | --- | --- | --- |
| A2 | 高风险停止初筛后锁定常规操作 | 追加 `HIGH_RISK_STOP_SCREENING`，下一步改为人工处置提示，仅保留交接/投诉按钮 | `a2-high-risk-stop.png` |
| A3 | 高风险交接可反复记录 | 追加 2 条 `risk-handoff`（暂无人接手/有人接手），状态与风险标记保持 | `a3-handoff.png` |
| A5 | 独立投诉复核且不动 case 时间线 | `CMP-002` 由 `demo-referral` 复核，case 事件 3→3、风险标记 1→1 | `a5-complaint-reviewed.png` |
| A6 | 暂停/恢复新登记并跨刷新保持 | 新建与社区登记入口禁用，刷新后仍暂停，恢复后可用 | `a6-paused.png` |

### 2.3 备份、导入与运行时（B1a/B1b、B2/B3/B5/B7、Z1）

| 编号 | 场景 | 结果摘要 | 证据 |
| --- | --- | --- | --- |
| B1a | 暂停状态下导出完整备份 | 含 `intakePaused=true`、10 条案例、2 条投诉、选中记录 | `b1a-export.png` |
| B1b | 导出→导入往返 | `cases 11→10`、`paused=true`、`roundTrip=true`（导出后新增记录被回滚） | `b1b-roundtrip.png` |
| B2 | 五类篡改/版本不符 | 版本号、非法状态、非法渠道、投诉关联不存在、重复帖子 ID 全部拒绝，内存与本机原始存档不变 | `b2-tamper-rejected.png` |
| B3 | 导入写入失败 | 提示“无法写入本机存档，当前演练数据未变更”，状态与原文均不变 | `b3-write-failure.png` |
| B5 | UTF-8 BOM 备份导入 | 带 BOM 的备份成功解析并导入 | `b5-bom.png` |
| B7 | 重置后仍可用合法备份恢复 | `cases=10`、`paused=true`、`roundTrip=true` | `b7-recovered.png` |
| Z1 | 页面运行无未捕获异常 | `pageErrors=0`、`consoleErrors=0` | 无文件，见记录 `observations` |

## 3. 边界与未覆盖

1. **未做真机与读屏器**：本轮没有 iOS/Android 实机、NVDA/VoiceOver/TalkBack 验证；可访问性不在本轮结论内。
2. **未做全量导入边界**：未覆盖 5 MB 上限附近、极长事件时间线、1,000 条记录上限、存储配额耗尽、隐私模式、跨浏览器、多标签并发导入、损坏文件模糊矩阵。
3. **未复跑修复**：本轮只读源码，没有启动 dev server、没有用浏览器重放。所有“已修复待复验”必须重跑对应分组后才能销项。
4. **不构成验收**：本清单不得被引用为“A+ 端验收通过”“缺陷清零”或上线依据。
5. **证据路径说明**：本轮证据目录为 `D:\Users\10974\Documents\ChatGPT\网页开发\docs\运营准备\evidence-audit-aplus-prefix\`；`run-record-all.json` 内各 step 的 `files` 字段仍记录旧目录名 `evidence-audit-aplus`（同一批文件，内容一致）。本清单按 `-prefix` 目录核对，证据文件名不变，PNG/TXT 均在该目录下。
6. **工具记录**：`run-error.txt`（20:33）显示备份分组脚本在 `tools/audit-aplus.mjs:893` 抛 `TypeError: Cannot set properties of undefined (setting 'caseId')`；随后 `run-record-backup.json`（20:37）正常产出，all 记录不受影响，但该审计脚本缺陷仍在。
7. **未并入本轮 5 项的分组失败**：`run-record-actions.json` 记有 A7（筛选切到“高风险”后详情仍停留 `SYNTH-002`，队列为 `SYNTH-001/SYNTH-005`）；`run-record-backup.json` 记有 B8（重置后备份文本仍为旧快照）、B9（导入接受空摘要记录）。按当前源码看 B8、B9 仍未闭环：`resetDemo()` 未清 `backupText`；`isIntakeCase()` 与 `validateIntakeCase()` 均未要求 `summary` 非空。建议下一轮单列复核，本轮不扩项。
8. **数据范围**：全部为合成演练数据与本机 localStorage，不涉及真实居民信息、真实通知、真实转介或生产权限。

## 4. 修复后补记（Lead，2026-10-21 21:00 前后）

本节由主控按实际修复与复验更新；上文“已修复待复验/未闭环”的判断以本节为准。

- A1 来源渠道与帖子 ID：`createCase` 已双向校验；“社区入口演练”缺少帖子 ID 被拒绝，非社区来源携带帖子 ID 被拒绝；备份导入同样拒绝非社区来源 + 帖子 ID，并拒绝空摘要。
- A4 投诉复核死锁：`createComplaintRecord` 在提交时检查可用复核角色（demo-review/demo-referral 且非提交人/被投诉角色），无可用角色直接拒绝。已实测通过。
- B1c 导入后备份面板：导入成功后清空 `backupText`，面板关闭（代码核对）。
- B4 导入伪造关联：备份校验新增 sourcePostId 与 sourceChannel 一致性规则（代码核对）。
- B6 无法读取旧存档保护：新增“必须先下载无法读取的旧存档，才允许重置或导入”的界面守卫；`resetDemo` 与 `importBackupFile` 均检查。已闭环（代码核对）。
- A7/B8/B9：筛选变化后若当前详情不在结果中自动选中首条（已实测 A5）；重置时清空备份文本面板（代码核对）；导入拒绝空摘要（代码核对）。
- 复验证据：`docs/运营准备/evidence-fixes2/` + `tools/check-fixes2.mjs`，**10/10 通过**；详细报告见 `docs/运营准备/2026-10-21-修复轮验证.md` §7。

仍未完成：真机/读屏器、全量导入边界、审计脚本自身缺陷（`audit-aplus.mjs` 备份组 TypeError、a11y 脚本假设 Esc 不关闭弹层）。
