const SUPABASE_URL="https://lsuopaybsfdlofigxlac.supabase.co";
const SUPABASE_KEY="sb_publishable_MEXZiitQlDx4lrh_vV4dag_8sbBKe7O";
const SESSION_KEY="azores-pruebas-session-v947";
let cloudSession=null, cloudReady=false, cloudSaving=false, cloudDirty=false, cloudTimer=null;
const cloudStatus=()=>document.getElementById("cloudStatus");
function setCloudStatus(message){const el=cloudStatus();if(el)el.textContent=message;}
function setCloudLock(locked){document.getElementById("appShell").hidden=locked;document.getElementById("loginPanel").hidden=!locked;}
function cloudHeaders(token){return {"apikey":SUPABASE_KEY,"Authorization":"Bearer "+token,"Content-Type":"application/json"};}
async function refreshCloudSession(){
 if(!cloudSession?.refresh_token)throw Error("Sesión caducada. Vuelve a entrar.");
 const r=await fetch(SUPABASE_URL+"/auth/v1/token?grant_type=refresh_token",{method:"POST",headers:{"apikey":SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:cloudSession.refresh_token})});
 const j=await r.json();if(!r.ok)throw Error(j.msg||j.error_description||"No se pudo renovar la sesión");
 cloudSession=j;localStorage.setItem(SESSION_KEY,JSON.stringify(j));return j;
}
async function cloudFetch(path,options={}){
 if((options.method||"GET").toUpperCase()!=="GET" && path!=="/functions/v1/azores-comparador-precios")throw Error("Modo pruebas: escritura bloqueada");
 let r=await fetch(SUPABASE_URL+path,{...options,headers:{...cloudHeaders(cloudSession.access_token),...(options.headers||{})}});
 if(r.status===401){await refreshCloudSession();r=await fetch(SUPABASE_URL+path,{...options,headers:{...cloudHeaders(cloudSession.access_token),...(options.headers||{})}});}
 if(!r.ok){let detail="";try{const j=await r.json();detail=j.message||j.msg||j.error_description||j.error||""}catch(_){}throw Error(detail||"Error de conexión ("+r.status+")");}
 return r;
}
// V9.27: fotos privadas en Supabase Storage. Las fotos antiguas Base64 se conservan.
const PHOTO_BUCKET="azores-fotos", PHOTO_PREFIX="storage:";
const photoUrlCache=new Map();
const pendingPhotoDeletions=new Set();
function photoIsStored(value){return typeof value==="string"&&value.startsWith(PHOTO_PREFIX);}
function photoPath(value){return value.slice(PHOTO_PREFIX.length);}
function photoDisplay(value){return photoIsStored(value)?(photoUrlCache.get(photoPath(value))||""):value||"";}
async function photoStorageFetch(path,options={}){
 if((options.method||"GET").toUpperCase()!=="GET")throw Error("Modo pruebas: escritura de fotos bloqueada");
 const request=async()=>fetch(SUPABASE_URL+path,{...options,headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+cloudSession.access_token,...(options.headers||{})}});
 let response=await request();if(response.status===401){await refreshCloudSession();response=await request();}
 if(!response.ok){let message="Error de Storage ("+response.status+")";try{const d=await response.json();message=d.message||d.error||message;}catch{}throw Error(message);}
 return response;
}
async function uploadProductPhoto(dataUrl,productId){
 if(!cloudSession?.user?.id)throw Error("Inicia sesión para subir la foto");
 const raw=atob(dataUrl.split(",")[1]);const bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 const path=cloudSession.user.id+"/"+productId+"-"+crypto.randomUUID()+".jpg";
 await photoStorageFetch("/storage/v1/object/"+PHOTO_BUCKET+"/"+path,{method:"POST",headers:{"Content-Type":"image/jpeg","x-upsert":"false"},body:new Blob([bytes],{type:"image/jpeg"})});
 // No descargar la URL firmada con fetch: en Safari/iOS puede fallar por CORS
 // aunque la imagen sea accesible en un elemento <img>.
 // La lectura autorizada se comprueba creando la URL firmada.
 try{await resolvePhoto(PHOTO_PREFIX+path);}
 catch(error){throw Error("Foto subida a Storage, pero no se pudo generar el acceso de lectura: "+error.message);}
 return PHOTO_PREFIX+path;
}
async function resolvePhoto(value){
 if(!photoIsStored(value))return value||"";
 const path=photoPath(value);if(photoUrlCache.has(path))return photoUrlCache.get(path);
 // Leer el objeto privado con la misma sesión autenticada que permite subirlo.
 // La URL blob evita problemas de visualización de enlaces firmados en Safari iOS.
 const response=await photoStorageFetch("/storage/v1/object/authenticated/"+PHOTO_BUCKET+"/"+path);
 const blob=await response.blob();
 if(!blob.size)throw Error("La fotografía descargada está vacía");
 const url=URL.createObjectURL(blob);
 photoUrlCache.set(path,url);
 return url;
}
function hydrateStoredPhotos(root=document){
 root.querySelectorAll("img[data-storage-photo]").forEach(async img=>{
  const value=img.getAttribute("data-storage-photo");
  if(!photoIsStored(value))return; // No tocar fotos antiguas Base64.
  try{const url=await resolvePhoto(value);if(img.isConnected&&img.getAttribute("data-storage-photo")===value)img.src=url;}
  catch(err){console.warn("AZORES: no se pudo cargar fotografía",err);}
 });
}
// Solo borrar archivos propios, tras confirmar que el estado nuevo se guardó en Supabase.
function scheduleOldPhotoCleanup(oldPhoto,newPhoto){
 if(photoIsStored(oldPhoto)&&oldPhoto!==newPhoto)pendingPhotoDeletions.add(photoPath(oldPhoto));
}
async function cleanupUnusedPhotos(){
 if(!cloudSession?.user?.id)return;
 const inUse=new Set(products.filter(p=>photoIsStored(p.photo)).map(p=>photoPath(p.photo)));
 for(const path of [...pendingPhotoDeletions]){
  if(inUse.has(path)){pendingPhotoDeletions.delete(path);continue;}
  if(!path.startsWith(cloudSession.user.id+"/")){pendingPhotoDeletions.delete(path);continue;}
  try{
   await photoStorageFetch("/storage/v1/object/"+PHOTO_BUCKET+"/"+path.split("/").map(encodeURIComponent).join("/"),{method:"DELETE"});
   const url=photoUrlCache.get(path);if(url?.startsWith("blob:"))URL.revokeObjectURL(url);
   photoUrlCache.delete(path);pendingPhotoDeletions.delete(path);
  }catch(error){console.warn("AZORES: foto desvinculada, pero no se pudo borrar de Storage",error);}
 }
}
function queueCloudSave(){
 return;
 if(!cloudReady)return;
 cloudDirty=true;setCloudStatus("Cambios pendientes de sincronizar…");
 clearTimeout(cloudTimer);cloudTimer=setTimeout(flushCloudSave,350);
}
async function flushCloudSave(){
 if(!cloudReady||cloudSaving||!cloudDirty)return;
 cloudSaving=true;cloudDirty=false;
 const snapshot={products:JSON.parse(JSON.stringify(products)),finances:JSON.parse(JSON.stringify(finances))};
 setCloudStatus("Guardando en la nube…");
 try{
  await cloudFetch("/rest/v1/azores_state?on_conflict=user_id",{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:cloudSession.user.id,data:snapshot,updated_at:new Date().toISOString()})});
  setCloudStatus(cloudDirty?"Cambios pendientes de sincronizar…":"✓ Sincronizado en Supabase");
  // Eliminar únicamente tras confirmación de guardado; nunca antes.
  if(!cloudDirty)await cleanupUnusedPhotos();
 }catch(e){cloudDirty=true;setCloudStatus("⚠ Sin sincronizar: "+e.message+". Pulsa Reintentar.");}
 finally{cloudSaving=false;if(cloudDirty&&navigator.onLine&&cloudStatus()?.textContent?.startsWith("Cambios"))setTimeout(flushCloudSave,300);}
}
async function loadCloudState(){
 cloudReady=false;setCloudStatus("Cargando datos…");
 const r=await cloudFetch("/rest/v1/azores_state?select=data&user_id=eq."+encodeURIComponent(cloudSession.user.id));
 const rows=await r.json();
 if(rows.length){
  const d=rows[0].data;
  if(!d||!Array.isArray(d.products)||!d.finances||typeof d.finances!=="object")throw Error("Los datos de la nube no tienen el formato esperado");
  products=d.products;finances=d.finances;
 }else{
  // Primera conexión: la cuenta parte vacía. Nunca importar datos locales de otro dispositivo automáticamente.
  products=[];finances={opening:{Aurora:0,Pedro:0},contributions:[],withdrawals:[],capitalRepayments:[]};
 }
 finances.opening||={Aurora:0,Pedro:0};finances.contributions||=[];finances.withdrawals||=[];finances.capitalRepayments||=[];
 cacheLocalState();
 cloudReady=true;render();setCloudLock(false);setCloudStatus("✓ Conectado a Supabase");
}
async function startCloud(){
 try{
  const saved=localStorage.getItem(SESSION_KEY);if(!saved)return;
  cloudSession=JSON.parse(saved);if(!cloudSession?.user?.id)throw Error("Sesión inválida");
  await refreshCloudSession();await loadCloudState();
 }catch(e){cloudReady=false;setCloudLock(true);document.getElementById("loginError").textContent="Inicia sesión para acceder a AZORES. "+e.message;}
}
function signOutCloud(){
 if(cloudDirty||cloudSaving){alert("Hay cambios sin sincronizar. Reintenta la sincronización antes de salir.");return;}
 oportunidad.epoch++; oportunidad.resultados=[]; oportunidad.ocupado=false; cloudReady=false;cloudSession=null;for(const url of photoUrlCache.values())if(url.startsWith("blob:"))URL.revokeObjectURL(url);photoUrlCache.clear();localStorage.removeItem(SESSION_KEY);
 products=[];finances={opening:{Aurora:0,Pedro:0},contributions:[],withdrawals:[],capitalRepayments:[]};
 localStorage.removeItem(KEY);localStorage.removeItem(FIN_KEY);setCloudLock(true);
 document.getElementById("loginForm").reset();document.getElementById("loginError").textContent="";
}
document.getElementById("loginForm").addEventListener("submit",async e=>{
 e.preventDefault();const button=document.getElementById("loginButton"),error=document.getElementById("loginError");
 button.disabled=true;error.textContent="Conectando…";
 try{
  const form=new FormData(e.currentTarget);
  const r=await fetch(SUPABASE_URL+"/auth/v1/token?grant_type=password",{method:"POST",headers:{"apikey":SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:String(form.get("email")||"").trim(),password:String(form.get("password")||"")})});
  const j=await r.json();if(!r.ok)throw Error(j.error_description||j.msg||j.error||"Correo o contraseña incorrectos");
  cloudSession=j;localStorage.setItem(SESSION_KEY,JSON.stringify(j));await loadCloudState();error.textContent="";
 }catch(err){error.textContent=err.message;cloudReady=false;setCloudLock(true);}
 finally{button.disabled=false;}
});
document.getElementById("logoutButton").addEventListener("click",signOutCloud);
document.getElementById("retrySync").addEventListener("click",()=>{if(!cloudReady)return;cloudDirty=true;flushCloudSave()});
window.addEventListener("online",()=>{if(cloudDirty)flushCloudSave()});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&cloudDirty)flushCloudSave()});
setCloudLock(true);startCloud();
const KEY="azores-pruebas-products-v947";
let products=JSON.parse(localStorage.getItem(KEY)||"[]");
const FIN_KEY="azores-pruebas-finances-v947";
let finances=JSON.parse(localStorage.getItem(FIN_KEY)||'{"opening":{"Aurora":0,"Pedro":0},"contributions":[],"withdrawals":[]}');
finances.opening ||= {Aurora:0,Pedro:0};finances.contributions ||= [];finances.withdrawals ||= [];finances.capitalRepayments ||= [];
function saveFin(){cacheLocalState();render();queueCloudSave()}
function normalizedAccount(v){return /aurora|auro/i.test(v||"")?"Aurora":/pedro/i.test(v||"")?"Pedro":null}
function purchaseMethod(p){return p.purchaseMethod||"Vinted"}
function receiver(p){return normalizedAccount(p.receivingAccount||p.account)}
function financesSummary(){
 const balances={Aurora:Number(finances.opening.Aurora)||0,Pedro:Number(finances.opening.Pedro)||0};
 const capital={Aurora:0,Pedro:0};
 for(const p of products){
   const payer=normalizedAccount(p.account),cost=Number(p.purchasePrice)||0;
   if(purchaseMethod(p)==="Personal"&&payer)capital[payer]+=cost;
   if(purchaseMethod(p)==="Vinted"&&payer)balances[payer]-=cost;
   if(isSold(p)&&p.paymentStatus==="Cobrado"){
     const r=receiver(p);if(r)balances[r]+=Number(p.salePrice)||0;
   }
 }
 for(const x of finances.contributions||[]){if(normalizedAccount(x.account))capital[normalizedAccount(x.account)]+=Number(x.amount)||0;if(x.toVinted&&normalizedAccount(x.account))balances[normalizedAccount(x.account)]+=Number(x.amount)||0}
 for(const x of finances.withdrawals||[]){const r=normalizedAccount(x.account);if(r)balances[r]-=Number(x.amount)||0}
 const repaid={Aurora:0,Pedro:0};
 for(const x of finances.capitalRepayments||[]){const who=normalizedAccount(x.account);if(who){repaid[who]+=Number(x.amount)||0;balances[who]-=Number(x.amount)||0}}
 const capitalPending={Aurora:Math.max(0,capital.Aurora-repaid.Aurora),Pedro:Math.max(0,capital.Pedro-repaid.Pedro)};
 const pending=products.reduce((t,p)=>t+(isSold(p)&&p.paymentStatus!=="Cobrado"?Number(p.salePrice)||0:0),0);
 const inventory=products.reduce((t,p)=>t+(!isSold(p)?Number(p.purchasePrice)||0:0),0);
 const profit=products.reduce((t,p)=>t+(isSold(p)?Number(p.salePrice)-Number(p.purchasePrice||0):0),0);
 return {balances,capital,repaid,capitalPending,pending,inventory,profit,total:balances.Aurora+balances.Pedro};
}
let activeTab="Inicio", photoData="", editingId=null, editingSaleId=null, editingShipmentId=null;
let cataTimer=null, cataLastTab=null;
let salesGroupOpen=null; // null: ambas ramas cerradas
const trackingPreview=new Map();
let trackingRun=0;
const $=s=>document.querySelector(s);
const money=n=>(Number(n)||0).toLocaleString("es-ES",{style:"currency",currency:"EUR"});
// La nube es el origen de verdad. Una caché local llena no debe impedir guardar.
function cacheLocalState(){
 try{localStorage.setItem(KEY,JSON.stringify(products));localStorage.setItem(FIN_KEY,JSON.stringify(finances));}
 catch(err){console.warn("AZORES: caché local llena; se conservará la sincronización en la nube",err);}
}
function save(){cacheLocalState();render();queueCloudSave()}
function stats(){
 const f=financesSummary();
 document.getElementById("homeCash").textContent=money(f.total);
 if(f.total<=0){const cata=document.getElementById("cataCelebration");if(cata)cata.hidden=true;}
 document.getElementById("homePending").textContent=money(f.pending);
 document.getElementById("homeStock").textContent=products.filter(p=>!isSold(p)).length;
}
function isSold(p){return p.salePrice!==""&&p.salePrice!=null}
function productStatus(p){return isSold(p)?"Vendido":(p.status||"Sin vender")}
// AZORES V9.38: calendario visual de solo lectura. No altera datos ni sincronización.
const azCalendarState={month:new Date().getMonth(),year:new Date().getFullYear(),selected:new Date().getDate(),collapsed:window.matchMedia('(max-width:760px)').matches};
function azCalendarDate(value){
 if(!value)return null;
 const s=String(value);
 const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
 if(m){const y=+m[1],mo=+m[2],day=+m[3];const d=new Date(y,mo-1,day);return d.getFullYear()===y&&d.getMonth()===mo-1&&d.getDate()===day?`${m[1]}-${m[2]}-${m[3]}`:null;}
 const d=new Date(s);if(!Number.isFinite(d.getTime()))return null;
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function azToday(){return azCalendarDate(new Date());}
function azCalendarEvents(){
 const events=[];
 const add=(date,type,title,amount)=>{const day=azCalendarDate(date);if(day)events.push({day,type,title,amount});};
 products.forEach(p=>{
  const name=String(p.name||'Producto');
  add(p.purchaseDate,'buy',name,p.purchasePrice);
  if(isSold(p))add(p.saleDate,'sale',name,p.salePrice);
  const shipping=p.shipping||{};
  if(isSold(p))add(shipping.sentAt||shipping.shippedAt||shipping.shippingDate,'ship',name,null);
  if(isSold(p)&&p.paymentStatus==='Cobrado')add(p.paidAt||p.paymentDate||p.collectedAt,'paid',name,p.salePrice);
 });
 return events;
}
function azRenderRecent(home){
 const el=document.getElementById('azRecent');if(!el)return;el.hidden=!home;if(!home)return;
 const labels={buy:'Compra',sale:'Venta',ship:'Envío',paid:'Cobro'},icons={buy:'↓',sale:'↑',ship:'→',paid:'€'};
 const events=azCalendarEvents().filter(e=>e.day<=azToday()).sort((a,b)=>b.day.localeCompare(a.day)).slice(0,6);
 el.innerHTML=`<header><h2>Actividad reciente</h2><small>Últimos movimientos registrados</small></header>${events.length?events.map(e=>`<div class="az-recent-row"><span class="az-recent-icon az-${e.type}" aria-hidden="true">${icons[e.type]}</span><div class="az-recent-detail"><strong>${labels[e.type]} · ${esc(e.title)}</strong><small>${esc(new Date(e.day+'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'}))}</small></div>${e.amount!==null&&e.amount!==undefined&&e.amount!==''?`<strong class="az-recent-amount">${money(e.amount)}</strong>`:''}</div>`).join(''):'<p>Sin movimientos registrados.</p>'}<small class="az-recent-note">Solo operaciones con fecha registrada.</small>`;
}
function azRenderCalendar(){
 const grid=document.getElementById('azCalendarGrid');if(!grid)return;
 const s=azCalendarState,first=new Date(s.year,s.month,1),count=new Date(s.year,s.month+1,0).getDate();
 document.getElementById('azMonthTitle').textContent=first.toLocaleDateString('es-ES',{month:'long',year:'numeric'});
 const events=azCalendarEvents();const grouped=new Map();events.forEach(e=>{if(!grouped.has(e.day))grouped.set(e.day,[]);grouped.get(e.day).push(e)});
 const labels=['L','M','X','J','V','S','D'];let html=labels.map(x=>`<span class="az-weekday">${x}</span>`).join('');
 const blanks=(first.getDay()+6)%7;for(let i=0;i<blanks;i++)html+='<span></span>';
 for(let day=1;day<=count;day++){
  const key=`${s.year}-${String(s.month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const list=grouped.get(key)||[];const types=[...new Set(list.map(e=>e.type))];
  html+=`<button type="button" class="az-day${s.selected===day?' selected':''}" data-az-day="${day}" aria-label="${day}: ${list.length} movimientos" aria-pressed="${s.selected===day}"><span>${day}</span><span class="az-day-dots">${types.map(t=>`<i class="az-dot az-${t}"></i>`).join('')}</span></button>`;
 }
 grid.innerHTML=html;
 grid.querySelectorAll('[data-az-day]').forEach(b=>b.addEventListener('click',()=>{s.selected=+b.dataset.azDay;azRenderCalendar()}));
 const key=`${s.year}-${String(s.month+1).padStart(2,'0')}-${String(s.selected).padStart(2,'0')}`;
 const selected=grouped.get(key)||[];
 const typeName={buy:'Compra',sale:'Venta',ship:'Envío',paid:'Cobro'};
 const activity=document.getElementById('azDayActivity');
 activity.innerHTML=`<strong>${s.selected} de ${first.toLocaleDateString('es-ES',{month:'long'})}</strong>`+(selected.length?selected.map(e=>`<div class="az-activity-row"><i class="az-dot az-${e.type}"></i><div><b>${typeName[e.type]}</b><span>${esc(e.title)}</span>${e.amount!==null&&e.amount!==undefined&&e.amount!==''?`<small>${money(e.amount)}</small>`:''}</div></div>`).join(''):'<p>Sin movimientos registrados.</p>');
}
function azSetCalendarCollapsed(collapsed){
 azCalendarState.collapsed=collapsed;
 const aside=document.getElementById('azCalendar');if(!aside)return;
 aside.classList.toggle('is-collapsed',collapsed);
 document.getElementById('azCalendarBody').hidden=collapsed;
 const toggle=document.getElementById('azCalendarToggle');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.textContent=collapsed?'▶':'◀';
}
function azCalendarShift(delta){const s=azCalendarState,d=new Date(s.year,s.month+delta,1);s.year=d.getFullYear();s.month=d.getMonth();s.selected=1;azRenderCalendar();}
document.getElementById('azCalendarToggle').addEventListener('click',()=>azSetCalendarCollapsed(!azCalendarState.collapsed));
document.getElementById('azPrevMonth').addEventListener('click',()=>azCalendarShift(-1));
document.getElementById('azNextMonth').addEventListener('click',()=>azCalendarShift(1));
azSetCalendarCollapsed(azCalendarState.collapsed);
let azInventoryMode="cards";
function azInventoryToolbar(rows){return `<div class="az-inventory-toolbar"><strong>${rows.length} productos · ${money(rows.reduce((n,p)=>n+(Number(p.purchasePrice)||0),0))} a coste</strong><div class="action-group"><button class="edit-product" data-inventory-mode="cards" aria-pressed="${azInventoryMode==="cards"}">▦ Tarjetas</button><button class="edit-product" data-inventory-mode="table" aria-pressed="${azInventoryMode==="table"}">☰ Tabla</button></div></div>`;}
$("#view").addEventListener("click",e=>{const b=e.target.closest("[data-inventory-mode]");if(b){azInventoryMode=b.dataset.inventoryMode;render();}});
function render(){
 queueMicrotask(()=>hydrateStoredPhotos(document));
 stats();azRenderGoals();azRenderCalendar();$("#sectionTitle").textContent=activeTab;
 const home=activeTab==="Inicio";azRenderRecent(home);$("#azGoals").hidden=!home;
 if(home && cataLastTab!=="Inicio") {
   const cata=document.getElementById("cataCelebration");
   if(cata){
     clearTimeout(cataTimer);
     cata.hidden=financesSummary().total<=0;
     if(!cata.hidden){
       const picture=cata.querySelector("img");
       picture.src="cata-celebracion.gif?play="+Date.now();
       cataTimer=setTimeout(()=>{cata.hidden=true},3000);
     }
   }
 } else if(!home){
   clearTimeout(cataTimer);
   const cata=document.getElementById("cataCelebration");if(cata)cata.hidden=true;
 }
 cataLastTab=activeTab;
 $("#homeSummary").hidden=!home;
 document.querySelector(".content-card").classList.toggle("home-navigation",home);
 document.querySelector(".section-heading").hidden=home;
 document.querySelector(".welcome").hidden=home;
 document.querySelectorAll("[data-tab]").forEach(b=>{const on=b.dataset.tab===activeTab;b.classList.toggle("active",on);if(on)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
 const view=$("#view");
 $("#newProduct").hidden=activeTab==="Oportunidades";
 if(activeTab==="Oportunidades"){renderOportunidades(view);return;}
 if(home){view.innerHTML="";return;}
 if(activeTab==="Compras"||activeTab==="Inventario"){
   const rows=products.filter(p=>activeTab==="Compras"||!isSold(p));
   rows.sort((a,b)=>String(b.purchaseDate||"").localeCompare(String(a.purchaseDate||"")) || products.indexOf(b)-products.indexOf(a));
   if(!rows.length){view.innerHTML=`<div class="empty"><div class="symbol">▧</div><h3>${activeTab==="Compras"?"Todavía no hay compras":"Tu inventario está vacío"}</h3><p>Añade el primer producto para empezar a organizar AZORES.</p><button class="primary" id="emptyAdd">＋ Añadir producto</button></div>`;$("#emptyAdd").onclick=()=>openDialog();return}
   if(activeTab==="Inventario" && azInventoryMode==="cards"){
     view.innerHTML=`${azInventoryToolbar(rows)}<div class="az-inventory-grid">${rows.map(p=>`<article class="az-inventory-card"><div class="az-inventory-photo">${p.photo?`<img class="zoomable-photo" src="${esc(photoDisplay(p.photo))}" data-storage-photo="${photoIsStored(p.photo)?esc(p.photo):""}" alt="Ampliar foto de ${esc(p.name)}" tabindex="0" role="button" loading="lazy">`:`<span aria-hidden="true">▧</span>`}<span class="az-inventory-status ${productStatus(p)==="Por recibir"?"waiting":productStatus(p)==="Por subir"?"upload":"ready"}">${esc(productStatus(p))}</span></div><div class="az-inventory-body"><h3>${esc(p.name)}</h3><small>Compra: ${esc(p.purchaseDate||"—")} · ${esc(p.account||"—")}</small><div class="az-inventory-cost"><small>Coste</small><strong>${money(p.purchasePrice)}</strong></div><div class="action-group"><button class="edit-product" data-edit="${esc(p.id)}">Editar</button><button class="primary" data-sell="${esc(p.id)}">Vender</button><button class="edit-product delete-product" data-delete="${esc(p.id)}">Eliminar</button></div></div></article>`).join("")}</div>`;
     return;
   }
   view.innerHTML=`${activeTab==="Inventario"?azInventoryToolbar(rows):""}<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Compra</th><th>Coste</th><th>Cuenta</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(p=>`<tr><td><div class="product-cell">${p.photo?`<img class="thumb zoomable-photo" src="${esc(photoDisplay(p.photo))}" data-storage-photo="${photoIsStored(p.photo)?esc(p.photo):""}" alt="Ampliar foto de ${esc(p.name)}" tabindex="0" role="button" loading="lazy">`:`<span class="thumb">▧</span>`}<strong>${esc(p.name)}</strong></div></td><td>${p.purchaseDate||"—"}</td><td>${money(p.purchasePrice)}</td><td>${esc(p.account||"—")}</td><td><span class="pill">${esc(productStatus(p))}</span></td><td><div class="action-group"><button type="button" class="edit-product" data-edit="${esc(p.id)}">Editar</button>${!isSold(p)?`<button type="button" class="edit-product" data-sell="${esc(p.id)}">Vender</button><button type="button" class="edit-product delete-product" data-delete="${esc(p.id)}" aria-label="Eliminar compra de ${esc(p.name)}">Eliminar</button>`:""}</div></td></tr>`).join("")}</tbody></table></div>`;
 }else if(activeTab==="Ventas"){
   const sold=products.filter(isSold);
   const byDate=(a,b)=>String(b.saleDate||"").localeCompare(String(a.saleDate||""));
   const pending=sold.filter(p=>p.paymentStatus!=="Cobrado").sort(byDate);
   const paid=sold.filter(p=>p.paymentStatus==="Cobrado").sort(byDate);
   const saleRow=p=>`<tr><td class="sale-product"><div class="product-cell">${p.photo?`<img class="thumb zoomable-photo" src="${esc(photoDisplay(p.photo))}" data-storage-photo="${photoIsStored(p.photo)?esc(p.photo):""}" alt="Ampliar foto de ${esc(p.name)}" tabindex="0" role="button" loading="lazy">`:`<span class="thumb" aria-hidden="true">▧</span>`}<strong>${esc(p.name)}</strong></div></td><td>${esc(p.saleDate||"—")}</td><td>${money(p.salePrice)}</td><td>${esc(p.buyer||"—")}</td><td><span class="pill">${esc(p.paymentStatus||"—")}</span></td><td>${money(Number(p.salePrice)-Number(p.purchasePrice||0))}</td><td><div class="action-group"><button class="edit-product" data-sale-edit="${esc(p.id)}">Editar venta</button><button class="edit-product" data-sale-cancel="${esc(p.id)}">Anular venta</button></div></td></tr>`;
   const current=salesGroupOpen==="pending"?pending:salesGroupOpen==="paid"?paid:null;
   view.innerHTML=`<div class="action-group sales-toolbar"><button class="primary" id="addSale" ${products.some(p=>!isSold(p))?"":"disabled"}>＋ Registrar venta</button><button type="button" class="sales-group-toggle ${salesGroupOpen==="pending"?"selected":""}" data-sales-group="pending" aria-expanded="${salesGroupOpen==="pending"}">Pendientes (${pending.length}) <span aria-hidden="true">${salesGroupOpen==="pending"?"⌃":"⌄"}</span></button><button type="button" class="sales-group-toggle ${salesGroupOpen==="paid"?"selected":""}" data-sales-group="paid" aria-expanded="${salesGroupOpen==="paid"}">Cobradas (${paid.length}) <span aria-hidden="true">${salesGroupOpen==="paid"?"⌃":"⌄"}</span></button></div>${current?(current.length?`<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Fecha</th><th>Precio venta</th><th>Comprador</th><th>Cobro</th><th>Beneficio</th><th>Acciones</th></tr></thead><tbody>${current.map(saleRow).join("")}</tbody></table></div>`:`<div class="simple-panel"><strong>No hay ventas ${salesGroupOpen==="paid"?"cobradas":"pendientes de cobro"}</strong></div>`):`<div class="simple-panel sales-empty-hint">${sold.length?"Selecciona Pendientes o Cobradas para ver las ventas.":"Aún no hay ventas. Pulsa Registrar venta para empezar."}</div>`}`;
   const add=$("#addSale");if(add)add.onclick=()=>openSaleDialog();
   view.querySelectorAll("[data-sales-group]").forEach(btn=>btn.onclick=()=>{salesGroupOpen=salesGroupOpen===btn.dataset.salesGroup?null:btn.dataset.salesGroup;render()});
 }else if(activeTab==="Envíos"){
   const sold=products.filter(p=>isSold(p)&&p.paymentStatus!=="Cobrado");
   view.innerHTML=`<span id="testVintedGoResult" role="status" hidden></span>`+(sold.length?`<div class="az-ship-grid">${sold.map(azShipCard).join("")}</div><p class="muted">Los envíos permanecen aquí hasta que la venta esté cobrada.</p>`:`<div class="simple-panel"><strong>No hay envíos pendientes de cobro</strong></div>`);
   const testButton=document.getElementById("testVintedGo");if(testButton)testButton.onclick=refreshVintedGoPreviews;
 }else if(activeTab==="Cuentas"){
   const f=financesSummary();
   view.innerHTML=`<div class="finance-grid">
   <article class="finance-box"><small>Saldo Vinted Aurora</small><strong>${money(f.balances.Aurora)}</strong></article>
   <article class="finance-box"><small>Saldo Vinted Pedro</small><strong>${money(f.balances.Pedro)}</strong></article>
   <article class="finance-box"><small>Dinero disponible AZORES</small><strong>${money(f.total)}</strong></article>
   <article class="finance-box"><small>Ventas pendientes de cobro</small><strong>${money(f.pending)}</strong></article>
   <article class="finance-box"><small>Inventario a coste</small><strong>${money(f.inventory)}</strong></article>
   <article class="finance-box"><small>Beneficio de ventas</small><strong>${money(f.profit)}</strong></article></div>
   <div class="simple-panel"><h3>Aportaciones personales registradas</h3><p>Aurora: <b>${money(f.capital.Aurora)}</b> · Pedro: <b>${money(f.capital.Pedro)}</b></p><p>Las aportaciones no son beneficios. Una compra pagada con dinero personal cuenta como aportación y no reduce el saldo de Vinted.</p></div>
   <div class="simple-panel"><h3>Devolución de aportaciones</h3><p>Solo registra aquí una devolución real del capital a un socio. Se descuenta del saldo Vinted correspondiente y reduce el capital pendiente de liquidar; no es un gasto ni reduce el beneficio.</p><div class="form-grid"><label>Socio<select id="repayOwner"><option>Aurora</option><option>Pedro</option></select></label><label>Importe (€)<input id="repayAmount" type="number" min="0.01" step="0.01"></label></div><button class="primary" id="addRepayment">Registrar devolución de capital</button></div>
   <div class="simple-panel"><h3>Saldos de partida (datos de prueba)</h3><p>Configura aquí el saldo inicial de cada cuenta antes de las operaciones registradas en esta versión. No incluyas aquí ingresos que ya figuren como ventas cobradas.</p><div class="form-grid"><label>Aurora (€)<input id="openingAurora" type="number" step="0.01" value="${finances.opening.Aurora||0}"></label><label>Pedro (€)<input id="openingPedro" type="number" step="0.01" value="${finances.opening.Pedro||0}"></label></div><button class="primary" id="saveOpening">Guardar saldos iniciales</button></div>
   <div class="simple-panel"><h3>Registrar aportación adicional</h3><p>Para dinero personal aportado al negocio que no esté ya reflejado en una compra personal.</p><div class="form-grid"><label>Socio<select id="capitalOwner"><option>Aurora</option><option>Pedro</option></select></label><label>Importe (€)<input id="capitalAmount" type="number" min="0.01" step="0.01"></label></div><label><input id="capitalToVinted" type="checkbox"> El dinero se ingresó en el saldo Vinted de ese socio</label><p><button class="primary" id="addCapital">Añadir aportación</button></p></div>
   <div class="simple-panel"><h3>Registrar retirada de saldo</h3><p>Dinero retirado de Vinted; se descuenta de la caja de AZORES. No modifica automáticamente las aportaciones ni el reparto de beneficios.</p><div class="form-grid"><label>Cuenta<select id="withdrawOwner"><option>Aurora</option><option>Pedro</option></select></label><label>Importe (€)<input id="withdrawAmount" type="number" min="0.01" step="0.01"></label></div><button class="primary" id="addWithdrawal">Registrar retirada</button></div>`;
   $("#saveOpening").onclick=()=>{const x=Number($("#openingAurora").value),y=Number($("#openingPedro").value);if(!Number.isFinite(x)||!Number.isFinite(y))return alert("Introduce saldos válidos");finances.opening={Aurora:x,Pedro:y};saveFin()};
   $("#addCapital").onclick=()=>{const n=Number($("#capitalAmount").value);if(!(n>0))return alert("Introduce un importe positivo");finances.contributions.push({id:crypto.randomUUID(),account:$("#capitalOwner").value,amount:n,toVinted:$("#capitalToVinted").checked});saveFin()};
   $("#addRepayment").onclick=()=>{const n=Number($("#repayAmount").value),who=$("#repayOwner").value,f=financesSummary();if(!Number.isFinite(n)||n<=0)return alert("Introduce un importe positivo");if(n>f.capitalPending[who]+0.001)return alert("No puedes devolver más capital del pendiente de ese socio");if(n>f.balances[who]+0.001)return alert("No hay saldo Vinted suficiente en esa cuenta");if(!confirm("¿Confirmas que has devuelto realmente "+money(n)+" a "+who+" desde su saldo Vinted?"))return;finances.capitalRepayments.push({id:crypto.randomUUID(),account:who,amount:n});saveFin()};
   $("#addWithdrawal").onclick=()=>{const n=Number($("#withdrawAmount").value);if(!(n>0))return alert("Introduce un importe positivo");finances.withdrawals.push({id:crypto.randomUUID(),account:$("#withdrawOwner").value,amount:n});saveFin()};
 }else if(activeTab==="Beneficios"){
   const f=financesSummary();const currentProfit=Math.max(0,Math.min(f.profit,f.total));const capitalOutstanding=f.capitalPending.Aurora+f.capitalPending.Pedro;const excessCash=Math.max(0,f.total-400);const withdrawalAvailable=capitalOutstanding>0?0:Math.min(currentProfit,excessCash);const withdrawalNote=f.total<=400?"La caja aún no supera los 400 €. No corresponde retirar dinero.":capitalOutstanding>0?"Primero hay que devolver las aportaciones pendientes, usando solo el dinero que supere los 400 € de caja. No corresponde repartir beneficios todavía.":"Las aportaciones están recuperadas. El beneficio que podría retirarse está limitado al excedente sobre 400 € y al beneficio actual.";view.innerHTML=`<div class="finance-grid"><article class="finance-box"><small>Beneficio total generado por ventas</small><strong>${money(f.profit)}</strong></article><article class="finance-box"><small>Beneficio actual</small><strong>${money(currentProfit)}</strong></article><article class="finance-box"><small>Beneficio Auro · 60 %</small><strong>${money(currentProfit*.6)}</strong></article><article class="finance-box"><small>Beneficio Pedro · 40 %</small><strong>${money(currentProfit*.4)}</strong></article><article class="finance-box"><small>Importe pendiente de cobro</small><strong>${money(f.pending)}</strong></article><article class="finance-box"><small>Capital pendiente · Aurora</small><strong>${money(f.capitalPending.Aurora)}</strong></article><article class="finance-box"><small>Capital pendiente · Pedro</small><strong>${money(f.capitalPending.Pedro)}</strong></article><article class="finance-box"><small>Capital total por devolver</small><strong>${money(f.capitalPending.Aurora+f.capitalPending.Pedro)}</strong></article></div><div class="simple-panel"><h3>Detalle de aportaciones</h3><p>Aurora: aportado <b>${money(f.capital.Aurora)}</b> · devuelto <b>${money(f.repaid.Aurora)}</b> · pendiente <b>${money(f.capitalPending.Aurora)}</b></p><p>Pedro: aportado <b>${money(f.capital.Pedro)}</b> · devuelto <b>${money(f.repaid.Pedro)}</b> · pendiente <b>${money(f.capitalPending.Pedro)}</b></p><p>Las compras pagadas con dinero personal se suman automáticamente al capital de quien las pagó. Las compras pagadas con saldo Vinted no generan aportaciones. Para registrar una devolución real, utiliza Cuentas → Devolución de aportaciones.</p><p>El beneficio total generado suma los márgenes de las ventas, aunque el cobro esté pendiente. El beneficio actual es el menor entre el beneficio acumulado por ventas y el saldo disponible en caja (sin mostrar valores negativos). Auro tiene asignado el 60 % y Pedro el 40 %. Estas cifras son informativas y no significan que el dinero pueda retirarse.</p><p><b>Regla de retirada (reserva de 400 €):</b> ${withdrawalNote}</p><p><b>Beneficio orientativo disponible para retirar ahora:</b> ${money(withdrawalAvailable)}. Las retiradas y devoluciones deben registrarse manualmente en Cuentas; AZORES no mueve dinero automáticamente.</p></div>`;
 }else{
   const descriptions={Ventas:"Cuando registremos ventas, aquí aparecerán el precio, comprador, cobro y beneficio de cada operación.",Envíos:"Aquí conectaremos los envíos de los productos vendidos: transportista y enlace directo al seguimiento del paquete.",Cuentas:"Aquí calcularemos los movimientos, aportaciones y dinero disponible, respetando las cuentas de Aurora y Pedro.",Beneficios:"Aquí aparecerán los beneficios y el reparto acordado: 60 % Aurora y 40 % Pedro."};
   view.innerHTML=`<div class="simple-panel"><strong>${activeTab}</strong><p>${descriptions[activeTab]}</p><small>Esta sección se activará al conectar los datos con Compras e Inventario.</small></div>`;
 }
}

function azShipStage(status,sent){
 const t=String(status||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
 if(/^(entregado|paquete entregado|entregado al destinatario|paquete entregado al destinatario|recogido por (el )?destinatario)$/.test(t))return 3;
 if(/disponible para (la )?recogida|listo para recoger|listo para (la )?recogida|esperando a ser recogido|a la espera de recogida por el destinatario/.test(t))return 2;
 if(/de camino|en camino|en transito|clasific|admitido|paquete dejado|en transporte/.test(t)||sent)return 1;
 if(/pendiente de envio|envio creado/.test(t))return 0;
 return -1;
}
function azShipCard(p){
 const sh=p.shipping||{}, e=trackingPreview.get(p.id)||sh, status=e.status||"Pendiente de seguimiento", stage=azShipStage(status,sh.sentAt);
 const date=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("es-ES",{dateStyle:"short",timeStyle:"short"}):"";
 const events=Array.isArray(e.events)?[...e.events].sort((a,b)=>(Date.parse(b.fecha||b.date||b.datetime)||0)-(Date.parse(a.fecha||a.date||a.datetime)||0)):[];
 return `<article class="az-ship-card"><header><div><small>${esc(sh.carrier||"Transportista sin indicar")}</small><h3>${esc(p.name)}</h3><small>${esc(p.buyer||"Comprador sin indicar")}</small></div><span class="pill">${esc(status)}</span></header><div class="az-ship-progress" aria-label="Fase orientativa del envío">${["Preparación","En camino","Recogida","Entregado"].map((label,i)=>`<div class="${stage>=i?"done":""}"><span>${stage>i?"✓":i+1}</span><small>${label}</small></div>`).join("")}</div><div class="az-ship-history"><strong>Movimientos disponibles</strong>${events.length?events.map(x=>`<div class="az-ship-event">${esc(x.estado||x.mensaje||x.message||x.status||x.description||"Descripción no disponible")}<small>${esc(date(x.fecha||x.date||x.datetime))}</small></div>`).join(""):`<div class="az-ship-event">${esc(status)}<small>${esc(date(e.lastUpdated)||"Sin fecha de actualización")}</small></div>`}${sh.sentAt?`<div class="az-ship-event">Fecha de envío <small>${esc(sh.sentAt)}</small></div>`:""}</div><footer>${safeTrackingLink(sh.trackingUrl)}<button class="edit-product" data-ship-edit="${esc(p.id)}">Editar envío</button></footer></article>`;
}
function vintedGoNumber(p){
 if(!isSold(p)||p.paymentStatus==="Cobrado"||!/vinted\s*go/i.test(p.shipping?.carrier||""))return null;
 try{
  const u=new URL(p.shipping?.trackingUrl||"");
  if(u.protocol!=="https:"||u.hostname!=="vintedgo.com")return null;
  return u.pathname.match(/^\/es\/tracking\/(\d{16})\/?$/)?.[1]||null;
 }catch{return null;}
}
// Caché temporal por pestaña: evita consultas repetidas al volver a Envíos.
// No modifica productos, cobros, almacenamiento permanente ni Supabase.
const TRACKING_INTERVAL_MS=15*60*1000;
const TRACKING_CACHE_KEY="azores-v9-11-tracking-cache";
function readTrackingCache(){
 try{
  const parsed=JSON.parse(sessionStorage.getItem(TRACKING_CACHE_KEY)||"{}");
  return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed:{};
 }catch{return {};}
}
function writeTrackingCache(cache){
 try{sessionStorage.setItem(TRACKING_CACHE_KEY,JSON.stringify(cache));}catch{}
}
async function refreshVintedGoPreviews(){
 if(!cloudReady||!cloudSession?.access_token||activeTab!=="Envíos")return;
 const run=++trackingRun;
 const button=document.getElementById("testVintedGo");
 const output=document.getElementById("testVintedGoResult");
 const candidates=products.map(p=>({p,number:vintedGoNumber(p)})).filter(x=>x.number);
 if(!output)return;
 if(!candidates.length){output.textContent="No hay envíos Vinted Go pendientes con enlace válido.";return;}
 const cache=readTrackingCache();
 const now=Date.now();
 let cached=0,changed=0,unchanged=0,failed=0;
 const pending=[];
 for(const {p,number} of candidates){
  const key=String(p.id)+":"+number;
  const entry=cache[key];
  if(entry&&Number.isFinite(entry.checkedAt)&&now-entry.checkedAt>=0&&now-entry.checkedAt<TRACKING_INTERVAL_MS&&typeof entry.status==="string"&&Number.isFinite(Date.parse(entry.lastUpdated))){
   const previous=trackingPreview.get(p.id);
   if(!previous||previous.status!==entry.status||previous.lastUpdated!==entry.lastUpdated){
    trackingPreview.set(p.id,{status:entry.status,lastUpdated:entry.lastUpdated,events:entry.events||[]});changed++;
   }
   cached++;
  }else pending.push({p,number,key});
 }
 if(button)button.disabled=true;
 output.textContent=pending.length?"Consultando "+pending.length+" envío(s); "+cached+" en caché…":"Sin consultas nuevas: "+cached+" envío(s) revisados hace menos de 15 minutos.";
 for(const {p,number,key} of pending){
  if(run!==trackingRun)break;
  try{
   const response=await cloudFetch("/functions/v1/azores-prueba-vintedgo?seguimiento="+encodeURIComponent(number),{method:"POST",body:"{}"});
   const result=await response.json();
   if(result.resultado!=="Seguimiento leído"||typeof result.estadoPaquete!=="string"||!Number.isFinite(Date.parse(result.ultimaActualizacion)))throw Error("Respuesta de seguimiento no válida");
   const next={status:result.estadoPaquete,lastUpdated:result.ultimaActualizacion,events:Array.isArray(result.movimientos)?result.movimientos:[]};
   const previous=trackingPreview.get(p.id);
   if(!previous||previous.status!==next.status||previous.lastUpdated!==next.lastUpdated||JSON.stringify(previous.events||[])!==JSON.stringify(next.events||[])){trackingPreview.set(p.id,next);changed++;}
   else unchanged++;
   cache[key]={...next,checkedAt:Date.now()};
   writeTrackingCache(cache);
  }catch(error){failed++;}
 }
 if(run!==trackingRun)return;
 if(activeTab==="Envíos"){
  // Redibujar únicamente si cambió el estado o la fecha visibles.
  if(changed)render();
  const currentButton=document.getElementById("testVintedGo");
  if(currentButton)currentButton.disabled=false;
  const currentOutput=document.getElementById("testVintedGoResult");
  if(currentOutput)currentOutput.textContent="Seguimiento: "+changed+" novedad(es), "+unchanged+" sin cambios, "+cached+" en caché (<15 min), "+failed+" error(es). Solo lectura.";
 }
}

function safeTrackingLink(url){
 if(!url)return "—";
 try{const u=new URL(url);if(!["https:","http:"].includes(u.protocol))return "Enlace no válido";return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">Abrir seguimiento</a>`}catch{return "Enlace no válido"}
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
const dialog=$("#productDialog");
function openDialog(id=null){
 editingId=typeof id==="string"?id:null;
 const p=products.find(item=>item.id===editingId);
 const form=$("#productForm");form.reset();$("#saveProductButton").disabled=false;
 $("#productFormMessage").textContent="";
 photoData=p?.photo||"";
 form.elements.name.value=p?.name||"";
 form.elements.purchaseDate.value=p?.purchaseDate||"";
 form.elements.purchasePrice.value=p?.purchasePrice||"";
 form.elements.origin.value=p?.origin||"";
 form.elements.account.value=p?.account||"";
 form.elements.purchaseMethod.value=p?.purchaseMethod||"Vinted";
 form.elements.status.value=p?productStatus(p):"Sin vender";
 form.elements.status.disabled=!!p&&isSold(p);
 updateProductPhotoPreview();
 $("#dialogTitle").textContent=p?"Editar producto":"Nuevo producto";
 $("#saveProductButton").textContent=p?"Guardar cambios":"Guardar producto";
 dialog.showModal();
}
$("#newProduct").onclick=()=>openDialog();$("#newProductTop").onclick=()=>openDialog();$("#closeDialog").onclick=()=>dialog.close();$("#cancelDialog").onclick=()=>dialog.close();
document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{activeTab=b.dataset.tab;azCloseMore();if(activeTab==="Ventas")salesGroupOpen=null;render();if(false)refreshVintedGoPreviews()}));
function updateProductPhotoPreview(){
 $("#photoPreview").innerHTML=photoData?`<img src="${esc(photoDisplay(photoData))}" data-storage-photo="${photoIsStored(photoData)?esc(photoData):""}" alt="Vista previa">`:"";
 hydrateStoredPhotos($("#photoPreview"));
 $("#removeProductPhoto").hidden=!photoData;
}
$("#removeProductPhoto").addEventListener("click",()=>{
 photoData="";
 $("#productForm [name=photo]").value="";$("#productForm [name=photoCamera]").value="";
 updateProductPhotoPreview();
 $("#productFormMessage").textContent="Fotografía eliminada. Pulsa Guardar cambios para confirmar.";
});
async function compressProductPhoto(file){
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=url;
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error("Imagen no compatible"));});
  const max=900,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext("2d");if(!ctx)throw Error("No se pudo procesar la imagen");
  ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",0.68);
 }finally{URL.revokeObjectURL(url);}
}
function onProductPhotoSelected(e){
 const f=e.target.files[0];if(!f)return;
 if(!f.type.startsWith("image/")){$("#productFormMessage").textContent="Selecciona una imagen válida.";return;}
 // Reducir fotos de cámara antes de almacenarlas o enviarlas a Supabase.
 $("#saveProductButton").disabled=true;
 $("#productFormMessage").textContent="Optimizando fotografía…";
 compressProductPhoto(f).then(data=>{
  photoData=data;updateProductPhotoPreview();
  $("#saveProductButton").disabled=false;
  $("#productFormMessage").textContent="Fotografía optimizada. Pulsa Guardar cambios.";
 }).catch(err=>{$("#saveProductButton").disabled=false;$("#productFormMessage").textContent="No se pudo preparar la fotografía: "+err.message;});
}
$("#chooseProductPhoto").addEventListener("click",()=>{$("#productForm [name=photo]").click();});
$("#productForm [name=photo]").addEventListener("change",onProductPhotoSelected);
$("#productForm [name=photoCamera]").addEventListener("change",onProductPhotoSelected);
$("#view").addEventListener("click",e=>{const b=e.target.closest("[data-edit]");if(b)openDialog(b.dataset.edit);const sell=e.target.closest("[data-sell]");if(sell)openSaleDialog(sell.dataset.sell);const editSale=e.target.closest("[data-sale-edit]");if(editSale)openSaleDialog(editSale.dataset.saleEdit,true);const cancel=e.target.closest("[data-sale-cancel]");if(cancel)cancelSale(cancel.dataset.saleCancel);const ship=e.target.closest("[data-ship-edit]");if(ship)openShippingDialog(ship.dataset.shipEdit);const del=e.target.closest("[data-delete]");if(del)deletePurchase(del.dataset.delete)});
function deletePurchase(id){
 if(!cloudReady){alert("Espera a que se conecte Supabase antes de eliminar una compra.");return;}
 if(cloudDirty||cloudSaving){alert("Hay cambios pendientes de sincronizar. Espera a que aparezca 'Sincronizado en Supabase' antes de eliminar.");return;}
 const p=products.find(x=>x.id===id);
 if(!p)return;
 if(isSold(p)){alert("Esta compra tiene una venta registrada. Primero anula la venta si realmente quieres eliminar la compra.");return;}
 if(!confirm(`¿Eliminar definitivamente la compra de "${p.name}"?\n\nSe quitará también del inventario y se recalcularán las cuentas. Esta acción no se puede deshacer desde la aplicación.\n\n¿Quieres continuar?`))return;
 products=products.filter(x=>x.id!==id);
 scheduleOldPhotoCleanup(p.photo,"");
 save();
}
$("#productForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const form=e.currentTarget;
 if(!form.checkValidity()){
  const invalid=form.querySelector(":invalid");
  $("#productFormMessage").textContent="Revisa este campo antes de guardar: "+(invalid?.closest("label")?.textContent?.trim()||"campo obligatorio");
  invalid?.focus();form.reportValidity();return;
 }
 if(!cloudReady){$("#productFormMessage").textContent="Espera a que AZORES conecte con la nube.";return;}
 const button=$("#saveProductButton");button.disabled=true;
 const productId=editingId||crypto.randomUUID();
 let finalPhoto=photoData;
 try{
  if(typeof photoData==="string"&&photoData.startsWith("data:image/")){
   $("#productFormMessage").textContent="Subiendo fotografía a Supabase…";
   finalPhoto=await uploadProductPhoto(photoData,productId);
  }
 }catch(error){$("#productFormMessage").textContent="No se ha guardado: "+error.message;button.disabled=false;return;}
 const f=new FormData(form);
 const fields={name:f.get("name"),purchaseDate:f.get("purchaseDate"),purchasePrice:f.get("purchasePrice"),origin:f.get("origin"),account:f.get("account"),purchaseMethod:f.get("purchaseMethod"),status:editingId&&products.find(x=>x.id===editingId)&&isSold(products.find(x=>x.id===editingId))?"Vendido":f.get("status"),photo:finalPhoto};
 if(editingId){const p=products.find(item=>item.id===editingId);if(!p)return;const previousPhoto=p.photo;Object.assign(p,fields);scheduleOldPhotoCleanup(previousPhoto,finalPhoto)}
 else products.push({id:productId,...fields,salePrice:""});
 try{save();dialog.close();activeTab="Inventario";render();}
 catch(error){$("#productFormMessage").textContent="No se pudieron guardar los cambios: "+error.message;}
 finally{button.disabled=false;}
});
const saleDialog=$("#saleDialog"),saleForm=$("#saleForm");
function openSaleDialog(id=null,edit=false){
 editingSaleId=edit?id:null;
 const p=products.find(x=>x.id===id);
 const choices=products.filter(x=>!isSold(x)||x.id===editingSaleId);
 if(!choices.length)return;
 saleForm.reset();
 $("#saleProduct").innerHTML=choices.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
 $("#saleProduct").value=p?.id||choices[0].id;
 $("#saleProduct").disabled=!!edit;
 saleForm.elements.saleDate.value=p?.saleDate||new Date().toLocaleDateString("en-CA");
 saleForm.elements.salePrice.value=edit?p.salePrice:"";
 saleForm.elements.buyer.value=edit?p.buyer||"":"";
 saleForm.elements.paymentStatus.value=edit?p.paymentStatus||"Pendiente de cobro":"Pendiente de cobro";
 saleForm.elements.paidAt.value=edit?azCalendarDate(p.paidAt||p.paymentDate||p.collectedAt)||"":"";
 saleForm.elements.sentAt.value=edit?azCalendarDate(p.shipping?.sentAt||p.shipping?.shippedAt||p.shipping?.shippingDate)||"":"";
 updatePaidDateVisibility(false);
 saleForm.elements.receivingAccount.value=edit?receiver(p)||"":normalizedAccount(p?.account)||"";
 $("#saleDialogTitle").textContent=edit?"Editar venta":"Registrar venta";
 updateSaleSummary();saleDialog.showModal();
}
function updatePaidDateVisibility(fill){
 const paid=saleForm.elements.paymentStatus.value==="Cobrado";
 document.getElementById("paidDateLabel").hidden=!paid;
 saleForm.elements.paidAt.disabled=!paid;
 if(paid&&fill&&!saleForm.elements.paidAt.value)saleForm.elements.paidAt.value=azToday();
}
saleForm.elements.paymentStatus.addEventListener("change",()=>updatePaidDateVisibility(true));
function updateSaleSummary(){
 const p=products.find(x=>x.id===$("#saleProduct").value);
 const value=saleForm.elements.salePrice.value;
 $("#saleSummary").innerHTML=p&&value!==""?`Coste: ${money(p.purchasePrice)} · Venta: ${money(value)}<strong>Beneficio: ${money(Number(value)-Number(p.purchasePrice||0))}</strong><small>Reparto orientativo: Aurora ${money((Number(value)-Number(p.purchasePrice||0))*.6)} · Pedro ${money((Number(value)-Number(p.purchasePrice||0))*.4)}</small>`:"Selecciona un producto e indica el precio de venta.";
}
$("#saleProduct").addEventListener("change",updateSaleSummary);
saleForm.elements.salePrice.addEventListener("input",updateSaleSummary);
$("#closeSaleDialog").onclick=()=>saleDialog.close();
$("#cancelSaleDialog").onclick=()=>saleDialog.close();
saleForm.addEventListener("submit",e=>{
 e.preventDefault();
 const p=products.find(x=>x.id===(editingSaleId||$("#saleProduct").value));if(!p)return;
 if(!editingSaleId&&isSold(p))return alert("Este producto ya figura como vendido.");
 if(!editingSaleId){p.shipping={carrier:"",trackingNumber:"",trackingUrl:"",status:"Pendiente de envío"}}
 if(!editingSaleId)p.statusBeforeSale=p.status&&p.status!=="Vendido"?p.status:"Sin vender";
 p.saleDate=saleForm.elements.saleDate.value;
 p.salePrice=saleForm.elements.salePrice.value;
 p.buyer=saleForm.elements.buyer.value.trim();
 const wasPaid=p.paymentStatus==="Cobrado";
 p.paymentStatus=saleForm.elements.paymentStatus.value;
 if(p.paymentStatus==="Cobrado"){
  const date=saleForm.elements.paidAt.value||(!wasPaid?azToday():"");
  if(date)p.paidAt=date;
 }else{delete p.paidAt;delete p.paymentDate;delete p.collectedAt;}
 p.shipping||={};
 p.shipping.sentAt=saleForm.elements.sentAt.value||null;
 if(!p.shipping.sentAt){delete p.shipping.shippedAt;delete p.shipping.shippingDate;}
 p.receivingAccount=saleForm.elements.receivingAccount.value;
 p.status="Vendido";
 save();saleDialog.close();activeTab="Ventas";render();
});
function cancelSale(id){
 const p=products.find(x=>x.id===id);
 if(!p||!isSold(p))return;
 if(!confirm(`¿Anular la venta de "${p.name}"? El producto volverá al inventario y el beneficio dejará de contabilizarse.`))return;
 p.status=p.statusBeforeSale&&p.statusBeforeSale!=="Vendido"?p.statusBeforeSale:"Sin vender";
 delete p.statusBeforeSale;
 p.salePrice="";
 delete p.saleDate;
 delete p.buyer;
 delete p.paymentStatus;
 delete p.paidAt;delete p.paymentDate;delete p.collectedAt;
 delete p.receivingAccount;
 delete p.shipping;
 activeTab="Inventario";
 save();
}
const shippingDialog=$("#shippingDialog"),shippingForm=$("#shippingForm");
function openShippingDialog(id){
 const p=products.find(x=>x.id===id);if(!p||!isSold(p))return;
 editingShipmentId=id;shippingForm.reset();
 $("#shippingProductName").textContent=p.name;
 shippingForm.elements.carrier.value=p.shipping?.carrier||"";
 shippingForm.elements.trackingUrl.value=p.shipping?.trackingUrl||"";
 shippingForm.elements.sentAt.value=azCalendarDate(p.shipping?.sentAt||p.shipping?.shippedAt||p.shipping?.shippingDate)||"";
 shippingDialog.showModal();
}
$("#markSentToday").onclick=()=>{shippingForm.elements.sentAt.value=azToday();};
$("#closeShippingDialog").onclick=()=>shippingDialog.close();
$("#cancelShippingDialog").onclick=()=>shippingDialog.close();
shippingForm.addEventListener("submit",e=>{
 e.preventDefault();const p=products.find(x=>x.id===editingShipmentId);if(!p||!isSold(p))return;
 const f=new FormData(shippingForm);
 p.shipping={...(p.shipping||{}),carrier:String(f.get("carrier")||"").trim(),trackingNumber:p.shipping?.trackingNumber||"",trackingUrl:String(f.get("trackingUrl")||"").trim(),status:p.shipping?.status||"Pendiente de seguimiento",lastUpdated:p.shipping?.lastUpdated||null,events:Array.isArray(p.shipping?.events)?p.shipping.events:[]};
 p.shipping.sentAt=String(f.get("sentAt")||"")||null;
 if(!p.shipping.sentAt){delete p.shipping.shippedAt;delete p.shipping.shippingDate;}
 save();shippingDialog.close();
});
render();
// Comprobar nuevas versiones al iniciar y al volver a la aplicación.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  let updateNoticeShown = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateNoticeShown) return;
    updateNoticeShown = true;
    // No recargar silenciosamente: el usuario puede estar editando un formulario.
    if (window.confirm("Hay una nueva versión de AZORES disponible. ¿Actualizar ahora? Guarda antes cualquier cambio que estés editando.")) {
      location.reload();
    }
  });
  navigator.serviceWorker.register("./sw.js", {updateViaCache: "none"}).then(registration => {
    const check = () => { if (navigator.onLine) registration.update().catch(() => {}); };
    check();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) check();
    });
    window.addEventListener("pageshow", check);
  }).catch(() => {});
}


