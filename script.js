'use strict';
/* Front end. All data now comes from the Node.js backend (server.js). */
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
const cls=n=>'s'+Math.round(n);
const STS=['Pending','In progress','Cleaned'];
const mapUrl=l=>'https://www.google.com/maps?q='+encodeURIComponent(l.lat+','+l.lng);
const lsGet=k=>{try{return localStorage.getItem(k)}catch(e){return null}};
const S={token:lsGet('cw_token'),role:lsGet('cw_role'),phone:lsGet('cw_phone')};
function setSess(t,r,p){
  S.token=t;S.role=r;S.phone=p;
  try{if(t){localStorage.setItem('cw_token',t);localStorage.setItem('cw_role',r);localStorage.setItem('cw_phone',p||'')}
      else['cw_token','cw_role','cw_phone'].forEach(k=>localStorage.removeItem(k))}catch(e){}
}
let pub=[],all=[],mine=[];

/* ---------- talking to the backend ---------- */

/* ---------- Easy mode: works without the server (data saved in this browser) ---------- */
let LOCAL=false;
const L_TYPES=['Public toilet','Park','Bus stop','Railway station','Market','Hospital'];
const L_ISSUES=['Garbage','Bad smell','No water','Broken fittings','No dustbin'];
const lmask=p=>p.slice(0,2)+'******'+p.slice(-2);
const lotp={},ladm={n:0,until:0};
function lfail(status,msg){const x=new Error(msg);x.status=status;return x}
function ldb(){
  try{const d=JSON.parse(localStorage.getItem('cw_local_db'));if(d&&Array.isArray(d.reports))return d}catch(e){}
  const S0=[['Public toilet','Bus Stand Toilet',1,['Bad smell','No water'],'No water since morning.','2026-10-10','9800000021'],
    ['Park','Gandhi Park',4,[],'Well kept.','2026-10-11','7000000005'],
    ['Market','Sabzi Mandi',2,['Garbage','No dustbin'],'Waste piled near gate.','2026-10-12','9800000021'],
    ['Railway station','Platform 1',3,['No dustbin'],'','2026-10-13','6300000048']];
  const d={nextId:5,reports:S0.map((x,i)=>({id:i+1,type:x[0],place:x[1],rating:x[2],issues:x[3],note:x[4],date:x[5],phone:x[6],by:lmask(x[6]),photo:null,loc:null,status:'Pending'}))};
  lsave(d);return d;
}
function lsave(d){try{localStorage.setItem('cw_local_db',JSON.stringify(d))}catch(e){throw lfail(413,'Browser storage is full. Delete old reports or use a smaller photo.')}}
async function localApi(path,o){
  const m=o.method||'GET',b=o.body||{},d=ldb(),t=S.token||'';
  const role=t.startsWith('local:user:')?'user':t==='local:admin'?'admin':null,phone=role==='user'?t.slice(11):null;
  const need=r=>{if(!role)throw lfail(401,'Please login first');if(r&&role!==r)throw lfail(403,'Not allowed for your role')};
  const full=r=>({id:r.id,type:r.type,place:r.place,rating:r.rating,issues:r.issues,note:r.note,date:r.date,by:r.by,photo:r.photo,loc:r.loc,status:r.status});
  const newest=a=>a.slice().reverse();
  if(path==='/me'){need();return{role,phone:phone?lmask(phone):null}}
  if(path==='/logout')return{ok:true};
  if(path==='/otp/send'){
    if(!/^[6-9]\d{9}$/.test(String(b.phone)))throw lfail(400,'Enter a valid 10-digit mobile number');
    const otp=String(100000+Math.floor(Math.random()*900000));
    lotp[b.phone]={otp,exp:Date.now()+120000,tries:0};return{ok:true,demoOtp:otp};
  }
  if(path==='/otp/verify'){
    const rec=lotp[b.phone];
    if(!rec||rec.exp<Date.now())throw lfail(400,'OTP expired. Send a new one');
    if(String(b.code||'')!==rec.otp){rec.tries++;if(rec.tries>=3)delete lotp[b.phone];throw lfail(400,rec.tries>=3?'Too many wrong attempts. Send a new OTP':'Wrong OTP. '+(3-rec.tries)+' tries left')}
    delete lotp[b.phone];return{token:'local:user:'+b.phone,role:'user',phone:lmask(b.phone)};
  }
  if(path==='/admin/login'){
    if(Date.now()<ladm.until)throw lfail(429,'Too many attempts. Wait 15 seconds');
    if(b.id==='admin'&&b.password==='admin123'){ladm.n=0;return{token:'local:admin',role:'admin',phone:null}}
    ladm.n++;if(ladm.n>=3){ladm.until=Date.now()+15000;ladm.n=0}
    throw lfail(401,'Wrong admin ID or password');
  }
  if(path==='/reports/public'&&m==='GET')return d.reports.map(r=>({id:r.id,type:r.type,place:r.place,rating:r.rating,date:r.date,status:r.status}));
  if(path==='/reports/mine'&&m==='GET'){need('user');return newest(d.reports.filter(r=>r.phone===phone)).map(full)}
  if(path==='/reports'&&m==='GET'){need('admin');return newest(d.reports).map(full)}
  if(path==='/reports'&&m==='POST'){
    need('user');
    const place=String(b.place||'').trim().slice(0,60),rating=+b.rating;
    if(!L_TYPES.includes(b.type)||!place||!Number.isInteger(rating)||rating<1||rating>5)throw lfail(400,'Please fill facility type, place and rating');
    const issues=(Array.isArray(b.issues)?b.issues:[]).filter(i=>L_ISSUES.includes(i));
    const photo=/^data:image\/jpeg;base64,/.test(String(b.photo||''))?b.photo:null;
    let loc=null;if(b.loc&&Math.abs(+b.loc.lat)<=90&&Math.abs(+b.loc.lng)<=180)loc={lat:+b.loc.lat,lng:+b.loc.lng,acc:Math.round(+b.loc.acc)||0};
    const r={id:d.nextId++,type:b.type,place,rating,issues,note:String(b.note||'').trim().slice(0,200),date:new Date().toISOString().slice(0,10),phone,by:lmask(phone),photo,loc,status:'Pending'};
    d.reports.push(r);lsave(d);return full(r);
  }
  const mm=/^\/reports\/(\d+)(\/status)?$/.exec(path);
  if(mm){
    need('admin');const i=d.reports.findIndex(r=>r.id===+mm[1]);if(i<0)throw lfail(404,'Report not found');
    if(mm[2]&&m==='PATCH'){if(!STS.includes(b.status))throw lfail(400,'Invalid status');d.reports[i].status=b.status;lsave(d);return{ok:true}}
    if(!mm[2]&&m==='DELETE'){d.reports.splice(i,1);lsave(d);return{ok:true}}
  }
  throw lfail(404,'Not found');
}
async function api(path,opts={}){
  if(LOCAL){try{return await localApi(path,opts)}catch(x){if(x.status===401&&S.token){setSess(null,null,null);refreshAuth()}throw x}}
  const h={'Content-Type':'application/json'};
  if(S.token)h.Authorization='Bearer '+S.token;
  let r;
  try{r=await fetch('/api'+path,{method:opts.method||'GET',headers:h,body:opts.body?JSON.stringify(opts.body):undefined})}
  catch(e){const x=new Error(location.protocol==='file:'?'You opened index.html directly. Run node server.js, then open http://localhost:3000 in the browser.':'Backend is not running. Start it with: node server.js');x.offline=true;throw x}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    if(r.status===401&&S.token){setSess(null,null,null);refreshAuth()}
    const x=new Error(r.status===401&&!j.error?'Please login again':(j.error||'Request failed'));x.status=r.status;throw x;
  }
  return j;
}
function banner(msg){
  let b=$('banner');
  if(!msg){if(b)b.remove();return}
  if(!b){b=document.createElement('div');b.id='banner';b.className='banner';b.setAttribute('role','alert');document.body.prepend(b)}
  b.textContent=msg;
}
async function load(){
  try{pub=await api('/reports/public');banner('')}
  catch(e){if(e.offline)banner(e.message);pub=[]}
  all=[];mine=[];
  try{
    if(S.role==='admin')all=await api('/reports');
    else if(S.role==='user')mine=await api('/reports/mine');
  }catch(e){}
  renderAll();
}

