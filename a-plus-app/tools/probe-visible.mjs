import { withBrowser, sleep } from './cdp.mjs'
const base='http://127.0.0.1:5180'
await withBrowser({windowSize:{width:1440,height:1000}}, async (page)=>{
  await page.navigate(`${base}/community.html`); await page.waitForSelector('.community-app')
  await page.setMembership('member'); await page.waitForSelector('.home-todo')
  const r = await page.eval(()=>{
    const el=document.querySelector('.home-todo')
    const chain=[]; let n=el
    while(n && chain.length<8){ const cs=getComputedStyle(n); chain.push({tag:n.tagName,cls:n.className,display:cs.display,visibility:cs.visibility,opacity:cs.opacity,h:n.getBoundingClientRect().height,w:n.getBoundingClientRect().width,inner:n.innerText?.slice(0,30)}); n=n.parentElement }
    return {rect: el.getBoundingClientRect().toJSON(), offsetH: el.offsetHeight, inner: el.innerText, chain}
  })
  console.log(JSON.stringify(r,null,2))
})