// Limpieza voluntaria de todas las fotografías, nunca automática al instalar.
let azoresBackupDownloadedThisSession=false;
document.getElementById("clearAllPhotos").addEventListener("click",async()=>{
 if(!cloudReady||!cloudSession?.user?.id||cloudDirty||cloudSaving){
  alert("Espera a que aparezca «Sincronizado en Supabase» antes de limpiar las fotos.");return;
 }
 if(!azoresBackupDownloadedThisSession){
  alert("Primero descarga una copia de seguridad desde «▣ Copias» en esta sesión.");return;
 }
 const withPhoto=products.filter(p=>p.photo);
 if(!withPhoto.length){alert("Los productos ya están sin fotografías.");return;}
 if(!confirm("Se quitarán TODAS las fotografías de "+withPhoto.length+" productos, antiguas y nuevas. NO se eliminarán los productos, compras, ventas, cuentas ni beneficios. ¿Continuar?"))return;
 if(prompt("Para confirmar la limpieza escribe BORRAR FOTOS:")!=="BORRAR FOTOS")return;
 const btn=document.getElementById("clearAllPhotos");btn.disabled=true;
 const original=products;
 const cleared=products.map(p=>({...p,photo:""}));
 const storedPaths=[...new Set(original.map(p=>p.photo).filter(photoIsStored).map(photoPath))];
 try{
  // Persistir primero los datos sin fotos. Si falla, no cambiar estado local ni borrar archivos.
  const snapshot={products:cleared,finances:JSON.parse(JSON.stringify(finances))};
  await cloudFetch("/rest/v1/azores_state?on_conflict=user_id",{
   method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},
   body:JSON.stringify({user_id:cloudSession.user.id,data:snapshot,updated_at:new Date().toISOString()})
  });
  products=cleared;cacheLocalState();render();setCloudStatus("✓ Sincronizado en Supabase");
  // Solo archivos de la cuenta que estaban referenciados por los productos.
  let failures=0;
  for(const path of storedPaths){
   if(!path.startsWith(cloudSession.user.id+"/"))continue;
   try{
    await photoStorageFetch("/storage/v1/object/"+PHOTO_BUCKET+"/"+path.split("/").map(encodeURIComponent).join("/"),{method:"DELETE"});
    const url=photoUrlCache.get(path);if(url?.startsWith("blob:"))URL.revokeObjectURL(url);
    photoUrlCache.delete(path);
   }catch(e){failures++;console.warn("No se pudo borrar el archivo",path,e);}
  }
  alert("Limpieza terminada: "+withPhoto.length+" productos sin fotografía. Los demás datos siguen intactos."+
   (failures?" Atención: "+failures+" archivos no pudieron borrarse de Storage.":"")+
   " Los archivos huérfanos antiguos de Storage que no estaban asociados a productos no se han tocado.");
 }catch(e){alert("No se ha realizado la limpieza: "+e.message);}
 finally{btn.disabled=false;}
});
// Copias completas de AZORES (datos del navegador, no sincronización)
(function(){
 const exportButton=document.getElementById("exportBackup"), importButton=document.getElementById("importBackup"), fileInput=document.getElementById("backupFile");
 const backupFormat="azores-backup-v1";
 function validFinance(f){
  return f&&typeof f==="object"&&!Array.isArray(f)&&f.opening&&typeof f.opening==="object"&&
   ["Aurora","Pedro"].every(k=>Number.isFinite(Number(f.opening[k]??0)))&&
   ["contributions","withdrawals","capitalRepayments"].every(k=>f[k]===undefined||Array.isArray(f[k]));
 }
 function validProduct(p){return p&&typeof p==="object"&&!Array.isArray(p)&&typeof p.id==="string"&&p.id.length>0&&typeof p.name==="string"&&Number.isFinite(Number(p.purchasePrice??0));}
 exportButton.addEventListener("click",()=>{
  try{
   const data={format:backupFormat,exportedAt:new Date().toISOString(),products:JSON.parse(JSON.stringify(products)),finances:finances};
   if(!Array.isArray(data.products)||!data.products.every(validProduct)||!validFinance(data.finances))throw Error("Los datos actuales no tienen un formato válido");
   const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
   azoresBackupDownloadedThisSession=true;
   const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="AZORES_copia_"+new Date().toISOString().slice(0,10)+".json";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(e){alert("No se ha podido generar la copia: "+e.message)}
 });
 importButton.addEventListener("click",()=>{fileInput.value="";fileInput.click()});
 fileInput.addEventListener("change",async()=>{
  const file=fileInput.files?.[0];if(!file)return;
  try{
   if(file.size>30*1024*1024)throw Error("La copia supera 30 MB. Contacta antes de restaurarla.");
   const data=JSON.parse(await file.text());
   if(data?.format!==backupFormat||!Array.isArray(data.products)||!data.products.every(validProduct)||!validFinance(data.finances))throw Error("El archivo no es una copia compatible de AZORES");
   const ids=data.products.map(p=>p.id);if(new Set(ids).size!==ids.length)throw Error("La copia contiene identificadores duplicados");
   const oldProducts=localStorage.getItem(KEY),oldFinances=localStorage.getItem(FIN_KEY);
   const ok=confirm("ATENCIÓN: Restaurar esta copia sustituirá TODAS las compras, ventas, envíos y cuentas guardados actualmente en este navegador. ¿Has descargado antes una copia de los datos actuales?\n\nCopia: "+data.products.length+" productos, creada "+(data.exportedAt||"fecha desconocida")+".\n\n¿Quieres continuar?");
   if(!ok)return;
   try{
    localStorage.setItem(KEY,JSON.stringify(data.products));
    localStorage.setItem(FIN_KEY,JSON.stringify(data.finances));
   }catch(e){
    try{if(oldProducts===null)localStorage.removeItem(KEY);else localStorage.setItem(KEY,oldProducts);if(oldFinances===null)localStorage.removeItem(FIN_KEY);else localStorage.setItem(FIN_KEY,oldFinances)}catch(_){}
    throw Error("No hay espacio suficiente en el almacenamiento del navegador. No se ha podido completar la restauración.");
   }
   products=data.products;finances=data.finances;
   finances.opening ||= {Aurora:0,Pedro:0};finances.contributions ||= [];finances.withdrawals ||= [];finances.capitalRepayments ||= [];
   render();queueCloudSave();alert("Copia restaurada. Comprueba Compras, Cuentas y Beneficios. Espera a que indique sincronizado antes de cerrar.");
  }catch(e){alert("No se ha restaurado la copia: "+e.message)}
 });
})();

// Visor de fotografías: no modifica los datos ni las imágenes almacenadas.
(function(){
 const viewer=document.createElement("dialog");
 viewer.className="azores-photo-viewer";
 viewer.setAttribute("aria-label","Fotografía ampliada del producto");
 viewer.innerHTML='<button type="button" class="azores-photo-close" aria-label="Cerrar fotografía">×</button><img alt="Fotografía ampliada">';
 document.body.appendChild(viewer);
 const close=()=>viewer.close();
 viewer.querySelector("button").addEventListener("click",close);
 viewer.addEventListener("click",e=>{if(e.target===viewer)close()});
 document.addEventListener("click",e=>{const photo=e.target.closest("img.zoomable-photo");if(!photo)return;viewer.querySelector("img").src=photo.src;viewer.querySelector("img").alt=photo.alt;viewer.showModal()});
 document.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.matches("img.zoomable-photo")){e.preventDefault();e.target.click()}});
})();

