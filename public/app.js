/* 栖柚美甲 · 在线预约（全栈版前端）—— 所有数据与规则来自后端 API，本页只负责展示与交互 */
(function(){
"use strict";
var WEEK=['日','一','二','三','四','五','六'];
function pad(n){return (n<10?'0':'')+n}
function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function addDays(d,n){var x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x}
function parseYmd(s){var p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2])}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function today(){return ymd(new Date())}
function dateLabel(s){var d=parseYmd(s),diff=Math.round((d-parseYmd(today()))/864e5);
  var pre=diff===0?'今天':diff===1?'明天':diff===2?'后天':diff===-1?'昨天':'周'+WEEK[d.getDay()];return (d.getMonth()+1)+'月'+d.getDate()+'日 '+pre}
function md(s){var d=parseYmd(s);return (d.getMonth()+1)+'/'+d.getDate()}
function maskPhone(p){return p&&p.length===11?p.slice(0,3)+'****'+p.slice(7):(p||'')}
function durText(m){return m>=60?(Math.floor(m/60)+'小时'+(m%60?(m%60)+'分':'')):m+'分钟'}
function hm(ms){var d=new Date(ms);return pad(d.getHours())+':'+pad(d.getMinutes())}

/* ---------- API ---------- */
var CT='qy_ctok',CP='qy_cphone',MT='qy_mtok';
var ME={token:localStorage.getItem(CT),phone:localStorage.getItem(CP)||'',info:null,bookings:null};
var M={token:sessionStorage.getItem(MT),user:null,dash:null,list:null,noshows:null,customers:null,settings:null,es:null};
function api(method,url,body,who){
  var h={};if(body!==undefined&&body!==null)h['Content-Type']='application/json';
  var t=who==='m'?M.token:who==='c'?ME.token:null;if(t)h.Authorization='Bearer '+t;
  return fetch(url,{method:method,headers:h,body:body!=null?JSON.stringify(body):undefined}).then(function(r){
    return r.json().catch(function(){return {}}).then(function(j){
      if(r.ok)return j;
      var e=(j&&j.error)||{code:'HTTP_'+r.status,message:'网络异常，请稍后再试'};e.status=r.status;
      if(r.status===401&&who==='c'){setCustomer(null)}
      if(r.status===401&&who==='m'){M.token=null;sessionStorage.removeItem(MT);if(S.view!=='mlogin'&&isMView()){S.view='mlogin';render(true)}}
      throw e})},function(){throw {code:'NETWORK',message:'网络连接失败，请检查网络后重试'}})}
function setCustomer(tok,phone){ME.token=tok;ME.phone=phone||'';ME.info=null;ME.bookings=null;
  if(tok){localStorage.setItem(CT,tok);localStorage.setItem(CP,phone)}else{localStorage.removeItem(CT);localStorage.removeItem(CP)}}
function fail(e){toast(e&&e.message||'操作失败')}
/* ---------- 图标 ---------- */
var I={
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  homeF:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  calF:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" fill="currentColor"/><path d="M3.5 10h17" stroke="#fff" stroke-width="1.8"/><path d="M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  user:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  userF:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4.5"/><path d="M3.5 21c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5z"/></svg>',
  back:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bigcheck:'<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#2BAE7E" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  right:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  shop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 2 3"/><path d="M10 20v-5h4v5"/></svg>',
  list:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>',
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  plus:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  close:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  gift:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 4 8.5 4 6 6.5 8 8M12 8s1.5-4 3.5-4S18 6.5 16 8"/></svg>',
  star:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  chat:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
  reset:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>'
};
/* 服务插画（纯 SVG 绘制） */
var ART={
  polish:function(c){return '<svg viewBox="0 0 48 48"><rect x="19" y="4" width="10" height="14" rx="2" fill="#3A3F4B"/><rect x="13" y="17" width="22" height="26" rx="7" fill="'+c+'"/><rect x="16.5" y="21" width="4" height="14" rx="2" fill="#fff" opacity=".45"/></svg>'},
  hand:function(c){return '<svg viewBox="0 0 48 48"><path d="M14 44V24c0-2 3-2 3 0v-12c0-2.2 3.4-2.2 3.4 0V8c0-2.2 3.4-2.2 3.4 0v4c0-2.2 3.4-2.2 3.4 0v4c0-2.2 3.3-2.2 3.3 0v14c2-3 3.5-5 5.5-4 1.6.9.8 2.6-.3 4.5L31 44z" fill="#F7D6C8"/><rect x="17.4" y="11" width="3" height="4" rx="1.5" fill="'+c+'"/><rect x="20.8" y="7" width="3" height="4" rx="1.5" fill="'+c+'"/><rect x="24.2" y="11" width="3" height="4" rx="1.5" fill="'+c+'"/><rect x="27.6" y="15" width="3" height="4" rx="1.5" fill="'+c+'"/></svg>'},
  gem:function(c){return '<svg viewBox="0 0 48 48"><path d="M10 18l6-8h16l6 8-14 20z" fill="'+c+'"/><path d="M10 18h28M16 10l4 8 4-8 4 8 4-8M20 18l4 20 4-20" stroke="#fff" stroke-width="1.4" fill="none" opacity=".7"/><circle cx="38" cy="9" r="2" fill="'+c+'"/><circle cx="9" cy="34" r="1.5" fill="'+c+'"/></svg>'},
  foot:function(c){return '<svg viewBox="0 0 48 48"><path d="M17 44c-4 0-6-4-5-9l2-12c1-6 4-11 9-11s7 4 7 9c0 4-2 7-2 11s4 6 4 9-2 3-4 3z" fill="#F7D6C8"/><ellipse cx="31" cy="11" rx="2.6" ry="3" fill="'+c+'"/><ellipse cx="35.5" cy="15" rx="2" ry="2.4" fill="'+c+'"/><ellipse cx="38" cy="20" rx="1.7" ry="2" fill="'+c+'"/><ellipse cx="38.5" cy="25" rx="1.4" ry="1.7" fill="'+c+'"/></svg>'},
  leaf:function(c){return '<svg viewBox="0 0 48 48"><path d="M10 38C10 18 22 8 40 8c0 18-10 30-30 30z" fill="'+c+'"/><path d="M10 38L32 16" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/></svg>'},
  drop:function(c){return '<svg viewBox="0 0 48 48"><path d="M24 6s13 14 13 23a13 13 0 0 1-26 0C11 20 24 6 24 6z" fill="'+c+'"/><path d="M18 30a6 6 0 0 0 6 6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".7"/></svg>'}
};
var PALETTE=[['#E86F8A','#FDECEF'],['#F29C6B','#FEF1E8'],['#8C7CF0','#F0EEFE'],['#3DB39E','#E7F6F2'],['#5AA2E8','#EAF3FD'],['#E0A93B','#FCF4E3']];
function art(s,size){var p=PALETTE[s.color%PALETTE.length];var f=ART[s.icon]||ART.polish;return '<div class="thumb" style="background:'+p[1]+'">'+f(p[0])+'</div>'}


/* ---------- 数据缓存 ---------- */
var C={shop:null,services:[],rules:[],policy:{},demo:{}};
var AV=null; // 当前服务的可约时段 {serviceId, days:[{date,free,slots}]}
function loadShop(){return api('GET','/api/shop').then(function(r){C=r;return r})}
function svcById(id){id=+id;return C.services.filter(function(s){return s.id===id})[0]}
function loadAvail(sid){return api('GET','/api/availability?serviceId='+sid).then(function(r){AV=r;return r})}
function loadMine(){if(!ME.token)return Promise.resolve();return Promise.all([api('GET','/api/me',null,'c'),api('GET','/api/me/bookings',null,'c')]).then(function(r){ME.info=r[0];ME.bookings=r[1]})}

/* ---------- 状态 & 渲染 ---------- */
var S={tab:'home',stack:[],view:'home',sel:{serviceId:null,date:null,time:null,name:'',phone:'',note:''},mineSeg:'open',mTab:'today',abT:'todo',errs:{},quote:null,last:null,busy:false};
var app=document.getElementById('app');
function go(view,push){if(push!==false)S.stack.push(S.view);S.view=view;render(true);onEnter(view)}
function back(){S.view=S.stack.pop()||S.tab;render(true);onEnter(S.view)}
function switchTab(t){S.tab=t;S.stack=[];S.view=t;render(true);onEnter(t)}
function isMView(){return ['merchant','abm','abset','svcedit','audit'].indexOf(S.view)>=0}
/* 进入页面时拉取数据 */
function onEnter(v){
  if(v==='time'&&S.sel.serviceId){loadAvail(S.sel.serviceId).then(function(){if(S.view==='time')render(false)},fail)}
  if(v==='mine'){loadMine().then(function(){if(S.view==='mine')render(false)},fail)}
  if(v==='confirm'||v==='time')loadShop().then(function(){if(S.view===v)render(false)},function(){});
  if(v==='confirm'){S.quote=null;if(ME.token&&ME.phone===S.sel.phone)api('GET','/api/quote?serviceId='+S.sel.serviceId,null,'c').then(function(q){S.quote=q;if(S.view==='confirm')render(false)},function(){})}
  if(isMView())mLoad(v);
  if(v==='book'||v==='home')loadShop().then(function(){if(S.view===v)render(false)},function(){});
}
function nav(title,opt){opt=opt||{};
  return '<div class="nav'+(opt.trans?' trans':'')+(opt.line?' line':'')+'">'+(opt.back?'<button class="back" data-a="back" aria-label="返回">'+I.back+'</button>':'')+
  '<span>'+title+'</span><div class="capsule" aria-hidden="true"><span><span class="dots"><i></i><i></i><i></i></span></span><span><span class="ring"></span></span></div></div>'}
