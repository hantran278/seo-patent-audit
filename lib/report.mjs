// Self-contained interactive HTML report (no external dependencies).
export function renderReport(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SEO Audit · ${esc(data.site.host)}</title>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--ink:#1c1c1a;--mute:#6b6b66;--line:#e4e3de;--accent:#2f5bd3;--high:#c93a2e;--medium:#c7861a;--low:#5b7c99;--info:#7a7a74;--good:#2e8b57;--chip:#efeee9}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#141413;--panel:#1d1d1b;--ink:#ecebe6;--mute:#9a9992;--line:#2e2e2b;--accent:#7b9cff;--high:#ff7b6b;--medium:#f0b44c;--low:#8fb3d1;--info:#9a9992;--good:#5cc98b;--chip:#272724}}
:root[data-theme=dark]{--bg:#141413;--panel:#1d1d1b;--ink:#ecebe6;--mute:#9a9992;--line:#2e2e2b;--accent:#7b9cff;--high:#ff7b6b;--medium:#f0b44c;--low:#8fb3d1;--info:#9a9992;--good:#5cc98b;--chip:#272724}
*{box-sizing:border-box}html,body{overflow-x:hidden}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:28px 24px 8px;max-width:1200px;margin:auto}h1{font-size:24px;margin:0 0 4px}.sub{color:var(--mute);font-size:13px}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);z-index:5}nav div{max-width:1200px;margin:auto;display:flex;gap:4px;padding:0 16px;overflow-x:auto}
nav button{background:none;border:0;border-bottom:2px solid transparent;padding:12px 12px;color:var(--mute);font:inherit;cursor:pointer;white-space:nowrap}nav button.on{color:var(--ink);border-color:var(--accent);font-weight:600}
main{max-width:1200px;margin:auto;padding:20px 16px 60px}section{display:none}section.on{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.big{font-size:44px;font-weight:700;line-height:1}.bar{height:6px;background:var(--chip);border-radius:3px;margin:10px 0 8px;overflow:hidden}.bar i{display:block;height:100%}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.muted{color:var(--mute)}.small{font-size:12.5px}
.sev{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:2px 7px;border-radius:4px;color:#fff}
.sev.high{background:var(--high)}.sev.medium{background:var(--medium)}.sev.low{background:var(--low)}.sev.info{background:var(--info)}
.pill{font-size:12px;background:var(--chip);padding:2px 8px;border-radius:999px;color:var(--mute)}
.issue{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:10px}
.issue summary{list-style:none;cursor:pointer;padding:12px 16px;display:flex;gap:10px;align-items:center}.issue summary::-webkit-details-marker{display:none}
.issue summary .t{flex:1;font-weight:600}.issue .body{padding:0 16px 14px;border-top:1px solid var(--line)}
.issue h4{margin:14px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mute)}
.pat{display:block;background:var(--chip);border-radius:8px;padding:8px 10px;margin:6px 0;font-size:13.5px}.pat b{font-weight:600}.pat a{color:var(--accent);text-decoration:none;margin-left:8px;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{position:sticky;top:44px;background:var(--panel);cursor:pointer;user-select:none;color:var(--mute);font-weight:600}
td.u{word-break:break-all;max-width:520px}.tablewrap{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:75vh}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.filters select,.filters input{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink)}
.chip{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer}.chip.on{background:var(--ink);color:var(--bg)}
.act{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}.act:last-child{border:0}.act .n{color:var(--mute);width:20px}
svg text{fill:var(--mute);font-size:11px}.theme{float:right;margin-left:12px}
.two{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:12px;align-items:start}
@media (max-width:720px){.two{grid-template-columns:minmax(0,1fr)}}
@media (max-width:600px){header{padding:20px 16px 4px}h1{font-size:20px;word-break:break-word}.big{font-size:36px}th{top:0}}
</style>
</head>
<body>
<header>
  <button class="chip theme" onclick="toggleTheme()">◐ Giao diện</button>
  <h1>SEO Audit · ${esc(data.site.host)}</h1>
  <div class="sub">${esc(data.meta.date)} · ${data.site.crawled} URL đã crawl · ${data.site.indexable} trang indexable · dựa trên ${data.meta.patentCount} patent Google</div>
  ${(data.sources || []).filter((s) => s.kind !== 'unknown').length ? `<div class="sub">Dữ liệu nhập: ${data.sources.filter((s) => s.kind !== 'unknown').map((s) => `${esc(s.label)} (${esc(s.name)}, ${s.rows.toLocaleString('vi-VN')} dòng)`).join(' · ')}</div>` : ''}
  ${data.ga4 ? `<div class="sub">GA4 organic (90 ngày): ${data.ga4.sessions.toLocaleString('vi-VN')} phiên · tỷ lệ tương tác ${Math.round(data.ga4.engagementRate * 100)}% · ${data.ga4.keyEvents.toLocaleString('vi-VN')} key event · ${data.ga4.pages.toLocaleString('vi-VN')} landing page</div>` : ''}
</header>
<nav><div id="tabs"></div></nav>
<main>
  <section id="s-overview"></section>
  <section id="s-issues"></section>
  <section id="s-checklist"></section>
  <section id="s-pages"></section>
  <section id="s-gsc"></section>
  <section id="s-backlinks"></section>
  <section id="s-patents"></section>
</main>
<script>
const D = ${json};
const $ = (s, el = document) => el.querySelector(s);
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SEV = {high:'Cao',medium:'Trung bình',low:'Thấp',info:'Thông tin'};
const color = (s) => s === null ? 'var(--info)' : s >= 80 ? 'var(--good)' : s >= 60 ? 'var(--medium)' : 'var(--high)';
function toggleTheme(){const r=document.documentElement;const dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=dark?'light':'dark';try{localStorage.setItem('theme',r.dataset.theme)}catch(e){}}
try{const t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}

const TABS = [['overview','Tổng quan'],['issues','Vấn đề ('+D.issues.filter(i=>i.severity!=='info').length+')'],...(D.checklist?[['checklist','Checklist ('+D.checklist.items.length+')']]:[]),['pages','Trang'],['gsc','GSC'],...(D.backlinks?[['backlinks','Backlink ('+D.backlinks.domains+')']]:[]),['patents','Patent']];
$('#tabs').innerHTML = TABS.map(([k,l]) => '<button data-k="'+k+'">'+l+'</button>').join('');
function show(k){document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.k===k));document.querySelectorAll('section').forEach(s=>s.classList.toggle('on',s.id==='s-'+k));try{sessionStorage.setItem('tab',k)}catch(e){}}
$('#tabs').onclick = (e) => { if (e.target.dataset.k) show(e.target.dataset.k); };

