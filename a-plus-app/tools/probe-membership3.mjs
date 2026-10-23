import { withBrowser, sleep } from './cdp.mjs'
const base='http://127.0.0.1:5180'
await withBrowser({windowSize:{width:1440,height:1000}}, async (page)=>{
  await page.navigate(`${base}/community.html`); await page.waitForSelector('.community-app')
  await page.clearLocalStorage(); await page.reload(); await page.waitForSelector('.community-app')
  await page.setMembership('member'); await page.waitForSelector('.home-todo')
  const get=()=>page.eval(()=>{const app=document.querySelector('#app').__vue_app__;const s=app.config.globalProperties.$pinia._s.get('community');return {m:s.membership,todo:!!document.querySelector('.home-todo'),h1:document.querySelector('.page-heading h1')?.innerText,body:document.body.innerText.slice(0,80)}})
  console.log('home1', await get())
  await page.clickByText('我的', {selector:'.side-nav button', exact:false}); await sleep(500)
  console.log('profile', await get())
  await page.clickByText('首页', {selector:'.side-nav button', exact:false}); await sleep(800)
  console.log('home2', await get())
  await sleep(500)
  console.log('home2b', await get())
})