function tabbar(){var t=[['home','首页',I.home,I.homeF],['book','预约',I.cal,I.calF],['mine','我的',I.user,I.userF]];
  return '<div class="tabbar">'+t.map(function(x){var on=S.tab===x[0];return '<button class="tab'+(on?' on':'')+'" data-a="tab" data-v="'+x[0]+'">'+(on?x[3]:x[2])+'<span>'+x[1]+'</span></button>'}).join('')+'</div>'}
function steps(n){var names=['选服务','选时间','填信息','确认'];
  return '<div class="steps">'+names.map(function(x,i){var c=i+1<n?'done':i+1===n?'on':'';return (i?'<div class="sline'+(i<n?' on':'')+'"></div>':'')+'<div class="step '+c+'"><i>'+(i+1<n?'✓':i+1)+'</i>'+x+'</div>'}).join('')+'</div>'}
function loading(){return '<div class="empty" style="padding:50px 0;color:var(--ink3)">加载中…</div>'}
function rulesBox(){return C.rules&&C.rules.length?'<div class="notice abrules" style="margin-top:10px"><b>预约规则（门店设置）：</b>'+C.rules.map(esc).join('；')+'。</div>':''}

var V={};
V.home=function(){
  if(!C.shop)return {nav:nav('栖柚美甲',{trans:true}),tab:true,body:loading()};
  var sh=C.shop;
  return {nav:nav(esc(sh.name),{trans:true}),tab:true,body:
  '<div class="hero"><div class="bubble" style="width:180px;height:180px;left:-60px;top:-50px"></div><div class="bubble" style="width:90px;height:90px;left:140px;top:30px"></div>'+
  '<svg class="deco" viewBox="0 0 200 200"><g opacity=".95"><rect x="96" y="30" width="22" height="34" rx="4" fill="#3A3F4B"/><rect x="82" y="60" width="50" height="62" rx="16" fill="#fff" opacity=".95"/><rect x="88" y="66" width="38" height="50" rx="12" fill="#F6A8B6"/><rect x="93" y="72" width="7" height="34" rx="3.5" fill="#fff" opacity=".5"/></g>'+
  '<g transform="rotate(-18 50 120)"><rect x="34" y="96" width="14" height="22" rx="3" fill="#3A3F4B"/><rect x="26" y="116" width="30" height="40" rx="10" fill="#FFE0B8"/></g><g transform="rotate(16 160 130)"><rect x="152" y="104" width="12" height="18" rx="3" fill="#3A3F4B"/><rect x="145" y="120" width="26" height="34" rx="9" fill="#C9B8FF"/></g>'+
  '<circle cx="40" cy="60" r="4" fill="#fff" opacity=".8"/><circle cx="170" cy="70" r="3" fill="#fff" opacity=".7"/><path d="M150 40l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#fff" opacity=".85"/></svg>'+
  '<div class="txt"><h1>'+esc(sh.name)+'</h1><p>QIYOU NAIL STUDIO · 一人一甲 · 慢工细作</p><div class="tagrow"><span>独立工作室</span><span>一客一消毒</span><span>可按图定制</span></div></div></div>'+
  '<div class="card shopcard"><div class="shoprow"><div class="ic">'+I.clock+'</div><div class="b"><b>营业时间 '+sh.open+' - '+sh.close+'</b><span>可在线预约未来 '+sh.bookDays+' 天</span></div></div>'+
  '<div class="shoprow"><div class="ic">'+I.pin+'</div><div class="b"><b>'+esc(sh.address)+'</b><span>地址为占位内容，可替换为门店真实地址</span></div></div>'+
  '<div class="shoprow"><div class="ic">'+I.phone+'</div><div class="b"><b>'+esc(sh.phone)+'</b><span>示例电话 · 到店前可电话确认</span></div></div></div>'+
  '<div class="pad" style="padding-top:0"><div class="card quick"><button data-a="startBook"><span class="qi" style="background:#FDECEF;color:#E86F8A">'+I.cal+'</span>立即预约</button><button data-a="tab" data-v="mine"><span class="qi" style="background:#EAF3FD;color:#5AA2E8">'+I.list+'</span>我的预约</button><button data-a="toast" data-v="作品集页面可按需定制"><span class="qi" style="background:#F0EEFE;color:#8C7CF0">'+ART.gem('#8C7CF0')+'</span>作品集</button><button data-a="toMerchant"><span class="qi" style="background:#FEF1E8;color:#F29C6B">'+I.shop+'</span>商家后台</button></div>'+
  '<div class="sec-t">热门服务<small data-a="startBook" style="cursor:pointer">全部 '+C.services.length+' 项 ›</small></div>'+
  C.services.slice(0,4).map(function(s){return svcCard(s,'quickBook')}).join('')+
  '<div class="demo-strip">演示作品：店铺名称、地址、预约数据均为虚构示例；短信验证码与定金支付均为模拟。</div></div>'}};
function svcCard(s,mode){var on=S.sel.serviceId===s.id&&mode==='pick';
  return '<button class="svc'+(on?' on':'')+'" data-a="'+mode+'" data-v="'+s.id+'">'+(s.hot?'<span class="hot">人气</span>':'')+art(s)+
  '<div class="info"><b>'+esc(s.name)+'</b><div class="d">'+esc(s.desc||'')+'</div><div class="meta"><span class="price">'+s.price+'</span><span class="chip">'+I.clock.replace('<svg','<svg width="11" height="11"')+durText(s.duration)+'</span>'+(s.deposit?'<span class="chip" style="color:#C9761A">定金¥'+s.deposit+'</span>':'')+'</div></div>'+
  (mode==='pick'?'<span class="pick">'+(on?I.check:'')+'</span>':'<span class="go">预约</span>')+'</button>'}
V.book=function(){var s=S.sel.serviceId&&svcById(S.sel.serviceId);
  return {nav:nav('选择服务',{back:S.stack.length>0}),tab:S.stack.length===0,body:steps(1)+'<div class="pad"><div class="sec-t">全部服务<small>共 '+C.services.length+' 项</small></div>'+
    (C.services.length?C.services.map(function(x){return svcCard(x,'pick')}).join(''):'<div class="empty">商家暂未上架服务</div>')+'</div>',
    foot:'<div class="foot"><div class="sum">'+(s?'已选：'+esc(s.name)+'<br><b class="price">'+s.price+'</b>':'请选择一项服务')+'</div><button class="btn" data-a="toTime"'+(s?'':' disabled')+'>下一步</button></div>'}};
V.time=function(){var s=svcById(S.sel.serviceId);if(!s)return V.book();
  var html=steps(2)+'<div class="pad"><div class="card" style="display:flex;align-items:center;gap:10px;padding:10px 12px"><div class="se" style="flex:1">'+art(s)+'<div class="b"><b>'+esc(s.name)+'</b><span class="muted" style="font-size:12px">时长约 '+durText(s.duration)+'</span></div></div><span class="price">'+s.price+'</span></div>';
  if(!AV||AV.serviceId!==s.id)return {nav:nav('选择时间',{back:true}),body:html+loading()+'</div>'};
  var days=AV.days;if(!S.sel.date||!days.some(function(d){return d.date===S.sel.date})){var f=days.filter(function(d){return d.free})[0]||days[0];S.sel.date=f&&f.date}
  var cur=days.filter(function(d){return d.date===S.sel.date})[0];
  if(S.sel.time&&cur&&!cur.slots.some(function(x){return x.time===S.sel.time&&x.ok}))S.sel.time=null;
  html+='<div class="sec-t">选择日期<small>可预约未来 '+days.length+' 天</small></div><div class="dates">'+days.map(function(d,i){var dt=parseYmd(d.date);
    return '<button class="date'+(S.sel.date===d.date?' on':'')+(d.free?'':' off')+'" data-a="pickDate" data-v="'+d.date+'"><small>'+(d.date===today()?'今天':i===1?'明天':'周'+WEEK[dt.getDay()])+'</small><b>'+dt.getDate()+'</b><small>'+(d.free?'余'+d.free:'约满')+'</small></button>'}).join('')+'</div>';
  html+='<div class="sec-t" style="margin-top:14px">选择时间<small>'+dateLabel(S.sel.date)+'</small></div>';
  [['上午',0,720],['下午',720,1080],['晚上',1080,1440]].forEach(function(g){var it=cur.slots.filter(function(x){var m=+x.time.slice(0,2)*60+ +x.time.slice(3);return m>=g[1]&&m<g[2]});if(!it.length)return;
    html+='<div class="period">'+g[0]+'</div><div class="slots">'+it.map(function(x){return '<button class="slot'+(S.sel.time===x.time?' on':'')+'" data-a="pickTime" data-v="'+x.time+'"'+(x.ok?'':' disabled')+'>'+x.time+(x.ok?'':'<small>'+x.why+'</small>')+'</button>'}).join('')+'</div>'});
  html+=rulesBox()+'<div class="legend"><span><i style="background:#fff"></i>可预约</span><span><i style="background:var(--brand-l);border-color:var(--brand)"></i>已选择</span><span><i style="background:var(--gray-l)"></i>不可约</span></div></div>';
  var end=S.sel.time?endOf(S.sel.time,s.duration):'';
  return {nav:nav('选择时间',{back:true}),body:html,foot:'<div class="foot"><div class="sum">'+(S.sel.time?dateLabel(S.sel.date)+'<br><b style="color:var(--ink)">'+S.sel.time+' - '+end+'</b>':'请选择到店时间')+'</div><button class="btn" data-a="toInfo"'+(S.sel.time?'':' disabled')+'>下一步</button></div>'}};
