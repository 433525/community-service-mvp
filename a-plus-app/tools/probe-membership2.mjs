import { withBrowser, sleep } from './cdp.mjs'
const base='http://127.0.0.1:5180'
await withBrowser({windowSize:{width:1440,height:1000}}, async (page)=>{
  await page.navigate(`${base}/community.html`); await page.waitForSelector('.community-app')
  await page.clearLocalStorage(); await page.reload(); await page.waitForSelector('.community-app')
  await page.setMembership('member'); await page.waitForSelector('.home-todo')
  await page.clickByText('社区', {selector:'.side-nav button', exact:false}); await page.waitForSelector('.post-card')
  const click=(text,label)=>page.eval((t,l)=>{const norm=v=>(v||'').replace(/\s+/g,' ').trim();const card=Array.from(document.querySelectorAll('.post-card')).find(n=>norm(n.innerText).includes(t));const b=card&&Array.from(card.querySelectorAll('button')).find(n=>norm(n.innerText)===l&&!n.disabled);if(!b)return {ok:false,buttons:card?Array.from(card.querySelectorAll('button')).map(n=>norm(n.innerText)):[]};b.click();return {ok:true}},text,label)
  console.log('accept', await click('帮忙把两箱','演练接单')); await sleep(300)
  console.log('signup', await click('周六步道清洁','演练报名')); await sleep(500)
  console.log('cancelText?', (await page.bodyText()).includes('取消演练报名'))
  console.log('before home membership', await page.eval(()=>{const app=document.querySelector('#app').__vue_app__;const s=app.config.globalProperties.$pinia._s.get('community');return s.membership}))
  await page.clickByText('首页', {selector:'.side-nav button', exact:false}); await sleep(500)
  console.log('after home', await page.eval(()=>{const app=document.querySelector('#app').__vue_app__;const s=app.config.globalProperties.$pinia._s.get('community');return {m:s.membership,todo:!!document.querySelector('.home-todo'),h1:document.querySelector('.page-heading h1')?.innerText}}))
})
