'use strict';
let data;
let openTeamId=null, refreshPending=null, baseSnapshot=null, liveSnapshot=null;
let creatorQuery = "", rainPaused = false;
let gwSelection, monthSelection, priceManagerSelection;
const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (n, digits = 0) => n == null ? '—' : Number(n).toLocaleString(undefined, {maximumFractionDigits:digits});
const movement = n => `<span class="movement ${n > 0 ? 'up' : n < 0 ? 'down' : 'neutral'}" aria-label="${n == null ? 'No previous rank' : n > 0 ? `Up ${n} places` : n < 0 ? `Down ${-n} places` : 'No change'}">${n > 0 ? '↑ '+n : n < 0 ? '↓ '+Math.abs(n) : '—'}</span>`;
const medal = rank => `<span class="rank-badge r${rank}" ${rank <= 3 ? `aria-label="${['','Gold','Silver','Bronze'][rank]}, position ${rank}"` : ''}>${rank}</span>`;
const person = (m, avatar = false, showChips = false) => `<div class="manager-cell">${avatar ? `<span class="avatar" aria-hidden="true">${esc([m.name.trim().split(/\s+/)[0],m.name.trim().split(/\s+/).at(-1)].map(x=>x?.[0]||'').join('').toUpperCase())}</span>` : ''}<button class="manager-btn" data-manager="${m.id}"><strong>${esc(m.creator?m.name:m.team)}</strong><small>${esc(m.creator?m.team:m.name)}</small>${showChips ? chipBadges(m) : ''}</button></div>`;
const empty = message => `<div class="empty">${message}</div>`;
function table(headers, rows, cls = '') { return `<div class="table-scroll ${cls}" tabindex="0" aria-label="Scrollable statistics table"><table><thead><tr>${headers.map((h,i)=>`<th scope="col" aria-sort="none"><button class="sort-button" data-sort="${i}" aria-label="Sort by ${esc(h==='↕'?'Movement':h)}">${h==='↕'?'Move':h}<span class="sort-arrow" aria-hidden="true">↕</span></button></th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`; }
const cell = (x, cls = '', sortValue) => `<td class="${cls}"${sortValue!==undefined?` data-sort-value="${esc(sortValue)}"`:''}>${x}</td>`;
const row = (cells, cls='') => `<tr class="${cls}">${cells.join('')}</tr>`;
function heading(title, description, control = '') { return `<div class="page-heading"><div><p class="eyebrow">${esc(data.season)} SEASON / LEAGUE ${data.league_id}</p><h1>${esc(title)}</h1><p class="subtext">${description}</p></div>${control || `<span class="pill"><i></i>${data.latest_completed ? `GW ${data.latest_completed} complete` : 'Season warming up'}</span>`}</div>`; }
function spark(history) { if(!history.length) return ''; const values=history.map(r=>r.net); const lo=Math.min(...values)-5, hi=Math.max(...values)+5; return `<svg class="spark" viewBox="0 0 230 58" role="img" aria-label="Recent scores: ${values.join(', ')}"><line x1="0" x2="230" y1="54" y2="54"/><polyline points="${values.map((v,i)=>`${values.length===1?115:5+i*220/(values.length-1)},${50-(v-lo)/(hi-lo)*45}`).join(' ')}"/></svg>`; }
function award(label, managers, value, detail='', options={}) {
 if(!managers.length) return '';
 return `<article class="stat-card"><p class="label">${label}</p><p class="stat ${options.color||''}">${value}</p><ul class="award-teams">${managers.map(m=>`<li>${person(m)}${options.failures ? failureBreakdown(m) : ''}${options.gws ? gwSuffix(m[options.gws]) : ''}</li>`).join('')}</ul><p class="detail">${detail}</p></article>`;
}
function failureBreakdown(m) { const counts={}; (m.captain_failure_details||[]).forEach(r=>counts[r.player]=(counts[r.player]||0)+1); return `<small class="failure-detail">${Object.entries(counts).map(([name,count])=>`${esc(name)} × ${count}`).join(' · ')}</small>`; }
function gwSuffix(gws=[]) { return gws.length ? `<span class="gw-ref">(${gws.map(gw=>'GW'+num(gw)).join(', ')})</span>` : ''; }
function scoreWithGW(m, key) { return `${num(m[key])} ${gwSuffix(m[key+'_gws'])}`; }
function chipBadges(m) { return `<span class="chip-badges">${(m.chips||[]).map(c=>`<span class="chip-token chip-${esc(c.name)}" title="${esc(chipName(c.name))} · GW${c.gw}">${({bboost:'BB','3xc':'TC',wildcard:'WC',freehit:'FH'})[c.name]||esc(c.name)}${c.gw}</span>`).join('')}</span>`; }
function ft(m) { return m.ft==null||!m.ft_gw ? '—' : `<span class="ft-number" title="Calculated allowance entering GW${m.ft_gw}, before private transfers since the last deadline">${m.ft}/${m.ft_cap}<sup>*</sup></span>`; }
const ftNote = 'FTs* are the calculated allowance entering the next GW. Private transfers since the last deadline may reduce the remaining balance.';
const liveNote = 'Live rank is the latest public overall FPL rank at the snapshot time; snapshots refresh approximately every 15 minutes around matches and every 6 hours otherwise. Scheduled updates can be delayed.';
function playerTile(p, subtitle='') { return `<div class="player-tile"><span class="portrait" aria-hidden="true"><span>${esc(p.name.slice(0,2))}</span>${p.photo?`<img class="player-photo" src="${esc(p.photo)}" alt="" loading="lazy" width="36" height="46" referrerpolicy="no-referrer">`:''}</span><span><strong>${esc(p.name)}</strong><small>${subtitle||esc(p.team)}</small></span></div>`; }
function mvpCell(m) { return m.mvp?.length ? m.mvp.map(p=>playerTile(p,`${num(p.points)} pts earned`)).join('') : `<span class="muted">${m.completed_count ? 'Unavailable' : '—'}</span>`; }

function best(items, key, low = false) { const available=items.filter(m=>m[key]!=null); if(!available.length)return []; const target=(low?Math.min:Math.max)(...available.map(m=>m[key])); return available.filter(m=>m[key]===target); }
const sortedManagers = () => [...data.managers].sort((a,b)=>a.rank-b.rank);
function projectionTable(compact=false) {
 const ms = data.managers.filter(m=>m.projected_total!=null).sort((a,b)=>a.projected_position-b.projected_position);
 if(!ms.length)return empty('Projections will appear after the first completed Gameweek.');
 const max=Math.max(1,...ms.map(m=>m.projected_total));
 return table(compact?['Projected','Manager','Current rank','Projected total','Change']:['Finish','Manager','Current points','Current rank','Projected total','Change'],ms.map(m=>row([
 cell(medal(m.projected_position),'rank-cell'),cell(person(m)),...(!compact?[cell(num(m.total),'numeric')]:[]),cell('#'+m.rank,'numeric'),
 cell(`<div class="projection-bar"><span>${num(m.projected_total)}</span><div class="power-track"><i style="width:${Math.max(0,m.projected_total)/max*100}%"></i></div></div>`),cell(movement(m.rank-m.projected_position),'',m.rank-m.projected_position)])));
}
function currentSquadValue(m) {
 const prices=new Map((data.prices?.players||[]).map(p=>[p.id,p.price]));
 const squad=m.public_team?.players;
 if(!squad||squad.length!==15||m.public_team.stale||squad.some(p=>!Number.isFinite(prices.get(p.id))))return null;
 return Math.round(squad.reduce((sum,p)=>sum+prices.get(p.id),0)*10)/10;
}
function squadValueCell(m) {
 const squad=currentSquadValue(m);
 const value=squad==null||m.bank==null?null:Math.round((squad+m.bank)*10)/10;
 return cell(value==null?'—':'£'+num(value,1)+'m','',value??'');
}
function wealthAward(ms) {
 const eligible=ms.map(m=>{
  const value=currentSquadValue(m);
  return value==null||m.bank==null?null:{...m,wealth:Math.round((value+m.bank)*10)/10};
 });
 if(eligible.some(m=>!m))return '';
 const winners=best(eligible,'wealth');
 return award('💵 Ambani amongst us',winners,'£'+num(winners[0]?.wealth,1)+'m','Current prices of the last public squad + bank at its deadline. Transfers since that deadline are private.');
}
function ownershipAwards(ms){
 const players=new Map((data.prices?.players||[]).map(p=>[p.id,p]));
 const rows=ms.map(m=>{
  const squad=m.public_team?.players;
  if(!squad||squad.length!==15||m.public_team.stale||squad.some(p=>!players.has(p.id)||!Number.isFinite(players.get(p.id).ownership)))return null;
  return {...m, differential_count:squad.filter(p=>players.get(p.id).ownership<5&&!(p.role===1&&players.get(p.id).price<=4)).length,
   template_ownership:Math.round(squad.reduce((sum,p)=>sum+players.get(p.id).ownership,0)*10)/10};
 });
 if(!rows.length||rows.some(m=>!m))return '';
 const differentials=best(rows,'differential_count'),template=best(rows,'template_ownership');
 return award('🔮 Eno amongst us',differentials,num(differentials[0].differential_count)+' players','Under 5% overall FPL ownership · public 15-player squad · excludes goalkeepers priced £4.0m or less')+
  award('🤖 Bakar amongst us',template,num(template[0].template_ownership,1)+'% <small class="stat-unit">EO</small>','EO here uses combined overall FPL ownership across all 15 public squad players; captain multipliers are not included.');
}
function home() {
 const ms=sortedManagers(), arrows=ms.map(m=>{const latest=m.history.find(r=>r.gw===data.latest_completed), previous=m.history.find(r=>r.gw===data.latest_completed-1);return {...m,last_gw_arrow:latest?.overall_rank&&previous?.overall_rank?(previous.overall_rank-latest.overall_rank)/previous.overall_rank*100:null};}), last=data.gameweeks.at(-1), winner=last?best(last.rows,'net'):[], high=best(ms,'best_gw_rank',true), low=best(ms,'worst_gw_rank'), up=best(arrows.filter(m=>m.last_gw_arrow>0),'last_gw_arrow'), down=best(arrows.filter(m=>m.last_gw_arrow<0),'last_gw_arrow',true), power=best(ms,'power')[0];
 return `<section class="home-hero">${heading(data.name, `${ms.length} managers. One league. Everything to play for.`)}</section>`+
 `<div class="layout"><section class="panel"><div class="panel-heading"><h2>League standings</h2><span class="subtext">${data.in_progress?'Provisional':'Overall'}</span></div>${ms.length?table(['Pos','Manager / team','Total','Last GW','Live rank','FTs*','↕'],ms.map(m=>row([cell(medal(m.rank),'rank-cell'),cell(person(m,true,true),'standing-manager'),cell(num(m.total),'numeric total'),cell(num(m.latest_score),'numeric'),cell(num(m.live_rank),'numeric'),cell(ft(m)),cell(movement(m.movement),'movement-cell',m.movement??'')],m.rank===1?'leader-row':m.rank===7?'seventh-row':m.rank===ms.at(-1).rank?'last-row':'')),'standings rank-portraits'):empty('No managers have scored yet.')}<p class="table-note">Last GW = points after hits. Swipe the table for FTs and live ranks. Select a manager for their stats.</p><p class="table-note">${ftNote} ${liveNote}</p></section>
 <aside class="side-stack">${winner.length?`<section class="panel spotlight"><span class="award-icon" aria-hidden="true">🏆</span><p class="eyebrow">GAMEWEEK ${last.id} / WINNER${winner.length>1?'S':''}</p><h2>${winner.map(m=>person(m)).join('')}</h2><div class="hero-score">${num(winner[0].net)}<span>net points</span></div><p class="subtext muted">This week's bragging rights.</p></section>`:''}
 ${power?`<section class="panel side-card"><p class="eyebrow">THE FORM GUIDE</p><h3>Setting the pace</h3><div class="power-mini">${person(power)}<span class="power-number">${power.power}</span></div><div class="power-track"><i style="width:${power.power}%"></i></div><p>Power Rating <button class="tooltip power-info" data-power-info aria-label="About Power Rating">ⓘ</button> · ${power.form}</p>${spark(power.recent)}</section>`:''}
 <section class="panel side-card"><p class="eyebrow">THE LONG GAME</p><h3>${data.completed_count} down. ${data.total_gameweeks-data.completed_count} to go.</h3><p>A few green arrows can change everything.</p><div class="power-track"><i style="width:${data.completed_count/data.total_gameweeks*100}%"></i></div></section></aside></div>
 <section class="section"><div class="section-title"><h2>Around the league</h2><span class="subtext">The talking points</span></div><div class="cards">
 ${award('👑 Current league leader',ms.filter(m=>m.rank===1),num(ms[0]?.total)+' pts')}
 ${award('🌍 Best GW of the season',high,num(high[0]?.best_gw_rank)+(high.length===1?' '+gwSuffix(high[0].best_gw_rank_gws):''),'Best overall FPL Gameweek rank',{gws:high.length>1?'best_gw_rank_gws':null})}
 ${award('📈 Biggest green arrow last GW',up,up.length?'↑ '+num(up[0].last_gw_arrow,1)+'%':'','Overall rank improvement in GW'+data.latest_completed,{color:'up'})}
 ${award('📉 Biggest red arrow last GW',down,down.length?'↓ '+num(Math.abs(down[0].last_gw_arrow),1)+'%':'','Overall rank decline in GW'+data.latest_completed,{color:'down'})}
 ${award('🪑 Most bench points',best(ms,'bench'),num(best(ms,'bench')[0]?.bench)+' pts','Completed Gameweeks')}
 ${award('🫙 The Ghee Khatam GW',low,num(low[0]?.worst_gw_rank)+(low.length===1?' '+gwSuffix(low[0].worst_gw_rank_gws):''),'Worst overall FPL Gameweek rank',{gws:low.length>1?'worst_gw_rank_gws':null})}
 ${ownershipAwards(ms)}
 ${wealthAward(ms)}
 </div></section><section class="section panel"><div class="panel-heading"><h2>Projected final standings</h2><a class="text-link" href="#predictions">The full picture ↗</a></div>${projectionTable(true)}<p class="table-note">Illustrative season projection using recent form, season form and chips remaining — not a guarantee.</p></section>`;
}
function liveWeek(){
 if(!data.in_progress||!data.current_gw)return null;
 const rows=data.managers.flatMap(m=>{
 const t=m.public_team;if(t?.gw!==data.current_gw||t.stale||!t.entry_history)return [];
 const h=t.entry_history, captain=t.players.find(p=>p.multiplier>1);
 if(t.players.some(p=>p.earned==null))return [];
 const gross=t.players.reduce((n,p)=>n+p.earned,0),hits=h.event_transfers_cost||0,net=gross-hits;
 const previous=m.history.at(-1)?.total||0;
 return [{...m,gross,hits,net,total:previous+net,captain:captain?.name,captain_points:captain?.earned,bench:t.players.filter(p=>p.multiplier===0).reduce((n,p)=>n+(p.points||0),0),transfers:h.event_transfers,chip:t.chip,movement:null}];
 });
 const overall=[...rows].sort((a,b)=>b.total-a.total);overall.forEach((r,i)=>r.league_rank=i&&r.total===overall[i-1].total?overall[i-1].league_rank:i+1);
 rows.sort((a,b)=>b.net-a.net);rows.forEach((r,i)=>r.gw_rank=i&&r.net===rows[i-1].net?rows[i-1].gw_rank:i+1);
 return {id:data.current_gw,provisional:true,deadline:data.current_deadline||data.updated_at,rows};
}
function drama(){
 const week=liveWeek(),ms=week?.rows||[], fixtures=(data.live_fixtures||[]).filter(f=>f.gw===data.current_gw);
 const current=fixtures.filter(f=>f.started&&!f.finished);
 return heading('Live drama','The scores, the armbands, the changing mood.',`<span class="pill"><i></i>GW ${data.current_gw||'—'} · ${current.length?'Matches in progress':data.in_progress?'Gameweek in progress':'Latest results'}</span>`)+
 `<p class="source-note">Snapshot: ${new Date(data.updated_at).toLocaleString()}. Live scores aim to refresh every minute during Saturday/Sunday matches, and every 15 minutes on other matchdays. Startup and FPL delays are possible. Official overall ranks refresh separately, roughly every 15 minutes. Points, bonus and autosubs remain provisional until FPL finalises them.</p>`+
 `<div class="cards">${fixtures.map(f=>`<article class="stat-card"><p class="label">${f.finished?'FULL TIME':f.started?'IN PLAY':f.kickoff?new Date(f.kickoff).toLocaleString(): 'KICKOFF TBC'}</p><p class="stat">${esc(f.home)} ${f.started?`${num(f.home_score)} – ${num(f.away_score)}`:'v'} ${esc(f.away)}</p></article>`).join('')}</div>${data.fixtures_stale?'<p class="notice">Match scores could not refresh. Showing the last saved fixtures.</p>':''}`+
 `<section class="section panel"><div class="panel-heading"><h2>The league right now</h2><span class="subtext">${ms.length} / ${data.managers.length} squads updated</span></div>${ms.length?table(['GW pos','Manager / team','GW points','Captain','Captain pts','Hit cost','Provisional total','View team'],ms.map(m=>row([cell(medal(m.gw_rank)),cell(person(m)),cell(num(m.net),'total'),cell(esc(m.captain||'—')),cell(num(m.captain_points)),cell(num(m.hits)),cell(num(m.total)),cell(`<button class="action-button" data-team="${m.id}">View GW${week.id} team</button>`)]))):empty(data.in_progress?'The current team sheets are being refreshed. Check back shortly.':'No Gameweek is currently in progress.')}<p class="table-note">GW points include captain multipliers and deduct transfer hits. Totals add these provisional points to the previous completed GW. This is a snapshot, not a minute-by-minute feed.</p></section>`;
}

function gameweeks() {
 const live=liveWeek();const weeks=live?[...data.gameweeks,live]:data.gameweeks; if(!weeks.length)return heading('Gameweek centre','The weekly highs, lows and captain calls.')+empty('The first completed Gameweek will appear here once FPL has checked the final scores.');
 const gw=weeks.find(w=>w.id===Number(gwSelection))||weeks.at(-1); gwSelection=gw.id;
 const controls=`<div class="filters"><label class="sr-label" for="gw-select">Gameweek</label><select id="gw-select">${[...weeks].reverse().map(w=>`<option value="${w.id}" ${w.id===gw.id?'selected':''}>Gameweek ${w.id}${w.provisional?' · Live':''}</option>`).join('')}</select></div>`;
 const awards=[['🏆 Manager of the Week','net',false,' pts'],['💀 Lowest score','net',true,' pts'],['🎯 Best captain return','captain_points',false,' pts'],['🪑 Most bench points','bench',false,' pts'],['📈 Biggest rank gain','movement',false,' places'],['📉 Biggest rank drop','movement',true,' places']];
 return heading('Gameweek '+gw.id,`Deadline: ${new Date(gw.deadline).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})} · ${gw.provisional?'Provisional · updates during matches':'Final scores'}`,controls)+
 `<div class="cards">${awards.filter(a=>!gw.provisional||a[1]!=='movement').map(([label,key,low,suffix])=>{const eligible=gw.rows.filter(r=>key!=='movement'||(low?r[key]<0:r[key]>0));const winners=best(eligible,key,low);return award(gw.provisional&&key==='net'&&!low?'🏆 GW leader so far':label,winners,(key==='movement'?(low?'↓ ':'↑ '):'')+num(key==='movement'?Math.abs(winners[0]?.[key]):winners[0]?.[key])+suffix,'',{color:key==='movement'?(low?'down':'up'):''});}).join('')}</div><section class="section panel"><div class="panel-heading"><h2>The Gameweek table</h2><span class="subtext">After transfer hits</span></div>`+
 table(['GW rank','Manager','Net points','Captain','Captain pts','Bench','Transfers this GW','Hit cost','Total after GW','League rank / move'],gw.rows.map(r=>row([cell(medal(r.gw_rank)),cell(person(r)+(r.chip?`<span class="chip">${esc(chipName(r.chip))}</span>`:'')),cell(`<strong>${r.net}</strong><small class="muted"> (${r.gross} − ${r.hits})</small>`),cell(esc(r.captain||'—')),cell(num(r.captain_points)),cell(r.bench),cell(r.transfers),cell(r.hits?`−${r.hits}`:'0','',r.hits),cell(num(r.total)),cell('#'+r.league_rank+' '+movement(r.movement))])))+
 `<p class="table-note">Captain points include the final multiplier, including vice-captain fallback. Bench is FPL's points left on the bench; Bench Boost points are already in the score. Tied weekly winners share the award.</p></section>`;
}
function chipName(chip){return {wildcard:'Wildcard',freehit:'Free Hit','3xc':'Triple Captain',bboost:'Bench Boost'}[chip]||chip;}
function monthly(){
 if(!data.months.length)return heading('Month by month','A fresh race, every month.')+empty('Monthly standings appear after the first completed Gameweek.');
 const month=data.months.find(m=>m.id===monthSelection)||data.months.at(-1);monthSelection=month.id;
 const control=`<div class="filters"><label for="month-select">Month</label><select id="month-select">${[...data.months].reverse().map(m=>`<option value="${m.id}" ${month.id===m.id?'selected':''}>${esc(m.label)}</option>`).join('')}</select></div>`;
 const winners=best(month.rows,'points'), lowest=best(month.rows,'points',true);
 return heading('Month by month',`Gameweeks ${month.gameweeks.join(', ')} · grouped by deadline month (UK time)`,control)+`<div class="cards">${award('🏆 Manager of the Month',winners,num(winners[0]?.points)+' pts',month.label)}${award('🎭 Fraud of the Month',lowest,num(lowest[0]?.points)+' pts',month.label+' · lowest points after hits')}</div><section class="section panel"><div class="panel-heading"><h2>${esc(month.label)}</h2><span class="subtext">${month.gameweeks.length} completed GWs</span></div>`+table(['Position','Manager','Points','Best GW','Worst GW','Season rank change'],month.rows.map(m=>row([cell(medal(m.rank)),cell(person(m)),cell(num(m.points),'total'),cell(scoreWithGW(m,'best')),cell(scoreWithGW(m,'worst')),cell(movement(m.movement),'',m.movement??'')])))+`<p class="table-note">Monthly scores include transfer hits in each included GW. Rank change compares the season table before and after the month; the first month has no prior rank. An ongoing month only includes completed Gameweeks.</p></section>`;
}
function season(){
 const ms=sortedManagers();
 const records=[['🪑 Most bench points','bench',' pts',false,'Completed Gameweeks'],['🌍 Best GW rank so far','best_gw_rank','',true,'Best overall FPL Gameweek rank · lower is better.'],['🎯 Most Captaincy failures','captain_failures',' failures',false,'Captain scored ≤4 base points. Final captain after vice fallback; multipliers excluded.'],['🔥 Most Hauls caught','hauls',' hauls',false,'12+ base points from a scoring player in one GW. Each player counts once; multipliers excluded.'],['🏆 Most GW wins','wins',' wins',false,'Tied weekly winners share the award.']];
 return heading('The season so far','Every point, every captain call, every green arrow.')+`<div class="cards season-records">${monthlyWinnersCard()}${records.map(([label,key,suffix,low,detail])=>{const winners=ms.every(m=>m[key]!=null)?best(ms,key,low):[];return award(gw.provisional&&key==='net'&&!low?'🏆 GW leader so far':label,winners,num(winners[0]?.[key])+suffix,detail,{gws:key==='best_gw_rank'?'best_gw_rank_gws':null,failures:key==='captain_failures'});}).join('')}</div><section class="section panel"><div class="panel-heading"><h2>Season statistics</h2><span class="subtext">Scroll for all stats →</span></div>`+table(['Rank','Manager','Total','Live rank','FTs*','Best GW','Worst GW','MVP','Bench','Captain pts','Hit cost','Transf made','GW wins','Squad + bank','Highest pos'],ms.map(m=>row([cell('#'+m.rank),cell(person(m,false,true),'standing-manager'),cell(num(m.total),'total'),cell(num(m.live_rank)),cell(ft(m)),cell(scoreWithGW(m,'best')),cell(scoreWithGW(m,'worst')),cell(mvpCell(m),'',m.mvp?.[0]?.points??''),cell(num(m.bench)),cell(captainTotal(m)),cell(num(m.hits)),cell(num(m.transfers_made)),cell(num(m.wins)),squadValueCell(m),cell(num(m.highest_position))],m.rank===1?'leader-row':m.rank===7?'seventh-row':m.rank===ms.at(-1).rank?'last-row':'')),'wide-table rank-portraits')+`<p class="table-note">MVP counts points actually earned for the manager in completed GWs, including captain multipliers. Transfers made so far use FPL's deadline totals, excluding Wildcard/Free Hit moves. ${ftNote} ${liveNote} Squad + bank uses current player prices for the last public squad plus money in the bank at its deadline. Transfers since the deadline are private. Historical positions are reconstructed among today's members, with fewer non-chip transfers breaking points ties.</p></section><section class="section"><div class="section-title"><h2>Power Rating <button class="tooltip power-info" data-power-info aria-label="About Power Rating">ⓘ</button></h2><span class="subtext">Relative to our league</span></div><div class="power-cards">${[...ms].sort((a,b)=>(b.power??-1)-(a.power??-1)).map(m=>`<article class="panel power-card">${person(m)}<div class="power-mini"><span class="subtext">${esc(m.form)}</span><span class="power-number">${num(m.power)}</span></div><div class="power-track"><i style="width:${m.power||0}%"></i></div>${spark(m.recent)}<p class="subtext">GW ${num(m.latest_score)} · #${m.rank}</p></article>`).join('')}</div></section><details class="section panel"><summary>How Power Rating works</summary><p>40% latest completed GW score + 30% last five available GW average + 20% season average + 10% rank movement across the last five completed GWs. Each component is scaled from 0 to 100 within this league; everyone gets 50 for a component when all values match. The weighted result is rounded to a whole number. This is a transparent form score, not AI or a win probability.</p></details>`;
}
function captainTotal(m){return m.captain_points==null?'—':num(m.captain_points)+(m.captain_coverage<m.completed_count?` <small class="muted">(${m.captain_coverage}/${m.completed_count} GWs)</small>`:'');}
function predictions(){return heading('The run-in, projected','Recent form. Chips in reserve. Plenty still to play for.')+`<section class="panel formula"><div><p class="eyebrow">FORM + CHIPS REMAINING</p><div class="formula-math">65% recent form + 35% season form</div></div><p><strong>${data.total_gameweeks-data.latest_completed} Gameweeks remaining.</strong> Recent returns are balanced with season form on a shared season scoring scale. Unused chips add a small allowance within their first- or second-half windows.</p></section><section class="section panel"><div class="panel-heading"><h2>Projected final table</h2><span class="subtext">${data.total_gameweeks} Gameweeks</span></div>${projectionTable()}<p class="table-note">An illustrative scoring scenario, not a guaranteed finish. Actual points are never reduced.</p></section><details class="section panel"><summary>About these projections</summary><p>The last five completed GW scores carry 65% of the form blend; season form carries 35%. Early-season returns are moderated towards a 50-point ordinary GW baseline, with greater weight on observed form as more weeks are completed. Unused Wildcard, Free Hit and Triple Captain add 8 estimated points each; Bench Boost adds 12. Expired chips are excluded and only one chip can be used in each remaining GW. The form and chip estimates are adjusted together to a shared season scoring scale. In-progress weeks are not counted twice. These are modelling assumptions, not promises of chip returns; fixtures and injuries are not modelled.</p></details>`;}
function priceChange(value) {
 if(value == null)return '—';
 return `<span class="${value>0?'up':value<0?'down':'muted'}">${value>0?'↑ +':value<0?'↓ −':''}£${Math.abs(value).toFixed(1)}m</span>`;
}
function priceTable(players) {
 if(!players.length)return empty('No players match this group in the latest snapshot.');
 const sorted=[...players].sort((a,b)=>Math.abs(b.projected_progress??0)-Math.abs(a.projected_progress??0));
 return table(['Player','Trend','Price','Owned','GW change','Next price update'],sorted.map(p=>row([
  cell(playerTile(p)),
  cell(p.projected_progress==null?'—':`<span class="${p.projected_progress>0?'up':p.projected_progress<0?'down':'muted'}">${p.projected_progress>0?'+':''}${num(p.projected_progress,1)}%</span><div class="price-track ${p.projected_progress<0?'fall':''}"><i style="width:${Math.min(100,Math.abs(p.projected_progress))}%"></i></div>`,'trend-cell',p.projected_progress??''),
  cell('£'+p.price.toFixed(1)+'m'),cell(num(p.ownership,1)+'%'),cell(priceChange(p.gw_change),'',p.gw_change??''),
  cell(`<span class="price-status ${p.direction>0?'up':p.direction<0?'down':'muted'}">${p.direction>0?'↑ ':p.direction<0?'↓ ':''}${esc(p.status)}</span>`)
 ])),'price-table');
}
let priceQuery='';
function priceSearchResults(){
 const words=searchableName(priceQuery).trim().split(/\s+/).filter(Boolean);
 if(!words.length)return '<p class="table-note">Search any player, regardless of ownership or price-change direction.</p>';
 const players=(data.prices?.players||[]).filter(p=>words.every(word=>searchableName((p.full_name||'')+' '+p.name+' '+p.team).includes(word)));
 return players.length?priceTable(players):empty('No matching players. Try another name.');
}
function prices() {
 const watch=data.prices;
 if(!watch?.players)return heading('Price watch','Keep an eye on your squad and the transfer market.')+empty('Price data will appear after the next successful update.');
 const ms=sortedManagers(), manager=ms.find(m=>m.id===Number(priceManagerSelection))||ms[0];
 if(!manager)return heading('Price watch','Keep an eye on the transfer market.')+empty('No public squads are available yet.');
 priceManagerSelection=manager.id;
 const squad=new Set(manager.squad||[]), owned=watch.players.filter(p=>squad.has(p.id));
 const rising=owned.filter(p=>p.direction>0), falling=owned.filter(p=>p.direction<0);
 const popular=watch.players.filter(p=>p.ownership>5 && p.direction!==0);
 const expired=watch.deadline&&Date.now()>new Date(watch.deadline).getTime();
 const deadline=watch.deadline?new Date(watch.deadline).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Unavailable';
 const controls=`<div class="filters"><label for="price-manager">Manager</label><select id="price-manager">${ms.map(m=>`<option value="${m.id}" ${m.id===manager.id?'selected':''}>${esc(m.team)} · ${esc(m.name)}</option>`).join('')}</select></div>`;
 return heading('Price watch','Official FPL forecasts. No login needed.',controls)+(expired?'<div class="notice">The saved forecast deadline has passed. These forecasts describe the previous price update; fresh forecasts will appear after the next data refresh.</div>':'')+
 `<section class="panel"><div class="panel-heading"><h2>Find a player</h2></div><div class="regret-body"><label class="search-field enemy-search"><input id="price-search" type="search" aria-label="Search player prices" placeholder="Search a player…" value="${esc(priceQuery)}" autocomplete="off"></label></div><div id="price-search-results" aria-live="polite">${priceSearchResults()}</div></section><section class="section panel price-intro"><div><p class="eyebrow">${expired?'SAVED FORECAST DEADLINE':'NEXT PRICE UPDATE'} · YOUR LOCAL TIME</p><h2>${esc(deadline)}</h2></div><p>Forecasts are a guide, not a guarantee. They are progress towards a price-change threshold—not percentage probabilities. <a href="https://fantasy.premierleague.com/en/price-changes" target="_blank" rel="noopener noreferrer">Official FPL price changes ↗</a></p></section>
 <section class="section"><div class="section-title"><div><h2>${esc(manager.team)} · squad watch</h2><p class="subtext">${manager.squad_restored?`Restored GW${manager.squad_gw} squad after Free Hit`:`Last public squad: GW${manager.squad_gw||'—'}`} · new transfers remain private until the next deadline.</p></div></div>
 <div class="price-summary"><div class="panel"><span class="up">↑ Likely to rise</span><strong>${rising.length}</strong><p>${rising.length?rising.map(p=>esc(p.name)).join(' · '):'No likely risers in this squad'}</p></div><div class="panel"><span class="down">↓ Likely to drop</span><strong>${falling.length}</strong><p>${falling.length?falling.map(p=>esc(p.name)).join(' · '):'No likely fallers in this squad'}</p></div></div>
 <div class="section panel"><div class="panel-heading"><h2>Your public squad</h2><span class="subtext">${owned.length} players · swipe for forecasts →</span></div>${priceTable(owned)}<p class="table-note">GW change is the actual net price movement since the current GW deadline. The forecast column is for the next listed price update. Locked/calibrating players are not marked as predicted risers or fallers.</p></div></section>
 <section class="section panel"><div class="panel-heading"><div><p class="eyebrow">THE SHARED WATCHLIST</p><h2>Owned by more than 5%</h2></div><span class="subtext">Likely risers &amp; fallers</span></div>${popular.length?priceTable(popular):empty('No players owned by more than 5% are currently flagged by FPL as likely to rise or drop.')}<p class="table-note">Only official “Likely” and “Very likely” forecasts are included. Ownership refers to all FPL teams, not just our league.</p></section>
 <p class="source-note">FPL forecast timestamp: ${watch.source_updated_at?esc(new Date(watch.source_updated_at).toLocaleString()):'Unavailable'}. Our saved snapshot updates about every 15 minutes around matches and every ${data.refresh_hours} hours otherwise. Check its timestamp before acting; these are not minute-by-minute updates.</p>`;
}