function endOf(t,dur){var m=+t.slice(0,2)*60+ +t.slice(3)+dur;return pad(Math.floor(m/60))+':'+pad(m%60)}
V.info=function(){var e=S.errs;
  return {nav:nav('填写信息',{back:true}),body:steps(3)+'<div class="pad"><div class="card" style="padding:2px 14px">'+
  '<div class="field'+(e.name?' bad':'')+'"><label>称呼</label><input id="f-name" maxlength="12" placeholder="如：王小姐" value="'+esc(S.sel.name)+'" autocomplete="name"></div>'+(e.name?'<div class="err">'+e.name+'</div>':'')+
  '<div class="field'+(e.phone?' bad':'')+'"><label>手机号</label><input id="f-phone" type="tel" inputmode="numeric" maxlength="11" placeholder="11 位手机号" value="'+esc(S.sel.phone)+'" autocomplete="tel"></div>'+(e.phone?'<div class="err">'+e.phone+'</div>':'')+
  '<div class="field" style="align-items:flex-start"><label style="padding-top:12px">备注</label><textarea id="f-note" maxlength="60" placeholder="选填：想做的款式、是否需要卸甲等">'+esc(S.sel.note)+'</textarea></div></div>'+
  '<div class="notice"><b>温馨提示：</b>手机号用于验证身份、门店联系与到店核对。'+(C.policy.verify?'提交时需短信验证码验证手机号。':'')+'</div></div>',
  foot:'<div class="foot"><button class="btn" style="width:100%" data-a="toConfirm">下一步</button></div>'}};
function depInfo(){var s=svcById(S.sel.serviceId),q=S.quote;return q?{amt:q.deposit,forced:q.restricted==='deposit'&&q.deposit>(s.deposit||0),confirm:q.needConfirm}:{amt:s.deposit||0,forced:false}}
V.confirm=function(){var s=svcById(S.sel.serviceId),d=depInfo(),P=C.policy;
  return {nav:nav('确认预约',{back:true}),body:steps(4)+'<div class="pad"><div class="ticket"><div class="top"><b>'+esc(s.name)+'</b><div style="font-size:13px;opacity:.9">'+dateLabel(S.sel.date)+'</div><div class="when">'+S.sel.time+' - '+endOf(S.sel.time,s.duration)+'</div></div><div class="cut"><i></i></div>'+
  '<div class="kv"><span>预约人</span><span>'+esc(S.sel.name)+'</span></div><div class="kv"><span>手机号</span><span>'+maskPhone(S.sel.phone)+'</span></div><div class="kv"><span>服务时长</span><span>约 '+durText(s.duration)+'</span></div>'+
  (S.sel.note?'<div class="kv"><span>备注</span><span style="max-width:65%;text-align:right">'+esc(S.sel.note)+'</span></div>':'')+
  '<div class="kv"><span>门店</span><span>'+esc(C.shop.name)+'</span></div><div class="kv" style="padding-bottom:16px"><span>参考价格</span><span class="price" style="font-size:18px">'+s.price+'</span></div></div>'+
  (d.amt?'<div class="abnote"><b>需付定金 ¥'+d.amt+'</b>'+(d.forced?'（因近期爽约，门店要求先付定金）':'（门店为该项目设置）')+'：<b>到店抵扣</b>；'+(P.cancelH?'开始前 '+P.cancelH+' 小时外取消原路退回，':'')+'<b>爽约不退</b>。'+(C.demo.mockPay?'<span class="abmock">模拟支付</span>':'')+'</div>':'')+
  '<div class="notice"><b>预约须知：</b>请提前 5 分钟到店；'+(P.cancelH?'开始前 '+P.cancelH+' 小时内不可线上取消':'可在「我的」中取消')+'；'+(d.amt?'定金到店抵扣，余款到店支付。':'到店付款，线上不收取费用。')+'</div>'+rulesBox()+'</div>',
  foot:'<div class="foot"><div class="sum">'+(d.amt?'今付定金<br><b class="price">'+d.amt+'</b>':'到店支付<br><b class="price">'+s.price+'</b>')+'</div><button class="btn" data-a="submit"'+(S.busy?' disabled':'')+'>'+(d.amt?'付定金并预约':'确认预约')+'</button></div>'}};
V.success=function(){var b=S.last,pd=b.status==='pending',wp=b.status==='awaiting_payment';
  return {nav:nav(pd?'已提交':wp?'待支付':'预约成功'),body:'<div class="succ"><div class="ok">'+I.bigcheck+'</div><h2>'+(pd?'已提交，待门店确认':wp?'时段已保留，待支付定金':'预约成功')+'</h2><p>'+(pd?'首次预约需门店确认，确认后在「我的」可看到状态更新':wp?'请在保留时间内完成支付，超时自动释放':'我们已为你保留时段，期待你的到来')+'</p></div><div class="pad"><div class="card bk">'+bookingInner(b,false)+'</div>'+
  '<div style="display:flex;gap:10px;margin-top:8px"><button class="btn ghost" data-a="tab" data-v="home">返回首页</button><button class="btn" data-a="goMine">查看我的预约</button></div></div>'}};
var OPEN_ST=['awaiting_payment','pending','confirmed','arrived'];
function stClass(b){return OPEN_ST.indexOf(b.status)>=0?'booked':b.status==='done'?'done':'cancelled'}
function tags(b){var h='';
  if(b.status==='pending')h+='<span class="abtag pend">待门店确认</span>';
  if(b.status==='awaiting_payment')h+='<span class="abtag pend">待支付 · '+hm(b.holdUntil)+'前</span>';
  if(b.status==='no_show')h+='<span class="abtag ns">'+(b.noshowBy==='auto'?'超时未到·爽约':'爽约')+'</span>';
  if(b.status==='rejected')h+='<span class="abtag ns">门店未接受</span>';
  if(b.status==='expired')h+='<span class="abtag pend">已失效</span>';
  if(b.deposit&&b.depositStatus&&b.depositStatus!=='unpaid')h+='<span class="abtag dep">'+({paid:'定金¥'+b.deposit+'已付',refunded:'定金已退',forfeited:'定金¥'+b.deposit+'不退'}[b.depositStatus]||'')+'</span>';
  return h}
function ptag(b){return b.custBlack?'<span class="abtag blk">黑名单</span>':b.custNoshow?'<span class="abtag res">爽约'+b.custNoshow+'</span>':''}
function bookingInner(b,showOps,merchant){
  return '<div class="h"><b>'+esc(b.serviceName)+(b.seed?'<span class="demo-tag">示例</span>':'')+tags(b)+'</b><span class="st '+stClass(b)+'">'+b.statusText+'</span></div>'+
  '<div class="row">'+I.cal+dateLabel(b.date)+' '+b.time+' - '+b.endTime+'</div>'+
  '<div class="row">'+I.user+esc(b.name)+' · '+(merchant?esc(b.phone)+ptag(b):esc(b.phone))+'</div>'+
  (b.note?'<div class="row">'+I.chat+esc(b.note)+'</div>':'')+
  '<div class="row">'+I.shop+'参考价 <span class="price" style="font-size:14px">'+b.price+'</span><span class="muted" style="margin-left:auto;font-size:11px">'+esc(b.code)+'</span></div>'+
  (showOps?ops(b,merchant):'')}
function ops(b,merchant){var h='';
  if(!merchant){if(b.status==='awaiting_payment')h='<button class="btn sm gray" data-a="uCancel" data-v="'+b.id+'">取消</button><button class="btn sm" data-a="payAgain" data-v="'+b.id+'">去支付 ¥'+b.deposit+'</button>';
    else if(OPEN_ST.indexOf(b.status)>=0&&b.status!=='arrived')h='<button class="btn sm gray" data-a="callShop">联系门店</button><button class="btn sm ghost" data-a="uCancel" data-v="'+b.id+'">取消预约</button>'}
  else{var past=b.startAt<=Date.now();
    if(b.status==='pending')h='<button class="abb r" data-a="mOp" data-v="reject|'+b.id+'">拒绝</button><button class="abb p" data-a="mOp" data-v="accept|'+b.id+'">确认预约</button>';
    else if(b.status==='awaiting_payment')h='<button class="btn sm gray" data-a="mOp" data-v="cancel|'+b.id+'">取消</button>';
    else if(b.status==='confirmed')h=past?'<button class="abb" data-a="mOp" data-v="arrive|'+b.id+'">已到店</button><button class="abb r" data-a="mOp" data-v="noshow|'+b.id+'">标记爽约</button>':'<button class="btn sm gray" data-a="mOp" data-v="cancel|'+b.id+'">取消</button><button class="btn sm okb" data-a="mOp" data-v="done|'+b.id+'">完成</button>';
    else if(b.status==='arrived')h='<button class="btn sm okb" data-a="mOp" data-v="done|'+b.id+'">完成</button>'}
  return h?'<div class="ops">'+h+'</div>':''}