/* ---------- rendering ---------- */
function renderStats(){
  const total=pub.length,a=total?avg(pub.map(d=>d.rating)).toFixed(1):'0';
  const bad=pub.filter(d=>d.rating<=2).length,good=pub.filter(d=>d.rating>=4).length;
  $('stats').innerHTML=
   `<div class="stat"><b>${total}</b><span>Total reports</span></div>
    <div class="stat"><b>${a}/5</b><span>Average rating</span></div>
    <div class="stat warn"><b>${bad}</b><span>Need attention</span></div>
    <div class="stat ok"><b>${good}</b><span>Clean places</span></div>`;
}
function renderRank(){
  const g={};
  pub.forEach(d=>{const k=d.type+'|'+d.place;(g[k]=g[k]||{type:d.type,place:d.place,r:[]}).r.push(d.rating)});
  const rows=Object.values(g).map(x=>({...x,a:avg(x.r)})).sort((p,q)=>p.a-q.a);
  $('rank').innerHTML=rows.length?rows.map(x=>{
    const col=x.a<=2.5?'var(--red)':x.a<3.5?'var(--amber)':'var(--green)';
    return `<div class="row"><div class="score ${cls(x.a)}">${x.a.toFixed(1)}</div>
      <div class="info"><b>${esc(x.place)}</b><small>${esc(x.type)} · ${x.r.length} report${x.r.length>1?'s':''}</small>
      <div class="bar2"><i style="width:${x.a*20}%;background:${col}"></i></div></div></div>`}).join('')
    :'<p class="empty">No facilities yet. Submit the first report above.</p>';
}
function renderFilter(){
  const types=[...new Set(all.map(d=>d.type))],cur=$('filter').value;
  $('filter').innerHTML='<option value="">All types</option>'+types.map(t=>`<option${t===cur?' selected':''}>${esc(t)}</option>`).join('');
}
const stBadge=d=>`<span class="stb st${STS.indexOf(d.status)}">${esc(d.status)}</span>`;
function renderList(){
  const sm=$('adminsum');
  if(sm){const c=STS.map(s=>all.filter(d=>d.status===s).length);sm.textContent='Pending: '+c[0]+'  |  In progress: '+c[1]+'  |  Cleaned: '+c[2]+(LOCAL?'   (Easy mode: only reports made in this browser are shown. Use the server for reports from all devices.)':'')}
  const f=$('filter').value,rows=all.filter(d=>!f||d.type===f);
  $('list').innerHTML=rows.length?rows.map(d=>`
    <div class="row"><div class="score ${cls(d.rating)}">${d.rating}</div>
    <div class="info"><b>${esc(d.place)}</b><small>${esc(d.type)} · ${esc(d.date)} · by ${esc(d.by)}</small>
    ${d.note?`<div>${esc(d.note)}</div>`:''}
    ${d.issues.map(i=>`<span class="tag">${esc(i)}</span>`).join('')}
    ${d.photo?`<img class="thumb" src="${esc(d.photo)}" alt="Photo of ${esc(d.place)}">`:''}
    ${d.loc?`<div><a href="${mapUrl(d.loc)}" target="_blank" rel="noopener">View on map</a></div>`:''}</div>
    <div class="adminctl"><select class="stsel" data-id="${d.id}" aria-label="Status">${STS.map(s=>`<option${s===d.status?' selected':''}>${s}</option>`).join('')}</select>
    <button class="del" data-id="${d.id}">Delete</button></div></div>`).join('')
    :'<p class="empty">No reports match this filter.</p>';
}
function renderHistory(){
  const g={};
  all.forEach(d=>{(g[d.by]=g[d.by]||[]).push(d)});
  const rows=Object.entries(g).sort((a,b)=>b[1].length-a[1].length);
  $('hcount').textContent=rows.length+' '+(rows.length===1?'person has':'people have')+' submitted '+all.length+' reports. Tap a name to see their history. Numbers are masked for privacy.';
  $('hist').innerHTML=rows.length?rows.map(([who,list],i)=>{
    const a=avg(list.map(d=>d.rating)),last=list.map(d=>d.date).sort().pop();
    return `<details class="person"><summary>
      <span class="av c${i%5}">${esc(who.slice(0,2))}</span>
      <span class="who"><b>${esc(who)}</b><small>Last report: ${esc(last)} · Avg rating given: ${a.toFixed(1)}</small></span>
      <span class="count">${list.length} report${list.length>1?'s':''}</span></summary>
      <ul>${list.map(d=>`<li><span class="mini ${cls(d.rating)}">${d.rating}</span><span>${esc(d.place)}<small>${esc(d.type)} · ${esc(d.date)}</small></span></li>`).join('')}</ul>
    </details>`}).join(''):'<p class="empty">No reporters yet.</p>';
}
function renderMine(){
  $('minelist').innerHTML=S.role==='user'?(mine.length?mine.map(d=>`<div class="row"><div class="score ${cls(d.rating)}">${d.rating}</div>
    <div class="info"><b>${esc(d.place)}</b><small>${esc(d.type)} · ${esc(d.date)}</small>
    ${d.note?`<div>${esc(d.note)}</div>`:''}
    ${d.photo?`<img class="thumb" src="${esc(d.photo)}" alt="Photo of ${esc(d.place)}">`:''}
    <div>${stBadge(d)}</div></div></div>`).join(''):'<p class="empty">You have not submitted any report yet.</p>'):'';
}
function renderAll(){renderStats();renderRank();renderFilter();renderList();renderHistory();renderMine()}
function applyRole(){
  document.querySelectorAll('[data-role]').forEach(el=>{el.hidden=el.dataset.role!==S.role});
  $('report').hidden=(S.role==='admin');
}
function refreshAuth(){
  $('auth').textContent=S.role==='admin'?'Logout (Admin)':S.role==='user'?'Logout '+(S.phone||''):'Login';
  applyRole();
}