function patentBlock(id){const p=D.patents[id];if(!p)return '<span class="pat"><b>'+id+'</b></span>';
  const obs='obsidian://open?vault='+encodeURIComponent(D.meta.vault)+'&file='+encodeURIComponent('Google Patent Research/01 - Core Patents/'+p.note);
  return '<div class="pat"><b>'+id+'</b> · '+h(p.title)+' <span class="muted small">('+p.year+(p.relevance?' · SEO '+p.relevance:'')+')</span>'+(D.meta.web?'':'<a href="'+obs+'">Mở note ↗</a>')+'<a href="https://patents.google.com/patent/'+id+'/en" target="_blank" rel="noopener">Google Patents ↗</a><div class="muted small" style="margin-top:3px">'+h(p.mech)+'</div></div>';}

function issueCard(i, open){
  const urls = i.urls.length ? '<h4>URL / mục bị ảnh hưởng ('+i.urls.length+')</h4><div class="tablewrap" style="max-height:320px"><table><tbody>'+i.urls.slice(0,300).map(u=>'<tr><td class="u">'+(/^https?:/.test(u.url)?'<a href="'+h(u.url)+'" target="_blank" rel="noopener">'+h(u.url)+'</a>':h(u.url))+'</td><td class="muted">'+h(u.note||'')+'</td></tr>').join('')+'</tbody></table></div>' : '';
  return '<details class="issue"'+(open?' open':'')+'><summary><span class="sev '+i.severity+'">'+SEV[i.severity]+'</span><span class="t">'+h(i.title)+'</span><span class="pill">'+h(D.groups[i.group].label)+'</span></summary><div class="body">'
    +(i.why?'<h4>Vì sao quan trọng</h4><div>'+h(i.why)+'</div>':'')+(i.fix?'<h4>Cách khắc phục</h4><div>'+h(i.fix)+'</div>':'')
    +(i.patents.length?'<h4>Căn cứ patent</h4>'+i.patents.map(patentBlock).join(''):'')+urls+'</div></details>';}