V.mine=function(){
  if(!ME.token)return {nav:nav('我的'),tab:true,body:'<div class="me"><div class="avatar">柚</div><div style="flex:1"><b style="font-size:17px">未登录</b><div class="muted" style="font-size:12px">验证手机号后查看你的预约</div></div><button class="fab-merchant" data-a="toMerchant">'+I.lock.replace('<svg','<svg width="14" height="14"')+'商家</button></div>'+
    '<div class="pad"><button class="btn" style="width:100%" data-a="login">验证手机号登录</button>'+emptyBox('登录后可查看和取消预约',true)+'</div>'};
  var bs=ME.bookings,inf=ME.info;
  var segs=[['open','待服务',function(b){return OPEN_ST.indexOf(b.status)>=0}],['done','已完成',function(b){return b.status==='done'}],['closed','已取消/失效',function(b){return ['cancelled','rejected','expired','no_show'].indexOf(b.status)>=0}]];
  var cur=segs.filter(function(x){return x[0]===S.mineSeg})[0];
  var list=bs?bs.filter(cur[2]):null;if(list&&S.mineSeg==='open')list.sort(function(a,b){return a.startAt-b.startAt});
  var warn='';if(inf){if(inf.blacklisted)warn='<div class="abnote">该号码已被门店限制线上预约，如有疑问请联系门店。</div>';
    else if(inf.restricted)warn='<div class="abnote">近期爽约 '+inf.noshowCount+' 次，'+(inf.restricted.act==='block'?'暂停线上预约':'预约需先付定金 ¥'+inf.restricted.deposit)+'，'+(new Date(inf.restricted.until).getMonth()+1)+'月'+new Date(inf.restricted.until).getDate()+'日后自动恢复。</div>';
    else if(inf.rateLockedUntil)warn='<div class="abnote">操作太频繁，线上预约/取消已暂停至 '+hm(inf.rateLockedUntil)+'。</div>'}
  return {nav:nav('我的'),tab:true,body:'<div class="me"><div class="avatar">'+esc((inf&&inf.name||'柚').slice(0,1))+'</div><div style="flex:1"><b style="font-size:17px">'+esc(inf&&inf.name||'栖柚会员')+'</b><div class="muted" style="font-size:12px">'+maskPhone(ME.phone)+' · <span data-a="logout" style="text-decoration:underline;cursor:pointer">退出</span></div></div><button class="fab-merchant" data-a="toMerchant">'+I.lock.replace('<svg','<svg width="14" height="14"')+'商家</button></div>'+
  '<div class="seg">'+segs.map(function(s){var n=bs?bs.filter(s[2]).length:0;return '<button class="'+(S.mineSeg===s[0]?'on':'')+'" data-a="mineSeg" data-v="'+s[0]+'">'+s[1]+(n?' '+n:'')+'</button>'}).join('')+'</div>'+
  '<div class="pad">'+warn+(!list?loading():list.length?list.map(function(b){return '<div class="card bk'+(stClass(b)==='cancelled'?' dim':'')+'">'+bookingInner(b,true)+'</div>'}).join(''):emptyBox(S.mineSeg==='open'?'暂无待服务的预约':'暂无记录',S.mineSeg==='open'))+
  '<div class="card" style="padding:2px 14px;margin-top:4px"><button class="cell" data-a="startBook"><span class="ic">'+I.cal+'</span><span class="t">新建预约</span><span class="arrow">'+I.right+'</span></button><button class="cell" data-a="callShop"><span class="ic">'+I.phone+'</span><span class="t">联系门店</span><span class="arrow">'+I.right+'</span></button></div></div>'}};
function emptyBox(t,cta){return '<div class="empty"><svg viewBox="0 0 96 96" width="96" height="96"><rect x="18" y="22" width="60" height="56" rx="10" fill="#FDECEF"/><rect x="18" y="22" width="60" height="14" rx="7" fill="#F6A8B6"/><rect x="30" y="14" width="6" height="16" rx="3" fill="#E86F8A"/><rect x="60" y="14" width="6" height="16" rx="3" fill="#E86F8A"/><circle cx="48" cy="57" r="11" fill="#fff"/></svg><p>'+t+'</p>'+(cta?'<button class="btn sm" data-a="startBook">去预约</button>':'')+'</div>'}

/* ---------- 顾客：验证手机号 / 支付 ---------- */
function sheet(title,body,cls){closeSheet();var el=document.createElement('div');el.className='mask absh';
  el.innerHTML=cls?'<div class="'+cls+'">'+body+'</div>':'<div class="sheet" role="dialog"><div class="sh">'+title+'<button data-a="closeSheet" aria-label="关闭">'+I.close+'</button></div><div class="sb">'+body+'</div></div>';
  el.addEventListener('click',function(e){if(e.target===el)closeSheet()});app.appendChild(el);return el}
function closeSheet(){var m=app.querySelector('.mask');if(m)m.remove()}
function alertBox(t,m){var el=document.createElement('div');el.className='mask center abalert';
  el.innerHTML='<div class="dlg" role="alertdialog"><div class="c"><b>'+esc(t)+'</b><p style="text-align:left">'+esc(m)+'</p></div><div class="a"><button data-d="1" style="color:var(--brand-d,#333);font-weight:600">知道了</button></div></div>';
  el.addEventListener('click',function(e){if(e.target===el||e.target.getAttribute('data-d'))el.remove()});app.appendChild(el)}
var verifyNext=null;
function verifySheet(phone,next){verifyNext=next;S.vphone=phone;
  if(!C.policy.verify){api('POST','/api/auth/quick',{phone:phone,name:S.sel.name},null).then(function(r){setCustomer(r.token,phone);var n=verifyNext;verifyNext=null;if(n)n()},fail);return}
  sheet('验证手机号','<div class="abnote" style="margin-top:0">为防止恶意占号，线上预约需验证手机号。'+(C.demo.showSmsCode?'<b>演示环境：不发送真实短信，演示验证码直接显示在下方。</b>':'')+'</div>'+
  '<div style="display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:15px">'+maskPhone(phone)+'</span><button class="abb p" id="sms-btn" data-a="sms">获取验证码</button></div><div id="ab-cbox"></div>')}
var smsT=null;
function sendSms(btn){btn.disabled=true;
  api('POST','/api/auth/sms',{phone:S.vphone}).then(function(r){
    var box=document.getElementById('ab-cbox');if(!box)return;
    box.innerHTML=(r.devCode?'<div class="abcode">演示验证码（演示环境不发送真实短信）<b id="ab-demo-code">'+r.devCode+'</b></div>':'<div class="abnote">验证码已发送，'+Math.round(r.ttl/60)+' 分钟内有效</div>')+
      '<input id="ab-code" class="abin" type="tel" inputmode="numeric" maxlength="6" placeholder="输入 6 位验证码" autocomplete="one-time-code"><div id="ab-cerr" class="err" style="min-height:18px"></div><button class="btn" style="width:100%" data-a="smsVerify">验证并继续</button>';
    var n=r.cooldown;clearInterval(smsT);smsT=setInterval(function(){var b=document.getElementById('sms-btn');if(!b){clearInterval(smsT);return}if(--n<=0){clearInterval(smsT);b.disabled=false;b.textContent='重新获取'}else b.textContent=n+' 秒'},1000)
  },function(e){btn.disabled=false;fail(e)})}
function smsVerify(){var code=(document.getElementById('ab-code').value||'').trim();
  api('POST','/api/auth/verify',{phone:S.vphone,code:code,name:S.sel.name}).then(function(r){setCustomer(r.token,S.vphone);closeSheet();toast('手机号已验证');var n=verifyNext;verifyNext=null;if(n)setTimeout(n,250)},
    function(e){var el=document.getElementById('ab-cerr');if(el)el.textContent=e.message;else fail(e)})}
var payCtx=null;
function paySheet(p,b,forced){payCtx={p:p,b:b};
  sheet('','<div class="top"><button data-a="payClose" aria-label="关闭" style="font-size:20px;width:30px;text-align:left">✕</button><span>微信支付'+(p.provider==='mock'?'<span class="abmock">模拟</span>':'')+'</span><span style="width:30px"></span></div>'+
  '<div class="amt"><small>'+esc(C.shop.name)+' · 预约定金</small><b><i>¥</i>'+(+p.amount).toFixed(2)+'</b></div><div class="box"><div class="kv2"><span>项目</span><span>'+esc(b.serviceName)+'</span></div><div class="kv2"><span>规则</span><span>到店抵扣 · 爽约不退</span></div>'+
  (forced?'<div class="kv2"><span>原因</span><span>近期爽约，需付定金</span></div>':'')+'<div class="kv2"><span>保留</span><span>'+hm(b.holdUntil)+' 前支付有效</span></div></div>'+
  '<button class="pay" data-a="payConfirm">确认支付</button><div class="mk">'+(p.provider==='mock'?'演示环境：模拟支付，不会产生真实扣款':'')+'</div>','abwxsheet')}
