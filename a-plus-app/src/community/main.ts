import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import 'vant/lib/style/css-variables.css'
import 'vant/lib/style/normalize.css'
import 'vant/lib/style/base.css'
import 'vant/lib/style/animation.css'
import 'vant/lib/overlay/index.css'
import 'vant/lib/popup/index.css'
import 'vant/lib/button/index.css'
import 'vant/lib/dialog/index.css'
import './style.css'

createApp(App).use(createPinia()).mount('#app')
