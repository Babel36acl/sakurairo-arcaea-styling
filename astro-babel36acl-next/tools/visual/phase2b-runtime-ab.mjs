import {createBrowser,createContext,VIEWPORTS,routeUrl} from './common.mjs';
const b=await createBrowser(); const v=VIEWPORTS.find(x=>x.name==='desktop-1272');
for(const [label,url] of [['reference','http://127.0.0.1:18081'],['candidate','http://127.0.0.1:4321']]){
 const c=await createContext(b,v,{static:false});const p=await c.newPage();await p.goto(routeUrl(url),{waitUntil:'domcontentloaded'});await p.waitForLoadState('load').catch(()=>{});await p.evaluate(()=>document.fonts?.ready);await p.waitForTimeout(500);
 const snap=async name=>({name,...await p.evaluate(()=>{const items=[...document.querySelectorAll('.post-list-thumb')].slice(0,5);const one=e=>{const s=getComputedStyle(e),b=e.getBoundingClientRect();return {class:e.className,opacity:s.opacity,filter:s.filter,transform:s.transform,contentVisibility:s.contentVisibility,animationName:s.animationName,animationPlayState:s.animationPlayState,rect:{y:b.y,h:b.height}}};return {scrollY,body:document.body.className,items:items.map(one),animations:document.getAnimations({subtree:true}).filter(a=>a.effect?.target?.closest?.('.post-list-thumb')).map(a=>({target:a.effect.target.className,name:a.animationName,duration:a.effect.getTiming().duration,delay:a.effect.getTiming().delay,playState:a.playState}))}})});
 const out=[await snap('initial')];await p.evaluate(()=>scrollTo(0,850));await p.waitForTimeout(700);out.push(await snap('first-entered'));await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(300);out.push(await snap('reverse-top'));console.log(label,JSON.stringify(out));await c.close();
}
await b.close();