function payConfirm(btn){var x=payCtx;if(!x)return;btn.disabled=true;btn.textContent='支付中…';
  if(x.p.provider!=='mock'){toast('真实支付需在微信内调起（见 README）');return}
  api('POST','/api/pay/mock/'+encodeURIComponent(x.p.outTradeNo)+'/confirm',null,'c').then(function(r){payCtx=null;closeSheet();
    if(r.booking.status==='expired'){alertBox('支付超时','超过保留时间，时段已释放，定金将原路退回。请重新预约。');ME.bookings=null;switchTab('mine');return}
    toast('定金已支付');S.last=r.booking;S.stack=[];S.view='success';render(true)},function(e){btn.disabled=false;btn.textContent='确认支付';fail(e)})}
var ERR_T={LIMIT_OPEN:'已达未完成预约上限',LIMIT_DAY:'已达当天预约上限',LIMIT_WEEK:'已达本周预约上限',LIMIT_MONTH:'已达本月预约上限',RATE_LOCKED:'操作太频繁',NOSHOW_BLOCKED:'暂时无法线上预约',BLACKLISTED:'暂时无法线上预约',CANCEL_BLOCKED:'暂不能线上取消',TOO_LATE:'时段已过'};
function submit(){var s=svcById(S.sel.serviceId);if(!s){toast('该服务已下架，请重新选择');switchTab('book');return}
  if(!(ME.token&&ME.phone===S.sel.phone)){verifySheet(S.sel.phone,submit);return}
  S.busy=true;render(false);
  api('POST','/api/bookings',{serviceId:s.id,date:S.sel.date,time:S.sel.time,name:S.sel.name.trim(),note:S.sel.note.trim()},'c').then(function(r){
    S.busy=false;ME.bookings=null;var keep={name:S.sel.name,phone:S.sel.phone};S.sel={serviceId:null,date:null,time:null,name:keep.name,phone:keep.phone,note:''};
    if(r.payment){S.last=r.booking;S.stack=[];S.view='success';render(true);paySheet(r.payment,r.booking,S.quote&&S.quote.restricted==='deposit');return}
    S.last=r.booking;S.stack=[];S.view='success';render(true)},
  function(e){S.busy=false;render(false);
    if(e.status===401){verifySheet(S.sel.phone,submit);return}
    if(e.code==='SLOT_TAKEN'||e.code==='TOO_LATE'){toast(e.message);S.sel.time=null;S.stack=['book'];S.view='time';render(true);onEnter('time');return}
    if(ERR_T[e.code])alertBox(ERR_T[e.code],e.message);else fail(e)})}

/* ---------- 商家端 ---------- */
function mLoad(v){if(!M.token)return;var p;
  if(v==='merchant')p=Promise.all([api('GET','/api/merchant/dashboard',null,'m'),api('GET','/api/merchant/bookings?scope='+S.mTab,null,'m'),M.user?null:api('GET','/api/merchant/me',null,'m')]).then(function(r){M.dash=r[0];M.list=r[1];if(r[2])M.user=r[2]});
  else if(v==='abm')p=Promise.all([api('GET','/api/merchant/dashboard',null,'m'),api('GET','/api/merchant/bookings?scope=pending',null,'m'),api('GET','/api/merchant/bookings?scope=today',null,'m'),api('GET','/api/merchant/noshows',null,'m'),api('GET','/api/merchant/customers',null,'m'),api('GET','/api/merchant/settings',null,'m')]).then(function(r){M.dash=r[0];M.pend=r[1];M.today=r[2];M.noshows=r[3];M.customers=r[4];M.settings=r[5]});
  else if(v==='abset')p=api('GET','/api/merchant/settings',null,'m').then(function(r){M.settings=r});
  else if(v==='svcedit')p=loadShop();
  else if(v==='audit')p=api('GET','/api/merchant/audit',null,'m').then(function(r){M.audit=r});
  if(p)p.then(function(){if(S.view===v)render(false)},fail);
  mStream()}
function mStream(){if(M.es||!M.token||!window.EventSource)return;
  M.es=new EventSource('/api/merchant/stream?token='+encodeURIComponent(M.token));
  var t=null;M.es.addEventListener('change',function(ev){var d={};try{d=JSON.parse(ev.data)}catch(e){}
    if(d.type==='booking.create'&&isMView())toast('有新的预约');
    clearTimeout(t);t=setTimeout(function(){if(isMView())mLoad(S.view)},300)});
  M.es.onerror=function(){if(!M.token){M.es.close();M.es=null}}}
function mStop(){if(M.es){M.es.close();M.es=null}}
setInterval(function(){if(isMView()&&M.token)mLoad(S.view);else if(S.view==='time'&&S.sel.serviceId)onEnter('time');else if(S.view==='mine'&&ME.token)onEnter('mine')},30000);
var isOwner=function(){return M.user&&M.user.role==='owner'};
V.mlogin=function(){return {nav:nav('商家登录',{back:S.stack.length>0}),body:'<div class="login"><div class="logo"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"><path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 2 3"/><path d="M10 20v-5h4v5"/></svg></div><h2>'+esc(C.shop?C.shop.name:'')+' · 商家后台</h2><div class="sub">管理预约、防占号规则与顾客</div>'+
  '<div class="card" style="padding:2px 14px;text-align:left;margin-top:14px"><div class="field"><label>账号</label><input id="m-user" autocomplete="username" placeholder="用户名" value="'+esc(S.muser||'')+'"></div><div class="field"><label>密码</label><input id="m-pass" type="password" autocomplete="current-password" placeholder="密码"></div></div>'+
  '<div class="hint">演示账号：<b>owner</b> / <b>qiyou2026</b>（店主）<br><b>staff</b> / <b>staff2026</b>（员工，不能改设置）</div><button class="btn dark" data-a="mLogin">登录</button></div>'}};
function wk(i){return '日一二三四五六'[parseYmd(i).getDay()]}
V.merchant=function(){var d=M.dash,L=M.list;if(!d||!L)return {nav:nav('商家后台',{back:S.stack.length>0}),body:loading()};
  var mx=Math.max.apply(null,d.week.map(function(x){return x.amount}).concat([1])),rev=d.week.reduce(function(a,x){return a+x.amount},0);
  var body='<div class="mhead"><div class="r"><div><b>'+esc(C.shop.name)+'</b><br><small>'+dateLabel(today())+' · '+esc(M.user?M.user.name+'（'+(isOwner()?'店主':'员工')+'）':'')+'</small></div><button class="exit" data-a="mLogout">退出</button></div></div>'+
  '<div class="card stats"><div class="stat"><b>'+d.today+'</b><span>今日预约</span></div><div class="stat"><b>'+d.upcoming+'</b><span>待服务</span></div><div class="stat money"><b><span style="font-size:13px">¥</span>'+rev.toLocaleString()+'</b><span>本周营业额估算</span></div></div>'+
  '<div class="pad" style="padding-top:0"><div class="mgrid">'+(isOwner()?'<button data-a="goSvcEdit"><span class="qi" style="background:#FDECEF;color:#E86F8A">'+I.edit+'</span><div><b>服务管理</b><span>'+C.services.length+' 项在售</span></div></button>':'')+
  '<button class="abentry" data-a="abGo"><span class="qi" style="background:#E7F7EE;color:#1E9E5A"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5" stroke-linecap="round"/></svg></span><div><b>防占号</b><span>'+(d.pending?d.pending+' 个待确认':'规则 · 爽约 · 黑名单')+'</span></div>'+(d.pending?'<em>'+d.pending+'</em>':'')+'</button>'+
  (isOwner()?'<button data-a="goAudit"><span class="qi" style="background:#EAF3FD;color:#5AA2E8">'+I.list+'</span><div><b>操作日志</b><span>谁在何时做了什么</span></div></button><button data-a="mReset"><span class="qi" style="background:#FEF1E8;color:#F29C6B">'+I.reset+'</span><div><b>重置演示</b><span>恢复示例数据</span></div></button>':'')+'</div>'+
  '<div class="card"><div class="sec-t" style="margin:0 0 4px;font-size:14px">本周营业额（估算）<small>按已确认/完成预约参考价合计</small></div><div class="bar7">'+d.week.map(function(x){return '<div class="'+(x.date===today()?'today':'')+'"><em>'+(x.amount||'')+'</em><i style="height:'+Math.round(x.amount/mx*60)+'px"></i><small>'+(x.date===today()?'今':wk(x.date))+'</small></div>'}).join('')+'</div></div>'+
  '<div class="mtabs">'+[['today','今日预约'],['upcoming','待服务'],['pending','待确认'],['all','全部记录']].map(function(x){return '<button class="'+(S.mTab===x[0]?'on':'')+'" data-a="mTab" data-v="'+x[0]+'">'+x[1]+'</button>'}).join('')+'</div>'+
  (L.length?'<div class="timeline">'+L.map(function(b){return '<div class="tl"><div class="tm">'+b.time+'<small>'+(S.mTab==='today'?b.duration+'分钟':md(b.date))+'</small></div><div class="card bk'+(stClass(b)==='cancelled'?' dim':'')+'" data-bid="'+b.id+'">'+bookingInner(b,true,true)+'</div></div>'}).join('')+'</div>':emptyBox('暂无预约',false))+
  '<div class="demo-strip">实时同步：顾客端新预约会自动出现在这里</div></div>';
  return {nav:nav('商家后台',{back:S.stack.length>0}),body:body}};