function comparisonManagers(league, creators) {
 // Copy rows so comparison positions never overwrite our mini-league ranks.
 const members=new Set(league.map(m=>m.id));
 const rows=[...creators.filter(m=>!members.has(m.id)),...league].map(m=>({...m,league_member:members.has(m.id),previous_rank:null}));
 function rank(list, points, transfers, target) {
  list.sort((a,b)=>b[points]-a[points] || (a[transfers]??0)-(b[transfers]??0));
  let previous;
  list.forEach((m,i)=>{m[target]=previous&&m[points]===previous[points]&&(m[transfers]??0)===(previous[transfers]??0)?previous[target]:i+1;previous=m;});
 }
 rank(rows,'total','tie_transfers','rank');
 rank(rows.filter(m=>m.previous_total!=null),'previous_total','previous_transfers','previous_rank');
 rows.forEach(m=>m.movement=m.previous_rank==null?null:m.previous_rank-m.rank);
 return rows;
}
function creators() {
 const snapshot=data.creators, ms=comparisonManagers(data.managers,snapshot?.managers||[]);
 const ownCount=ms.filter(m=>m.league_member).length;
 if(!snapshot?.managers?.length)return heading('Content Creators','The familiar faces, in one table.')+empty('Creator standings are unavailable until the next successful refresh.');
 return heading('Content Creators',`${ms.length-ownCount} creators + ${ownCount} of us. See where we stand.`, `<div class="creator-controls"><span class="pill"><i></i>GW ${data.latest_completed} complete</span><label class="search-field"><input aria-label="Search managers or teams" id="creator-search" type="search" placeholder="Search manager or team…" value="${esc(creatorQuery)}"></label></div>`)+(Date.now()-new Date(snapshot.updated_at).getTime()>18*3600000?'<div class="notice">The creator refresh is delayed. Creator scores use the last complete creator snapshot; our league uses its latest snapshot.</div>':'')+
 `<section class="panel"><div class="panel-heading"><h2>Creator standings</h2><span class="subtext">Click any column to sort ↕</span></div>`+
 `<div id="creator-results">${creatorResults(ms)}</div>`+
 `<p class="table-note">Positions and arrows compare everyone in this table. Our league teams are highlighted in green. Points ties use fewer non-chip transfers. Last GW is GW${snapshot.latest_completed??data.latest_completed}, the latest completed week in this creator snapshot. ${ftNote} ${liveNote}</p></section><p class="source-note">Scores refresh from official FPL data. Creator snapshot: ${esc(new Date(snapshot.updated_at).toLocaleString())}.</p>`;
}
function creatorResults(ms=comparisonManagers(data.managers,data.creators?.managers||[])) {
 const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const terms=normalize(creatorQuery).trim().split(/\s+/).filter(Boolean);
 const filtered=ms.filter(m=>terms.every(t=>normalize(m.name+' '+m.team).includes(t)));
 return `<p class="search-count" aria-live="polite">${filtered.length} of ${ms.length} teams</p>`+(filtered.length ? table(['Pos','Manager / team','Total','Last GW','↕','FTs*','Live rank'],filtered.map(m=>row([cell(medal(m.rank),'rank-cell'),cell(person(m,false,true)),cell(num(m.total),'numeric total'),cell(num(m.latest_score),'numeric'),cell(movement(m.movement),'',m.movement??''),cell(ft(m)),cell(num(m.live_rank),'numeric')],m.league_member?'league-member':'')),'standings creators-table') : empty('No matching managers or teams.'));
}
function showCreatorProfile(m) {
 $('#profile-content').innerHTML=`<p class="eyebrow">CONTENT CREATOR</p><h2 id="profile-title">${esc(m.name)}</h2><p class="muted">${esc(m.team)}</p>${chipBadges(m)}<div class="profile-actions"><button class="action-button" data-team="${m.id}">View team</button></div><div class="profile-stats">${[['Comparison position','#'+m.rank],['Total points',num(m.total)],['Last GW',num(m.latest_score)],['Overall FPL rank',num(m.live_rank)],['FTs remaining*',ft(m)]].map(([k,v])=>`<div><small>${k}</small><strong>${v}</strong></div>`).join('')}</div><p class="profile-note">${ftNote}</p>`;
 $('#profile').showModal();
}

