<script setup lang="ts">
/**
 * A+ 受控登记演练入口。
 *
 * 这里只做三件事：装配工作台、把唯一状态源 provide 给子树、按阅读顺序摆放版面。
 * 具体状态与动作见 `src/aplus/workbench.ts`，纯展示逻辑见 `src/aplus/presentation.ts`。
 */
import { provide, type ComponentPublicInstance } from 'vue'
import { APLUS_WORKBENCH_KEY } from './aplus/context'
import { useAplusWorkbench } from './aplus/workbench'
import AppSideRail from './aplus/components/AppSideRail.vue'
import AppTopBar from './aplus/components/AppTopBar.vue'
import PageHeading from './aplus/components/PageHeading.vue'
import IntakeGate from './aplus/components/IntakeGate.vue'
import SyntheticBanner from './aplus/components/SyntheticBanner.vue'
import BackupTextPanel from './aplus/components/BackupTextPanel.vue'
import MetricGrid from './aplus/components/MetricGrid.vue'
import QueuePanel from './aplus/components/QueuePanel.vue'
import CaseDetail from './aplus/components/CaseDetail.vue'
import ComplaintPanel from './aplus/components/ComplaintPanel.vue'
import MobileNav from './aplus/components/MobileNav.vue'
import OfflineNotice from './shared/components/OfflineNotice.vue'
import CommunityBridgeDialog from './aplus/components/dialogs/CommunityBridgeDialog.vue'
import CreateCaseDialog from './aplus/components/dialogs/CreateCaseDialog.vue'
import TransitionDialog from './aplus/components/dialogs/TransitionDialog.vue'
import HighRiskStopDialog from './aplus/components/dialogs/HighRiskStopDialog.vue'
import FollowUpDialog from './aplus/components/dialogs/FollowUpDialog.vue'
import ContactSimulationDialog from './aplus/components/dialogs/ContactSimulationDialog.vue'
import ReopenDialog from './aplus/components/dialogs/ReopenDialog.vue'
import CheckpointDialog from './aplus/components/dialogs/CheckpointDialog.vue'
import ComplaintDialog from './aplus/components/dialogs/ComplaintDialog.vue'
import HelpDialog from './aplus/components/dialogs/HelpDialog.vue'

const workbench = useAplusWorkbench()
provide(APLUS_WORKBENCH_KEY, workbench)

const { anyDialogOpen, backupInput, importBackupFile, toastMessage, toastIsError } = workbench

/**
 * 隐藏的文件输入由工作台的 `chooseBackup()` 触发点击，因此这里用函数式 ref
 * 显式回填引用：字符串 ref 不会在类型层面“读取”该绑定，容易被误判为未使用。
 */
function bindBackupInput(el: Element | ComponentPublicInstance | null) {
  backupInput.value = el instanceof HTMLInputElement ? el : null
}
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#aplus-main">跳到主内容</a>
    <AppSideRail />

    <main id="aplus-main" class="main-area" tabindex="-1" :inert="anyDialogOpen">
      <input :ref="bindBackupInput" class="visually-hidden" type="file" tabindex="-1" aria-label="选择 JSON 备份文件导入" accept="application/json,.json" @change="importBackupFile" />
      <AppTopBar />

      <div class="content">
        <PageHeading />
        <IntakeGate />
        <SyntheticBanner />
        <BackupTextPanel />

        <div class="work-zone">
          <MetricGrid />
          <section class="work-grid">
            <QueuePanel />
            <CaseDetail />
          </section>
        </div>

        <ComplaintPanel />
        <MobileNav />
      </div>
    </main>

    <CommunityBridgeDialog />
    <CreateCaseDialog />
    <HighRiskStopDialog />
    <TransitionDialog />
    <FollowUpDialog />
    <ContactSimulationDialog />
    <ReopenDialog />
    <CheckpointDialog />
    <ComplaintDialog />
    <HelpDialog />

    <div v-if="toastMessage" class="toast" :role="toastIsError ? 'alert' : 'status'" :aria-live="toastIsError ? 'assertive' : 'polite'">{{ toastMessage }}</div>
    <OfflineNotice />
  </div>
</template>