V.abm=function(){if(!M.settings||!M.customers)return {nav:nav('防占号管理',{back:true}),body:loading()};
  var Cv=M.settings.values,T=S.abT,now=Date.now();
  var over=(M.today||[]).filter(function(b){return b.status==='confirmed'&&b.startAt<now});
  var nr=M.customers.filter(function(c){return c.restricted}).length,nb=M.customers.filter(function(c){return c.blacklisted}).length;
  var pend=(M.pend||[]).filter(function(b){return b.status==='pending'});
  var card=function(b,note){return '<div class="abitem"><div class="t"><b>'+esc(b.name)+' <span style="font-weight:400;color:var(--ink3);font-size:12px">'+esc(b.phone)+'</span>'+ptag(b)+'</b></div><div class="s">'+esc(b.serviceName)+' · '+md(b.date)+' '+b.time+(note?' · '+note:'')+tags(b)+(b.seed?'<span class="demo-tag">示例</span>':'')+'</div>'+ops(b,true).replace('class="ops"','class="o"')+'</div>'};
  var sm=[];if(Cv.verify.on)sm.push('手机验证');if(Cv.maxOpen.on)sm.push('未完成≤'+Cv.maxOpen.v);if(Cv.perDay.on)sm.push('每天≤'+Cv.perDay.v);if(Cv.cancelH.on)sm.push('提前'+Cv.cancelH.v+'小时取消');if(Cv.noshow.on)sm.push('爽约'+Cv.noshow.n+'次'+(Cv.noshow.act==='block'?'禁约':'付定金'));
  var body='<div class="pad"><div class="abstat"><div><b style="color:#C9761A">'+pend.length+'</b><span>待确认</span></div><div><b>'+over.length+'</b><span>超时未到</span></div><div><b style="color:#E5484D">'+nr+'</b><span>受限顾客</span></div><div><b>'+nb+'</b><span>黑名单</span></div></div>'+
  '<button class="abitem" data-a="abSet" style="display:flex;width:100%;align-items:center;gap:10px;text-align:left"><span style="flex:1"><b style="font-size:15px">防占号设置</b><div class="s">'+(sm.join(' · ')||'全部规则已关闭')+'</div></span><span style="color:var(--ink3)">'+I.right.replace('<svg','<svg width="18" height="18"')+'</span></button>'+
  '<div class="abmt">'+[['todo','待处理'],['cust','顾客 / 黑名单']].map(function(s){return '<button class="'+(T===s[0]?'on':'')+'" data-a="abT" data-v="'+s[0]+'">'+s[1]+'</button>'}).join('')+'</div>';
  if(T==='todo'){body+='<div class="sec-t" style="margin:6px 2px 8px;font-size:14px">新客待确认<small>'+(Cv.confirmNew.on?'新客预约需确认':'已关闭新客确认')+'</small></div>'+(pend.length?pend.map(function(b){return card(b)}).join(''):'<div class="abitem s" style="color:var(--ink3);font-size:13px">暂无待确认预约</div>')+
    '<div class="sec-t" style="margin:12px 2px 8px;font-size:14px">已过开始时间未到店<small>'+(Cv.grace.on?'超时 '+Cv.grace.v+' 分钟自动标爽约':'自动标记已关闭')+'</small></div>'+(over.length?over.map(function(b){return card(b,'已超时 '+Math.round((now-b.startAt)/60000)+' 分钟')}).join(''):'<div class="abitem s" style="color:var(--ink3);font-size:13px">暂无</div>')+
    '<div class="sec-t" style="margin:12px 2px 8px;font-size:14px">最近爽约记录<small>超时自动 / 手动标记</small></div>'+((M.noshows||[]).length?M.noshows.slice(0,8).map(function(b){return '<div class="abitem"><div class="t"><b>'+esc(b.name)+' <span style="font-weight:400;color:var(--ink3);font-size:12px">'+esc(b.phone)+'</span></b><span class="abtag ns">'+(b.noshowBy==='auto'?'超时自动标记':'手动标记')+'</span></div><div class="s">'+esc(b.serviceName)+' · '+md(b.date)+' '+b.time+(b.seed?'<span class="demo-tag">示例</span>':'')+'</div></div>'}).join(''):'<div class="abitem s" style="color:var(--ink3);font-size:13px">暂无爽约记录</div>')}
  else{body+='<div class="abitem"><b style="font-size:14px">手动加入黑名单</b><div class="s">黑名单号码无法线上预约，可随时移出</div><div class="abadd"><input id="ab-bl" type="tel" inputmode="numeric" maxlength="11" placeholder="输入 11 位手机号"><button class="abb k" data-a="abBlAdd">加入</button></div></div>'+
    '<div class="abitem">'+(M.customers.length?M.customers.map(function(o){var st=o.blacklisted?'black':o.restricted?'restr':'';
      return '<div class="abcust"><div class="nm"><b>'+esc(o.name||'未留名')+'</b>'+(st==='black'?'<span class="abtag blk">黑名单</span>':st==='restr'?'<span class="abtag res">受限</span>':'')+'<small>'+esc(o.phone)+' · 爽约 '+o.noshowTotal+' 次'+(o.noshowTotal?'（近 '+Cv.noshow.days+' 天 '+o.noshowInWindow+' 次）':'')+'</small></div>'+
      (st==='restr'||o.rateLockedUntil?'<button class="abb" data-a="abClr" data-v="'+o.phone+'">解除限制</button>':'')+'<button class="abb'+(st==='black'?'':' r')+'" data-a="abBlk" data-v="'+o.phone+'|'+(st==='black'?0:1)+'">'+(st==='black'?'移出黑名单':'拉黑')+'</button></div>'}).join(''):'<div class="s">暂无顾客</div>')+'</div>'}
  return {nav:nav('防占号管理',{back:true}),body:body+'<div class="small" style="text-align:center;color:var(--ink3);font-size:12px;margin:10px 0 20px">规则由服务器统一执行，修改后对所有顾客立即生效</div></div>'}};
/* 设置页：由服务端 schema 渲染；每次修改即 PUT 保存 */
function sv(path){var o=M.settings.values;path.split('.').forEach(function(k){o=o==null?o:o[k]});return o}
function rg(path){return path.indexOf('svc.')===0?M.settings.depositRange.concat(['元','定金']):M.settings.ranges[path]}
function stp(path,label){var r=rg(path),v=path.indexOf('svc.')===0?svcDep(path).deposit:sv(path);
  return '<div class="abrow"><span>'+esc(label||r[4])+'</span><div class="abstp"><button data-a="abStep" data-v="'+path+'|-1" aria-label="减少"'+(v<=r[0]?' disabled':'')+'>−</button><input data-abin="'+path+'" type="number" inputmode="numeric" min="'+r[0]+'" max="'+r[1]+'" value="'+v+'" aria-label="'+esc(label||r[4])+'"><small>'+r[3]+'</small><button data-a="abStep" data-v="'+path+'|1" aria-label="增加"'+(v>=r[1]?' disabled':'')+'>+</button></div></div>'}
function svcDep(path){var id=+path.split('.')[1];return M.settings.services.filter(function(s){return s.id===id})[0]}
V.abset=function(){if(!M.settings)return {nav:nav('防占号设置',{back:true}),body:loading()};
  var Cv=M.settings.values,ro=!isOwner();
  var h='<div class="pad"><div class="abnote" style="margin-top:0">每项规则可单独开关、调整数值，<b>保存后立即对所有顾客生效</b>，顾客端提示会引用当前数值。'+(ro?'<b>当前为员工账号，仅可查看。</b>':'')+'</div>';
  M.settings.schema.forEach(function(g){h+='<div class="sec-t" style="margin:14px 2px 8px;font-size:14px">'+esc(g.group)+'</div>';
    g.rules.forEach(function(r){var on=Cv[r.key].on,rows='';
      if(r.key==='rate')rows=stp('rate.m')+stp('rate.n')+stp('rate.lock');
      else if(r.key==='noshow')rows=stp('noshow.n')+stp('noshow.days','统计周期（近 N 天）')+'<div class="abrow"><span>处理方式</span><div class="abseg">'+[['block','禁止线上预约'],['deposit','必须付定金']].map(function(s){return '<button class="'+(Cv.noshow.act===s[0]?'on':'')+'" data-a="abAct" data-v="'+s[0]+'">'+s[1]+'</button>'}).join('')+'</div></div>'+stp('noshow.release','自动解除（最后一次爽约后）');
      else if(r.key==='deposit')rows=M.settings.services.map(function(s){return '<div class="abrow"><span style="display:flex;align-items:center;gap:8px"><button class="abtog'+(s.depositOn?' on':'')+'" style="transform:scale(.8);margin-left:-4px" data-a="abSvcTog" data-v="'+s.id+'" role="switch" aria-checked="'+s.depositOn+'" aria-label="'+esc(s.name)+' 定金"></button>'+esc(s.name)+'</span>'+(s.depositOn?stp('svc.'+s.id).replace(/^<div class="abrow"><span>[^<]*<\/span>/,'').replace(/<\/div>$/,''):'<small style="color:var(--ink3)">不收定金</small>')+'</div>'}).join('')+stp('deposit.force');
      else if(r.fields)rows=r.fields.map(function(f){return stp(r.key+'.'+f)}).join('');
      h+='<div class="abrule'+(on?'':' off')+'" id="abr-'+r.key+'"><div class="hd"><b>'+esc(r.title)+'</b><button class="abtog'+(on?' on':'')+'" data-a="abTog" data-v="'+r.key+'" role="switch" aria-checked="'+on+'" aria-label="'+esc(r.title)+'"></button></div><div class="ds">'+esc(r.desc)+'</div>'+(rows?'<div class="rows">'+rows+'</div>':'')+'</div>'})});
  h+='<button class="btn ghost" style="width:100%;margin:6px 0 24px" data-a="abReset">恢复默认</button></div>';
  return {nav:nav('防占号设置',{back:true}),body:h}};