/* ---------- report form (photo + live location) ---------- */
let photo=null,loc=null;
$('photo').onchange=e=>{
  const f=e.target.files[0];
  if(!f||!f.type.startsWith('image/'))return;
  const img=new Image(),url=URL.createObjectURL(f);
  img.onload=()=>{
    const s=Math.min(1,800/Math.max(img.width,img.height)),c=document.createElement('canvas');
    c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    photo=c.toDataURL('image/jpeg',0.7);
    $('prev').src=photo;$('prev').hidden=false;URL.revokeObjectURL(url);
  };
  img.src=url;
};
$('geo').onclick=()=>{
  if(!navigator.geolocation){$('locout').textContent='This browser does not support location.';return}
  $('locout').textContent='Getting your location...';
  navigator.geolocation.getCurrentPosition(p=>{
    loc={lat:+p.coords.latitude.toFixed(5),lng:+p.coords.longitude.toFixed(5),acc:Math.round(p.coords.accuracy)};
    $('locout').textContent='Location added: '+loc.lat+', '+loc.lng+' (accuracy about '+loc.acc+' m)';
  },err=>{
    $('locout').textContent=err.code===1?'Permission denied. Allow location access in your browser settings.':'Could not get location. Try again outside or on a network.';
  },{enableHighAccuracy:true,timeout:15000});
};
$('form').addEventListener('submit',async e=>{
  e.preventDefault();
  if(S.role==='admin'){alert('Admin cannot submit reports. Logout and login as a user.');return}
  if(S.role!=='user'){openLogin();return}
  const r=document.querySelector('input[name=r]:checked');
  if(!r)return;
  const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
  try{
    await api('/reports',{method:'POST',body:{
      type:$('type').value,place:$('place').value.trim(),rating:+r.value,
      issues:[...document.querySelectorAll('.chips input:checked')].map(i=>i.value),
      note:$('note').value.trim(),photo:photo,loc:loc}});
    e.target.reset();photo=null;loc=null;$('prev').hidden=true;$('locout').textContent='Not added yet.';
    await load();$('rank').scrollIntoView({behavior:'smooth'});
  }catch(err){alert(err.message);if(err.status===401)openLogin()}
  finally{btn.disabled=false}
});

