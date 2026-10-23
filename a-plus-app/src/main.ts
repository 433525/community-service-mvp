import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { installChunkRecovery } from './shared/chunk-recovery'
import { installErrorReporting } from './shared/error-reporting'
import { installOfflineSupport } from './shared/offline'
import { vTablist } from './shared/tablist'

installChunkRecovery()
installOfflineSupport()

const app = createApp(App)
app.use(createPinia())
app.directive('tablist', vTablist)
installErrorReporting(app, 'intake')
app.mount('#app')