// Overview
(function(){
  const g = Object.values(D.groups);
  const top = D.issues.filter(i=>i.severity!=='info').sort((a,b)=>b.rank-a.rank||b.urls.length-a.urls.length).slice(0,12);
  $('#s-overview').innerHTML = '<div class="two">'
   +'<div class="card"><div class="muted small">Điểm tổng</div><div class="big" style="color:'+color(D.score.overall)+'">'+D.score.overall+'</div><div class="bar"><i style="width:'+D.score.overall+'%;background:'+color(D.score.overall)+'"></i></div><div class="small muted">Trung bình có trọng số (P1×3, P2×2, P3×1). Điểm là chỉ báo ưu tiên, không phải điểm của Google.</div>'
   +'<div class="row" style="margin-top:12px">'+['high','medium','low'].map(s=>'<span class="sev '+s+'">'+D.issues.filter(i=>i.severity===s).length+' '+SEV[s]+'</span>').join('')+'</div></div>'
   +'<div class="card"><div style="font-weight:600;margin-bottom:4px">Việc nên làm trước</div>'+top.map((i,n)=>'<div class="act"><span class="n">'+(n+1)+'</span><div style="flex:1"><div>'+h(i.title)+'</div><div class="small muted">'+h(D.groups[i.group].label)+' · '+D.groups[i.group].priority+' · '+i.patents.slice(0,3).join(', ')+'</div></div><span class="sev '+i.severity+'">'+SEV[i.severity]+'</span></div>').join('')+'</div></div>'
   +'<h3 style="margin:26px 0 10px">Điểm theo nhóm yếu tố</h3><div class="grid">'+g.map(x=>'<div class="card" style="cursor:pointer" onclick="filterGroup(\\''+x.id+'\\')"><div class="row" style="justify-content:space-between"><b>'+h(x.label)+'</b><span class="pill">'+x.priority+'</span></div><div class="row" style="align-items:baseline;gap:6px;margin-top:6px"><span style="font-size:28px;font-weight:700;color:'+color(x.score)+'">'+(x.score===null?'—':x.score)+'</span><span class="small muted">'+(x.score===null?'chưa có dữ liệu':'/100')+'</span></div><div class="bar"><i style="width:'+(x.score||0)+'%;background:'+color(x.score)+'"></i></div><div class="small muted">'+['high','medium','low'].map(s=>x.counts[s]+' '+SEV[s].toLowerCase()).join(' · ')+'</div></div>').join('')+'</div>';
})();

// Issues with filters
let F = {group:'', sev:new Set(['high','medium','low']), q:''};
function filterGroup(g){F.group=g;$('#fg').value=g;renderIssues();show('issues');}
(function(){
  $('#s-issues').innerHTML='<div class="filters"><select id="fg"><option value="">Tất cả nhóm</option>'+Object.values(D.groups).map(g=>'<option value="'+g.id+'">'+h(g.label)+'</option>').join('')+'</select>'
   +['high','medium','low','info'].map(s=>'<button class="chip'+(F.sev.has(s)?' on':'')+'" data-s="'+s+'">'+SEV[s]+'</button>').join('')
   +'<input id="fq" placeholder="Tìm trong vấn đề / URL…" style="flex:1;min-width:180px"></div><div id="il"></div>';
  $('#fg').onchange=e=>{F.group=e.target.value;renderIssues()};$('#fq').oninput=e=>{F.q=e.target.value.toLowerCase();renderIssues()};
  document.querySelectorAll('#s-issues .chip').forEach(b=>b.onclick=()=>{F.sev.has(b.dataset.s)?F.sev.delete(b.dataset.s):F.sev.add(b.dataset.s);b.classList.toggle('on');renderIssues()});
  renderIssues();
})();
function renderIssues(){
  const L=D.issues.filter(i=>(!F.group||i.group===F.group)&&F.sev.has(i.severity)&&(!F.q||(i.title+' '+i.urls.map(u=>u.url+' '+(u.note||'')).join(' ')).toLowerCase().includes(F.q))).sort((a,b)=>b.rank-a.rank||b.urls.length-a.urls.length);
  $('#il').innerHTML=L.length?L.map(i=>issueCard(i,false)).join(''):'<p class="muted">Không có vấn đề nào khớp bộ lọc.</p>';}

