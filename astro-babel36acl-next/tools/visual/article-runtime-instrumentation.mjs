// Observe browser registrations without replacing time, randomness or animation.
export function instrumentArticleRuntime(){
 const intervals=new Set(),timeouts=new Set(),frames=new Set(),listeners=[];
 const si=window.setInterval.bind(window),ci=window.clearInterval.bind(window),st=window.setTimeout.bind(window),ct=window.clearTimeout.bind(window),raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);
 window.setInterval=(fn,delay,...args)=>{const id=si(fn,delay,...args);intervals.add(id);return id;};
 window.clearInterval=id=>{intervals.delete(id);timeouts.delete(id);return ci(id);};
 window.setTimeout=(fn,delay,...args)=>{const id=st((...values)=>{timeouts.delete(id);typeof fn==='function'?fn(...values):(0,eval)(fn);},delay,...args);timeouts.add(id);return id;};
 window.clearTimeout=id=>{timeouts.delete(id);intervals.delete(id);return ct(id);};
 window.requestAnimationFrame=fn=>{const id=raf(time=>{frames.delete(id);fn(time);});frames.add(id);return id;};
 window.cancelAnimationFrame=id=>{frames.delete(id);return caf(id);};
 const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
 EventTarget.prototype.addEventListener=function(type,fn,options){
  if(!fn)return add.call(this,type,fn,options);
  const capture=typeof options==='boolean'?options:!!options?.capture;
  const old=listeners.find(r=>r.active&&r.target===this&&r.type===type&&r.fn===fn&&r.capture===capture);
  if(old)return add.call(this,type,old.wrapped,options);
  const row={target:this,type,fn,capture,active:!options?.signal?.aborted,wrapped:null};
  row.wrapped=function(event){if(options?.once)row.active=false;return typeof fn==='function'?fn.call(this,event):fn.handleEvent(event);};
  listeners.push(row);
  if(options?.signal)add.call(options.signal,'abort',()=>{row.active=false;},{once:true});
  return add.call(this,type,row.wrapped,options);
 };
 EventTarget.prototype.removeEventListener=function(type,fn,options){
  const capture=typeof options==='boolean'?options:!!options?.capture;
  const row=listeners.find(r=>r.active&&r.target===this&&r.type===type&&r.fn===fn&&r.capture===capture);
  if(row){row.active=false;return remove.call(this,type,row.wrapped,options);}return remove.call(this,type,fn,options);
 };
 window.__runtimeCounts=()=>({intervals:intervals.size,timeouts:timeouts.size,raf:frames.size,globalListeners:listeners.filter(r=>r.active&&(r.target===window||r.target===document)).length,connectedListeners:listeners.filter(r=>r.active&&(r.target===window||r.target===document||r.target?.isConnected)).length,globalByType:listeners.filter(r=>r.active&&(r.target===window||r.target===document)).reduce((a,r)=>(a[r.type]=(a[r.type]||0)+1,a),{})});
}
