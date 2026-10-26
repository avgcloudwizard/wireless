const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app.js','utf8').split("document.addEventListener('click'")[0];
const ctx=vm.createContext({console,structuredClone});vm.runInContext(source,ctx);
const snapshot=JSON.parse(fs.readFileSync('data/league.json'));
ctx.snapshot=snapshot;vm.runInContext('data=snapshot',ctx);
for(const page of ['home','season','gameweeks','monthly','predictions','prices','creators','enemies','untouched','maccapanti','money','drama'])assert(vm.runInContext(page+'()',ctx).length>0,page+' renders');
if(snapshot.in_progress)assert(vm.runInContext('home()',ctx).includes('GW '+snapshot.current_gw+' '+vm.runInContext('currentGWStatus()',ctx)));
if(snapshot.in_progress)assert(vm.runInContext('monthly()',ctx).includes(new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'Europe/London'}).format(new Date(snapshot.current_deadline))));
const m=snapshot.managers.find(m=>m.id===61950);
ctx.m=m;assert(Number.isFinite(vm.runInContext('teamValue(m)',ctx)));
snapshot.in_progress=true;const gw=snapshot.current_gw;
const team=m.public_team,initial=vm.runInContext('currentScore(m)',ctx);
assert.equal(initial,team.players.reduce((n,p)=>n+p.earned,0)-team.entry_history.event_transfers_cost);
// Extend an existing transfer receipt once, and include a new live-GW receipt.
const ids=team.players.map(p=>p.id);m.transfer_moves=[{gw:gw-1,in_id:ids[0],out_id:ids[1],in:'A',out:'B'},{gw,in_id:ids[2],out_id:ids[3],in:'C',out:'D'}];
snapshot.player_points=Object.fromEntries(ids.map((id,i)=>[id,i]));team.chip=null;
ctx.saved={perma_captains:[],bench:[],receipts:[{gw:gw-1,weeks:[gw-1],moves:[{in:'A',out:'B',bought:10,sold:2,delta:8}],hits:4,delta:4}]};
const updated=vm.runInContext('currentRegrets(m,saved)',ctx);
assert.equal(updated.receipts[0].gw,gw);assert.equal(updated.receipts[1].delta,3);assert.equal(updated.receipts[1].weeks.length,2);
assert.equal(ctx.saved.receipts[0].delta,4,'Does not mutate completed dataset');
team.chip='wildcard';assert.equal(vm.runInContext('transferText(m)',ctx),'Wildcard');assert.equal(vm.runInContext('currentRegrets(m,saved).receipts.length',ctx),1);
console.log('All 12 pages render; current scores, month, value and transfer receipts checked.');
// Season adds the provisional GW exactly once and leaves stored records untouched.
ctx.snapshot=JSON.parse(fs.readFileSync('data/league.json'));vm.runInContext('data=snapshot',ctx);
if(ctx.snapshot.in_progress){
 const week=vm.runInContext('liveWeek()',ctx),updated=vm.runInContext('seasonManagers()',ctx);
 for(const m of ctx.snapshot.managers){const live=week.rows.find(r=>r.id===m.id),s=updated.find(r=>r.id===m.id);if(!live)continue;
  assert.equal(s.bench,m.bench+live.bench);assert.equal(s.hits,m.hits+live.hits);assert.equal(s.wins,m.wins+(live.gw_rank===1?1:0));
  assert.equal(s.latest_score,live.net);assert(s.power>=0&&s.power<=100);
 }
 assert.equal(JSON.stringify(vm.runInContext('seasonManagers()',ctx)),JSON.stringify(updated),'Repeated renders do not accumulate the live GW');
 assert(vm.runInContext('season()',ctx).includes('GW '+ctx.snapshot.current_gw+' '+vm.runInContext('currentGWStatus()',ctx)));
}
console.log('Season live totals are repeatable; historical data stays unchanged.');

// Finished fixtures change labels without finalising unverified FPL records.
vm.runInContext("data.in_progress=true;data.fixtures_stale=false;data.live_fixtures=[{gw:data.current_gw,finished:true}]",ctx);
assert.equal(vm.runInContext('currentGWStatus()',ctx),'finished');
assert(vm.runInContext('scoreHeading()',ctx).includes('finished'));
vm.runInContext('data.live_fixtures[0].finished=false',ctx);
assert.equal(vm.runInContext('currentGWStatus()',ctx),'live');
vm.runInContext('data.live_fixtures=[]',ctx);
assert.equal(vm.runInContext('currentGWStatus()',ctx),'live');
