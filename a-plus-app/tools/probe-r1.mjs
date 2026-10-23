import { withBrowser, sleep } from './cdp.mjs'
const base='http://127.0.0.1:5180'
await withBrowser({windowSize:{width:1440,height:1000}}, async(page)=>{
  await page.navigate(`${base}/community.html`); await page.waitForSelector('.community-app')
  await page.clearLocalStorage(); await page.reload(); await page.waitForSelector('.community-app'); await page.setMembership('member')
  await page.eval(()=>{const app=document.querySelector('#app').__vue_app__;const s=app.config.globalProperties.$pinia._s.get('community');const e=JSON.parse(s.readBackupJson());const p=e.state.posts.find(x=>x.title.includes('帮忙把两箱'));p.moderation='hidden';p.orderStatus='accepted-local-demo';p.orderEvents=[{id:'EVT-X',type:'accept',actor:'synthetic-counterpart',note:'old',createdAt:new Date().toISOString(),synthetic:true}];localStorage.setItem('community-mvp.synthetic-state.v1',JSON.stringify(e))})
  await page.reload(); await page.waitForSelector('.community-app'); await page.setMembership('member'); await sleep(300)
  const r=await page.eval(()=>{const app=document.querySelector('#app').__vue_app__;const s=app.config.globalProperties.$pinia._s.get('community');const p=s.posts.find(x=>x.title.includes('帮忙把两箱'));return {status:p.orderStatus,events:p.orderEvents,last:p.orderEvents?.at(-1),len:p.orderEvents?.length}})
  console.log(JSON.stringify(r,null,2))
})