// V9.36: prueba local de permiso y notificación. No implica suscripción push ni servidor.
document.getElementById("testNotificationButton")?.addEventListener("click", async () => {
  const result = document.getElementById("testNotificationResult");
  const say = message => { result.textContent = message; };
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    say("Este navegador no admite esta prueba de notificaciones."); return;
  }
  try {
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") { say("Permiso no concedido. Revisa Ajustes > Notificaciones del iPhone."); return; }
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("AZORES · Prueba correcta", {
      body: "Las notificaciones están permitidas en este iPhone. Esta es una prueba, no un cambio real de envío.",
      icon: "./icon-192.png", badge: "./icon-192.png", tag: "azores-prueba-local", data: {url: "./"}
    });
    say("Notificación de prueba enviada al sistema. Comprueba si aparece en el iPhone.");
  } catch (error) { say("No se pudo mostrar la notificación: " + (error?.message || String(error))); }
});

// V9.37: suscripción Web Push autenticada. No cambia ventas, cobros ni inventario.
function azoresBase64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
document.getElementById("registerPushButton")?.addEventListener("click", async () => {
  const button = document.getElementById("registerPushButton");
  const result = document.getElementById("testNotificationResult");
  const say = message => { if (result) result.textContent = message; };
  if (!cloudReady || !cloudSession?.access_token) { say("Primero debes iniciar sesión en AZORES."); return; }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    say("Este dispositivo no admite notificaciones push. En iPhone, abre AZORES desde su icono en la pantalla de inicio."); return;
  }
  button.disabled = true;
  try {
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") throw Error("Permiso de notificaciones no concedido.");
    const registration = await navigator.serviceWorker.ready;
    const response = await cloudFetch("/functions/v1/azores-push", {method:"GET"});
    const config = await response.json();
    if (!config.publicKey) throw Error("El servidor todavía no tiene habilitado el registro push.");
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:azoresBase64UrlToBytes(config.publicKey)});
    await cloudFetch("/functions/v1/azores-push", {method:"POST", body:JSON.stringify({subscription:subscription.toJSON(), dispositivo: /iPad/i.test(navigator.userAgent) ? "iPad" : /iPhone/i.test(navigator.userAgent) ? "iPhone" : "Navegador"})});
    say("Este dispositivo se ha registrado para recibir avisos automáticos.");
  } catch(error) { say("No se pudo activar: " + (error?.message || String(error))); }
  finally { button.disabled = false; }
});