function showProfile(id){openTeamId=null;const m=[...data.managers,...comparisonManagers(data.managers,data.creators?.managers||[])].find(m=>m.id===Number(id));if(!m)return;if(m.creator){showCreatorProfile(m);return;}const max=Math.max(1,...m.recent.map(r=>r.net));
 $('#profile-content').innerHTML=`<p class="eyebrow">MANAGER PROFILE</p><h2 id="profile-title">${esc(m.team)}</h2><p class="muted">${esc(m.name)}</p><div class="profile-top"><div><p class="eyebrow">LEAGUE POSITION</p><h2>#${m.rank} <span class="muted">/ ${data.managers.length}</span></h2></div><div><p class="eyebrow">TOTAL POINTS</p><h2>${num(m.total)}</h2></div><div><p class="eyebrow" title="Overall FPL rank at the last update">OR RANK</p><span class="profile-or">${num(m.live_rank)}</span></div><div class="profile-rank-trend"><p class="eyebrow">RANK TREND</p>${rankTrend(m)}</div></div><div class="profile-actions"><button class="action-button" data-team="${m.id}">View team</button></div><h3>Last ${m.recent.length} Gameweeks <small class="muted">· after hits</small></h3><div class="bar-chart">${m.recent.map(r=>`<div class="bar-column"><b>${r.net}</b><i style="height:${Math.max(r.chip?22:3,r.net/max*85)}px">${r.chip?`<span class="chart-chip chip-${esc(r.chip)}" title="${esc(chipName(r.chip))} · GW${r.gw}" aria-label="${esc(chipName(r.chip))}">${({bboost:'BB','3xc':'TC',freehit:'FH',wildcard:'WC'})[r.chip]||esc(r.chip)}</span>`:''}</i><span>GW ${r.gw}</span></div>`).join('')}</div><div class="profile-stats">${[['Best GW',scoreWithGW(m,'best')],['Worst GW',scoreWithGW(m,'worst')],['FTs remaining*',ft(m)],['GW wins',num(m.wins)],['Captain points',captainTotal(m)],['Bench points',num(m.bench)],['Transfers made so far',num(m.transfers_made)],['Hit cost',num(m.hits)+' pts'],['Projected finish',m.projected_position?'#'+m.projected_position:'—']].map(([k,v])=>`<div><small>${k}</small><strong>${v}</strong></div>`).join('')}</div><p class="profile-note">${ftNote}${m.ft_gw?' Allowance shown for GW'+m.ft_gw+'.':''}</p>`;
 $('#profile').showModal();}
