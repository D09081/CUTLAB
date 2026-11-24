const $=id=>document.getElementById(id);
let project=null, clips=[], suggestions=[], hasCaptions=false;
const file=$("file"), preview=$("preview");
$("choose").onclick=()=>file.click();
function say(s){$("message").textContent=s}
function setReady(){
 $("analyze").disabled=false;$("transcribe").disabled=false;$("add").disabled=false;$("export").disabled=false;
 $("setStart").disabled=false;$("setEnd").disabled=false;$("uploadSrt").disabled=false;
 $("projectTag").textContent="ПРОЕКТ ГОТОВ";
}
function setProject(j){
 project=j;try{localStorage.setItem("cutlab:lastProject",j.id)}catch{}clips=[];suggestions=[];render();setReady();
 preview.src="/api/source/"+j.id;preview.style.display="block";preview.load();
 $("start").value=0;$("end").value=30;
 $("fileInfo").textContent=(j.name||"Видео")+(j.size?" · "+(j.size/1024/1024).toFixed(1)+" МБ":"");
 $("captionStatus").textContent="НЕ ДОБАВЛЕНЫ";hasCaptions=false;
 $("suggestions").innerHTML='<div class="empty">Нажми «Найти лучшие моменты», чтобы получить предложения.</div>';
}
$("importUrl").onclick=async()=>{
 const url=$("sourceUrl").value.trim();if(!url)return say("Вставь ссылку на видео.");
 $("importUrl").disabled=true;say("Импортирую видео. Это может занять несколько минут…");
 try{const r=await fetch("/api/import-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url})}),j=await r.json();if(!r.ok)throw Error(j.error);setProject(j);say("Импорт завершён. Теперь найди лучшие моменты или нарежь видео вручную.");await loadHistory();}
 catch(e){say("Не удалось импортировать: "+e.message)}finally{$("importUrl").disabled=false}
};
file.onchange=async()=>{
 const f=file.files[0];if(!f)return;
 say("Загружаю видео на сервер…");$("fileInfo").textContent=f.name+" · "+(f.size/1024/1024).toFixed(1)+" МБ";
 const data=new FormData();data.append("video",f);
 try{const r=await fetch("/api/upload",{method:"POST",body:data}),j=await r.json();if(!r.ok)throw Error(j.error);setProject(j);say("Видео загружено. Можно запускать анализ.");await loadHistory();}
 catch(e){say("Ошибка загрузки: "+e.message)}
};
$("setStart").onclick=()=>{$("start").value=preview.currentTime.toFixed(1)};
$("setEnd").onclick=()=>{$("end").value=preview.currentTime.toFixed(1)};
$("analyze").onclick=async()=>{
 if(!project)return;say("Анализирую смены сцен. Подожди…");$("analyze").disabled=true;
 try{const r=await fetch("/api/analyze/"+project.id,{method:"POST"}),j=await r.json();if(!r.ok)throw Error(j.error);suggestions=j.suggestions||[];renderSuggestions();say("Анализ готов: "+suggestions.length+" предложений. "+(j.warning||"Выбери подходящие моменты."));}
 catch(e){say("Не удалось проанализировать: "+e.message)}finally{$("analyze").disabled=false}
};
function renderSuggestions(){
 const box=$("suggestions");box.innerHTML="";
 if(!suggestions.length){box.innerHTML='<div class="empty">Яркие смены сцен не найдены. Попробуй ручную нарезку.</div>';return}
 suggestions.forEach((s,i)=>{
  const el=document.createElement("div");el.className="suggestion";
  el.innerHTML='<div><b>Момент '+(i+1)+'</b><small>'+s.start.toFixed(1)+'–'+s.end.toFixed(1)+' сек · '+escapeHtml(s.reason||"Предложение")+'</small></div><button class="secondary">Добавить</button>';
  el.querySelector("button").onclick=()=>{if(!clips.some(c=>Math.abs(c.start-s.start)<.2)){clips.push({start:s.start,end:s.end});render();say("Фрагмент добавлен в монтаж.");}};
  el.querySelector("div").onclick=()=>{preview.currentTime=s.start;preview.play().catch(()=>{});};
  box.append(el);
 });
}
$("transcribe").onclick=async()=>{
 if(!project)return;say("Распознаю речь. Это может занять несколько минут…");$("transcribe").disabled=true;
 try{const r=await fetch("/api/transcribe/"+project.id,{method:"POST"}),j=await r.json();if(!r.ok)throw Error(j.error);
 hasCaptions=true;$("captionStatus").textContent=j.count+" ФРАЗ";say("Субтитры готовы. При экспорте включено вшивание, если сервер поддерживает его.");await loadHistory();
 }catch(e){say(e.message)}finally{$("transcribe").disabled=false}
};
$("uploadSrt").onclick=async()=>{
 if(!project)return;const f=$("srtFile").files[0];if(!f)return say("Сначала выбери файл .SRT");
 try{const srt=await f.text(),r=await fetch("/api/captions/"+project.id,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({srt})}),j=await r.json();if(!r.ok)throw Error(j.error);
 hasCaptions=true;$("captionStatus").textContent=j.count+" ФРАЗ";say("Субтитры загружены: "+j.count+" фраз.");await loadHistory();
 }catch(e){say("Ошибка субтитров: "+e.message)}
};
$("add").onclick=()=>{
 if(!project)return;const start=Number($("start").value),end=Number($("end").value);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)return say("Проверь начало и конец фрагмента.");
 clips.push({start,end});render();say("Фрагмент добавлен.");
};
function render(){
 const box=$("clips");box.innerHTML="";
 if(!clips.length){box.innerHTML='<div class="empty">Пока нет фрагментов. Выбери предложение или добавь вручную.</div>';return}
 clips.forEach((c,i)=>{
  const el=document.createElement("div");el.className="clip";
  el.innerHTML='<div><b>ФРАГМЕНТ '+String(i+1).padStart(2,"0")+'</b><small>'+c.start.toFixed(1)+' — '+c.end.toFixed(1)+' сек</small></div><div class="clip-actions"><button class="previewClip">▶</button><button class="removeClip" aria-label="Удалить">×</button></div>';
  el.querySelector(".previewClip").onclick=()=>{preview.currentTime=c.start;preview.play().catch(()=>{});};
  el.querySelector(".removeClip").onclick=()=>{clips.splice(i,1);render()};
  box.append(el);
 });
}
$("export").onclick=async()=>{
 if(!project||!clips.length)return say("Сначала добавь фрагменты.");
 $("export").disabled=true;say("Собираю "+clips.length+($("makeVariants").checked?" × 2 версии":"")+" роликов. Не закрывай страницу…");
 try{
  const r=await fetch("/api/clips",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:project.id,clips,aspect:$("aspect").value,burnSubtitles:$("burnSubtitles").checked,editorName:$("editorName").value,makeVariants:$("makeVariants").checked})}),j=await r.json();if(!r.ok)throw Error(j.error);
  const box=$("message");box.innerHTML="<b>Готово! Забирай ролики:</b>";
  j.exports.forEach(x=>{
   const row=document.createElement("div");row.className="download-row";
   const a=document.createElement("a");a.href=x.url;a.download=x.name;a.textContent="↓ "+x.name;row.append(a);
   if(x.subtitleUrl){const s=document.createElement("a");s.href=x.subtitleUrl;s.download=x.name+".srt";s.textContent="Субтитры SRT";row.append(s);}
   const note=document.createElement("small");note.textContent=x.burned?"Субтитры вшиты в видео":"Субтитры отдельным файлом (если добавлены)";row.append(note);box.append(row);
  });
  await loadHistory();
 }catch(e){say("Ошибка экспорта: "+e.message)}finally{$("export").disabled=false}
};
async function loadHistory(){
 const box=$("history");if(!box)return;
 try{const r=await fetch("/api/history"),j=await r.json();box.innerHTML="";
  if(!j.items.length){box.innerHTML='<div class="empty">История пока пуста</div>';return}
  j.items.forEach(item=>{
   const el=document.createElement("article");el.className="history-item";
   const date=new Date(item.createdAt).toLocaleString("ru-RU");
   const links=(item.exports||[]).map(x=>'<a href="'+x.url+'" download>'+escapeHtml(x.name)+'</a>').join(" · ");
   el.innerHTML='<div><b>'+escapeHtml(item.name)+'</b><small>'+date+' · '+escapeHtml(item.status)+(item.aspect?" · "+item.aspect:"")+'</small>'+(links?'<div class="history-links">'+links+'</div>':"")+'</div><span class="history-type">'+(item.type==="export"?"ЭКСПОРТ":item.type==="import"?"ИМПОРТ":item.type==="captions"?"СУБТИТРЫ":"ИСХОДНИК")+'</span>';
   box.append(el);
  });
 }catch(e){box.innerHTML='<div class="empty">Не удалось загрузить историю</div>'}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$("refreshHistory").onclick=loadHistory;
async function restoreProject(){
 const id=localStorage.getItem("cutlab:lastProject");if(!id)return;
 try{
  const r=await fetch("/api/jobs/"+encodeURIComponent(id)),j=await r.json();if(!r.ok)throw Error(j.error||"Проект недоступен");
  const x=j.job;setProject({id:x.id,name:x.name,size:x.size,hash:x.hash});
  if(x.captions){hasCaptions=true;$("captionStatus").textContent=x.captions.count+" ФРАЗ"}
  say("Последний проект восстановлен. Можно продолжать монтаж.");
 }catch(e){
  localStorage.removeItem("cutlab:lastProject");
  say("Предыдущий проект недоступен на сервере. Загрузи исходник заново.");
 }
}
loadHistory();restoreProject();