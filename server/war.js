import { randomUUID } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const rankPath = process.env.WAR_RANK_FILE || path.join(here, 'rank_war.txt');
const WAR_MAX_HP = 20;
const active = new Map();
const shots = new Map();
let match = freshMatch();

function freshMatch() {
  return { phase: 'waiting', players: new Map(), enemies: new Map(), floorPoints: [], actorHeight: 1.38, countdownEndsAt: 0, startedAt: 0, elapsed: 0, reinforcements: 0, respawns: [], nextEnemyId: 1, nextShotId: 1, result: null, resultSaved: false };
}
const clean = (value, max = 32) => String(value ?? '').replace(/[|\r\n]/g, ' ').trim().slice(0, max);
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dist2 = (a, b) => (a.x-b.x)**2 + (a.z-b.z)**2;
const send = (peer, type, data = {}) => {
  if (peer.open && peer.socket.readyState === WebSocket.OPEN) {
    peer.socket.send(JSON.stringify({ type, data }));
  }
};
function broadcast(type, data = {}) { for (const peer of active.values()) send(peer, type, data); }
function vectorFromYaw(yaw) { return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) }; }
function raySphere(origin, direction, center, radius) {
  const ox=origin.x-center.x, oy=origin.y-center.y, oz=origin.z-center.z;
  const b=ox*direction.x+oy*direction.y+oz*direction.z, c=ox*ox+oy*oy+oz*oz-radius*radius, discriminant=b*b-c;
  if (discriminant < 0) return Infinity;
  const near=-b-Math.sqrt(discriminant), far=-b+Math.sqrt(discriminant);
  return near >= 0 ? near : far >= 0 ? far : Infinity;
}
function pickPoint(excluded = [], minimum = 5, preferred = null) {
  const points=match.floorPoints;
  if (!points.length) return null;
  if(preferred&&excluded.every(point=>dist2(preferred,point)>=minimum*minimum))return {...preferred};
  for (let attempt=0;attempt<Math.min(500,points.length*6);attempt++) {
    const candidate=points[Math.floor(Math.random()*points.length)];
    if(excluded.every(point=>dist2(candidate,point)>=minimum*minimum))return {...candidate};
  }
  // Avoid inventing a spawn plane; when the supplied real walkable samples
  // cannot satisfy separation, choose the least crowded sampled surface.
  return {...points.reduce((best,candidate)=>!best||excluded.reduce((score,point)=>score+dist2(candidate,point),0)>excluded.reduce((score,point)=>score+dist2(best,point),0)?candidate:best,null)};
}
function livingPlayers() { return [...match.players.values()].filter(player=>player.hp>0); }
function createEnemy() {
  const excluded=[...match.players.values(),...match.enemies.values()];
  const position=pickPoint(excluded,6);if(!position)return;
  const id=`e${match.nextEnemyId++}`;
  match.enemies.set(id,{id,...position,yaw:0,hp:10,actorHeight:match.actorHeight,nextShotAt:Date.now()+1000+Math.random()*500,visibleTo:[]});
}
function serializeState(now = Date.now()) {
  const players=[...match.players.values()].map(({id,name,x,y,z,yaw,hp,kills,actorHeight,crouched,shieldActive,shieldCharges,weapon,ammo,reserve,reloads,grenades})=>({id,name,x,y,z,yaw,hp,kills,actorHeight,crouched,shieldActive,shieldCharges,weapon,ammo,reserve,reloads,grenades}));
  const elapsed=match.phase==='running'?Math.max(0,(now-match.startedAt)/1000):match.elapsed;
  return {phase:match.phase,countdownEndsAt:match.countdownEndsAt,elapsed,kills:[...match.players.values()].reduce((sum,p)=>sum+p.kills,0),totalKills:[...match.players.values()].reduce((sum,p)=>sum+p.kills,0),enemyCount:match.enemies.size,reinforcements:match.reinforcements,reinforcementsMax:15,players,enemies:[...match.enemies.values()].map(({visibleTo,...enemy})=>enemy),result:match.result};
}
function stateFor(peer) { send(peer,'state',serializeState()); }
async function saveResult(outcome) {
  if(match.resultSaved)return;
  match.resultSaved=true;
  const players=[...match.players.values()];
  const time=match.phase==='running'?Math.max(0,(Date.now()-match.startedAt)/1000):match.elapsed;
  const playerLabel=players.map(player=>`${player.name} (${player.kills})`).join(', ');
  const row=`${new Date().toISOString()} | ${time.toFixed(2)}s | ${playerLabel} | ${players.reduce((sum,p)=>sum+p.kills,0)} | ${outcome} | arena\n`;
  try {
    let exists=true;try{await readFile(rankPath);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
    if(!exists)await appendFile(rankPath,'# WAR RANKS · elapsed time | players (individual kills) | total kills | result | map\n','utf8');
    await appendFile(rankPath,row,'utf8');
  } catch(error) { console.error('WAR rank write failed:',error); }
}
function finish(outcome) {
  if(match.phase==='finished')return;
  if(match.phase==='running')match.elapsed=Math.max(0,(Date.now()-match.startedAt)/1000);
  match.phase='finished';match.result=outcome;
  broadcast('state',serializeState());
  void saveResult(outcome);
}
function addDamage(player, amount, source) {
  if(player.hp<=0)return;
  if(player.shieldActive&&player.shieldCharges>0&&source) {
    const forward=vectorFromYaw(player.yaw),toSource={x:source.x-player.x,z:source.z-player.z},length=Math.hypot(toSource.x,toSource.z)||1;
    if((forward.x*toSource.x+forward.z*toSource.z)/length>.25) {
      player.shieldCharges--;if(!player.shieldCharges)player.shieldActive=false;return;
    }
  }
  player.hp=Math.max(0,player.hp-amount);player.lastDamageAt=Date.now();player.nextRegenAt=player.lastDamageAt+5000;
  if(livingPlayers().length===0)finish('DEFEAT');
}
function killEnemy(enemy, player) {
  if(!match.enemies.has(enemy.id))return;
  match.enemies.delete(enemy.id);player.kills++;
  if(match.reinforcements<15)match.respawns.push(Date.now()+2000);
  else if(match.enemies.size===0&&match.respawns.length===0)finish('VICTORY');
}
function launchEnemyShot(enemy, player, now) {
  const origin={x:enemy.x,y:enemy.y+enemy.actorHeight*.72,z:enemy.z},target={x:player.x,y:player.y+player.actorHeight*.9,z:player.z},delta={x:target.x-origin.x,y:target.y-origin.y,z:target.z-origin.z};
  const distance=Math.hypot(delta.x,delta.y,delta.z)||1,direction={x:delta.x/distance,y:delta.y/distance,z:delta.z/distance},id=`s${match.nextShotId++}`;
  const shot={id,targetId:player.id,origin,direction,distance,speed:34,createdAt:now,expiresAt:now+Math.max(900,distance/34*1000+500)};shots.set(id,shot);
  broadcast('enemy-shot',{...shot});
}
function tick() {
  const now=Date.now();
  if(match.phase==='countdown'&&now>=match.countdownEndsAt) {
    match.phase='running';match.startedAt=now;match.elapsed=0;
    for(let index=0;index<5;index++)createEnemy();
    broadcast('state',serializeState(now));
  }
  if(match.phase==='running') {
    match.elapsed=Math.max(0,(now-match.startedAt)/1000);
    for(const player of livingPlayers())if(now>=player.nextRegenAt&&player.hp<WAR_MAX_HP){player.hp++;player.nextRegenAt=now+1000;}
    while(match.respawns.length&&match.respawns[0]<=now&&match.reinforcements<15){match.respawns.shift();match.reinforcements++;createEnemy();}
    const pursuitCount=new Map();
    for(const enemy of match.enemies.values()) {
      const visibleTargets=livingPlayers().filter(player=>player.visibleEnemies?.includes(enemy.id)&&(pursuitCount.get(player.id)||0)<3);
      const target=visibleTargets.sort((a,b)=>(pursuitCount.get(a.id)||0)-(pursuitCount.get(b.id)||0)||dist2(enemy,a)-dist2(enemy,b))[0];
      if(!target)continue;
      pursuitCount.set(target.id,(pursuitCount.get(target.id)||0)+1);
      const dx=target.x-enemy.x,dz=target.z-enemy.z,distance=Math.hypot(dx,dz)||1;
      enemy.yaw=Math.atan2(dx,dz);
      if(distance>2.1){const step=Math.min(.82*.05,distance-2.1);enemy.x+=dx/distance*step;enemy.z+=dz/distance*step;const floor=match.floorPoints.reduce((best,point)=>!best||dist2(point,enemy)<dist2(best,enemy)?point:best,null);if(floor&&dist2(floor,enemy)<4)enemy.y=floor.y;}
      if(target.visibleEnemies?.includes(enemy.id)&&now>=enemy.nextShotAt){enemy.nextShotAt=now+1000+Math.random()*500;launchEnemyShot(enemy,target,now);}
    }
    for(const [id,shot] of shots)if(shot.expiresAt<now)shots.delete(id);
  }
  if(match.phase==='waiting'&&active.size===0&&match.players.size)match=freshMatch();
  if(now-lastBroadcast>=100){lastBroadcast=now;broadcast('state',serializeState(now));}
}
let lastBroadcast=0;
function onJoin(peer,data) {
  if(match.phase==='finished'&&active.size===0)match=freshMatch();
  if(match.players.size>=2||match.phase==='running'||match.phase==='finished'){send(peer,'error',{message:'이 WAR 매치는 이미 가득 찼습니다.'});return;}
  const name=clean(data.name);if(!name){send(peer,'error',{message:'플레이어 이름을 입력해 주세요.'});return;}
  const actorHeight=clamp(number(data.actorHeight,1.38),.2,24);
  const points=Array.isArray(data.floorPoints)?data.floorPoints.slice(0,160).map(point=>({x:number(point.x,NaN),y:number(point.y,NaN),z:number(point.z,NaN)})).filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z)&&Math.abs(point.x)<=250&&point.y>=-30&&point.y<=100&&Math.abs(point.z)<=250):[];
  if(points.length<8){send(peer,'error',{message:'실제 맵 바닥을 확인하지 못했습니다. 맵을 다시 불러와 주세요.'});return;}
  if(!match.floorPoints.length){match.floorPoints=points;match.actorHeight=actorHeight;}
  if(!match.floorPoints.length){send(peer,'error',{message:'WAR 맵 바닥 정보가 없습니다.'});return;}
  const preferred=data.preferredSpawn&&{x:number(data.preferredSpawn.x,NaN),y:number(data.preferredSpawn.y,NaN),z:number(data.preferredSpawn.z,NaN)};
  const validPreferred=preferred&&Number.isFinite(preferred.x)&&Number.isFinite(preferred.y)&&Number.isFinite(preferred.z)?match.floorPoints.reduce((best,point)=>!best||dist2(point,preferred)<dist2(best,preferred)?point:best,null):null;
  const spawn=validPreferred&&dist2(validPreferred,preferred)<1?pickPoint([...match.players.values()],7,validPreferred):pickPoint([...match.players.values()],7);
  if(!spawn){send(peer,'error',{message:'실제 바닥에서 스폰 위치를 정하지 못했습니다.'});return;}
  const id=peer.id;
  const player={id,name,x:spawn.x,y:spawn.y,z:spawn.z,yaw:0,pitch:0,hp:WAR_MAX_HP,kills:0,actorHeight,standingHeight:actorHeight,crouched:false,shieldActive:false,shieldCharges:3,grenades:2,grenadeIds:new Set(),weapon:'m1911',ammo:{m1911:12,bren2:15},reserve:{m1911:-1,bren2:-1},reloads:2,visibleEnemies:[],lastDamageAt:0,nextRegenAt:0,lastFireAt:0};
  match.players.set(id,player);peer.player=player;
  send(peer,'welcome',{id,spawn:{x:player.x,y:player.y,z:player.z}});
  if(match.players.size===2){match.phase='countdown';match.countdownEndsAt=Date.now()+10000;}
  stateFor(peer);broadcast('state',serializeState());
}
function handle(peer,message) {
  const {type,data={}}=message||{};
  if(type==='join'){onJoin(peer,data);return;}
  const player=peer.player;if(!player||!active.has(peer.id))return;
  if(type==='input') {
    player.x=clamp(number(data.x,player.x),-250,250);player.y=clamp(number(data.y,player.y),-30,100);player.z=clamp(number(data.z,player.z),-250,250);player.yaw=number(data.yaw,player.yaw);player.pitch=clamp(number(data.pitch,player.pitch),-1.5,1.5);player.crouched=Boolean(data.crouched);player.actorHeight=player.standingHeight*(player.crouched ? 0.75 : 1);
    player.visibleEnemies=Array.isArray(data.visibleEnemies)?data.visibleEnemies.slice(0,32).map(String):[];return;
  }
  if(type==='equipment'){player.shieldActive=Boolean(data.shieldActive&&player.shieldCharges>0);return;}
  if(type==='weapon'&&['m1911','bren2'].includes(data.weapon)){player.weapon=data.weapon;return;}
  if(type==='fire') {
    const weapon=['m1911','bren2'].includes(data.weapon)?data.weapon:player.weapon;player.weapon=weapon;
    const now=Date.now(),fireDelay=weapon==='m1911'?150:115;
    if(match.phase!=='running'||player.hp<=0||now-player.lastFireAt<fireDelay||player.ammo[weapon]<=0){send(peer,'ammo',{weapon,magazine:player.ammo[weapon],reserve:player.reserve[weapon],reloads:player.reloads});return;}
    player.lastFireAt=now;
    player.ammo[weapon]--;
    const origin={x:clamp(number(data.origin?.x,player.x),-300,300),y:clamp(number(data.origin?.y,player.y+1),-50,120),z:clamp(number(data.origin?.z,player.z),-300,300)};
    const direction=data.direction||{},length=Math.hypot(number(direction.x),number(direction.y),number(direction.z))||1,ray={x:number(direction.x)/length,y:number(direction.y)/length,z:number(direction.z)/length};
    const wallDistance=clamp(number(data.wallDistance,250),0,250),target=match.enemies.get(String(data.targetId||''));
    if(target){
      // Enemy actors carry the same world-space height as the player. Fall
      // back to this match's map-derived size for older/malformed snapshots.
      const targetHeight=Number.isFinite(target.actorHeight)&&target.actorHeight>0?target.actorHeight:match.actorHeight;
      const hitDistance=raySphere(origin,ray,{x:target.x,y:target.y+targetHeight*.5,z:target.z},targetHeight*.36);
      const hit=hitDistance<=wallDistance&&hitDistance<180;
      if(hit){target.hp-=weapon==='m1911'?9:5;if(target.hp<=0)killEnemy(target,player);}
      send(peer,'fire-result',{enemyId:target.id,hit,killed:hit&&target.hp<=0,hp:Math.max(0,target.hp)});
    }else send(peer,'fire-result',{enemyId:'',hit:false,killed:false,hp:0});
    send(peer,'ammo',{weapon,magazine:player.ammo[weapon],reserve:player.reserve[weapon],reloads:player.reloads});return;
  }
  if(type==='reload') {
    const weapon=['m1911','bren2'].includes(data.weapon)?data.weapon:player.weapon,capacity=weapon==='m1911'?12:15;
    if(match.phase!=='running'||player.ammo[weapon]>=capacity)return;
    // -1 is the WAR-only infinite reserve sentinel; JSON keeps it numeric and
    // the client renders it as ∞. Every accepted reload fills the magazine.
    const infiniteReserve=player.reserve[weapon]===-1;
    if(!infiniteReserve&&player.reserve[weapon]<=0)return;
    const added=infiniteReserve?capacity-player.ammo[weapon]:Math.min(capacity-player.ammo[weapon],player.reserve[weapon]);
    player.ammo[weapon]+=added;
    if(!infiniteReserve)player.reserve[weapon]-=added;
    send(peer,'ammo',{weapon,magazine:player.ammo[weapon],reserve:player.reserve[weapon],reloads:player.reloads});return;
  }
  if(type==='enemy-impact') {
    const shot=shots.get(String(data.shotId||''));if(!shot||shot.targetId!==player.id)return;shots.delete(shot.id);if(data.hit) addDamage(player,2,shot.origin);return;
  }
  if(type==='grenade-throw') {
    if(match.phase!=='running'||player.grenades<=0)return;player.grenades--;const grenadeId=clean(data.id,80);if(grenadeId)player.grenadeIds.add(grenadeId);return;
  }
  if(type==='grenade-explode') {
    if(match.phase!=='running')return;
    const grenadeId=clean(data.id,80);if(!grenadeId||!player.grenadeIds.has(grenadeId))return;player.grenadeIds.delete(grenadeId);
    const position={x:clamp(number(data.x,player.x),-300,300),y:clamp(number(data.y,player.y),-50,120),z:clamp(number(data.z,player.z),-300,300)};
    for(const enemy of [...match.enemies.values()])if(Math.hypot(enemy.x-position.x,enemy.y+player.actorHeight*.5-position.y,enemy.z-position.z)<=4.1){enemy.hp-=9;if(enemy.hp<=0)killEnemy(enemy,player);}
    for(const targetPlayer of match.players.values())if(Math.hypot(targetPlayer.x-position.x,targetPlayer.y+targetPlayer.actorHeight*.5-position.y,targetPlayer.z-position.z)<=4.1)addDamage(targetPlayer,3,position);
    broadcast('blast',{...position,id:grenadeId});return;
  }
}
function closePeer(peer) {
  if(!active.has(peer.id))return;
  active.delete(peer.id);peer.open=false;clearInterval(peer.heartbeat);
  if(peer.player&&match.players.has(peer.id)){
    if(match.phase==='running')finish('ABANDONED');
    match.players.delete(peer.id);
  }
  if(match.phase==='countdown'&&match.players.size<2){match.phase='waiting';match.countdownEndsAt=0;broadcast('state',serializeState());}
  if(active.size===0&&match.phase==='waiting')match=freshMatch();
}
function attach(server) {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade',(request,socket,head)=>{
    let pathname;try{pathname=new URL(request.url,'http://localhost').pathname;}catch{return socket.destroy();}
    if(pathname!=='/war'){socket.destroy();return;}
    if(active.size>=2){socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');return;}
    webSocketServer.handleUpgrade(request,socket,head,webSocket=>{
      webSocketServer.emit('connection',webSocket,request);
    });
  });
  webSocketServer.on('connection',socket=>{
    const peer={id:randomUUID(),socket,open:true,player:null,isAlive:true};
    active.set(peer.id,peer);
    socket.on('pong',()=>{peer.isAlive=true;});
    peer.heartbeat=setInterval(()=>{
      if(!peer.open)return;
      if(!peer.isAlive){socket.terminate();return;}
      peer.isAlive=false;
      socket.ping();
    },20000);
    peer.heartbeat.unref?.();
    socket.on('message',payload=>{
      try{handle(peer,JSON.parse(payload.toString('utf8')));}
      catch(error){console.warn('Invalid WAR packet:',error.message);}
    });
    socket.on('close',()=>closePeer(peer));
    socket.on('error',()=>closePeer(peer));
  });
  setInterval(tick,50).unref?.();
}

function getAdminStatus() {
  const now = Date.now();
  return {
    phase: match.phase,
    players: [...match.players.values()].map(player => ({ name: player.name, hp: player.hp, kills: player.kills })),
    playerCount: active.size,
    enemyCount: match.enemies.size,
    reinforcements: match.reinforcements,
    reinforcementsMax: 15,
    elapsed: match.phase === 'running' ? Math.max(0, (now - match.startedAt) / 1000) : match.elapsed,
    countdownSeconds: match.phase === 'countdown' ? Math.max(0, Math.ceil((match.countdownEndsAt - now) / 1000)) : 0,
    result: match.result,
  };
}

function resetWarMatch() {
  const peers = [...active.values()];
  active.clear();
  shots.clear();
  match = freshMatch();
  for (const peer of peers) {
    peer.open = false;
    clearInterval(peer.heartbeat);
    try { peer.socket.close(4001, 'Operator reset'); } catch {}
  }
  return peers.length;
}

export { attach, getAdminStatus, resetWarMatch };
