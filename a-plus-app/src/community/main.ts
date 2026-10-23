import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { installChunkRecovery } from '../shared/chunk-recovery'
import { installErrorReporting } from '../shared/error-reporting'
import { installOfflineSupport } from '../shared/offline'
import { vTablist } from '../shared/tablist'
import './style.css'

installChunkRecovery()
installOfflineSupport()

const app = createApp(App)
app.use(createPinia())
app.directive('tablist', vTablist)
installErrorReporting(app, 'community')
app.mount('#app')