// Technical checklist
(function(){
  if(!D.checklist) return;
  const ST=['Chưa đạt','Một phần','Cần kiểm tra thủ công','Đạt','Không áp dụng'];
  const SC={'Chưa đạt':'high','Một phần':'medium','Cần kiểm tra thủ công':'low','Đạt':'good','Không áp dụng':'info'};
  const items=D.checklist.items, sheets=[...new Set(items.map(i=>i.sheet))];
  const cnt=s=>items.filter(i=>i.status===s).length;
  let fs=new Set(['Chưa đạt','Một phần','Cần kiểm tra thủ công']), fsh='', fp='';
  const el=$('#s-checklist');
  el.innerHTML='<div class="grid" style="margin-bottom:14px">'+ST.map(s=>'<div class="card"><div class="small muted">'+s+'</div><div style="font-size:26px;font-weight:700;color:'+(SC[s]==='good'?'var(--good)':'var(--'+SC[s]+')')+'">'+cnt(s)+'</div></div>').join('')+'</div>'
   +'<p class="small muted">Checklist: '+h(D.checklist.file)+' · '+items.filter(i=>i.status!=='Cần kiểm tra thủ công').length+'/'+items.length+' hạng mục được kết luận tự động. '+(D.meta.web?'Tải file Excel đã điền kết quả ở trang công cụ.':'File Excel đã điền kết quả nằm cạnh báo cáo này.')+'</p>'
   +'<div class="filters"><select id="cs"><option value="">Tất cả sheet</option>'+sheets.map(s=>'<option>'+h(s)+'</option>').join('')+'</select><select id="cp"><option value="">Mọi ưu tiên</option><option>P1</option><option>P2</option><option>P3</option></select>'+ST.map(s=>'<button class="chip'+(fs.has(s)?' on':'')+'" data-st="'+s+'">'+s+'</button>').join('')+'</div><div id="cl"></div>';
  const draw=()=>{const L=items.filter(i=>fs.has(i.status)&&(!fsh||i.sheet===fsh)&&(!fp||i.priority===fp));
    const g=[...new Set(L.map(i=>i.sheet))];
    $('#cl').innerHTML=g.length?g.map(s=>'<h3 style="margin:18px 0 8px">'+h(s)+'</h3>'+L.filter(i=>i.sheet===s).map(i=>'<details class="issue"><summary><span class="sev '+(SC[i.status]==='good'?'info':SC[i.status])+'" style="'+(SC[i.status]==='good'?'background:var(--good)':'')+'">'+h(i.status)+'</span><span class="t">'+h(i.item)+' <span class="muted small" style="font-weight:400">· '+h(i.group||'')+'</span></span><span class="pill">'+h(i.priority||'')+'</span>'+(i.auto?'':'<span class="pill">thủ công</span>')+'</summary><div class="body">'
      +'<h4>Tiêu chí</h4><div>'+h(i.criteria||'')+'</div><h4>Kết quả kiểm tra</h4><div>'+h(i.evidence)+'</div>'
      +(i.patents.length?'<h4>Căn cứ patent</h4>'+i.patents.map(patentBlock).join(''):'')
      +(i.urls.length?'<h4>Chi tiết ('+i.urls.length+')</h4><div class="tablewrap" style="max-height:300px"><table><tbody>'+i.urls.map(u=>'<tr><td class="u">'+(/^https?:/.test(u.url)?'<a href="'+h(u.url)+'" target="_blank" rel="noopener">'+h(u.url)+'</a>':h(u.url))+'</td><td class="muted">'+h(u.note||'')+'</td></tr>').join('')+'</tbody></table></div>':'')
      +'<h4>Owner · Giai đoạn · Công cụ</h4><div class="small muted">'+h([i.owner,i.phase,i.tool].filter(Boolean).join(' · '))+'</div></div></details>').join('')).join(''):'<p class="muted">Không có hạng mục nào khớp bộ lọc.</p>';};
  $('#cs').onchange=e=>{fsh=e.target.value;draw()};$('#cp').onchange=e=>{fp=e.target.value;draw()};
  el.querySelectorAll('[data-st]').forEach(b=>b.onclick=()=>{fs.has(b.dataset.st)?fs.delete(b.dataset.st):fs.add(b.dataset.st);b.classList.toggle('on');draw()});
  draw();
})();