function monthlyWinnersCard(){
 const months=data.months.filter(m=>m.complete);
 return `<article class="stat-card monthly-winners"><p class="label">🏆 Monthly winners</p>${months.length?`<ul>${months.map(month=>`<li><span>${esc(month.label.split(' ')[0].slice(0,3))}</span> — ${month.rows.filter(m=>m.rank===1).map(m=>`<button class="inline-manager" data-manager="${m.id}">${esc(m.name)}</button>`).join(', ')}</li>`).join('')}</ul>`:'<p class="muted">The first completed month will appear here.</p>'}<p class="detail">Completed deadline months</p></article>`;
}
function rankTrend(m){
 const points=m.history.slice(1).flatMap((r,i)=>{const prev=m.history[i];return r.gw===prev.gw+1&&prev.overall_rank>0&&r.overall_rank>0?[{gw:r.gw,change:(prev.overall_rank-r.overall_rank)/prev.overall_rank*100}]:[];});
 if(!points.length)return '<span class="muted">From GW2</span>';
 const extent=Math.max(1,...points.map(r=>Math.abs(r.change)));
 return `<svg class="rank-trend" viewBox="0 0 200 78" role="img" aria-label="Overall rank percentage change from GW2. Green means improvement, red means decline."><line x1="4" x2="196" y1="33" y2="33" stroke="#56625a" stroke-width="1"/>${points.map((r,i)=>{const x=points.length===1?100:12+i*176/(points.length-1);return `<g><title>GW${r.gw}: ${r.change>=0?'improved':'declined'} ${num(Math.abs(r.change),1)}%</title><line x1="${x}" x2="${x}" y1="33" y2="${33-r.change/extent*28}" stroke="${r.change>=0?'#b9ef75':'#ef998f'}" stroke-width="1.5"/>${points.length<9||i===0||i===points.length-1?`<text x="${x}" y="76" text-anchor="middle" fill="#a3b0a5" font-size="9">GW${r.gw}</text>`:''}</g>`;}).join('')}</svg><small class="trend-caption">Overall rank · % change</small>`;
}