// V9.45: preferencia visual local, independiente de los datos.
(()=>{const root=document.documentElement,button=document.getElementById('azThemeToggle');if(!button)return;function apply(dark){root.dataset.theme=dark?'dark':'light';button.textContent=dark?'☀':'☾';button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',dark?'Activar modo claro':'Activar modo oscuro');button.title=button.getAttribute('aria-label');}apply(root.dataset.theme==='dark');button.addEventListener('click',()=>{const dark=root.dataset.theme!=='dark';apply(dark);try{localStorage.setItem('azores-theme',dark?'dark':'light')}catch(e){}});})();

// V9.46: presentación exclusivamente; usa el resumen contable existente.
function azRenderGoals(){
 const f=financesSummary();
 function bar(label,value,target,detail){const pct=target>0?Math.max(0,Math.min(100,value/target*100)):0;return `<div class="az-goal"><div class="az-goal-line"><strong>${label}</strong><span>${money(value)} / ${money(target)}</span></div><progress max="100" value="${pct}" aria-label="${label}"></progress><small>${detail}</small></div>`;}
 document.getElementById('azGoals').innerHTML='<h2>Objetivos económicos</h2>'+bar('Liquidez',f.total,500,f.total>=500?'Objetivo alcanzado · Reserva mínima: 400 €':`Faltan ${money(500-f.total)} · Reserva mínima: 400 €`)+['Aurora','Pedro'].map(w=>bar('Capital · '+w,f.repaid[w],f.capital[w],f.capital[w]>0?`Pendiente: ${money(f.capitalPending[w])}`:'Sin capital aportado')).join('');
}
function azCloseMore(){document.getElementById('azMoreMenu').hidden=true;document.getElementById('azMoreToggle').setAttribute('aria-expanded','false');}
(()=>{const layout=document.getElementById('azDashboardLayout'),toggle=document.getElementById('azMenuToggle');let collapsed=false;try{collapsed=localStorage.getItem('azores-menu-collapsed')==='1'}catch(e){}function apply(){layout.classList.toggle('az-menu-collapsed',collapsed);toggle.setAttribute('aria-expanded',String(!collapsed));toggle.setAttribute('aria-label',collapsed?'Ampliar menú':'Plegar menú');}apply();toggle.addEventListener('click',()=>{collapsed=!collapsed;apply();try{localStorage.setItem('azores-menu-collapsed',collapsed?'1':'0')}catch(e){}});const more=document.getElementById('azMoreToggle'),panel=document.getElementById('azMoreMenu');more.addEventListener('click',()=>{panel.hidden=!panel.hidden;more.setAttribute('aria-expanded',String(!panel.hidden));});document.addEventListener('click',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!more.contains(e.target))azCloseMore();});document.addEventListener('keydown',e=>{if(e.key==='Escape')azCloseMore();});})();

// Entorno de pruebas: impedir acciones de edición en la interfaz.
document.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;if(b.closest("#view")&&activeTab!=="Oportunidades"&&!b.matches("[data-inventory-mode],[data-sales-group]" )||b.matches("#newProduct,#newProductTop,#importBackup,#clearAllPhotos,#registerPushButton,#retrySync")){e.preventDefault();e.stopImmediatePropagation();alert("Entorno de pruebas: utiliza Oportunidades. Los datos reales son de solo lectura.");}},true);