function saveRule(patch,msg){if(!isOwner()){toast('员工账号不能修改设置');return}
  api('PUT','/api/merchant/settings',patch,'m').then(function(r){M.settings=r;render(false);toast(msg||'已保存，立即生效');loadShop()},function(e){fail(e);render(false)})}
function saveSvcDep(id,f,msg){if(!isOwner()){toast('员工账号不能修改设置');return}
  api('PUT','/api/merchant/services/'+id,f,'m').then(function(){return api('GET','/api/merchant/settings',null,'m')}).then(function(r){M.settings=r;render(false);toast(msg);loadShop()},function(e){fail(e);render(false)})}
function setPath(path,val){if(path.indexOf('svc.')===0){var s=svcDep(path);saveSvcDep(s.id,{deposit:val},'已保存：'+s.name+' 定金 ¥'+val);return}
  var p=path.split('.'),o={};o[p[0]]={};o[p[0]][p[1]]=val;var r=rg(path);saveRule(o,'已保存：'+val+' '+r[3])}
V.audit=function(){var A=M.audit;return {nav:nav('操作日志',{back:true}),body:'<div class="pad">'+(!A?loading():A.length?A.map(function(a){var d=new Date(a.at);
  return '<div class="abitem"><div class="t"><b style="font-size:13px">'+esc(a.action)+'</b><span class="muted" style="font-size:11px">'+(d.getMonth()+1)+'/'+d.getDate()+' '+hm(a.at)+'</span></div><div class="s">'+esc(a.actor_type)+(a.actor_name?' · '+esc(a.actor_name):'')+(a.target?' · '+esc(a.target):'')+(a.detail?' · '+esc(JSON.stringify(a.detail)).slice(0,120):'')+'</div></div>'}).join(''):'<div class="empty">暂无记录</div>')+'</div>'}};
V.svcedit=function(){return {nav:nav('服务管理',{back:true}),body:'<div class="pad"><div class="sec-t">在售服务<small>修改后顾客端实时生效</small></div>'+
  C.services.map(function(s){return '<div class="card se">'+art(s)+'<div class="b"><b>'+esc(s.name)+'</b><span class="price">'+s.price+'</span> <span class="chip">'+durText(s.duration)+'</span></div><div class="ops"><button class="icbtn" data-a="svcEdit" data-v="'+s.id+'" aria-label="编辑">'+I.edit+'</button><button class="icbtn del" data-a="svcDel" data-v="'+s.id+'" aria-label="删除">'+I.trash+'</button></div></div>'}).join('')+
  '<button class="add" data-a="svcEdit">'+I.plus+'新增服务</button></div>'}};
function svcSheet(s){var isNew=!s;s=s||{name:'',desc:'',price:'',duration:60,icon:'polish',color:0};S.draft={id:s.id,icon:s.icon,color:s.color};
  var durs=[30,45,60,90,120,150,180];
  sheet(isNew?'新增服务':'编辑服务','<div class="card" style="padding:2px 14px"><div class="field"><label>名称</label><input id="s-name" maxlength="14" placeholder="如：法式美甲" value="'+esc(s.name)+'"></div>'+
  '<div class="field"><label>价格(元)</label><input id="s-price" type="number" inputmode="numeric" min="0" placeholder="0" value="'+esc(s.price)+'"></div>'+
  '<div class="field"><label>时长</label><select id="s-dur">'+durs.map(function(d){return '<option value="'+d+'"'+(d===s.duration?' selected':'')+'>'+durText(d)+'</option>'}).join('')+'</select></div>'+
  '<div class="field"><label>简介</label><input id="s-desc" maxlength="24" placeholder="选填，一句话介绍" value="'+esc(s.desc)+'"></div></div>'+
  '<div class="card"><div class="muted" style="font-size:12px">图标与配色</div><div class="picks" id="pk-icon"></div><div class="picks" id="pk-color" style="padding-top:0"></div></div>'+
  '<div style="display:flex;gap:10px;margin-top:6px"><button class="btn gray" style="flex:1" data-a="closeSheet">取消</button><button class="btn" style="flex:1" data-a="svcSave">保存</button></div>');refreshPicks()}
function refreshPicks(){var c=S.draft.color;
  document.getElementById('pk-icon').innerHTML=Object.keys(ART).map(function(k){return '<button class="'+(k===S.draft.icon?'on':'')+'" data-a="pkIcon" data-v="'+k+'" style="background:'+PALETTE[c][1]+'">'+ART[k](PALETTE[c][0])+'</button>'}).join('');
  document.getElementById('pk-color').innerHTML=PALETTE.map(function(p,i){return '<button class="'+(i===c?'on':'')+'" data-a="pkColor" data-v="'+i+'" style="background:'+p[0]+';width:30px;height:30px;border-radius:50%"></button>'}).join('')}
function saveSvc(){var b={name:document.getElementById('s-name').value.trim(),price:document.getElementById('s-price').value.trim(),duration:+document.getElementById('s-dur').value,desc:document.getElementById('s-desc').value.trim(),icon:S.draft.icon,color:S.draft.color};
  if(!b.name){toast('请填写服务名称');return}if(b.price===''||isNaN(+b.price)){toast('请填写正确的价格');return}b.price=+b.price;
  api(S.draft.id?'PUT':'POST','/api/merchant/services'+(S.draft.id?'/'+S.draft.id:''),b,'m').then(function(){closeSheet();toast(S.draft.id?'已保存':'已新增服务');return loadShop()}).then(function(){render(false)},fail)}
function mDoLogin(){var u=document.getElementById('m-user').value.trim(),p=document.getElementById('m-pass').value;S.muser=u;
  if(!u||!p){toast('请输入账号和密码');return}
  api('POST','/api/merchant/login',{username:u,password:p}).then(function(r){M.token=r.token;M.user=r.user;sessionStorage.setItem(MT,r.token);S.view='merchant';render(true);onEnter('merchant');toast('登录成功')},fail)}

/* ---------- 通用 ---------- */
function dialog(title,msg,okText,onOk){var el=document.createElement('div');el.className='mask center';
  el.innerHTML='<div class="dlg" role="alertdialog"><div class="c"><b>'+title+'</b><p>'+msg+'</p></div><div class="a"><button data-d="0">再想想</button><button data-d="1">'+okText+'</button></div></div>';
  el.addEventListener('click',function(e){var d=e.target.getAttribute('data-d');if(e.target===el||d==='0'){el.remove()}else if(d==='1'){el.remove();onOk()}});app.appendChild(el)}
var toastT;
function toast(msg){var o=app.querySelector('.toast');if(o)o.remove();clearTimeout(toastT);var t=document.createElement('div');t.className='toast';t.textContent=msg;app.appendChild(t);toastT=setTimeout(function(){t.remove()},1800)}
function demoBar(){return C.demo&&C.demo.notice?'<div class="demobar" role="note">'+esc(C.demo.notice)+'</div>':''}
function render(resetScroll){
  var r=V[S.view]();var prev=app.querySelector('.main'),st=prev?prev.scrollTop:0;
  var keep=app.querySelector('.mask'),tst=app.querySelector('.toast');
  app.classList.toggle('demo-on',!!(C.demo&&C.demo.notice));
  app.innerHTML=(r.nav||'')+'<div class="main">'+demoBar()+'<div class="page'+(resetScroll?'':' nofade')+'">'+r.body+'</div></div>'+(r.foot||'')+(r.tab?tabbar():'');
  if(keep&&!resetScroll)app.appendChild(keep);if(tst)app.appendChild(tst);
  var m=app.querySelector('.main');
  if(r.nav&&r.nav.indexOf('trans')>0){m.addEventListener('scroll',function(){var n=app.querySelector('.nav');var y=m.scrollTop;n.style.background='rgba(255,255,255,'+Math.min(y/150,1)+')';n.style.color=y>110?'#1F2329':'#fff'})}
  if(!resetScroll){m.scrollTop=st;m.firstChild.style.animation='none'}
  bindInputs()}
function bindInputs(){var n=document.getElementById('f-name'),p=document.getElementById('f-phone'),no=document.getElementById('f-note');
  if(n)n.addEventListener('input',function(){S.sel.name=n.value});
  if(p)p.addEventListener('input',function(){var v=p.value.replace(/\D/g,'').slice(0,11);if(v!==p.value)p.value=v;S.sel.phone=v});
  if(no)no.addEventListener('input',function(){S.sel.note=no.value});
  var mp=document.getElementById('m-pass');if(mp)mp.addEventListener('keydown',function(e){if(e.key==='Enter')mDoLogin()})}
function validate(){var e={},nm=S.sel.name.trim(),ph=S.sel.phone;
  if(!nm)e.name='请填写称呼';if(!/^1[3-9]\d{9}$/.test(ph))e.phone=ph.length!==11?'请输入 11 位手机号':'手机号格式不正确';S.errs=e;return !e.name&&!e.phone}