function pitchPlayer(p){return `<div class="pitch-player"><div class="pitch-shirt">${p.photo?`<img class="player-photo" src="${esc(p.photo)}" alt="" width="38" height="48" loading="lazy">`:'♟'}${p.captain?'<b class="captain-label">C</b>':p.vice?'<b class="captain-label vice-label">V</b>':''}</div><strong title="${esc(p.name)}">${esc(p.name)}</strong><span>${num(p.slot<=11||p.multiplier>0?p.earned:p.points)}<small>${p.multiplier>1?' ×'+p.multiplier+' incl.':''}</small></span></div>`;}
function showTeam(id,refresh=true){
 openTeamId=id;
 const m=[...data.managers,...(data.creators?.managers||[])].find(m=>m.id===id);if(!m)return;const team=m.public_team;
 $('#profile-content').innerHTML=`<p class="eyebrow">THE TEAM SHEET</p><h2 id="profile-title">${esc(m.team)}</h2><p class="muted">${esc(m.name)}${team?` · GW${team.gw} · ${team.final?'Final':'Provisional'}${team.chip?' · '+chipName(team.chip):''}`:''}</p><div class="profile-actions"><button class="action-button" data-manager="${m.id}">← Manager stats</button></div>${team?.stale||(team&&team.gw<data.current_gw)?`<p class="notice">Squad refresh delayed. Showing the last saved team${team.updated_at?' from '+esc(new Date(team.updated_at).toLocaleString()):''}.</p>`:''}${team?.players?.length?`<div class="team-pitch">${[1,2,3,4].map(role=>`<div class="pitch-row">${team.players.filter(p=>p.slot<=11&&p.role===role).map(pitchPlayer).join('')}</div>`).join('')}</div><p class="bench-heading">BENCH</p><div class="pitch-row bench-row">${team.players.filter(p=>p.slot>11).sort((a,b)=>a.slot-b.slot).map(pitchPlayer).join('')}</div><p class="profile-note">Starting XI points include captain multipliers. Bench shows base points unless Bench Boost scores them. Autosubs follow the latest public FPL picks. New transfers stay private until the deadline.</p>`:empty('Team sheet unavailable in this snapshot. Please check again after the next refresh.')}`;
 if(!$('#profile').open)$('#profile').showModal();
 if(refresh)load(true);
}
const rupees=n=>`${n<0?'−':''}₹${Math.abs(n).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const moneyNet=n=>`<span class="${n>=0?'up':'down'}">${n>0?'+':''}${rupees(n)}</span>`;
function money(){
 const p=data.prizes;if(!p)return heading('Money follows','The league ledger.')+empty('Prize data will appear after the next refresh.');
 const rows=p.rows.map(r=>({...data.managers.find(m=>m.id===r.id),...r})).sort((a,b)=>b.earned-a.earned||a.rank-b.rank);
 return `<div class="money-page ${rainPaused?'rain-paused':''}"><div class="money-rain" aria-hidden="true">${Array.from({length:12},(_,i)=>`<span style="--x:${(i*37)%100}%;--delay:-${i*1.7}s;--duration:${9+i%5}s">₹</span>`).join('')}</div><section class="money-hero">${heading('Money follows','Rank follows, my brother. The ledger keeps receipts.')}<button class="rain-toggle" data-rain aria-pressed="${rainPaused}">${rainPaused?'Resume':'Pause'} falling money</button></section><div class="cards money-summary"><article class="stat-card"><p class="label">THE POT</p><p class="stat">${rupees(p.total_pool)}</p><p class="detail">${p.players} managers × ${rupees(p.buy_in)}</p></article><article class="stat-card"><p class="label">PRIZES EARNED SO FAR</p><p class="stat up">${rupees(p.allocated)}</p><p class="detail">${rupees(p.remaining_pool)} still to be awarded</p></article><article class="stat-card"><p class="label">THE PODIUM</p><p class="prize-podium">🥇 ${rupees(p.season_prizes[0])}<br>🥈 ${rupees(p.season_prizes[1])}<br>🥉 ${rupees(p.season_prizes[2])}</p><p class="detail">Plus ${p.monthly_count} monthly awards × ${rupees(p.monthly_prize)}</p></article></div><section class="section panel"><div class="panel-heading"><div><p class="eyebrow">SHOW ME THE MONEY</p><h2>Who's in the money?</h2></div><span class="subtext">Buy-in: ${rupees(p.buy_in)}</span></div>${table(['Manager','Monthly wins','Earned','Net after buy-in',p.season_complete?'Season prize':'Season prize if ended today',p.season_complete?'Final net':'Net if ended today'],rows.map(m=>row([cell(person(m)),cell(num(m.monthly_wins)),cell(rupees(m.earned),'total',m.earned),cell(moneyNet(m.net),'',m.net),cell(rupees(m.season_prize),'',m.season_prize),cell(moneyNet(m.if_ended_net),'',m.if_ended_net)])))}<p class="table-note">Earned prizes count only completed monthly awards${p.season_complete?' and final season prizes':'; season prizes remain provisional'}. Net = prizes minus the ${rupees(p.buy_in)} buy-in. “If ended today” adds the current podium prize, with no assumed future monthly wins. This ledger tracks entitlement, not payment status.</p></section><section class="section panel"><div class="panel-heading"><h2>Monthly money trail</h2><span class="subtext">${p.awards.length} / ${p.monthly_count} awarded</span></div>${p.awards.length?`<ul class="money-awards">${p.awards.map(a=>`<li><span>${esc(a.label)}</span><div>${a.winner_ids.map(id=>{const m=data.managers.find(m=>m.id===id);return m?person(m):'';}).join('')}</div><strong class="up">${rupees(a.each)}${a.winner_ids.length>1?' each':''}</strong></li>`).join('')}</ul>`:empty('The first monthly prize is still up for grabs.')}<p class="table-note">Monthly ties split ₹1,500 equally. Season ties share the prizes for the occupied places. Awards follow the calendar month of each GW deadline, after every GW in that month is final.</p></section></div>`;
}
let personalManager, hindsightPlayer;
function selectedManager(){return data.managers.find(m=>String(m.id)===String(personalManager))||sortedManagers()[0];}
function personalControl(){const m=selectedManager();return `<label class="personal-filter">Choose your team<select id="personal-manager">${sortedManagers().map(p=>`<option value="${p.id}" ${p.id===m?.id?'selected':''}>${esc(p.team)} · ${esc(p.name)}</option>`).join('')}</select></label>`;}
function regretNotice(){const r=data.regrets;return r?.stale?`<div class="notice">These results use the previous successful snapshot${r.updated_at?' from '+esc(new Date(r.updated_at).toLocaleString()):''}.</div>`:'';}
function signed(n){return `<span class="${n>0?'up':n<0?'down':'neutral'}">${n>0?'+':''}${num(n)}</span>`;}
function maccapanti(){
 const m=selectedManager(), record=data.regrets?.rows?.find(r=>r.id===m?.id);
 let html=heading('MaccaPanti','A place of regrets, hindsights and what could have been—and all the decisions you swear you were planning to make.',personalControl())+regretNotice();
 if(!record)return html+empty('The regret archive is being prepared. Check back after the next data refresh.');
 const options=record.perma_captains||[], captain=options.find(p=>String(p.id)===String(hindsightPlayer))||options[0];
 html+=`<section class="panel regret-section"><div class="panel-heading"><h2>🎭 Captain Hindsight</h2></div><div class="regret-body"><label class="personal-filter">What if I perma capped…<select id="hindsight-player">${options.map(p=>`<option value="${p.id}" ${p.id===captain?.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>${captain?`<div class="perma-result"><strong class="${captain.delta>0?'up':captain.delta<0?'down':'neutral'}">${num(Math.abs(captain.delta))}</strong><span>points ${captain.delta>0?'better off':captain.delta<0?'worse off':'different'} with ${esc(captain.name)}</span></div>`:empty('Captain comparisons will appear after the next successful refresh.')}</div><p class="table-note">Through GW ${data.regrets.through_gw}. A captain-bonus-only what-if: the chosen player supplies your captain bonus every completed GW, even if you did not own him. Triple Captain weeks keep the extra bonus. No vice fallback; all other points stay unchanged.</p></section>`;
 html+=`<section class="section panel"><div class="panel-heading"><div><p class="eyebrow">THE RECEIPTS ARE PUBLIC</p><h2>💸 Transfer Receipts</h2></div><span class="subtext">${record.receipts.length} transfer weeks</span></div><p class="table-note">Player base points in the transfer GW and the next two GWs, even if later sold or benched. No captain multipliers. This is a fixed-window comparison, not a reconstruction of your team score. Hits are deducted once per transfer week. Wildcard and Free Hit weeks are excluded.</p><div class="receipt-list">${record.receipts.length?record.receipts.map(r=>`<article class="receipt"><div class="section-title"><h3>GW ${r.gw}</h3><span class="pill">${r.weeks.length}/3 GWs ${r.weeks.length<3?'· still unfolding':'· complete'}</span></div>${table(['Sold','Bought','Sold pts','Bought pts','Swing'],r.moves.map(t=>row([cell(esc(t.out)),cell(esc(t.in)),cell(num(t.sold)),cell(num(t.bought)),cell(signed(t.delta),'',t.delta)])))}<p class="receipt-total">GW ${r.weeks.join(', ')} · Hits: −${r.hits} <strong>Net swing ${signed(r.delta)}</strong></p></article>`).join(''):empty('No normal transfers to judge yet.')}</div></section>`;
 html+=`<section class="section panel"><div class="panel-heading"><div><p class="eyebrow">NICE POINTS. WRONG SEAT.</p><h2>🪑 Bench Regret of the Week</h2></div></div>${record.bench.length?table(['GW','Top scoring player left on the bench','Points'],record.bench.map(r=>row([cell('GW'+r.gw),cell(r.players.map(esc).join(' · ')),cell(num(r.points),'total')]))):empty('No bench regrets available.')}<p class="table-note">Highest-scoring unused player in each completed GW, after official autosubs. Bench Boost weeks excluded. These are bench points, not a claim that a legal substitution would have earned all of them.</p></section>`;
 return html;
}
function untouched(){
 const records=data.regrets?.rows||[];
 const ms=sortedManagers().map(m=>({...m,comparison:records.find(r=>r.id===m.id)})).sort((a,b)=>(b.comparison?.frozen?.points??-Infinity)-(a.comparison?.frozen?.points??-Infinity));
 let rank=0,previous=null;
 return heading('UnTouched','One squad. One armband. Absolutely no tinkering.')+regretNotice()+`<section class="panel"><div class="panel-heading"><h2>What if you left GW1 alone?</h2><span class="subtext">Through GW ${num(data.regrets?.through_gw)} · scroll for stats →</span></div>${table(['Frozen table pos','Manager','Untouched pts','Actual pts','Untouched − actual','GW1 captain','GW1 vice'],ms.map((m,i)=>{const r=m.comparison,f=r?.frozen;if(f&&f.points!==previous){rank=i+1;previous=f.points;}return row([cell(f?medal(rank):'—'),cell(person(m)),cell(num(f?.points),'total'),cell(num(r?.actual)),cell(f?signed(f.points-r.actual):'—','',f?f.points-r.actual:''),cell(f?esc(f.captain):'—'),cell(f?esc(f.vice):'—')]);}),'untouched-table')}<p class="table-note">Frozen table position compares all frozen teams. GW1 starting XI, bench order, captain and vice stay fixed. Automatic substitutions obey formation limits and bench priority. The vice takes over if the captain does not play. No chips, transfers, hits or manual changes—even if a chip was played in the actual GW1. Double GWs include all matches; blank-GW players do not play. Actual points use the same completed GWs, after hits. A positive difference means leaving it alone would have beaten the real team. Managers without a public GW1 squad are unavailable.</p></section>`;
}
let enemyQuery='', enemyPlayer=null;
const searchableName = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function enemyMatches(){
 const query=searchableName(enemyQuery).trim();
 const matches=(data.prices?.players||[]).filter(p=>query&&query.split(/\s+/).every(word=>searchableName((p.full_name||'')+' '+p.name+' '+p.team).includes(word))).slice(0,30);
 return query?(matches.length?`<div class="player-search-matches">${matches.map(p=>`<button data-enemy-player="${p.id}" aria-pressed="${p.id===enemyPlayer}">${esc(p.full_name||p.name)} <small>${esc(p.team)}</small></button>`).join('')}</div>`:empty('No matching players. Try another name.')):'<p class="subtext">Search a player to see who owns him.</p>';
}
function enemyOwnership(){
 const player=(data.prices?.players||[]).find(p=>p.id===enemyPlayer);
 if(!player)return '';
 const gw=Math.max(...data.managers.map(m=>m.public_team?.gw||0));
 const ready=sortedManagers().filter(m=>m.public_team?.gw===gw&&!m.public_team.stale&&m.public_team.players?.length===15);
 const owners=ready.filter(m=>m.public_team.players.some(p=>p.id===player.id)), others=ready.filter(m=>!m.public_team.players.some(p=>p.id===player.id));
 const group=(title,ms)=>`<section class="panel"><div class="panel-heading"><h2>${title}</h2><span class="pill">${ms.length}</span></div><ul class="ownership-list">${ms.map(m=>`<li>${person(m)}</li>`).join('')||'<li class="muted">Nobody</li>'}</ul></section>`;
 return `<div class="section-title section"><h2>${esc(player.full_name||player.name)} <span class="subtext">· ${esc(player.team)}</span></h2><span class="subtext">GW ${gw}</span></div><div class="ownership-grid">${group('Owned by',owners)}${group('Not owned by',others)}</div><p class="source-note">Includes all 15 players, including the bench, in each manager’s latest public squad. Transfers since the deadline are private.${ready.length<data.managers.length?' '+(data.managers.length-ready.length)+' unavailable squads are excluded from both lists.':''}</p>`;
}
function enemies(){
 return heading('Who Owns','One player. Who has him—and who doesn’t?')+`<label class="search-field enemy-search"><input id="enemy-search" type="search" aria-label="Search a player" placeholder="Search a player…" value="${esc(enemyQuery)}" autocomplete="off"></label><div id="enemy-matches">${enemyMatches()}</div><div id="enemy-ownership">${enemyOwnership()}</div>`;
}

function render(){if(!data)return;const route=location.hash.slice(1)||'home';const pages={home,season,drama,gameweeks,monthly,predictions,prices,creators,enemies,untouched,maccapanti,money};const active=pages[route]?route:'home';document.querySelectorAll('[data-nav]').forEach(a=>{a.classList.toggle('active',a.dataset.nav===active);if(a.dataset.nav===active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 let notice=data.in_progress?`<div class="notice">Gameweek ${data.current_gw} is in progress or awaiting final checks. Current standings may be provisional; season records stop at GW ${data.latest_completed||'—'}.</div>`:'';
 if(Date.now()-new Date(data.updated_at).getTime()>(data.in_progress?Math.max(5*60000,(data.live_interval||900)*2000):18*3600000))notice+='<div class="notice">Updates are delayed. Showing the last successful scores; check the timestamp below.</div>';
 if(data.warnings.length)notice+='<div class="notice">Some data could not be refreshed. Previous values are retained where possible; missing values are unavailable. Check the snapshot time shown in each section.</div>';
 $('#content').innerHTML=`<div class="fade">${notice}${pages[active]()}</div>`;
 document.title=`${active==='home'?data.name:active==='drama'?'Live drama':active==='creators'?'Content Creators':active==='enemies'?'Who Owns':active==='money'?'Money follows':active==='untouched'?'UnTouched':active==='maccapanti'?'MaccaPanti':active[0].toUpperCase()+active.slice(1)} · Wireless`;
}
// Sort displayed statistics in place; missing values stay last in both directions.
function sortValue(td) {
 if(td.hasAttribute('data-sort-value'))return td.dataset.sortValue===''?null:Number(td.dataset.sortValue);
 const name=td.querySelector('.manager-btn strong, .player-tile strong');
 if(name)return name.textContent.trim();
 const text=td.textContent.trim();
 if(!text||text==='—'||text==='Unavailable')return null;
 const number=text.replace(/,/g,'').replace(/−/g,'-').match(/^[#£+]?(-?\d+(?:\.\d+)?)/);
 return number?Number(number[1]):text;
}
function sortTable(button) {
 const table=button.closest('table'), th=button.closest('th'), index=Number(button.dataset.sort);
 const ascending=th.getAttribute('aria-sort')!=='ascending';
 const rows=[...table.tBodies[0].rows];
 rows.sort((a,b)=>{const x=sortValue(a.cells[index]),y=sortValue(b.cells[index]);if(x==null)return y==null?0:1;if(y==null)return -1;const cmp=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),undefined,{numeric:true,sensitivity:'base'});return ascending?cmp:-cmp;});
 rows.forEach(r=>table.tBodies[0].appendChild(r));
 table.querySelectorAll('th').forEach(h=>{const selected=h===th;h.setAttribute('aria-sort',selected?(ascending?'ascending':'descending'):'none');h.querySelector('.sort-arrow').textContent=selected?(ascending?'↑':'↓'):'↕';});
}

document.addEventListener('click',event=>{const enemy=event.target.closest('[data-enemy-player]');if(enemy){enemyPlayer=Number(enemy.dataset.enemyPlayer);$('#enemy-matches').innerHTML=enemyMatches();$('#enemy-ownership').innerHTML=enemyOwnership();return;}if(event.target.closest('[data-power-info]')){openTeamId=null;$('#profile-content').innerHTML='<h2 id="profile-title">Power Rating</h2><p class="power-explanation">A form score from 0–100, relative to the managers in this league.</p><ul><li>40% — latest completed Gameweek</li><li>30% — last five Gameweeks</li><li>20% — season scoring form</li><li>10% — recent league rank movement</li></ul><p class="subtext">Each component is scaled within the league, then combined. It describes form, not a win probability.</p>';$('#profile').showModal();return;}const team=event.target.closest('[data-team]');if(team){showTeam(Number(team.dataset.team));return;}if(event.target.closest('[data-rain]')){rainPaused=!rainPaused;render();return;}const sort=event.target.closest('[data-sort]');if(sort){sortTable(sort);return;}const button=event.target.closest('[data-manager]');if(button)showProfile(button.dataset.manager);});
document.addEventListener('input',event=>{if(event.target.id==='price-search'){priceQuery=event.target.value;$('#price-search-results').innerHTML=priceSearchResults();return;}if(event.target.id==='enemy-search'){enemyQuery=event.target.value;$('#enemy-matches').innerHTML=enemyMatches();return;}if(event.target.id==='creator-search'){creatorQuery=event.target.value;$('#creator-results').innerHTML=creatorResults();}});
document.addEventListener('change',event=>{if(event.target.id==='personal-manager'){personalManager=event.target.value;hindsightPlayer=null;render();return;}if(event.target.id==='hindsight-player'){hindsightPlayer=event.target.value;render();return;}if(event.target.id==='gw-select'){gwSelection=event.target.value;render();$('#gw-select')?.focus();}if(event.target.id==='month-select'){monthSelection=event.target.value;render();$('#month-select')?.focus();}if(event.target.id==='price-manager'){priceManagerSelection=event.target.value;render();$('#price-manager')?.focus();}});
$('#profile').addEventListener('close',()=>{openTeamId=null;});
$('#profile .close').addEventListener('click',()=>$('#profile').close());
$('#profile').addEventListener('click',e=>{if(e.target===$('#profile')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
window.addEventListener('hashchange',()=>{if(location.hash==='#content'){document.querySelector('main').focus();return;}render();window.scrollTo(0,0);});
document.addEventListener('error',event=>{if(event.target.matches?.('.player-photo'))event.target.hidden=true;},true);
function applyLive(base,live){
 const merged=structuredClone(base);
 if(!live||live.league_id!==base.league_id||live.season!==base.season||live.gw<=base.latest_completed||Date.parse(live.updated_at)<=Date.parse(base.updated_at))return merged;
 if(!Array.isArray(live.managers)||live.managers.length!==base.managers.length||!base.managers.every(m=>live.managers.some(r=>r.id===m.id&&r.public_team?.gw===live.gw&&r.public_team.players?.length===15)))return merged;
 merged.snapshot_updated_at=base.updated_at;merged.updated_at=live.updated_at;merged.live_interval=live.interval_seconds;
 merged.current_gw=live.gw;merged.current_deadline=live.deadline;merged.in_progress=true;
 merged.live_fixtures=live.fixtures;merged.fixtures_stale=false;
 merged.managers=base.managers.map(m=>{const r=live.managers.find(r=>r.id===m.id);return {...m,public_team:r.public_team,total:r.total,event_total:r.event_total,...(r.official_rank?.value?{live_rank:r.official_rank.value,rank_updated_at:r.official_rank.updated_at}:{})};});
 const ranked=[...merged.managers].sort((a,b)=>b.total-a.total);ranked.forEach((m,i)=>{m.rank=i&&m.total===ranked[i-1].total?ranked[i-1].rank:i+1;m.movement=null;});
 return merged;
}
async function fetchSnapshot(url){const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('Snapshot unavailable');return response.json();}
async function load(silent=false){
 if(refreshPending)return refreshPending;
 refreshPending=(async()=>{try{
 const stamp=Math.floor(Date.now()/30000);
 const slot=(Math.floor(Date.now()/60000)-1)%10;
 const day=new Date(Date.now()+330*60000).getUTCDay();
 const liveFile=day===0||day===6?'live-'+slot+'.json':'live.json';
 const results=await Promise.allSettled([fetchSnapshot('./data/league.json?t='+stamp),fetchSnapshot('https://raw.githubusercontent.com/avgcloudwizard/wireless/live-data/data/'+liveFile+'?t='+stamp)]);
 if(results[0].status==='fulfilled'){const next=results[0].value;if(Array.isArray(next.managers)&&Array.isArray(next.gameweeks)&&(!baseSnapshot||Date.parse(next.updated_at)>=Date.parse(baseSnapshot.updated_at)))baseSnapshot=next;}
 if(results[1].status==='fulfilled'){const next=results[1].value;if(!liveSnapshot||Date.parse(next.updated_at)>=Date.parse(liveSnapshot.updated_at))liveSnapshot=next;}
 if(!baseSnapshot)throw new Error('Snapshot unavailable');
 const next=applyLive(baseSnapshot,liveSnapshot);
 if(data?.updated_at===next.updated_at&&data?.snapshot_updated_at===next.snapshot_updated_at)return;
 data=next;render();
 if($('#profile').open&&openTeamId!==null)showTeam(openTeamId,false);
 $('#updated').textContent=`Scores updated: ${new Date(data.updated_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})} · Weekend live scores ~1 min · Official ranks/full stats may lag`;
 }catch(error){if(data)return;$('#content').innerHTML=empty('The league snapshot could not be loaded. <button id="retry">Try again</button>');$('#retry').addEventListener('click',()=>load());console.error(error);}})();
 try{await refreshPending;}finally{refreshPending=null;}
}
function refreshVisible(){if(!document.hidden&&!['creator-search','enemy-search','price-search','personal-manager','hindsight-player'].includes(document.activeElement?.id))load(true);}
load();
setInterval(refreshVisible,30000);
document.addEventListener('visibilitychange',refreshVisible);
window.addEventListener('focus',refreshVisible);