/* ---------- admin actions ---------- */
$('list').addEventListener('click',async e=>{
  if(!e.target.classList.contains('del')||S.role!=='admin')return;
  if(!confirm('Delete this report?'))return;
  try{await api('/reports/'+e.target.dataset.id,{method:'DELETE'});await load()}catch(err){alert(err.message)}
});
$('list').addEventListener('change',async e=>{
  if(!e.target.classList.contains('stsel')||S.role!=='admin')return;
  try{await api('/reports/'+e.target.dataset.id+'/status',{method:'PATCH',body:{status:e.target.value}});await load()}catch(err){alert(err.message)}
});
$('filter').addEventListener('change',renderList);
$('csv').addEventListener('click',async()=>{
  if(S.role!=='admin')return;
  try{
    let blob;
    if(LOCAL){
      const q=v=>{v=String(v==null?'':v);if(/^[=+\-@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"'};
      const rows=[['Date','Type','Place','Rating','Issues','Comment','Reported by','Status','Latitude','Longitude'].join(',')]
        .concat(all.map(r=>[r.date,r.type,r.place,r.rating,r.issues.join('; '),r.note,r.by,r.status,r.loc?r.loc.lat:'',r.loc?r.loc.lng:''].map(q).join(',')));
      blob=new Blob([rows.join('\n')],{type:'text/csv'});
    }else{
      const r=await fetch('/api/export.csv',{headers:{Authorization:'Bearer '+S.token}});
      if(!r.ok)throw new Error();blob=await r.blob();
    }
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cleanliness-reports.csv';a.click();
  }catch(e){alert('Could not download the CSV file.')}
});

/* ---------- login: User (OTP) and Admin ---------- */
const lmsg=t=>$('lmsg').textContent=t;
function showTab(t){
  $('uform').hidden=t!=='u';$('aform').hidden=t!=='a';
  $('tabu').classList.toggle('on',t==='u');$('taba').classList.toggle('on',t==='a');lmsg('');
}
function openLogin(){
  $('phone').value='';$('code').value='';$('step2').hidden=true;$('demo').textContent='';
  showTab('u');$('dlg').showModal();
}
$('tabu').onclick=()=>showTab('u');$('taba').onclick=()=>showTab('a');
$('lclose').onclick=()=>$('dlg').close();
$('auth').onclick=async()=>{
  if(S.role){try{await api('/logout',{method:'POST'})}catch(e){}setSess(null,null,null);refreshAuth();await load()}
  else openLogin();
};
$('send').onclick=async()=>{
  const p=$('phone').value.trim();
  if(!/^[6-9]\d{9}$/.test(p)){lmsg('Enter a valid 10-digit mobile number.');return}
  try{
    const r=await api('/otp/send',{method:'POST',body:{phone:p}});
    $('pending').value=p;$('step2').hidden=false;
    $('demo').textContent=r.demoOtp?'Demo mode: your OTP is '+r.demoOtp:'';
    $('demo').hidden=!r.demoOtp;
    lmsg('OTP sent. It is valid for 2 minutes.');
  }catch(e){lmsg(e.message)}
};
$('verify').onclick=async()=>{
  try{
    const r=await api('/otp/verify',{method:'POST',body:{phone:$('pending').value,code:$('code').value.trim()}});
    setSess(r.token,r.role,r.phone);$('dlg').close();refreshAuth();await load();
  }catch(e){lmsg(e.message)}
};
$('alogin').onclick=async()=>{
  try{
    const r=await api('/admin/login',{method:'POST',body:{id:$('aid').value.trim(),password:$('apw').value}});
    $('aid').value='';$('apw').value='';
    setSess(r.token,r.role,null);$('dlg').close();refreshAuth();await load();location.hash='#log';
  }catch(e){lmsg(e.message)}
};

/* ---------- start ---------- */
(async function init(){
  try{
    const r=await fetch('/api/reports/public');
    if(!r.ok||!(r.headers.get('content-type')||'').includes('json'))throw 0;
  }catch(e){
    LOCAL=true;
    const f=document.querySelector('.foot');
    if(f)f.textContent='Public Facility Cleanliness mini project. Running without a server: data is saved in this browser only.';
  }
  refreshAuth();
  if(S.token){try{const r=await api('/me');setSess(S.token,r.role,r.phone)}catch(e){setSess(null,null,null)}refreshAuth()}
  await load();
})();

/* ---------- Clean India Green India slider ---------- */
(function(){
  const SLIDE_SECONDS=3; // change this number to make the slides faster or slower
  const box=document.querySelector('.poster'), track=$('ptrack'), dots=$('pdots');
  const slides=[...track.children];
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i=0, timer=null, paused=reduce;
  dots.innerHTML=slides.map((_,n)=>`<button type="button" data-n="${n}" aria-label="Slide ${n+1}"></button>`).join('');
  function go(n){
    i=(n+slides.length)%slides.length;
    track.style.transform='translateX(-'+(i*100)+'%)';
    slides.forEach((s,k)=>{s.inert=k!==i;s.setAttribute('aria-hidden',k!==i)});
    dots.querySelectorAll('button').forEach((b,k)=>b.classList.toggle('on',k===i));
  }
  function stop(){clearInterval(timer)}
  function start(){stop();if(!paused)timer=setInterval(()=>go(i+1),SLIDE_SECONDS*1000)}
  $('pprev').onclick=()=>{go(i-1);start()};
  $('pnext').onclick=()=>{go(i+1);start()};
  dots.onclick=e=>{if(e.target.dataset.n){go(+e.target.dataset.n);start()}};
  $('pplay').textContent=paused?'Play':'Pause';
  $('pplay').onclick=()=>{paused=!paused;$('pplay').textContent=paused?'Play':'Pause';paused?stop():start()};
  box.addEventListener('mouseenter',stop);box.addEventListener('mouseleave',start);
  box.addEventListener('focusin',stop);box.addEventListener('focusout',start);
  let x0=null;
  box.addEventListener('touchstart',e=>{x0=e.touches[0].clientX;stop()},{passive:true});
  box.addEventListener('touchend',e=>{
    if(x0!==null){const d=e.changedTouches[0].clientX-x0;if(Math.abs(d)>50)go(i+(d<0?1:-1))}
    x0=null;start();
  });
  go(0);start();
})();
