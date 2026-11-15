const SUPABASE_URL="https://lsuopaybsfdlofigxlac.supabase.co";
const SUPABASE_KEY="sb_publishable_MEXZiitQlDx4lrh_vV4dag_8sbBKe7O";
const SESSION_KEY="azores-cloud-session-v8";
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
 let r=await fetch(SUPABASE_URL+path,{...options,headers:{...cloudHeaders(cloudSession.access_token),...(options.headers||{})}});
 if(r.status===401){await refreshCloudSession();r=await fetch(SUPABASE_URL+path,{...options,headers:{...cloudHeaders(cloudSession.access_token),...(options.headers||{})}});}
 if(!r.ok){let detail="";try{const j=await r.json();detail=j.message||j.msg||j.error_description||j.error||""}catch(_){}throw Error(detail||"Error de conexión ("+r.status+")");}
 return r;
}
function queueCloudSave(){
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
 localStorage.setItem(KEY,JSON.stringify(products));localStorage.setItem(FIN_KEY,JSON.stringify(finances));
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
 cloudReady=false;cloudSession=null;localStorage.removeItem(SESSION_KEY);
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
const KEY="azores-prototype-products-v1";
let products=JSON.parse(localStorage.getItem(KEY)||"[]");
const FIN_KEY="azores-finances-v7";
let finances=JSON.parse(localStorage.getItem(FIN_KEY)||'{"opening":{"Aurora":0,"Pedro":0},"contributions":[],"withdrawals":[]}');
finances.opening ||= {Aurora:0,Pedro:0};finances.contributions ||= [];finances.withdrawals ||= [];finances.capitalRepayments ||= [];
function saveFin(){localStorage.setItem(FIN_KEY,JSON.stringify(finances));render();queueCloudSave()}
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
let activeTab="Inventario", photoData="", editingId=null, editingSaleId=null, editingShipmentId=null;
const $=s=>document.querySelector(s);
const money=n=>(Number(n)||0).toLocaleString("es-ES",{style:"currency",currency:"EUR"});
function save(){localStorage.setItem(KEY,JSON.stringify(products));render();queueCloudSave()}
function stats(){
 const stock=products.filter(p=>!isSold(p)).length;
 const sold=products.filter(isSold).length;
 const profit=products.reduce((a,p)=>a+(isSold(p)?Number(p.salePrice)-Number(p.purchasePrice||0):0),0);
 $("#stock").textContent=stock;$("#sales").textContent=sold;$("#profit").textContent=money(profit);$("#cash").textContent="—";
}
function isSold(p){return p.salePrice!==""&&p.salePrice!=null}
function productStatus(p){return isSold(p)?"Vendido":(p.status||"Sin vender")}
function render(){
 stats();$("#sectionTitle").textContent=activeTab;
 document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===activeTab));
 const view=$("#view");
 if(activeTab==="Compras"||activeTab==="Inventario"){
   const rows=products.filter(p=>activeTab==="Compras"||!isSold(p));
   if(!rows.length){view.innerHTML=`<div class="empty"><div class="symbol">▧</div><h3>${activeTab==="Compras"?"Todavía no hay compras":"Tu inventario está vacío"}</h3><p>Añade el primer producto para empezar a organizar AZORES.</p><button class="primary" id="emptyAdd">＋ Añadir producto</button></div>`;$("#emptyAdd").onclick=()=>openDialog();return}
   view.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Compra</th><th>Coste</th><th>Cuenta</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${rows.map(p=>`<tr><td><div class="product-cell">${p.photo?`<img class="thumb" src="${p.photo}">`:`<span class="thumb">▧</span>`}<strong>${esc(p.name)}</strong></div></td><td>${p.purchaseDate||"—"}</td><td>${money(p.purchasePrice)}</td><td>${esc(p.account||"—")}</td><td><span class="pill">${esc(productStatus(p))}</span></td><td><div class="action-group"><button type="button" class="edit-product" data-edit="${esc(p.id)}">Editar</button>${!isSold(p)?`<button type="button" class="edit-product" data-sell="${esc(p.id)}">Vender</button><button type="button" class="edit-product delete-product" data-delete="${esc(p.id)}" aria-label="Eliminar compra de ${esc(p.name)}">Eliminar</button>`:""}</div></td></tr>`).join("")}</tbody></table></div>`;
 }else if(activeTab==="Ventas"){
   const sold=products.filter(isSold);
   view.innerHTML=`<div class="action-group" style="margin-bottom:14px"><button class="primary" id="addSale" ${products.some(p=>!isSold(p))?"":"disabled"}>＋ Registrar venta</button></div>${sold.length?`<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Fecha</th><th>Precio venta</th><th>Comprador</th><th>Cobro</th><th>Beneficio</th><th>Acciones</th></tr></thead><tbody>${sold.map(p=>`<tr><td class="sale-product"><div class="product-cell">${p.photo?`<img class="thumb" src="${p.photo}" alt="Foto de ${esc(p.name)}" loading="lazy">`:`<span class="thumb" aria-hidden="true">▧</span>`}<strong>${esc(p.name)}</strong></div></td><td>${esc(p.saleDate||"—")}</td><td>${money(p.salePrice)}</td><td>${esc(p.buyer||"—")}</td><td><span class="pill">${esc(p.paymentStatus||"—")}</span></td><td>${money(Number(p.salePrice)-Number(p.purchasePrice||0))}</td><td><div class="action-group"><button class="edit-product" data-sale-edit="${esc(p.id)}">Editar venta</button><button class="edit-product" data-sale-cancel="${esc(p.id)}">Anular venta</button></div></td></tr>`).join("")}</tbody></table></div>`:`<div class="simple-panel"><strong>Aún no hay ventas</strong><p>Cuando vendas un producto, selecciónalo desde Inventario o pulsa Registrar venta.</p></div>`}`;
   const add=$("#addSale");if(add)add.onclick=()=>openSaleDialog();
 }else if(activeTab==="Envíos"){
   const sold=products.filter(isSold);
   view.innerHTML=sold.length?`<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Comprador</th><th>Transportista</th><th>Nº seguimiento</th><th>Seguimiento</th><th>Acciones</th></tr></thead><tbody>${sold.map(p=>`<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.buyer||"—")}</td><td>${esc(p.shipping?.carrier||"—")}</td><td>${esc(p.shipping?.trackingNumber||"—")}</td><td>${safeTrackingLink(p.shipping?.trackingUrl)}</td><td><button type="button" class="edit-product" data-ship-edit="${esc(p.id)}">Editar envío</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="simple-panel"><strong>Aún no hay envíos</strong><p>Al registrar una venta, su envío aparecerá automáticamente aquí.</p></div>`;
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
   const f=financesSummary();view.innerHTML=`<div class="finance-grid"><article class="finance-box"><small>Beneficio generado por ventas</small><strong>${money(f.profit)}</strong></article><article class="finance-box"><small>Aurora · 60 %</small><strong>${money(f.profit*.6)}</strong></article><article class="finance-box"><small>Pedro · 40 %</small><strong>${money(f.profit*.4)}</strong></article><article class="finance-box"><small>Importe pendiente de cobro</small><strong>${money(f.pending)}</strong></article><article class="finance-box"><small>Capital pendiente · Aurora</small><strong>${money(f.capitalPending.Aurora)}</strong></article><article class="finance-box"><small>Capital pendiente · Pedro</small><strong>${money(f.capitalPending.Pedro)}</strong></article><article class="finance-box"><small>Capital total por devolver</small><strong>${money(f.capitalPending.Aurora+f.capitalPending.Pedro)}</strong></article></div><div class="simple-panel"><h3>Detalle de aportaciones</h3><p>Aurora: aportado <b>${money(f.capital.Aurora)}</b> · devuelto <b>${money(f.repaid.Aurora)}</b> · pendiente <b>${money(f.capitalPending.Aurora)}</b></p><p>Pedro: aportado <b>${money(f.capital.Pedro)}</b> · devuelto <b>${money(f.repaid.Pedro)}</b> · pendiente <b>${money(f.capitalPending.Pedro)}</b></p><p>Las compras pagadas con dinero personal se suman automáticamente al capital de quien las pagó. Las compras pagadas con saldo Vinted no generan aportaciones. Para registrar una devolución real, utiliza Cuentas → Devolución de aportaciones.</p><p>El beneficio se calcula sobre las ventas, aunque el cobro esté pendiente, y es independiente del capital aportado.</p></div>`;
 }else{
   const descriptions={Ventas:"Cuando registremos ventas, aquí aparecerán el precio, comprador, cobro y beneficio de cada operación.",Envíos:"Aquí conectaremos los envíos de los productos vendidos: transportista y enlace directo al seguimiento del paquete.",Cuentas:"Aquí calcularemos los movimientos, aportaciones y dinero disponible, respetando las cuentas de Aurora y Pedro.",Beneficios:"Aquí aparecerán los beneficios y el reparto acordado: 60 % Aurora y 40 % Pedro."};
   view.innerHTML=`<div class="simple-panel"><strong>${activeTab}</strong><p>${descriptions[activeTab]}</p><small>Esta sección se activará al conectar los datos con Compras e Inventario.</small></div>`;
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
 const form=$("#productForm");form.reset();
 photoData=p?.photo||"";
 form.elements.name.value=p?.name||"";
 form.elements.purchaseDate.value=p?.purchaseDate||"";
 form.elements.purchasePrice.value=p?.purchasePrice||"";
 form.elements.origin.value=p?.origin||"";
 form.elements.account.value=p?.account||"";
 form.elements.purchaseMethod.value=p?.purchaseMethod||"Vinted";
 form.elements.status.value=p?productStatus(p):"Sin vender";
 form.elements.status.disabled=!!p&&isSold(p);
 $("#photoPreview").innerHTML=photoData?`<img src="${photoData}" alt="Vista previa">`:"";
 $("#dialogTitle").textContent=p?"Editar producto":"Nuevo producto";
 $("#saveProductButton").textContent=p?"Guardar cambios":"Guardar producto";
 dialog.showModal();
}
$("#newProduct").onclick=()=>openDialog();$("#newProductTop").onclick=()=>openDialog();$("#closeDialog").onclick=()=>dialog.close();$("#cancelDialog").onclick=()=>dialog.close();
document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{activeTab=b.dataset.tab;render()}));
$("#productForm [name=photo]").addEventListener("change",e=>{const f=e.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=()=>{photoData=reader.result;$("#photoPreview").innerHTML=`<img src="${photoData}" alt="Vista previa">`};reader.readAsDataURL(f)});
$("#view").addEventListener("click",e=>{const b=e.target.closest("[data-edit]");if(b)openDialog(b.dataset.edit);const sell=e.target.closest("[data-sell]");if(sell)openSaleDialog(sell.dataset.sell);const editSale=e.target.closest("[data-sale-edit]");if(editSale)openSaleDialog(editSale.dataset.saleEdit,true);const cancel=e.target.closest("[data-sale-cancel]");if(cancel)cancelSale(cancel.dataset.saleCancel);const ship=e.target.closest("[data-ship-edit]");if(ship)openShippingDialog(ship.dataset.shipEdit);const del=e.target.closest("[data-delete]");if(del)deletePurchase(del.dataset.delete)});
function deletePurchase(id){
 if(!cloudReady){alert("Espera a que se conecte Supabase antes de eliminar una compra.");return;}
 if(cloudDirty||cloudSaving){alert("Hay cambios pendientes de sincronizar. Espera a que aparezca 'Sincronizado en Supabase' antes de eliminar.");return;}
 const p=products.find(x=>x.id===id);
 if(!p)return;
 if(isSold(p)){alert("Esta compra tiene una venta registrada. Primero anula la venta si realmente quieres eliminar la compra.");return;}
 if(!confirm(`¿Eliminar definitivamente la compra de "${p.name}"?\n\nSe quitará también del inventario y se recalcularán las cuentas. Esta acción no se puede deshacer desde la aplicación.\n\n¿Quieres continuar?`))return;
 products=products.filter(x=>x.id!==id);
 save();
}
$("#productForm").addEventListener("submit",e=>{
 e.preventDefault();const f=new FormData(e.currentTarget);
 const fields={name:f.get("name"),purchaseDate:f.get("purchaseDate"),purchasePrice:f.get("purchasePrice"),origin:f.get("origin"),account:f.get("account"),purchaseMethod:f.get("purchaseMethod"),status:editingId&&products.find(x=>x.id===editingId)&&isSold(products.find(x=>x.id===editingId))?"Vendido":f.get("status"),photo:photoData};
 if(editingId){const p=products.find(item=>item.id===editingId);if(!p)return;Object.assign(p,fields)}
 else products.push({id:crypto.randomUUID(),...fields,salePrice:""});
 save();dialog.close();activeTab="Inventario";render();
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
 saleForm.elements.receivingAccount.value=edit?receiver(p)||"":normalizedAccount(p?.account)||"";
 $("#saleDialogTitle").textContent=edit?"Editar venta":"Registrar venta";
 updateSaleSummary();saleDialog.showModal();
}
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
 p.paymentStatus=saleForm.elements.paymentStatus.value;
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
 shippingForm.elements.trackingNumber.value=p.shipping?.trackingNumber||"";
 shippingForm.elements.trackingUrl.value=p.shipping?.trackingUrl||"";
 shippingDialog.showModal();
}
$("#closeShippingDialog").onclick=()=>shippingDialog.close();
$("#cancelShippingDialog").onclick=()=>shippingDialog.close();
shippingForm.addEventListener("submit",e=>{
 e.preventDefault();const p=products.find(x=>x.id===editingShipmentId);if(!p||!isSold(p))return;
 const f=new FormData(shippingForm);
 p.shipping={carrier:String(f.get("carrier")||"").trim(),trackingNumber:String(f.get("trackingNumber")||"").trim(),trackingUrl:String(f.get("trackingUrl")||"").trim()};
 save();shippingDialog.close();
});
render();
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(()=>{});


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
   const data={format:backupFormat,exportedAt:new Date().toISOString(),products:JSON.parse(localStorage.getItem(KEY)||"[]"),finances:finances};
   if(!Array.isArray(data.products)||!data.products.every(validProduct)||!validFinance(data.finances))throw Error("Los datos actuales no tienen un formato válido");
   const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
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
