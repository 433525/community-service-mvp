import { withBrowser, sleep } from './cdp.mjs'
const base='http://127.0.0.1:5180'
await withBrowser({windowSize:{width:1440,height:1000}}, async (page)=>{
  await page.navigate(`${base}/community.html`); await page.waitForSelector('.community-app')
  await page.clearLocalStorage(); await page.reload(); await page.waitForSelector('.community-app')
  await page.setMembership('member'); await page.waitForSelector('.home-todo')
  const getMembership=()=>page.eval(()=>{const app=document.querySelector('#app').__vue_app__;const s=app.config.globalProperties.$pinia._s.get('community');return {m:s.membership, tab:document.querySelector('.page-heading h1')?.innerText}})
  console.log('start', await getMembership())
  await page.clickByText('社区', {selector:'.side-nav button', exact:false}); await page.waitForSelector('.post-card')
  console.log('community', await getMembership())
  const r=await page.eval(()=>{const norm=v=>(v||'').replace(/\s+/g,' ').trim();const card=Array.from(document.querySelectorAll('.post-card')).find(n=>norm(n.innerText).includes('帮忙把两箱'));const b=card&&Array.from(card.querySelectorAll('button')).find(n=>norm(n.innerText)==='演练接单'&&!n.disabled);if(!b)return false;b.click();return true})
  console.log('accept clicked',r); await sleep(400); console.log('after accept', await getMembership())
  await page.clickByText('首页', {selector:'.side-nav button', exact:false}); await sleep(400)
  console.log('home', await getMembership())
  console.log('todo?', await page.eval(()=>!!document.querySelector('.home-todo')))
})
