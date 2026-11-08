// Tyro-Shelf screens: the Epic install dialog, the Download Manager and the Storage page (the ideas are from Playnite's
// Unified Download Manager and Storage add-ons; written from scratch). One overlay; Esc / the controller's B closes it.
(function(){
const api=window.boxshelf||{};
const $=id=>document.getElementById(id);
let el=null,view=null,dm=[],sel="",st=null,busy=false,onClose=null,gpT=null,gpWas=false,dmListen=false;
const GiB=1073741824;
const sz=b=>b==null||!(b>=0)?"—":b>=GiB?(b/GiB).toFixed(b>=100*GiB?1:2)+" GiB":b>=1048576?(b/1048576).toFixed(0)+" MiB":(b/1024).toFixed(0)+" KiB";
const when=t=>t?new Date(t).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"";
const h=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e};
const toast=m=>{try{window.dispatchEvent(new CustomEvent("tyro-toast",{detail:m}))}catch{}};
function ensure(){if(el)return el;el=h("div","tt");el.id="tyroTools";el.setAttribute("role","dialog");el.hidden=true;document.body.appendChild(el);
  document.addEventListener("keydown",e=>{if(el.hidden)return;if(e.key==="Escape"||(e.key==="Backspace"&&!/INPUT|TEXTAREA|SELECT/.test((e.target||{}).tagName||""))){e.preventDefault();e.stopPropagation();back()}},true);return el}
function open(v){ensure();view=v;el.hidden=false;document.body.classList.add("tt-open");if(!onClose){const m=window.__tyroMode&&window.__tyroMode();onClose=m||(()=>{})}render();gpStart()}
function close(){if(!el||el.hidden)return;el.hidden=true;document.body.classList.remove("tt-open");el.textContent="";view=null;gpStop();const f=onClose;onClose=null;try{f&&f()}catch{}}
function back(){if(view&&view.kind==="install"&&view.from==="downloads"){view={kind:"downloads"};render();return}close()}
function gpStart(){gpStop();gpT=setInterval(()=>{let b=false;try{for(const p of navigator.getGamepads()||[])if(p&&p.buttons[1]&&p.buttons[1].pressed)b=true}catch{}if(b&&!gpWas)back();gpWas=b},80)}
function gpStop(){clearInterval(gpT);gpT=null;gpWas=false}
function head(title,btns){const bar=h("div","tt-head"),bk=h("button","tt-btn","←");bk.title="Back";bk.onclick=back;bar.append(bk,h("div","tt-title",title));const sp=h("div","tt-sp");bar.append(sp);for(const b of btns||[])bar.append(b);return bar}
function btn(label,fn,cls,title){const b=h("button","tt-btn"+(cls?" "+cls:""),label);if(title)b.title=title;b.onclick=fn;return b}

// ---------- the install dialog
async function installDialog(g,from){
  const app=g.legendaryApp||String(g.id||"").replace(/^epic-/,"");
  view={kind:"install",g,from,app};ensure();el.hidden=false;document.body.classList.add("tt-open");if(!onClose)onClose=()=>{};gpStart();
  const o={dir:"",dlcs:false,ignoreSpace:false,reorder:false,workers:0,memory:0,info:null};
  try{o.dir=await api.dmDefaultDir()}catch{}
  const draw=()=>{el.textContent="";const wrap=h("div","tt-card"),t=h("div","tt-bar");t.append(h("div","tt-title",g.title));wrap.append(t);
    const row=h("div","tt-row");row.append(h("label","", "Installation folder"));const inp=h("input","tt-in");inp.value=o.dir;inp.oninput=()=>{o.dir=inp.value};inp.onchange=()=>{o.dir=inp.value;refresh()};row.append(inp);
    const br=btn("Browse…",async()=>{try{const p=await api.pick({kind:"folder",title:"Choose where to install "+g.title});const f=typeof p==="string"?p:p&&p.path;if(f){o.dir=f;draw();refresh()}}catch{}});row.append(br);wrap.append(row);
    const box1=h("div","tt-box");box1.append(h("div","tt-boxh","Extra content"));const c1=h("label","tt-chk");const i1=h("input");i1.type="checkbox";i1.checked=o.dlcs;i1.onchange=()=>{o.dlcs=i1.checked};c1.append(i1,document.createTextNode(" Install DLCs"));box1.append(c1);wrap.append(box1);
    const box2=h("div","tt-box");box2.append(h("div","tt-boxh","Advanced options"));
    const chk=(label,k)=>{const c=h("label","tt-chk"),i=h("input");i.type="checkbox";i.checked=o[k];i.onchange=()=>{o[k]=i.checked};c.append(i,document.createTextNode(" "+label));return c};
    const num=(label,k,title)=>{const c=h("label","tt-num");c.append(document.createTextNode(label+" "));const i=h("input","tt-in tt-n");i.type="number";i.min=0;i.max=k==="workers"?64:65536;i.value=o[k];i.title=title||"";i.onchange=()=>{o[k]=Math.max(0,parseInt(i.value,10)||0)};c.append(i);return c};
    box2.append(chk("Ignore free space","ignoreSpace"),chk("Enable reordering optimization","reorder"),num("Maximum number of parallel tasks","workers","0 = let Legendary choose"),num("Maximum amount of shared memory (MB)","memory","0 = let Legendary choose"));wrap.append(box2);
    const f=h("div","tt-foot"),l=h("div"),r=h("div");const inf=o.info||{};
    l.append(h("div","",`Download Size: ${sz(inf.download)}`),h("div","",`Install Size: ${sz(inf.install)}`));
    r.append(h("div","",`Space Available: ${sz(inf.free)}`),h("div","",`After Installing: ${inf.free!=null&&inf.install!=null?sz(inf.free-inf.install):"—"}`));f.append(l,r);wrap.append(f);
    const act=h("div","tt-actions");act.append(btn("Install",async()=>{
      if(!o.dir.trim()){toast("Choose a folder first");return}
      try{await api.dmAdd({app,title:g.title,dir:o.dir.trim(),opts:{dlcs:o.dlcs,ignoreSpace:o.ignoreSpace,reorder:o.reorder,workers:o.workers,memory:o.memory,size:(o.info||{}).install||0,dlSize:(o.info||{}).download||0}});view={kind:"downloads"};render()}catch(e){showErr(e)}},"tt-go"),btn("Cancel",back));wrap.append(act);el.append(wrap)};
  const showErr=e=>{const m=(e&&e.message||String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/,"");const n=el.querySelector(".tt-err")||h("div","tt-err");n.textContent=m;(el.querySelector(".tt-card")||el).append(n)};
  const refresh=async()=>{try{o.info=await api.dmInfo({app,dir:o.dir});draw()}catch{}};
  draw();refresh();
}

// ---------- the download manager
function dmRender(){
  el.textContent="";const run=dm.find(i=>i.status==="running"),s=dm.find(i=>i.id===sel);
  const act=(a)=>()=>{if(sel||a==="clear")api.dmDo(a,sel).catch(()=>{})};
  el.append(head("Download Manager",[btn("▶",act("resume"),"","Resume"),btn("❚❚",act("pause"),"","Pause"),btn("■",act("stop"),"","Stop"),btn("▲",act("up"),"","Move up"),btn("▼",act("down"),"","Move down"),btn("Remove",act("remove")),btn("Clear finished",act("clear"))]));
  const tbl=h("div","tt-table"),hd=h("div","tt-tr tt-th");for(const c of ["Name","Source","Progress","Downloaded","Install Size","Status","Added","Completed"])hd.append(h("div","",c));tbl.append(hd);
  if(!dm.length){tbl.append(h("div","tt-empty","Nothing here yet. Press Play on an Epic game you own but haven't installed to download it."))}
  for(const i of dm){const r=h("div","tt-tr"+(i.id===sel?" on":""));r.onclick=()=>{sel=i.id;dmRender()};
    const pb=h("div","tt-prog"),fill=h("i");fill.style.width=Math.max(0,Math.min(100,i.pct||0))+"%";pb.append(fill,h("span","",(i.pct||0).toFixed(1)+"%"));
    const stx={queued:"Queued",running:"Downloading",paused:"Paused",done:"Completed",error:"Failed",canceled:"Canceled"}[i.status]||i.status;
    const sc=h("div","",stx);if(i.error)sc.title=i.error;
    r.append(h("div","",i.title),h("div","","Epic Games"),(()=>{const c=h("div");c.append(pb);return c})(),h("div","",i.downloaded||""),h("div","",i.size?sz(i.size):""),sc,h("div","",when(i.added)),h("div","",when(i.completed)));tbl.append(r)}
  el.append(tbl);
  const err=s&&s.status==="error"&&s.error?s.error:"";if(err)el.append(h("div","tt-err",err));
  const ft=h("div","tt-stat");const sp=run&&run.speed?sz(run.speed)+"/s":"";
  ft.append(h("div","",`Download Speed: ${sp}`),h("div","",`ETA: ${run?run.eta||"":""}`));el.append(ft);
}
function dmUpdate(l){dm=Array.isArray(l)?l:[];if(view&&view.kind==="downloads"&&el&&!el.hidden)dmRender()}
async function openDownloads(){ensure();try{dm=await api.dmList()}catch{dm=[]}if(!dmListen&&api.onDmUpdate){dmListen=true;api.onDmUpdate(dmUpdate)}if(!sel&&dm[0])sel=dm[0].id;view={kind:"downloads"};open({kind:"downloads"});}

// ---------- storage
let drive="";
async function scan(force){if(busy)return;busy=true;st=null;if(view&&view.kind==="storage")stRender();try{st=await api.storageScan({force})}catch(e){st={error:(e&&e.message)||"failed",entries:[],drives:[]}}busy=false;if(view&&view.kind==="storage"&&!el.hidden)stRender()}
function stRender(){
  el.textContent="";el.append(head("Storage",[btn("Refresh",()=>scan(true))]));
  if(!st){el.append(h("div","tt-empty","Measuring your games… (the first time can take a minute; it's remembered after that)"));return}
  if(st.error){el.append(h("div","tt-err",st.error));return}
  if(!drive||!st.drives.some(d=>d.root===drive))drive=(st.drives.slice().sort((a,b)=>b.games-a.games)[0]||{}).root||"";
  const d=st.drives.find(x=>x.root===drive),top=h("div","tt-top"),lab=h("label","","Drive: "),sel2=h("select","tt-in");
  for(const x of st.drives){const o=h("option","",x.root);o.value=x.root;if(x.root===drive)o.selected=true;sel2.append(o)}sel2.onchange=()=>{drive=sel2.value;stRender()};lab.append(sel2);top.append(lab);
  const list=st.entries.filter(e=>e.drive===drive);top.append(h("div","tt-sum",`Games installed: ${list.length}   Used by games: ${sz(d?d.games:0)}`));el.append(top);
  if(d){const other=Math.max(0,d.total-d.free-d.games),bar=h("div","tt-sbar");for(const [v,c] of [[d.games,"g"],[other,"o"],[d.free,"f"]]){const s=h("i","s-"+c);s.style.flexGrow=String(Math.max(v,0));bar.append(s)}el.append(bar);
    el.append(h("div","tt-leg",`■ Games ${sz(d.games)}    ■ Other ${sz(other)}    ■ Free ${sz(d.free)}    Total ${sz(d.total)}`))}
  const tbl=h("div","tt-table tt-st"),hd=h("div","tt-tr tt-th");for(const c of ["Name","Source","Size","Install directory"])hd.append(h("div","",c));tbl.append(hd);
  for(const e of list){const r=h("div","tt-tr");r.append(h("div","",e.name),h("div","",e.source),h("div","",sz(e.size)),h("div","tt-dir",e.dir));r.title=e.dir;tbl.append(r)}
  el.append(tbl);
}
function openStorage(){ensure();open({kind:"storage"});if(!st)scan(false);else stRender()}
function render(){if(!view)return;if(view.kind==="downloads")dmRender();else if(view.kind==="storage")stRender()}
window.TyroTools={openDownloads,openStorage,install:g=>installDialog(g,null),close,setReturn:f=>{onClose=f},isOpen:()=>!!el&&!el.hidden,count:()=>dm.filter(i=>["running","queued","paused"].includes(i.status)).length};
})();
