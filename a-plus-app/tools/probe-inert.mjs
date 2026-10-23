import { withBrowser, sleep } from './cdp.mjs'
const base='http://127.0.0.1:5180'
await withBrowser({windowSize:{width:1440,height:1000}}, async (page)=>{
  await page.navigate(`${base}/community.html`); await page.waitForSelector('.community-app')
  await page.setMembership('member'); await page.waitForSelector('.home-todo')
  const r = await page.eval(()=>{
    const wrapper=document.querySelector('.home-main-content')
    const frame=document.querySelector('.app-frame')
    const topbar=document.querySelector('.topbar')
    return {
      wrapperAttr: wrapper?.getAttribute('inert'),
      wrapperProp: wrapper?.inert,
      frameAttr: frame?.getAttribute('inert'),
      frameProp: frame?.inert,
      topbarAttr: topbar?.getAttribute('inert'),
      topbarProp: topbar?.inert,
      textHas: document.body.innerText.includes('我的待办'),
      wrapperTextHas: wrapper ? wrapper.innerText.includes('我的待办') : null,
    }
  })
  console.log(JSON.stringify(r,null,2))
})