// Pages table
(function(){
  const cols=[['url','URL'],['status','Mã'],['depth','Độ sâu'],['words','Số từ'],['inl','Link vào'],['pagerank','PR nội bộ'],['ttfb','TTFB ms'],['n','Vấn đề']];
  let sort=['pagerank',-1],q='';
  $('#s-pages').innerHTML='<div class="filters"><input id="pq" placeholder="Lọc URL…" style="flex:1"></div><div class="tablewrap"><table><thead><tr>'+cols.map(c=>'<th data-c="'+c[0]+'">'+c[1]+'</th>').join('')+'</tr></thead><tbody id="pt"></tbody></table></div>';
  const draw=()=>{const rows=D.pages.filter(p=>!q||p.url.toLowerCase().includes(q)).sort((a,b)=>((a[sort[0]]??-1)>(b[sort[0]]??-1)?1:-1)*sort[1]);
    $('#pt').innerHTML=rows.slice(0,2000).map(p=>'<tr><td class="u"><a href="'+h(p.url)+'" target="_blank" rel="noopener">'+h(p.url)+'</a>'+(p.title?'<div class="muted small">'+h(p.title)+'</div>':'')+'</td><td>'+(p.status??'robots')+'</td><td>'+(p.depth??'–')+'</td><td>'+(p.words??'')+'</td><td>'+p.inl+'</td><td>'+(p.pagerank??'')+'</td><td>'+(p.ttfb??'')+'</td><td>'+(p.n||'')+'</td></tr>').join('');};
  $('#s-pages thead').onclick=e=>{const c=e.target.dataset.c;if(!c)return;sort=[c,sort[0]===c?-sort[1]:-1];draw()};$('#pq').oninput=e=>{q=e.target.value.toLowerCase();draw()};draw();
})();

// GSC
(function(){
  const el=$('#s-gsc');
  if(!D.gsc){el.innerHTML='<div class="card">Chưa có dữ liệu Google Search Console. Chạy lại với <code>--gsc &lt;file.csv&gt;</code> (export GSC → Hiệu suất → Truy vấn, tốt nhất là Truy vấn + Trang) và <code>--brand "tên thương hiệu"</code>.</div>';return;}
  const c=D.gsc.curve, W=640,H=220,P=34, maxY=Math.max(...c.map(x=>x.expected),5);
  const x=i=>P+(W-2*P)*(i/(c.length-1)), y=v=>H-P-(H-2*P)*(v/maxY);
  const pts=D.gsc.points.map(p=>'<circle cx="'+x(Math.min(19,Math.max(0,p.pos-1)))+'" cy="'+y(Math.min(maxY,p.ctr))+'" r="3" fill="'+(p.flag==='under'?'var(--high)':p.flag==='over'?'var(--good)':'var(--line)')+'"><title>'+h(p.q)+' · vị trí '+p.pos.toFixed(1)+' · CTR '+p.ctr.toFixed(1)+'%</title></circle>').join('');
  const svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;max-width:760px">'+[0,.25,.5,.75,1].map(t=>'<line x1="'+P+'" x2="'+(W-P)+'" y1="'+y(maxY*t)+'" y2="'+y(maxY*t)+'" stroke="var(--line)"/><text x="4" y="'+(y(maxY*t)+4)+'">'+(maxY*t).toFixed(0)+'%</text>').join('')
   +c.map((p,i)=>i%2===0?'<text x="'+(x(i)-4)+'" y="'+(H-10)+'">'+p.pos+'</text>':'').join('')+pts
   +'<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="'+c.map((p,i)=>x(i)+','+y(p.expected)).join(' ')+'"/></svg>';
  el.innerHTML='<div class="grid" style="margin-bottom:14px">'+[['Query',D.gsc.summary.queries],['Lượt click',D.gsc.summary.clicks],['Lượt hiển thị',D.gsc.summary.impressions],['Click từ thương hiệu',D.gsc.brand?D.gsc.brand.share+'%':'— (thiếu --brand)']].map(k=>'<div class="card"><div class="muted small">'+k[0]+'</div><div style="font-size:26px;font-weight:700">'+(typeof k[1]==='number'?k[1].toLocaleString('vi-VN'):k[1])+'</div></div>').join('')+'</div>'
   +'<div class="card"><b>CTR theo vị trí</b><div class="small muted">Đường xanh: CTR kỳ vọng (dữ liệu của site trộn với mức trung bình ngành). Chấm đỏ: dưới 60% kỳ vọng · chấm xanh lá: vượt 130% kỳ vọng.</div>'+svg+'</div>'
   +'<h3 style="margin:22px 0 10px">Vấn đề từ dữ liệu GSC</h3>'+D.issues.filter(i=>i.group==='user-signals'||i.group==='query-understanding'||i.id==='low-brand-demand').map(i=>issueCard(i,false)).join('');
})();