function findB(id){id=+id;var all=(ME.bookings||[]).concat(M.list||[],M.pend||[],M.today||[]);return all.filter(function(b){return b.id===id})[0]}
var MOP_T={accept:['确认预约','确认后顾客端显示「待服务」。','确认'],reject:['拒绝预约','拒绝后释放时段，已付定金原路退回。','拒绝'],arrive:null,done:null,noshow:['标记爽约','将记录一次爽约，已付定金不退。','标记'],cancel:['取消该预约','取消后释放时段，已付定金原路退回，建议先电话告知顾客。','确定取消']};
var MOP_OK={accept:'已确认',reject:'已拒绝',arrive:'已标记到店',done:'已标记完成',noshow:'已标记爽约',cancel:'已取消'};
function mOp(op,id){var run=function(){api('POST','/api/merchant/bookings/'+id+'/'+op,null,'m').then(function(r){toast(MOP_OK[op]+(r.refunded?'，定金已退回':''));mLoad(S.view)},fail)};
  var t=MOP_T[op];if(t)dialog(t[0],t[1],t[2],run);else run()}

/* ---------- 事件 ---------- */
app.addEventListener('click',function(e){
  var t=e.target.closest('[data-a]');if(!t||!app.contains(t))return;
  var a=t.getAttribute('data-a'),v=t.getAttribute('data-v');
  switch(a){
  case 'tab': switchTab(v);break;
  case 'back': back();break;
  case 'toast': toast(v);break;
  case 'startBook': S.sel.time=null;S.tab='book';S.stack=[];S.view='book';render(true);onEnter('book');break;
  case 'quickBook': S.sel.serviceId=+v;S.sel.time=null;S.tab='book';S.stack=['book'];S.view='time';AV=null;render(true);onEnter('time');break;
  case 'pick': if(S.sel.serviceId!==+v){S.sel.serviceId=+v;S.sel.time=null;AV=null}render(false);break;
  case 'toTime': go('time');break;
  case 'pickDate': S.sel.date=v;S.sel.time=null;render(false);break;
  case 'pickTime': S.sel.time=v;render(false);break;
  case 'toInfo': if(!S.sel.phone&&ME.phone)S.sel.phone=ME.phone;if(!S.sel.name&&ME.info&&ME.info.name)S.sel.name=ME.info.name;S.errs={};go('info');break;
  case 'toConfirm': if(validate())go('confirm');else render(false);break;
  case 'submit': submit();break;
  case 'goMine': S.mineSeg='open';switchTab('mine');break;
  case 'mineSeg': S.mineSeg=v;render(false);break;
  case 'login': dialogPhone();break;
  case 'logout': api('POST','/api/auth/logout',null,'c').catch(function(){});setCustomer(null);render(false);toast('已退出');break;
  case 'sms': sendSms(t);break;
  case 'smsVerify': smsVerify();break;
  case 'closeSheet': closeSheet();verifyNext=null;break;
  case 'payClose': closeSheet();toast('时段已保留，可在「我的」中继续支付');break;
  case 'payConfirm': payConfirm(t);break;
  case 'payAgain': api('GET','/api/bookings/'+v+'/payment',null,'c').then(function(p){paySheet(p,findB(v))},fail);break;
  case 'uCancel': var b=findB(v);if(b&&b.canCancel===false){alertBox('暂不能线上取消',b.cancelBlock);break}
    dialog('取消预约','确定要取消这次预约吗？取消后时段会释放给其他顾客。'+(b&&b.depositStatus==='paid'?'定金 ¥'+b.deposit+' 将原路退回。':''),'确定取消',function(){
      api('POST','/api/bookings/'+v+'/cancel',null,'c').then(function(r){toast('已取消预约'+(r.refunded?'，定金已退回':''));onEnter('mine')},function(e){if(ERR_T[e.code])alertBox(ERR_T[e.code],e.message);else fail(e)})});break;
  case 'callShop': toast('门店电话 '+(C.shop?C.shop.phone:''));break;
  case 'toMerchant': if(M.token)go('merchant');else go('mlogin');break;
  case 'mLogin': mDoLogin();break;
  case 'mLogout': api('POST','/api/merchant/logout',null,'m').catch(function(){});M.token=null;M.user=null;sessionStorage.removeItem(MT);mStop();switchTab('mine');toast('已退出商家后台');break;
  case 'mTab': S.mTab=v;M.list=null;render(false);mLoad('merchant');break;
  case 'mOp': var q=v.split('|');mOp(q[0],q[1]);break;
  case 'mReset': dialog('重置演示数据','将清空所有预约、顾客与设置改动，恢复示例数据（商家账号保留）。','重置',function(){api('POST','/api/merchant/demo-reset',null,'m').then(function(){toast('已恢复示例数据');loadShop().then(function(){mLoad('merchant')})},fail)});break;
  case 'goSvcEdit': go('svcedit');break;
  case 'goAudit': go('audit');break;
  case 'abGo': go('abm');break;
  case 'abSet': go('abset');break;
  case 'abT': S.abT=v;render(false);break;
  case 'abBlAdd': var ph=(document.getElementById('ab-bl').value||'').trim();if(!/^1[3-9]\d{9}$/.test(ph)){toast('请输入正确的 11 位手机号');break}
    api('POST','/api/merchant/customers/blacklist',{phone:ph,on:true},'m').then(function(){toast('已加入黑名单');mLoad('abm')},fail);break;
  case 'abBlk': var bp=v.split('|');(bp[1]==='1'?function(f){dialog('加入黑名单','该号码将无法线上预约，可随时移出。','拉黑',f)}:function(f){f()})(function(){
      api('POST','/api/merchant/customers/blacklist',{phone:bp[0],on:bp[1]==='1'},'m').then(function(){toast(bp[1]==='1'?'已拉黑':'已移出黑名单');mLoad('abm')},fail)});break;
  case 'abClr': api('POST','/api/merchant/customers/'+v+'/clear',null,'m').then(function(){toast('已解除限制');mLoad('abm')},fail);break;
  case 'abTog': var o={};o[v]={on:!M.settings.values[v].on};saveRule(o,(o[v].on?'已开启':'已关闭')+'，立即生效');break;
  case 'abAct': saveRule({noshow:{act:v}});break;
  case 'abSvcTog': var sd=svcDep('svc.'+v);saveSvcDep(sd.id,{depositOn:!sd.depositOn},(sd.depositOn?'已关闭':'已开启')+'「'+sd.name+'」定金');break;
  case 'abStep': var sp=v.split('|'),r=rg(sp[0]),cur=sp[0].indexOf('svc.')===0?svcDep(sp[0]).deposit:sv(sp[0]),x=cur+(+sp[1])*r[2];
    if(x<r[0]||x>r[1]){toast('可设置范围 '+r[0]+'–'+r[1]+' '+r[3]);break}setPath(sp[0],x);break;
  case 'abReset': if(!isOwner()){toast('员工账号不能修改设置');break}dialog('恢复默认','所有防占号规则恢复为默认值，顾客爽约记录和黑名单不受影响。','恢复',function(){api('POST','/api/merchant/settings/reset',null,'m').then(function(r){M.settings=r;render(false);toast('已恢复默认设置');loadShop()},fail)});break;
  case 'svcEdit': svcSheet(v?svcById(v):null);break;
  case 'pkIcon': S.draft.icon=v;refreshPicks();break;
  case 'pkColor': S.draft.color=+v;refreshPicks();break;
  case 'svcSave': saveSvc();break;
  case 'svcDel': var sv0=svcById(v);dialog('下架服务','确定下架「'+esc(sv0.name)+'」？已有预约不受影响。','下架',function(){api('DELETE','/api/merchant/services/'+v,null,'m').then(function(){toast('已下架');return loadShop()}).then(function(){render(false)},fail)});break;
  }
});
app.addEventListener('change',function(e){var t=e.target,p=t.getAttribute&&t.getAttribute('data-abin');if(!p)return;var r=rg(p),v=String(t.value).trim();
  if(!/^\d+$/.test(v)||+v<r[0]||+v>r[1]||(+v-r[0])%r[2]){toast('请输入 '+r[0]+'–'+r[1]+' 之间'+(r[2]>1?' '+r[2]+' 的倍数':'的整数'));render(false);return}setPath(p,+v)});
function dialogPhone(){var el=sheet('验证手机号','<div class="card" style="padding:2px 14px"><div class="field"><label>手机号</label><input id="lg-phone" type="tel" inputmode="numeric" maxlength="11" placeholder="11 位手机号"></div></div><button class="btn" style="width:100%;margin-top:8px" data-a="lgNext">下一步</button>');
  el.querySelector('[data-a=lgNext]').addEventListener('click',function(e){e.stopPropagation();var ph=document.getElementById('lg-phone').value.trim();if(!/^1[3-9]\d{9}$/.test(ph)){toast('请输入正确的 11 位手机号');return}
    verifySheet(ph,function(){onEnter('mine');render(false)})})}

/* ---------- 启动 ---------- */
if(location.hash==='#merchant'){S.tab='mine';S.view=M.token?'merchant':'mlogin'}
window.addEventListener('hashchange',function(){if(location.hash==='#merchant'){S.tab='mine';S.stack=[];S.view=M.token?'merchant':'mlogin';render(true);onEnter(S.view)}});
render(true);
loadShop().then(function(){render(false);onEnter(S.view)},function(e){app.querySelector('.main').innerHTML='<div class="empty" style="padding:60px 20px">'+esc(e.message)+'<br><button class="btn sm" onclick="location.reload()">重试</button></div>'});
})();
