const $=id=>document.getElementById(id);
let project=null, clips=[];
const file=$("file"), preview=$("preview");
$("choose").onclick=()=>file.click();
file.onchange=async()=>{
 const f=file.files[0]; if(!f)return;
 $("message").textContent="Загружаю видео…";
 $("fileInfo").textContent=`${f.name} · ${(f.size/1024/1024).toFixed(1)} МБ`;
 preview.src=URL.createObjectURL(f);preview.style.display="block";
 const data=new FormData();data.append("video",f);
 try{const r=await fetch("/api/upload",{method:"POST",body:data});const j=await r.json();if(!r.ok)throw Error(j.error);
 project=j;$("projectTag").textContent="ПРОЕКТ ГОТОВ";$("add").disabled=false;$("export").disabled=false;
 $("message").textContent=`Видео загружено. SHA-256: ${j.hash.slice(0,18)}…`;
 await loadHistory();
 }catch(e){$("message").textContent="Ошибка: "+e.message}
};
$("add").onclick=()=>{
 const start=Number($("start").value),end=Number($("end").value);
 if(!project)return;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start){$("message").textContent="Проверь начало и конец фрагмента";return}
 clips.push({start,end});render();
};
function render(){
 $("clips").innerHTML="";
 if(!clips.length){$("clips").innerHTML='<div class="empty">Пока нет фрагментов. Добавь первый отрезок.</div>';return}
 clips.forEach((c,i)=>{const el=document.createElement("div");el.className="clip";el.innerHTML=`<span>ФРАГМЕНТ ${String(i+1).padStart(2,"0")} · ${c.start.toFixed(1)} — ${c.end.toFixed(1)} сек</span><button aria-label="Удалить">×</button>`;el.querySelector("button").onclick=()=>{clips.splice(i,1);render()};$("clips").append(el)});
}
$("export").onclick=async()=>{
 if(!project||!clips.length){$("message").textContent="Сначала добавь фрагменты";return}
 $("export").disabled=true;$("message").textContent="Рендерю MP4. Не закрывай страницу…";
 try{const r=await fetch("/api/clips",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:project.id,clips,aspect:$("aspect").value})});const j=await r.json();if(!r.ok)throw Error(j.error);
 $("message").innerHTML="Готово:<br>"+j.exports.map(x=>`<a style="color:#c5ff4a" href="${x.url}" download>${x.name}</a>`).join("<br>");
 await loadHistory();
 }catch(e){$("message").textContent="Ошибка экспорта: "+e.message}
 finally{$("export").disabled=false}
};
async function loadHistory(){
 const box=$("history"); if(!box)return;
 try{
  const r=await fetch("/api/history");const j=await r.json();box.innerHTML="";
  if(!j.items.length){box.innerHTML='<div class="empty">История пока пуста</div>';return}
  j.items.forEach(item=>{
   const el=document.createElement("article");el.className="history-item";
   const date=new Date(item.createdAt).toLocaleString("ru-RU");
   const links=(item.exports||[]).map(x=>`<a href="${x.url}" download>${x.name}</a>`).join(" · ");
   el.innerHTML=`<div><b>${escapeHtml(item.name)}</b><small>${date} · ${item.status}${item.aspect?" · "+item.aspect:""}</small>${links?`<div class="history-links">${links}</div>`:""}</div><span class="history-type">${item.type==="export"?"ЭКСПОРТ":"ИСХОДНИК"}</span>`;
   box.append(el);
  });
 }catch(e){box.innerHTML='<div class="empty">Не удалось загрузить историю</div>'}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$("refreshHistory").onclick=loadHistory;
loadHistory();