// Backlinks: referring domains sorted into DISAVOW / REVIEW / RECHECK / KEEP
(function(){
  const B=D.backlinks, el=$('#s-backlinks'); if(!B) return;
  const V=[['DISAVOW','var(--high)','Đề xuất disavow'],['REVIEW','var(--medium)','Cần xem lại'],['RECHECK','var(--low)','Kiểm tra lại (mất link / thiếu dữ liệu)'],['KEEP','var(--good)','Giữ']];
  const tot=B.domains||1;
  const months=B.months||[], maxM=Math.max(1,...months.map(m=>m.count)), W=520,H=150,bw=(W-20)/Math.max(1,months.length);
  const chart=months.length?'<svg viewBox="0 0 '+W+' '+H+'" style="width:100%">'+months.map((m,i)=>{const hh=(H-34)*m.count/maxM;return '<rect x="'+(10+i*bw+1)+'" y="'+(H-22-hh)+'" width="'+(bw-2)+'" height="'+Math.max(hh,1)+'" rx="2" fill="'+(B.spikes.includes(m.month)?'var(--high)':'var(--line)')+'"><title>'+m.month+': '+m.count+' domain mới</title></rect>'}).join('')+[[0,'start'],[Math.floor(months.length/2),'middle'],[months.length-1,'end']].map(([i,a])=>'<text text-anchor="'+a+'" x="'+(a==='end'?W-10:a==='middle'?10+(i+.5)*bw:10)+'" y="'+(H-6)+'">'+months[i].month+'</text>').join('')+'</svg>':'<p class="muted small">File không có cột First seen.</p>';
  let fv=new Set(['DISAVOW','REVIEW','RECHECK']), q='';
  el.innerHTML='<div class="grid" style="margin-bottom:10px">'+V.map(([k,c,l])=>'<div class="card"><div class="row" style="justify-content:space-between"><b style="color:'+c+'">'+k+'</b><span class="muted small">'+Math.round(100*B.counts[k]/tot)+'%</span></div><div style="font-size:34px;font-weight:700;color:'+c+'">'+B.counts[k]+'</div><div class="small muted">'+l+'</div></div>').join('')+'</div>'
   +'<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:10px">'+V.map(([k,c])=>'<i style="width:'+(100*B.counts[k]/tot)+'%;background:'+c+'"></i>').join('')+'</div>'
   +'<p class="small muted">'+B.domains+' referring domain từ '+B.rows+' dòng dữ liệu. '+(B.method==='jev'?'Nhãn do <b>Jev</b> phân loại '+B.jev.analysed+'/'+B.domains+' domain ('+B.jev.calls+' lần gọi · '+B.jev.inputTokens.toLocaleString('vi-VN')+' token · ~$'+B.jev.cost.toFixed(4)+(B.jev.analysed<B.domains?'; phần còn lại theo quy tắc':'')+'), dựa trên tín hiệu code tự đếm (cụm IP, tháng tăng đột biến, AS/DR…). Confidence không phải tỷ lệ chắc chắn đúng':'Nhãn do <b>quy tắc tự động</b> gán (AS/DR, cụm IP, tháng tăng đột biến, tên miền/đuôi spam, site thống kê, token thương hiệu, ngày thấy link)')+': luôn rà soát trước khi disavow.</p>'
   +'<div class="row" style="margin:10px 0 18px"><button class="chip on" id="dl-disavow">⬇ Tải disavow.txt ('+B.counts.DISAVOW+' domain)</button></div>'
   +'<div class="two" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)"><div class="card"><b>Mạng cùng subnet /24</b> <span class="small muted">(đã bỏ dải CDN)</span><div style="font-size:22px;font-weight:700;margin:4px 0">'+B.clusters.length+' cụm · '+B.clusters.reduce((a,c)=>a+c.domains.length,0)+' domain</div>'
   +(B.clusters.length?B.clusters.slice(0,12).map(c=>'<div class="act"><div style="flex:1"><b>'+h(c.net)+'</b> <span class="muted small">'+c.domains.length+' domain'+(c.avgAs!==null?' · AS TB '+c.avgAs:'')+'</span><div class="small muted" style="word-break:break-all">'+h(c.domains.slice(0,8).join(', '))+(c.domains.length>8?' …':'')+'</div></div></div>').join(''):'<p class="muted small">'+(B.hasIp?'Không có cụm ≥ 3 domain.':'File không có cột IP.')+'</p>')+'</div>'
   +'<div class="card"><b>Domain mới theo tháng</b> <span class="small muted">(24 tháng gần nhất'+(B.spikes.length?' · đỏ: tăng đột biến':'')+')</span>'+chart+'</div></div>'
   +'<h3 style="margin:22px 0 10px">Danh sách referring domain</h3><div class="filters">'+V.map(([k])=>'<button class="chip'+(fv.has(k)?' on':'')+'" data-v="'+k+'">'+k+' · '+B.counts[k]+'</button>').join('')+'<input id="bq" placeholder="Tìm domain / lý do…" style="flex:1;min-width:160px"></div>'
   +'<div class="tablewrap"><table><thead><tr><th>Domain</th><th>Nhãn</th><th>AS/DR</th><th>Link</th><th>IP</th><th>Quốc gia</th><th>First seen</th><th>Last seen</th><th>Lý do</th></tr></thead><tbody id="bt"></tbody></table></div>'
   +(B.gaps||[]).filter(g=>g.gap.length).map(g=>'<h3 style="margin:22px 0 10px">Link gap với '+h(g.host)+' <span class="small muted">('+g.gap.length+' domain link tới đối thủ, chưa link tới bạn)</span></h3><div class="tablewrap" style="max-height:340px"><table><thead><tr><th>Domain</th><th>AS/DR</th><th>Link</th></tr></thead><tbody>'+g.gap.map(d=>'<tr><td>'+h(d.domain)+'</td><td>'+(d.as??'—')+'</td><td>'+d.links+'</td></tr>').join('')+'</tbody></table></div>').join('')
   +'<h3 style="margin:22px 0 10px">Vấn đề backlink</h3>'+D.issues.filter(i=>/^bl-/.test(i.id)).map(i=>issueCard(i,false)).join('');
  const col=Object.fromEntries(V.map(([k,c])=>[k,c]));
  const draw=()=>{$('#bt').innerHTML=B.list.filter(d=>fv.has(d.verdict)&&(!q||(d.domain+' '+d.why.join(' ')).toLowerCase().includes(q))).slice(0,2000).map(d=>'<tr><td class="u">'+h(d.domain)+'</td><td><b style="color:'+col[d.verdict]+'">'+d.verdict+'</b></td><td>'+(d.as??'—')+'</td><td>'+d.links+'</td><td>'+h(d.ip||'')+'</td><td>'+h(d.country||'')+'</td><td>'+h(d.first||'')+'</td><td>'+h(d.last||'')+'</td><td class="small muted">'+h(d.why.join(' · '))+'</td></tr>').join('');};
  el.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{fv.has(b.dataset.v)?fv.delete(b.dataset.v):fv.add(b.dataset.v);b.classList.toggle('on');draw()});
  $('#bq').oninput=e=>{q=e.target.value.toLowerCase();draw()};
  $('#dl-disavow').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([B.disavowTxt],{type:'text/plain'}));a.download='disavow-'+D.site.host+'.txt';a.click();};
  draw();
})();

// Patents referenced
(function(){
  const used={};D.issues.forEach(i=>i.patents.forEach(p=>(used[p]=used[p]||[]).push(i)));
  const ids=Object.keys(used).sort((a,b)=>used[b].length-used[a].length);
  $('#s-patents').innerHTML='<p class="muted">'+ids.length+' patent được dùng làm căn cứ cho các phát hiện trong báo cáo này.'+(D.meta.web?'':' Bấm "Mở note" để xem phân tích đầy đủ trong Obsidian.')+'</p>'+ids.map(id=>patentBlock(id).replace('</div></div>','</div><div class="small" style="margin-top:4px">Căn cứ cho: '+used[id].map(i=>h(i.title)).join(' · ')+'</div></div>')).join('');
})();

let t='overview';try{t=sessionStorage.getItem('tab')||t}catch(e){}show(t);
</script>
</body>
</html>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
