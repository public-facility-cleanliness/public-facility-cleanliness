'use strict';
// Backend: Node.js, no extra packages needed. Run: node server.js
const http=require('http'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const PORT=+process.env.PORT||3000, DEMO_OTP=process.env.DEMO_OTP!=='false';
const ADMIN_ID=process.env.ADMIN_ID||'admin', ADMIN_PW=process.env.ADMIN_PW||'admin123';
const ROOT=__dirname, DATA=process.env.DATA_DIR||path.join(ROOT,'data'), UP=process.env.DATA_DIR?path.join(DATA,'uploads'):path.join(ROOT,'uploads'), DBF=path.join(DATA,'db.json');
const TYPES=['Public toilet','Park','Bus stop','Railway station','Market','Hospital'];
const ISSUES=['Garbage','Bad smell','No water','Broken fittings','No dustbin'];
const STATUS=['Pending','In progress','Cleaned'];
const mask=p=>p.slice(0,2)+'******'+p.slice(-2);
fs.mkdirSync(DATA,{recursive:true}); fs.mkdirSync(UP,{recursive:true});

/* ---------- tiny JSON database ---------- */
let db;
try{db=JSON.parse(fs.readFileSync(DBF,'utf8'))}catch(e){
  const S=[['Public toilet','Bus Stand Toilet',1,['Bad smell','No water'],'No water since morning.','2026-10-10','9800000021'],
    ['Park','Gandhi Park',4,[],'Well kept.','2026-10-11','7000000005'],
    ['Market','Sabzi Mandi',2,['Garbage','No dustbin'],'Waste piled near gate.','2026-10-12','9800000021'],
    ['Railway station','Platform 1',3,['No dustbin'],'','2026-10-13','6300000048']];
  db={nextId:5,users:{},reports:S.map((s,i)=>({id:i+1,type:s[0],place:s[1],rating:s[2],issues:s[3],note:s[4],date:s[5],phone:s[6],by:mask(s[6]),photo:null,loc:null,status:'Pending'}))};
  save();
}
function save(){const t=DBF+'.tmp';fs.writeFileSync(t,JSON.stringify(db,null,1));fs.renameSync(t,DBF)}

/* ---------- helpers ---------- */
const sessions=new Map(), otps=new Map(), adminTry=new Map();
const sha=s=>crypto.createHash('sha256').update(String(s)).digest();
const safeEq=(a,b)=>crypto.timingSafeEqual(sha(a),sha(b));
const fail=(code,msg)=>Object.assign(new Error(msg),{code});
function send(res,code,obj,type){
  res.writeHead(code,{'Content-Type':type||'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(type?obj:JSON.stringify(obj));
}
function readBody(req,max=3e6){return new Promise((ok,no)=>{let n=0;const c=[];
  req.on('data',d=>{n+=d.length;if(n>max){no(fail(413,'Request too large'));req.destroy();return}c.push(d)});
  req.on('end',()=>{try{ok(c.length?JSON.parse(Buffer.concat(c)):{})}catch(e){no(fail(400,'Bad JSON'))}});
  req.on('error',no)})}
function session(req){
  const h=req.headers.authorization||'', t=h.startsWith('Bearer ')?h.slice(7):'';
  const s=sessions.get(t); if(!s||s.exp<Date.now()){sessions.delete(t);return null}
  return {...s,token:t};
}
const need=(req,role)=>{const s=session(req);if(!s)throw fail(401,'Please login first');if(role&&s.role!==role)throw fail(403,'Not allowed for your role');return s};
const newToken=(role,phone)=>{const t=crypto.randomBytes(24).toString('hex');sessions.set(t,{role,phone,exp:Date.now()+12*3600e3});return t};
const pubRow=r=>({id:r.id,type:r.type,place:r.place,rating:r.rating,date:r.date,status:r.status});
const fullRow=r=>({id:r.id,type:r.type,place:r.place,rating:r.rating,issues:r.issues,note:r.note,date:r.date,by:r.by,photo:r.photo,loc:r.loc,status:r.status});
const newest=a=>a.slice().reverse();

/* ---------- API ---------- */
async function api(req,res,p,m){
  if(p==='/api/me'&&m==='GET'){const s=need(req);return send(res,200,{role:s.role,phone:s.phone?mask(s.phone):null})}
  if(p==='/api/logout'&&m==='POST'){const s=session(req);if(s)sessions.delete(s.token);return send(res,200,{ok:true})}

  if(p==='/api/otp/send'&&m==='POST'){
    const {phone}=await readBody(req);
    if(!/^[6-9]\d{9}$/.test(String(phone)))throw fail(400,'Enter a valid 10-digit mobile number');
    const old=otps.get(phone);
    if(old&&Date.now()-old.sent<30000)throw fail(429,'Please wait 30 seconds before asking for a new OTP');
    const otp=String(crypto.randomInt(100000,1000000));
    otps.set(phone,{otp,exp:Date.now()+120000,tries:0,sent:Date.now()});
    console.log('[SMS simulation] OTP for '+phone+' is '+otp);
    return send(res,200,{ok:true,...(DEMO_OTP?{demoOtp:otp}:{})});
  }
  if(p==='/api/otp/verify'&&m==='POST'){
    const {phone,code}=await readBody(req), rec=otps.get(phone);
    if(!rec||rec.exp<Date.now())throw fail(400,'OTP expired. Send a new one');
    if(!safeEq(code||'',rec.otp)){rec.tries++;if(rec.tries>=3)otps.delete(phone);throw fail(400,rec.tries>=3?'Too many wrong attempts. Send a new OTP':'Wrong OTP. '+(3-rec.tries)+' tries left')}
    otps.delete(phone);
    db.users[phone]={last:new Date().toISOString()};save();
    return send(res,200,{token:newToken('user',phone),role:'user',phone:mask(phone)});
  }
  if(p==='/api/admin/login'&&m==='POST'){
    const ip=req.socket.remoteAddress, a=adminTry.get(ip)||{n:0,until:0};
    if(Date.now()<a.until)throw fail(429,'Too many attempts. Wait 15 seconds');
    const {id,password}=await readBody(req);
    if(safeEq(id||'',ADMIN_ID)&&safeEq(password||'',ADMIN_PW)){adminTry.delete(ip);return send(res,200,{token:newToken('admin',null),role:'admin',phone:null})}
    a.n++;if(a.n>=3){a.until=Date.now()+15000;a.n=0}adminTry.set(ip,a);
    throw fail(401,'Wrong admin ID or password');
  }

  if(p==='/api/reports/public'&&m==='GET')return send(res,200,db.reports.map(pubRow));
  if(p==='/api/reports/mine'&&m==='GET'){const s=need(req,'user');return send(res,200,newest(db.reports.filter(r=>r.phone===s.phone)).map(fullRow))}
  if(p==='/api/reports'&&m==='GET'){need(req,'admin');return send(res,200,newest(db.reports).map(fullRow))}
  if(p==='/api/reports'&&m==='POST'){
    const s=need(req,'user'), b=await readBody(req);
    const place=String(b.place||'').trim().slice(0,60), rating=+b.rating;
    if(!TYPES.includes(b.type)||!place||!Number.isInteger(rating)||rating<1||rating>5)throw fail(400,'Please fill facility type, place and rating');
    const issues=(Array.isArray(b.issues)?b.issues:[]).filter(i=>ISSUES.includes(i));
    let photo=null;
    if(b.photo){
      const mt=/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo));
      if(!mt)throw fail(400,'Photo must be a JPEG image');
      const buf=Buffer.from(mt[1],'base64'); if(buf.length>1.5e6)throw fail(413,'Photo is too large');
      const name=crypto.randomBytes(8).toString('hex')+'.jpg';
      fs.writeFileSync(path.join(UP,name),buf); photo='/uploads/'+name;
    }
    let loc=null;
    if(b.loc&&Math.abs(+b.loc.lat)<=90&&Math.abs(+b.loc.lng)<=180)loc={lat:+b.loc.lat,lng:+b.loc.lng,acc:Math.round(+b.loc.acc)||0};
    const r={id:db.nextId++,type:b.type,place,rating,issues,note:String(b.note||'').trim().slice(0,200),date:new Date().toISOString().slice(0,10),phone:s.phone,by:mask(s.phone),photo,loc,status:'Pending'};
    db.reports.push(r);save();return send(res,201,fullRow(r));
  }
  const mm=/^\/api\/reports\/(\d+)(\/status)?$/.exec(p);
  if(mm){
    need(req,'admin');
    const i=db.reports.findIndex(r=>r.id===+mm[1]); if(i<0)throw fail(404,'Report not found');
    if(mm[2]&&m==='PATCH'){const {status}=await readBody(req);if(!STATUS.includes(status))throw fail(400,'Invalid status');db.reports[i].status=status;save();return send(res,200,{ok:true})}
    if(!mm[2]&&m==='DELETE'){
      const ph=db.reports[i].photo; if(ph){fs.unlink(path.join(UP,path.basename(ph)),()=>{})}
      db.reports.splice(i,1);save();return send(res,200,{ok:true});
    }
  }
  if(p==='/api/export.csv'&&m==='GET'){
    need(req,'admin');
    const q=v=>{v=String(v==null?'':v);if(/^[=+\-@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"'};
    const rows=[['Date','Type','Place','Rating','Issues','Comment','Reported by','Status','Latitude','Longitude'].join(',')]
      .concat(db.reports.map(r=>[r.date,r.type,r.place,r.rating,r.issues.join('; '),r.note,r.by,r.status,r.loc?r.loc.lat:'',r.loc?r.loc.lng:''].map(q).join(',')));
    return send(res,200,rows.join('\n'),'text/csv; charset=utf-8');
  }
  throw fail(404,'Not found');
}

/* ---------- static files (only the website files, never server.js or data) ---------- */
const FILES={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/script.js':'script.js','/pm.jpg':'pm.jpg','/pm.jpeg':'pm.jpeg','/pm.png':'pm.png'};
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png'};
function serveStatic(res,p,m){
  if(m!=='GET'&&m!=='HEAD'){res.writeHead(405);return res.end()}
  let f=FILES[p], dir=ROOT;
  if(!f&&/^\/uploads\/[a-f0-9]{16}\.jpg$/.test(p)){f=p.slice(9);dir=UP}
  if(!f){res.writeHead(404);return res.end('Not found')}
  fs.readFile(path.join(dir,f),(e,b)=>{
    if(e){res.writeHead(404);return res.end('Not found')}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(b);
  });
}

http.createServer(async(req,res)=>{
  try{
    const p=new URL(req.url,'http://localhost').pathname;
    if(p.startsWith('/api/'))return await api(req,res,p,req.method);
    serveStatic(res,p,req.method);
  }catch(e){
    const ok=e.code&&e.code<600;
    if(!ok)console.error(e);
    send(res,ok?e.code:500,{error:ok?e.message:'Server error'});
  }
}).listen(PORT,()=>{
  console.log('Public Facility Cleanliness Tracker running at http://localhost:'+PORT+'  (press Ctrl+C to stop)');
  const ips=[].concat(...Object.values(os.networkInterfaces())).filter(i=>i.family==='IPv4'&&!i.internal).map(i=>i.address);
  ips.forEach(ip=>console.log('Open from a phone or another laptop on the same WiFi: http://'+ip+':'+PORT));
});
