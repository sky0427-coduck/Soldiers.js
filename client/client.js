import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/OBJLoader.js';
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/meshopt_decoder.module.js';
import { acceleratedRaycast, computeBoundsTree } from 'https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.8.3/build/index.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

const $ = (id) => document.getElementById(id);
const ui = { landing: $('landing'), mapScreen: $('map-screen'), name: $('name-screen'), hud: $('hud'), result: $('result'), loader: $('loader'), nameInput: $('player-name'), mode: $('selected-mode'), timer: $('timer'), objective: $('objective'), level: $('level-banner'), warCountdown: $('war-countdown'), warScoreboard: $('war-scoreboard'), crosshair: $('crosshair'), hitmarker: $('hitmarker'), damage: $('damage-vignette'), capture: $('capture'), captureBar: document.querySelector('#capture span'), hpBar: document.querySelector('#health i'), hp: document.querySelector('#health b'), weapon: $('weapon-name'), mag: $('magazine'), reserve: $('reserve'), reloads: document.querySelector('#ammo small'), resultMode: $('result-mode'), resultTitle: $('result-title'), resultScore: $('result-score'), ranks: $('rank-list') };
const loader = new GLTFLoader(), objLoader = new OBJLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
THREE.Cache.enabled = true;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const menuMusic = new Audio('/sound/Military.ogg');
menuMusic.loop = true;
menuMusic.volume = 0.35;

function show(...screens) {
  document.querySelectorAll('.screen').forEach(item => item.classList.remove('active'));
  screens.forEach(item => item.classList.add('active'));

  if (screens.includes(ui.landing)) {
    menuMusic.play().catch(() => {
      // 브라우저가 사용자 입력 전 자동재생을 막을 수 있음
    });
  } else {
    menuMusic.pause();
    menuMusic.currentTime = 0;
  }
}

const gameAudio = { gunshot: new Audio('/sound/gunshot.ogg'), reload: new Audio('/sound/gunreload.ogg'), emptyClick: new Audio('/sound/gun-click.ogg'), ricochet: [new Audio('/sound/ricochet1.ogg'),new Audio('/sound/ricochet2.ogg')] };
gameAudio.gunshot.preload = gameAudio.reload.preload = gameAudio.emptyClick.preload = 'auto';
for(const sound of gameAudio.ricochet)sound.preload='auto';
let rankSessionToken = '';
try { rankSessionToken = sessionStorage.getItem('soldiers-rank-session') || ''; } catch {}
const rankSessionReady = fetch('/api/session', { method: 'POST', headers: rankSessionToken ? { 'X-Soldiers-Session': rankSessionToken } : {} })
  .then(response => { if (!response.ok) throw new Error('Could not create rank session'); return response.json(); })
  .then(session => { rankSessionToken = session.token; try { sessionStorage.setItem('soldiers-rank-session', rankSessionToken); } catch {} return session.id; })
  .catch(error => { console.warn('Rank session unavailable.', error); return null; });
let reloadDurationMs = 3316;
gameAudio.reload.addEventListener('loadedmetadata', () => { if (!reloading && Number.isFinite(gameAudio.reload.duration)) reloadDurationMs = gameAudio.reload.duration * 1000; });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6e7678);
scene.fog = new THREE.Fog(0x6e7678, 42, 170);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .04, 260);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = false; renderer.outputColorSpace = THREE.SRGBColorSpace;
} catch (error) {
  // Keep the menus usable on browser-automation hosts without an available GPU.
  const canvas = document.createElement('canvas');
  renderer = { domElement: canvas, setSize() {}, render() {} };
  console.warn('WebGL is unavailable in this browser session.', error);
}
$('render-root').append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd9e0e2, 0x303630, 1.05));
const sun = new THREE.DirectionalLight(0xffe8c9, 1.15); sun.position.set(16, 24, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
const clock = new THREE.Clock(), raycaster = new THREE.Raycaster(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const keys = new Set();
// WAR movement has its own input state. It deliberately does not depend on
// pointer lock: aiming and walking are separate controls.
const warMovementKeys = new Set();
let mode = 'practice', selectedMap = 'house_A', playerName = '', running = false, pointer = false, elapsed = 0, score = 0, level = 1, levelHits = 0, health = 14, remaining = 0, captureTime = 0, captured = 0, lastDamage = 0, matchGeneration = 0;
let operatorReturnRequested = false;
let house = null, houseMeshes = [], floorCandidates = [], enemyTemplate = null, practiceGroup = null, practiceTarget = null, gunRoot = null, shieldRoot = null, grenadeRoot = null, playerBody = null, currentGun = 'm1911', guns = {}, flags = [], enemies = [], healthOrbs = [], grenades = [], heldItem = 'gun', shieldCharges = 3, grenadeCount = 2, mapBox = new THREE.Box3(new THREE.Vector3(-28, 0, -28), new THREE.Vector3(28, 20, 28));
let warFloorRange = null, warLastSafePosition = null, warActorHeight = 1.38, warPlayerHeight = 1.38, warCrouched = false;
let warRequiredHeadroom = 2.05;
let warSocket = null, warState = null, warPhase = 'waiting', warMyId = '', warSpawnInitialized = false, warLastInputAt = 0, warResultShown = false;
const warRemotePlayers = new Map(), warProjectiles = [], warBlastEffects = [];
const houseAssets = new Map(), sharedAssets = { enemy: null, flag: null, shield: null, grenade: null };
const grenadeWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
grenadeWorld.allowSleep = true;
const playerSize = new THREE.Vector3(.58, 1.38, .58);
let eyeHeight = 1.26;
// Keep actor meshes a little above the collision surface so thin GLB floor
// triangles and floating-point rounding never leave their feet below it.
const actorGroundClearance = .08;
let verticalVelocity = 0, grounded = false;
let aimPitch = 0, aimYaw = 0, recoilPitch = 0, recoilYaw = 0, gunKick = 0, aimHeld = false, hitmarkerTimeout = 0, announceTimeout = 0, damageTimeout = 0;
let reloading = false, reloadStage = '', reloadStartedAt = 0, reloadTimer = 0, reloadPending = null, reloadEndedHandler = null, reloadErrorHandler = null;
let leftMouseHeld = false, autoFireTimer = 0;
const reloadStartPosition = new THREE.Vector3(), reloadCenterPosition = new THREE.Vector3(0, 0, -.9), reloadRestScale = new THREE.Vector3(1, 1, 1), reloadLargeScale = new THREE.Vector3(1.75, 1.75, 1.75), reloadStartQuaternion = new THREE.Quaternion(), reloadSideQuaternion = new THREE.Quaternion(), reloadStartScale = new THREE.Vector3();
const gunData = { m1911: { label: 'M1911', capacity: 12, damage: 9, reserve: 84 }, bren2: { label: 'BREN 2', capacity: 15, damage: 5, reserve: 105 } };
let ammo = { m1911: 12, bren2: 15 }, reserves = { m1911: 84, bren2: 105 }, reloads = 2;

function show(...screens) { document.querySelectorAll('.screen').forEach(item => item.classList.remove('active')); screens.forEach(item => item.classList.add('active')); }
function loading(showing) { ui.loader.classList.toggle('show', showing); }
function resetWorld() { if(warSocket){warSocket.close();warSocket=null;}warMovementKeys.clear();keys.clear();scene.fog=new THREE.Fog(0x6e7678,42,170);warState=null;warPhase='waiting';warMyId='';warSpawnInitialized=false;warResultShown=false;warFloorRange=null;warLastSafePosition=null;for(const remote of warRemotePlayers.values())scene.remove(remote.model);warRemotePlayers.clear();for(const shot of warProjectiles){scene.remove(shot.mesh);shot.mesh.geometry.dispose();shot.mesh.material.dispose();}warProjectiles.length=0;for(const effect of warBlastEffects){scene.remove(effect.mesh);effect.mesh.geometry.dispose();effect.mesh.material.dispose();}warBlastEffects.length=0;for (const child of [...scene.children]) if (child !== scene.children[0] && child !== scene.children[1]) scene.remove(child); while(camera.children.length)camera.remove(camera.children[0]);for(const grenade of grenades)grenadeWorld.removeBody(grenade.body);grenades=[]; house = null; houseMeshes = []; floorCandidates = []; enemyTemplate = null; practiceGroup = null; practiceTarget = null; playerBody = null; flags = []; enemies = []; healthOrbs = []; gunRoot = null; shieldRoot = null; grenadeRoot = null; guns = {}; heldItem='gun'; }
function setHUD() { ui.hud.style.display = 'block'; ui.hud.classList.toggle('war-mode',mode==='war');ui.crosshair.style.display = 'block'; ui.objective.style.display = 'block'; $('health').style.display = mode !== 'practice' ? 'flex' : 'none';ui.warCountdown.classList.remove('visible'); }
function updateUI() { if(mode==='war'){const seconds=warState?.elapsed||0;ui.timer.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}.${Math.floor((seconds%1)*10)}`;ui.objective.textContent=`적 ${warState?.totalKills||0} / 20 · 보충 ${warState?.reinforcements||0} / 15`;if(warState){const me=warState.players.find(player=>player.id===warMyId);if(me){health=me.hp;shieldCharges=me.shieldCharges;grenadeCount=me.grenades;ammo={...ammo,...me.ammo};reserves={...reserves,...me.reserve};ui.hp.textContent=health;ui.hpBar.style.width=`${health/20*100}%`;}}ui.warScoreboard.textContent=(warState?.players||[]).map(player=>`${player.name}   ${player.kills} K   HP ${player.hp}`).join('\n');}else{const mins = Math.floor(Math.max(0, remaining) / 60), secs = Math.ceil(Math.max(0, remaining) % 60); ui.timer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`; ui.objective.textContent = mode === 'practice' ? `명중 ${levelHits} / 7` : `점령 ${captured} / 3`;ui.hp.textContent=health;ui.hpBar.style.width=`${(health/14)*100}%`;} if(heldItem==='shield'){ui.weapon.textContent='POLICE SHIELD';ui.mag.textContent=shieldCharges;ui.reserve.textContent='3';ui.reloads.textContent='방어 횟수';}else if(heldItem==='grenade'){ui.weapon.textContent='GRENADE';ui.mag.textContent=grenadeCount;ui.reserve.textContent='2';ui.reloads.textContent='우클릭 투척';}else{const data = gunData[currentGun]; ui.weapon.textContent = data.label; ui.mag.textContent = ammo[currentGun]; ui.reserve.textContent = mode==='war'?'∞':reserves[currentGun]; ui.reloads.textContent = reloading ? '재장전 중' : mode==='war' ? '재장전 제한 없음' : `재장전 ${reloads}`;} }
function announce(text, levelUp = false) { clearTimeout(announceTimeout); ui.level.textContent = text; ui.level.classList.toggle('level-up', levelUp); ui.level.classList.remove('visible'); void ui.level.offsetWidth; ui.level.classList.add('visible'); announceTimeout = setTimeout(() => ui.level.classList.remove('visible', 'level-up'), 1400); }
function setPointer(active) { pointer = active; if (!active && running) document.exitPointerLock?.(); }
function lockPointer() { try { const request=renderer.domElement.requestPointerLock?.(); if(request?.catch) request.catch(()=>{}); } catch {} }
function returnToLandingByOperator() {
  operatorReturnRequested = true;
  matchGeneration++;
  running = false;
  cancelReload();
  document.exitPointerLock?.();
  loading(false);
  ui.hud.style.display = 'none';
  resetWorld();
  scene.fog = new THREE.Fog(0x6e7678,42,170);
  show(ui.landing);
}

async function start() {
  playerName = ui.nameInput.value.trim(); if (!playerName) { ui.nameInput.focus(); return; }
  operatorReturnRequested = false;
  const thisMatch = ++matchGeneration;
  lockPointer(); running = false; loading(true); resetWorld();
  stopAutoFire();cancelReload(); elapsed = 0; score = 0; level = 1; levelHits = 0; health = mode==='war'?20:14; captured = 0; captureTime = 0; reloads = 2; ammo = { m1911: 12, bren2: 15 }; reserves = { m1911: 84, bren2: 105 }; currentGun = 'm1911'; heldItem='gun';shieldCharges=3;grenadeCount=2; remaining = mode === 'practice' ? 55 : 150; playerSize.set(.58,1.38,.58);eyeHeight=1.26;warActorHeight=1.38;warPlayerHeight=1.38;warCrouched=false;warRequiredHeadroom=2.05;verticalVelocity = 0; grounded = false; aimPitch = 0; aimYaw = 0; recoilPitch = 0; recoilYaw = 0; gunKick = 0; aimHeld = false; clearTimeout(hitmarkerTimeout); clearTimeout(announceTimeout); clearTimeout(damageTimeout); ui.hitmarker.classList.remove('visible', 'kill'); ui.level.classList.remove('visible', 'level-up'); ui.damage.classList.remove('active');
  try { if (mode === 'practice') await createPractice(); else if(mode==='cqb') await createCQB(); else await createWar(); await attachGun(); } catch (error) { console.warn(error);running=false;loading(false);if(mode==='war'){warSocket?.close();warSocket=null;scene.fog=new THREE.Fog(0x6e7678,42,170);ui.mode.textContent=`WAR · ${error.message||'서버/맵 연결 실패'}`;show(ui.name);return;}announce('모델 로딩 오류 — 대체 훈련 구역'); if (mode === 'practice') createPracticeFallback(); else createCQBFallback(); }
  if (thisMatch !== matchGeneration || operatorReturnRequested) { loading(false); return; }
  loading(false); show(); setHUD(); updateUI(); running = true; lockPointer();
  if (mode === 'practice') announce('LEVEL 1');
}
function floorPlane(size = 150) { const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x52595a, roughness: .93 })); plane.rotation.x = -Math.PI / 2; plane.receiveShadow = true; scene.add(plane); return plane; }
async function createPractice() { createPracticeFallback(); }
function createPracticeFallback() {
  floorPlane(); practiceGroup = new THREE.Group(); scene.add(practiceGroup); camera.position.set(0, 1.65, 12); camera.rotation.set(0, 0, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(44, 10, .5), new THREE.MeshStandardMaterial({ color: 0x3e4545 })); back.position.set(0, 5, -20); back.receiveShadow = true; practiceGroup.add(back);
  const targetGroup = new THREE.Group(); const stand = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, 3), new THREE.MeshStandardMaterial({ color: 0x252b2c })); stand.position.y = -1.5; targetGroup.add(stand);
  const rings = [[1.1, 0xe9e6dc], [.76, 0x222527], [.49, 0xe8e5dc], [.24, 0x932e2e], [.09, 0xe4d8a5]]; rings.forEach(([radius, color], index) => { const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), new THREE.MeshBasicMaterial({ color })); mesh.position.z = .05 + index * .002; targetGroup.add(mesh); });
  targetGroup.position.set(0, 3.1, -17); targetGroup.userData.target = true; practiceTarget = targetGroup; practiceGroup.add(targetGroup);
}
function houseMeshList(root) { const meshes = []; root.traverse(node => { if (node.isMesh) { node.castShadow = false; node.receiveShadow = true; for(const material of (Array.isArray(node.material)?node.material:[node.material])) if(material) material.side=THREE.DoubleSide; meshes.push(node); } }); return meshes; }
async function optimizeStaticMap(meshes) { const geometries=[...new Set(meshes.map(mesh=>mesh.geometry))].filter(geometry=>geometry.attributes.position?.count>48&&!geometry.boundsTree);for(let index=0;index<geometries.length;index++){try{geometries[index].computeBoundsTree({maxLeafTris:24,maxDepth:40});}catch(error){console.warn('Map mesh acceleration skipped for one geometry.',error);}if(index%2===1)await new Promise(resolve=>requestAnimationFrame(resolve));} }
async function loadHouseModel(name) {
  if (!houseAssets.has(name)) houseAssets.set(name, loader.loadAsync(`/models/${name}.glb`).then(gltf => gltf.scene).catch(error => { houseAssets.delete(name); throw error; }));
  return (await houseAssets.get(name)).clone(true);
}
async function loadSharedModel(key, url, fallback) {
  if (!sharedAssets[key]) sharedAssets[key] = loader.loadAsync(url).then(gltf => gltf.scene).catch(() => fallback());
  return sharedAssets[key];
}
async function createCQB() {
  house = await loadHouseModel(selectedMap); const rawBox = new THREE.Box3().setFromObject(house); const center = rawBox.getCenter(new THREE.Vector3()), mapScale = selectedMap === 'house_A' ? .75 : 1; house.scale.setScalar(mapScale); house.position.copy(center).multiplyScalar(-mapScale); house.rotation.y = 0; scene.add(house); house.updateMatrixWorld(true); mapBox.setFromObject(house); houseMeshes = houseMeshList(house); await optimizeStaticMap(houseMeshes);
  floorCandidates = findInteriorFloors();
  const spawn = floorCandidates.length ? floorCandidates[Math.floor(floorCandidates.length / 2)].clone() : (floorPoint(new THREE.Vector3(0,mapBox.max.y+10,0)) || new THREE.Vector3(0,mapBox.min.y+.1,0));
  setPlayerPosition(spawn); camera.rotation.set(0, 0, 0);
  await makeFlags(); await makeEnemies(); await makeOrbs();
}
async function createWar() {
  house=await loadHouseModel('arena');
  const rawBox=new THREE.Box3().setFromObject(house),center=rawBox.getCenter(new THREE.Vector3());
  // Scale the supplied arena to the game world; all walking/collision surfaces
  // still come directly from this mesh (no artificial ground is added).
  const sourceSize=rawBox.getSize(new THREE.Vector3()),mapScale=36/Math.max(sourceSize.x,sourceSize.z,.01);
  house.scale.setScalar(mapScale);house.position.copy(center).multiplyScalar(-mapScale);house.rotation.y=0;scene.add(house);house.updateMatrixWorld(true);
  mapBox.setFromObject(house);houseMeshes=houseMeshList(house);
  // The earlier half-map-height ratio made both sides oversized; WAR actors
  // now use a quarter of the normalized map height (half their previous size).
  warActorHeight=Math.max(.1,(mapBox.max.y-mapBox.min.y)*.25);warPlayerHeight=warActorHeight;
  eyeHeight=warPlayerHeight*.9;playerSize.set(warActorHeight*.38,warPlayerHeight,warActorHeight*.38);
  warRequiredHeadroom=warActorHeight+.18;
  await optimizeStaticMap(houseMeshes);
  floorCandidates=findWarWalkableSurfaces();
  if(floorCandidates.length<12)throw new Error('arena 맵에서 플레이어 크기에 맞는 연속된 실제 바닥을 찾지 못했습니다.');
  const spawn=findArenaSignSpawn()||floorCandidates[Math.floor(Math.random()*floorCandidates.length)].clone();
  setPlayerPosition(spawn);aimYaw=Math.atan2(spawn.x,spawn.z);aimPitch=0;camera.rotation.set(0,aimYaw,0,'YXZ');
  const enemyAsset=await loadSharedModel('enemy','/models/enemy.glb',enemyFallback);enemyTemplate=enemyAsset.clone(true);
  enemyTemplate.traverse(node=>{if(!node.isMesh)return;const shade=material=>{const copy=material.clone();copy.color.multiplyScalar(.78);return copy;};node.material=Array.isArray(node.material)?node.material.map(shade):shade(node.material);});
  scene.fog=new THREE.Fog(0x6e7678,48,92);await joinWar();
}
function styleWarMap(root) {
  const palette=[0x77725f,0x62685e,0x817560,0x555d58,0x6b6759,0x4e5954,0x746b5a,0x5d625b];let index=0;
  root.traverse(node=>{if(!node.isMesh)return;for(const material of (Array.isArray(node.material)?node.material:[node.material]))if(material){material.color.setHex(palette[index%palette.length]);material.roughness=.92;material.metalness=0;}index++;});
}
function joinWar() {
  return new Promise((resolve,reject)=>{
    const scheme=location.protocol==='https:'?'wss':'ws';warSocket=new WebSocket(`${scheme}://${location.host}/war`);let settled=false;const timeout=setTimeout(()=>{if(!settled){settled=true;reject(new Error('WAR server timeout'));}},12000);
    warSocket.addEventListener('open',()=>{const preferred=findArenaSignSpawn()||floorCandidates[0],count=Math.min(159,floorCandidates.length),samples=[preferred,...Array.from({length:count},(_,index)=>floorCandidates[Math.floor(index*(floorCandidates.length-1)/Math.max(1,count-1))])].map(point=>({x:point.x,y:point.y,z:point.z}));warSocket.send(JSON.stringify({type:'join',data:{name:playerName,actorHeight:warActorHeight,crouched:false,preferredSpawn:{x:preferred.x,y:preferred.y,z:preferred.z},floorPoints:samples}}));});
    warSocket.addEventListener('message',event=>{
      let packet;try{packet=JSON.parse(event.data);}catch{return;}
      if(packet.type==='error'){clearTimeout(timeout);settled=true;reject(new Error(packet.data?.message||'WAR join failed'));return;}
      if(packet.type==='welcome'){
        warMyId=packet.data.id;
        if(packet.data.spawn){
          const p=packet.data.spawn,point=new THREE.Vector3(p.x,p.y,p.z),surface=warGroundSurfaceAt(point.x,point.z,point.y);
          if(!surface||Math.abs(surface.point.y-point.y)>.42){clearTimeout(timeout);settled=true;warSocket.close();reject(new Error('서버 스폰 위치가 이 브라우저에서 확인한 경기장 바닥과 일치하지 않습니다. 다시 접속해 주세요.'));return;}
          point.y=surface.point.y;setPlayerPosition(point);warLastSafePosition=point.clone();aimYaw=Math.atan2(point.x,point.z);aimPitch=0;camera.rotation.set(0,aimYaw,0,'YXZ');
        }
        return;
      }
      if(packet.type==='state'){handleWarState(packet.data);if(!settled){settled=true;clearTimeout(timeout);resolve();}}
      else if(packet.type==='enemy-shot')receiveEnemyShot(packet.data);
      else if(packet.type==='blast')showWarBlast(packet.data);
      else if(packet.type==='ammo'){ammo[packet.data.weapon]=packet.data.magazine;reserves[packet.data.weapon]=packet.data.reserve;reloads=packet.data.reloads;updateUI();}
      else if(packet.type==='fire-result'){
        const target=enemies.find(enemy=>enemy.userData.warId===packet.data.enemyId);
        if(target&&Number.isFinite(packet.data.hp))target.userData.health=packet.data.hp;
        if(packet.data.hit)showHitmarker(packet.data.killed);
        else if(packet.data.enemyId)playRicochet();
      }
    });
    warSocket.addEventListener('error',()=>{if(!settled){settled=true;clearTimeout(timeout);reject(new Error('WAR WebSocket connection failed'));}});
    warSocket.addEventListener('close',event=>{if(event.code===4001){returnToLandingByOperator();return;}if(running&&mode==='war'&&warPhase!=='finished'){announce('서버 연결이 끊겼습니다');running=false;}});
  });
}
function sendWar(type,data={}) { if(warSocket?.readyState===WebSocket.OPEN)warSocket.send(JSON.stringify({type,data})); }
function handleWarState(state) {
  const oldHp=warState?.players.find(player=>player.id===warMyId)?.hp;warState=state;warPhase=state.phase;const me=state.players.find(player=>player.id===warMyId);
  if(me){if(!warMyId)warMyId=me.id;if(!warSpawnInitialized&&(state.phase==='waiting'||state.phase==='countdown'))warSpawnInitialized=true;if(oldHp!==undefined&&me.hp<oldHp)flashDamage();if(heldItem==='shield'&&me.shieldCharges<=0)stowHeldItem();}
  const wanted=new Set();for(const data of state.enemies){wanted.add(data.id);let enemy=enemies.find(item=>item.userData.warId===data.id);if(!enemy){enemy=createWarEnemy(data);enemies.push(enemy);scene.add(enemy);}enemy.userData.netTarget.set(data.x,data.y+actorGroundClearance,data.z);enemy.rotation.y=data.yaw;enemy.userData.health=data.hp;}
  for(const enemy of [...enemies])if(enemy.userData.warId&&!wanted.has(enemy.userData.warId)){scene.remove(enemy);enemies=enemies.filter(item=>item!==enemy);}
  const remoteIds=new Set();for(const player of state.players){if(player.id===warMyId)continue;remoteIds.add(player.id);let remote=warRemotePlayers.get(player.id);if(!remote){const model=createWarAvatar(player.name);remote={model,target:new THREE.Vector3(player.x,player.y+actorGroundClearance,player.z),yaw:player.yaw,actorHeight:player.actorHeight||warActorHeight};warRemotePlayers.set(player.id,remote);scene.add(model);}remote.target.set(player.x,player.y+actorGroundClearance,player.z);remote.yaw=player.yaw;remote.actorHeight=player.actorHeight||warActorHeight;}
  for(const [id,remote] of warRemotePlayers)if(!remoteIds.has(id)){scene.remove(remote.model);warRemotePlayers.delete(id);}
  if(state.phase==='waiting'){ui.warCountdown.classList.remove('visible');ui.warCountdown.textContent='';}
  if(state.phase==='countdown'){ui.warCountdown.classList.add('visible');const count=Math.max(1,Math.ceil((state.countdownEndsAt-Date.now())/1000));ui.warCountdown.textContent=String(count);}
  if(state.phase==='running'){ui.warCountdown.classList.remove('visible');ui.warCountdown.textContent='';}
  if(state.phase==='finished')finishWar(state.result||'VICTORY');updateUI();
}
function createWarEnemy(data) {
  const model=enemyTemplate.clone(true);model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),scale=warActorHeight/Math.max(size.y,.01);model.scale.multiplyScalar(scale);model.position.add(new THREE.Vector3(-center.x*scale,-box.min.y*scale,-center.z*scale));const root=new THREE.Group();root.add(model);root.position.set(data.x,data.y+actorGroundClearance,data.z);root.rotation.y=data.yaw;root.userData.enemy=true;root.userData.warId=data.id;root.userData.health=data.hp;root.userData.netTarget=new THREE.Vector3(root.position.x,root.position.y,root.position.z);root.traverse(node=>{if(node.isMesh){node.castShadow=false;node.userData.enemyRoot=root;}});return root;
}
function createWarAvatar(name='ALLY') { const h=warActorHeight,r=h*.15,group=new THREE.Group(),material=new THREE.MeshStandardMaterial({color:0x486c8c,emissive:0x172839,emissiveIntensity:.28,roughness:.82}),body=new THREE.Mesh(new THREE.CapsuleGeometry(r,h*.7,3,7),material),head=new THREE.Mesh(new THREE.SphereGeometry(r*.78,8,6),new THREE.MeshStandardMaterial({color:0xb88969,roughness:.86}));body.position.y=h*.42;head.position.y=h*.88;group.add(body,head);const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const context=canvas.getContext('2d');context.fillStyle='rgba(19,26,28,.82)';context.fillRect(4,5,248,54);context.fillStyle='#e6e0d2';context.font='600 27px system-ui, sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText(String(name).slice(0,18),128,32);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));label.position.y=h*1.05;label.scale.set(h*1.05,h*.26,1);group.add(label);return group; }
function receiveEnemyShot(data) { const geometry=new THREE.SphereGeometry(.055,6,5),material=new THREE.MeshBasicMaterial({color:0xffd48a}),mesh=new THREE.Mesh(geometry,material);mesh.position.set(data.origin.x,data.origin.y,data.origin.z);scene.add(mesh);warProjectiles.push({id:data.id,targetId:data.targetId,origin:new THREE.Vector3(data.origin.x,data.origin.y,data.origin.z),direction:new THREE.Vector3(data.direction.x,data.direction.y,data.direction.z),distance:data.distance,speed:data.speed||34,traveled:0,mesh,resolved:false}); }
function showWarBlast(data) { const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial({color:0xffb34f,transparent:true,opacity:.62,depthWrite:false,wireframe:true}));mesh.position.set(data.x,data.y,data.z);mesh.scale.setScalar(.2);scene.add(mesh);warBlastEffects.push({mesh,started:performance.now(),duration:560}); }
function finishWar(outcome) { if(warResultShown)return;warResultShown=true;warPhase='finished';running=false;cancelReload();document.exitPointerLock?.();ui.hud.style.display='none';ui.resultMode.textContent='WAR · ARENA';ui.resultTitle.textContent=outcome==='VICTORY'?'작전 성공':outcome==='DEFEAT'?'작전 실패':'매치 종료';const elapsedTime=warState?.elapsed||0,kills=warState?.players.reduce((sum,player)=>sum+player.kills,0)||0;ui.resultScore.textContent=`${Math.floor(elapsedTime/60)}:${String(Math.floor(elapsedTime%60)).padStart(2,'0')} · 팀 처치 ${kills} / 20`;ui.ranks.innerHTML='<li><span>기록 저장</span><span>rank_war.txt</span></li>';show(ui.result); }
function createCQBFallback() { floorPlane(140); const shell = new THREE.Mesh(new THREE.BoxGeometry(55, 5, 55), new THREE.MeshBasicMaterial({ color:0x4b5252, wireframe:true })); shell.position.y = 2.5; scene.add(shell); mapBox.set(new THREE.Vector3(-27, 0, -27), new THREE.Vector3(27, 8, 27)); houseMeshes = [shell]; floorCandidates = []; for(let x=-20;x<=20;x+=5)for(let z=-20;z<=20;z+=5)floorCandidates.push(new THREE.Vector3(x,0,z)); setPlayerPosition(new THREE.Vector3(0,0,8)); camera.rotation.set(0,0,0); makeFlags(); makeEnemies(); makeOrbs(); }
function setPlayerPosition(feetPosition) { const feet=feetPosition.clone();feet.y+=actorGroundClearance;if(playerBody)scene.remove(playerBody);playerBody=new THREE.Mesh(new THREE.BoxGeometry(playerSize.x,playerSize.y,playerSize.z),new THREE.MeshBasicMaterial({color:0xe9e7df,transparent:true,opacity:.08,depthWrite:false}));playerBody.position.set(feet.x,feet.y+playerSize.y/2,feet.z);playerBody.userData.player=true;scene.add(playerBody);camera.position.set(feet.x,feet.y+eyeHeight,feet.z);grounded=true;verticalVelocity=0;camera.userData.capturePosition=feet.clone(); }
function setWarCrouched(crouched) {
  if(mode!=='war'||!running||warPhase==='finished'||warCrouched===crouched)return;
  const feet=feetPosition();
  warCrouched=crouched;
  warPlayerHeight=warActorHeight*(warCrouched ? 0.75 : 1);
  playerSize.y=warPlayerHeight;
  eyeHeight=warPlayerHeight*.9;
  warRequiredHeadroom=warPlayerHeight+.18;
  camera.position.y=feet.y+eyeHeight+actorGroundClearance;
  if(playerBody){playerBody.geometry.dispose();playerBody.geometry=new THREE.BoxGeometry(playerSize.x,playerSize.y,playerSize.z);playerBody.position.set(camera.position.x,feet.y+actorGroundClearance+playerSize.y/2,camera.position.z);}
  sendWar('input',{x:feet.x,y:feet.y-actorGroundClearance,z:feet.z,yaw:aimYaw,pitch:aimPitch,crouched:warCrouched,actorHeight:warPlayerHeight,visibleEnemies:[]});
}
function isWalkableHit(hit, headroom=1.52) {
  if(!hit.face)return false;
  const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if(normal.y<.78)return false;
  raycaster.set(hit.point.clone().add(new THREE.Vector3(0,.08,0)),new THREE.Vector3(0,1,0));raycaster.far=headroom;
  const ceiling=raycaster.intersectObjects(houseMeshes,false)[0];
  return !ceiling||ceiling.distance>=headroom-.04;
}
function findInteriorFloors() { const candidates=[],spanX=mapBox.max.x-mapBox.min.x,spanZ=mapBox.max.z-mapBox.min.z,height=mapBox.max.y-mapBox.min.y,up=new THREE.Vector3(0,1,0),down=new THREE.Vector3(0,-1,0);for(let ix=1;ix<10;ix++)for(let iz=1;iz<10;iz++){const x=mapBox.min.x+spanX*ix/10,z=mapBox.min.z+spanZ*iz/10;raycaster.set(new THREE.Vector3(x,mapBox.max.y+3,z),down);raycaster.far=height+8;const hits=raycaster.intersectObjects(houseMeshes,false);for(const hit of hits){if(!isWalkableHit(hit))continue;candidates.push(hit.point.clone());break;}}return candidates; }
// arena.glb is one merged mesh. Sample actual upward-facing triangles, then
// retain its largest connected, near-level surface without adding a floor.
function findWarWalkableSurfaces() {
  const spanX=mapBox.max.x-mapBox.min.x,spanZ=mapBox.max.z-mapBox.min.z,height=mapBox.max.y-mapBox.min.y;
  const columns=72,stepX=spanX/(columns+1),stepZ=spanZ/(columns+1),down=new THREE.Vector3(0,-1,0),cells=new Array(columns*columns);
  for(let ix=0;ix<columns;ix++)for(let iz=0;iz<columns;iz++){
    const x=mapBox.min.x+stepX*(ix+1),z=mapBox.min.z+stepZ*(iz+1);
    raycaster.set(new THREE.Vector3(x,mapBox.max.y+Math.max(1,height*.01),z),down);raycaster.far=height+4;
    let lowest=null;
    for(const hit of raycaster.intersectObjects(houseMeshes,false)){
      if(lowest&&hit.point.y>=lowest.y-.02)continue;
      if(!isWalkableHit(hit,warRequiredHeadroom)||!warBodyHasClearance(hit.point)||!warFloorHasFooting(hit.point))continue;
      lowest=hit.point;
    }
    if(lowest)cells[ix*columns+iz]={ix,iz,x,y:lowest.y,z};
  }

  const visited=new Uint8Array(cells.length),components=[];
  for(let index=0;index<cells.length;index++){
    const seed=cells[index];if(!seed||visited[index])continue;
    const queue=[seed],component=[];visited[index]=1;
    for(let cursor=0;cursor<queue.length;cursor++){
      const cell=queue[cursor];component.push(cell);
      for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]){
        const ix=cell.ix+dx,iz=cell.iz+dz;if(ix<0||ix>=columns||iz<0||iz>=columns)continue;
        const nextIndex=ix*columns+iz,next=cells[nextIndex];if(!next||visited[nextIndex])continue;
        // A local step may not bridge stair risers, and the whole component
        // must remain a single floor level instead of walking up a seating tier.
        if(Math.abs(next.y-cell.y)>.18||Math.abs(next.y-seed.y)>.32)continue;
        visited[nextIndex]=1;queue.push(next);
      }
    }
    if(component.length<12)continue;
    const xs=component.map(point=>point.x),zs=component.map(point=>point.z),ys=component.map(point=>point.y);
    const bounds={minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};
    if(bounds.maxX-bounds.minX<2.1||bounds.maxZ-bounds.minZ<2.1)continue;
    ys.sort((a,b)=>a-b);
    components.push({cells:component,bounds,minY:ys[0],maxY:ys.at(-1),medianY:ys[Math.floor(ys.length/2)]});
  }
  components.sort((a,b)=>b.cells.length-a.cells.length||a.medianY-b.medianY);
  const arena=components[0];
  if(!arena)return [];
  warFloorRange={min:arena.minY-.24,max:arena.maxY+.24};
  return arena.cells.map(point=>new THREE.Vector3(point.x,point.y,point.z));
}
function findArenaSignSpawn() {
  // The arena GLB is a single merged mesh with its entrance sign baked into
  // the texture. The sign sits at the front edge; use the actual sampled floor
  // points nearest that edge, never a guessed y-coordinate or a helper plane.
  if(!floorCandidates.length)return null;
  const center=mapBox.getCenter(new THREE.Vector3()),horizontal=mapBox.getSize(new THREE.Vector3());
  const candidates=floorCandidates.filter(point=>Math.abs(point.x-center.x)<horizontal.x*.24);
  if(!candidates.length)return null;
  candidates.sort((a,b)=>b.z-a.z);
  const frontZ=candidates[0].z,frontBand=candidates.filter(point=>point.z>=frontZ-horizontal.z*.07);
  const spawn=frontBand[Math.floor(frontBand.length/2)];
  return spawn?.clone()||null;
}
function warBodyHasClearance(floorPoint) {
  const bodyRadius=playerSize.x*.5,origin=new THREE.Vector3(floorPoint.x,floorPoint.y+.12,floorPoint.z),directions=8,heights=[.08,warActorHeight*.34,warActorHeight*.72];
  for(let index=0;index<directions;index++){
    const angle=index*Math.PI*2/directions,direction=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
    for(const height of heights){
      raycaster.set(origin.clone().add(new THREE.Vector3(0,height,0)),direction);raycaster.far=bodyRadius+.08;
      const obstruction=intersectFirst(houseMeshes).find(hit=>hit.distance>.035&&hit.distance<bodyRadius+.04&&hit.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).dot(direction)<-.08);
      if(obstruction)return false;
    }
  }
  return true;
}
function warFloorHasFooting(floorPoint) {
  let support=0;
  // Check the full actor footprint. Narrow upward-facing props are not stable
  // support surfaces and must not become spawn/landing points.
  const radius=playerSize.x*.5;
  for(const [dx,dz] of [[-radius,0],[radius,0],[0,-radius],[0,radius]]){
    raycaster.set(new THREE.Vector3(floorPoint.x+dx,floorPoint.y+.24,floorPoint.z+dz),new THREE.Vector3(0,-1,0));raycaster.far=.62;
    const hit=intersectFirst(houseMeshes).find(candidate=>candidate.face&&candidate.point.y>=floorPoint.y-.28&&candidate.point.y<=floorPoint.y+.12&&candidate.face.normal.clone().transformDirection(candidate.object.matrixWorld).y>=.78);
    if(hit)support++;
  }
  // Require a broad patch on the supplied GLB mesh, not an invented plane.
  return support>=3;
}
function floorPoint(point) { if(!houseMeshes.length)return new THREE.Vector3(point.x,0,point.z);raycaster.set(new THREE.Vector3(point.x,mapBox.max.y+3,point.z),new THREE.Vector3(0,-1,0));raycaster.far=mapBox.max.y-mapBox.min.y+8;const hits=raycaster.intersectObjects(houseMeshes,false);const floor=hits.find(hit=>hit.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y>.68&&hit.point.y<=mapBox.min.y+(mapBox.max.y-mapBox.min.y)*.72);return floor?.point||null; }
function intersectFirst(objects) { raycaster.firstHitOnly=true;try{return raycaster.intersectObjects(objects,true);}finally{raycaster.firstHitOnly=false;} }
function mapPosition(seed=Math.random(),occupied=[],minimumDistance=3) { if(floorCandidates.length){const offset=Math.floor(Math.random()*floorCandidates.length);for(let step=0;step<floorCandidates.length;step++){const candidate=floorCandidates[(offset+step)%floorCandidates.length];if(occupied.every(point=>point.distanceToSquared(candidate)>minimumDistance*minimumDistance))return candidate.clone();}return floorCandidates[offset].clone();}const width=mapBox.max.x-mapBox.min.x,depth=mapBox.max.z-mapBox.min.z,angle=Math.random()*Math.PI*2;return floorPoint(new THREE.Vector3(Math.cos(angle)*width*.25,mapBox.max.y+20,Math.sin(angle)*depth*.25))||new THREE.Vector3(0,mapBox.min.y,0); }
const auraTexture = (() => { const size=24,data=new Uint8Array(size*size*4),center=(size-1)/2;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const radius=Math.min(1,Math.hypot(x-center,y-center)/center),alpha=Math.round(Math.pow(1-radius,2.2)*150),index=(y*size+x)*4;data[index]=90;data[index+1]=166;data[index+2]=255;data[index+3]=alpha;}const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.needsUpdate=true;return texture; })();
const auraMaterial = new THREE.SpriteMaterial({ map:auraTexture, transparent:true, opacity:.72, depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false });
async function makeFlags() { const source=await loadSharedModel('flag','/models/flag_in_the_wind.glb',flagFallback);const placed=[];for(let i=0;i<3;i++){const pos=mapPosition(Math.random(),placed,6);placed.push(pos);const flag=source.clone(true);flag.position.copy(pos);flag.rotation.y=Math.random()*Math.PI*2;flag.scale.setScalar(1.1/3);flag.userData.flag=true;flag.userData.capturePoint=pos.clone();const aura=new THREE.Sprite(auraMaterial);aura.position.y=4.35;aura.scale.set(10.8,10.8,1);flag.add(aura);scene.add(flag);flags.push(flag);} }
function flagFallback() { const group = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,2.6), new THREE.MeshStandardMaterial({color:0xddddcf})); pole.position.y=1.3; const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1,.65),new THREE.MeshStandardMaterial({color:0x65746a,side:THREE.DoubleSide})); cloth.position.set(.55,2.15,0);group.add(pole,cloth);return group; }
async function makeEnemies() { enemyTemplate=await loadSharedModel('enemy','/models/enemy.glb',enemyFallback);for(let i=0;i<3;i++)spawnEnemy(enemyTemplate,Math.random()); }
function enemyFallback() { const g=new THREE.Group(); const body=new THREE.Mesh(new THREE.CapsuleGeometry(.28,1.15,4,8),new THREE.MeshStandardMaterial({color:0x49504a}));body.position.y=1;g.add(body);return g; }
function spawnEnemy(source, seed) { const model=source.clone(true);model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());const height=Math.max(size.y,.01),scale=1.25/height;model.scale.multiplyScalar(scale);model.position.add(new THREE.Vector3(-center.x*scale,-bounds.min.y*scale,-center.z*scale));const enemy=new THREE.Group();enemy.add(model);const occupied=[camera.position,...enemies.map(item=>item.position),...flags.map(flag=>flag.userData.capturePoint)],pos=mapPosition(seed+Math.random()*.1,occupied);enemy.position.copy(pos);enemy.updateMatrixWorld(true);const worldBounds=new THREE.Box3().setFromObject(enemy);enemy.position.y+=pos.y+actorGroundClearance-worldBounds.min.y;enemy.userData.enemy=true;enemy.userData.health=10;enemy.userData.nextShot=elapsed+1.8+Math.random()*1.1;enemy.userData.navSide=Math.random()<.5?-1:1;enemy.traverse(n=>{if(n.isMesh){n.castShadow=false;n.userData.enemyRoot=enemy;}});scene.add(enemy);enemies.push(enemy); }
async function makeOrbs() { for(let i=0;i<3;i++) spawnOrb(Math.random()); }
const orbGeometry=new THREE.SphereGeometry(.18,12,8),orbMaterial=new THREE.MeshStandardMaterial({color:0x67ae70,emissive:0x1e542e,emissiveIntensity:.75,roughness:.25});
function spawnOrb(seed) { const occupied=[camera.position,...flags.map(flag=>flag.userData.capturePoint),...enemies.map(enemy=>enemy.position),...healthOrbs.map(orb=>orb.position)];const orb=new THREE.Mesh(orbGeometry,orbMaterial);orb.position.copy(mapPosition(seed,occupied,3));orb.position.y+=.42;orb.userData.orb=true;orb.userData.baseY=orb.position.y;orb.userData.phase=Math.random()*6.28;scene.add(orb);healthOrbs.push(orb); }
async function attachGun() { const group = new THREE.Group(); group.position.set(.2,-.25,-.52); group.rotation.set(-.08,-.23,0); camera.add(group); scene.add(camera); gunRoot = group; await changeGun('m1911'); }
async function createHeldModel(kind) {
  if(kind==='shield') {
    // Police Shield.glb contains four ~140k-vertex material primitives. A
    // compact geometric stand-in keeps the same held-shield role without the
    // large per-frame vertex and fragment cost on Raspberry Pi-class GPUs.
    const outline=new THREE.Shape();
    outline.moveTo(0,.59);outline.lineTo(-.35,.53);outline.lineTo(-.41,.30);outline.lineTo(-.34,-.30);outline.lineTo(0,-.59);outline.lineTo(.34,-.30);outline.lineTo(.41,.30);outline.lineTo(.35,.53);outline.closePath();
    const geometry=new THREE.ExtrudeGeometry(outline,{depth:.055,bevelEnabled:false,curveSegments:1,steps:1});
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x3d484a}));
    mesh.position.z=-.0275;
    const panelShape=new THREE.Shape();panelShape.moveTo(-.28,.36);panelShape.lineTo(.28,.36);panelShape.lineTo(.27,-.20);panelShape.lineTo(0,-.47);panelShape.lineTo(-.27,-.20);panelShape.closePath();
    const panel=new THREE.Mesh(new THREE.ShapeGeometry(panelShape),new THREE.MeshBasicMaterial({color:0x566164,side:THREE.DoubleSide}));
    panel.position.z=.029;
    const held=new THREE.Group();held.add(mesh,panel);held.position.set(.3,-.08,-1.02);held.rotation.y=Math.PI;held.userData.readyPosition=held.position.clone();held.visible=false;camera.add(held);return held;
  }
  const key='grenade',url='/models/grenade.glb',targetHeight=.24;
  const fallback=()=>new THREE.Mesh(new THREE.BoxGeometry(kind==='shield'?.82:.22,targetHeight,.07),new THREE.MeshStandardMaterial({color:kind==='shield'?0x34404a:0x475142,metalness:.25,roughness:.6}));
  const source=await loadSharedModel(key,url,fallback),model=source.clone(true);model.updateMatrixWorld(true);const core=kind==='grenade'?(model.getObjectByName('body')||model):model,bounds=new THREE.Box3().setFromObject(core),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),scale=targetHeight/Math.max(size.y,.01);model.scale.multiplyScalar(scale);model.position.addScaledVector(center,-scale);
  const held=new THREE.Group();held.add(model);if(kind==='shield'){held.position.set(.3,-.08,-1.02);held.rotation.y=Math.PI;}else{held.position.set(.27,-.2,-.7);held.rotation.set(.1,Math.PI,0);}held.userData.readyPosition=held.position.clone();held.visible=false;camera.add(held);return held;
}
async function toggleShield() {
  if(!running||(mode!=='cqb'&&mode!=='war')||(mode==='war'&&(warPhase!=='running'||health<=0))||shieldCharges<=0||reloading)return;
  if(heldItem==='shield'){stowHeldItem();return;}
  try{if(!shieldRoot)shieldRoot=await createHeldModel('shield');}catch(error){console.warn('Shield model could not be loaded.',error);announce('방패 모델을 불러오지 못했습니다');return;}
  if(!running)return;if(shieldRoot.parent!==camera)camera.add(shieldRoot);heldItem='shield';aimHeld=false;gunRoot.visible=false;if(grenadeRoot)grenadeRoot.removeFromParent();shieldRoot.visible=true;shieldRoot.userData.raisedAt=performance.now();shieldRoot.position.y=shieldRoot.userData.readyPosition.y-1.15;if(mode==='war')sendWar('equipment',{shieldActive:true});updateUI();
}
async function selectGrenade() {
  if(!running||(mode!=='cqb'&&mode!=='war')||(mode==='war'&&(warPhase!=='running'||health<=0))||reloading)return;
  if(grenadeCount<=0){announce('수류탄이 없습니다');return;}
  try{if(!grenadeRoot)grenadeRoot=await createHeldModel('grenade');}catch(error){console.warn('Grenade model could not be loaded.',error);announce('수류탄 모델을 불러오지 못했습니다');return;}
  if(!running)return;if(grenadeRoot.parent!==camera)camera.add(grenadeRoot);heldItem='grenade';aimHeld=false;gunRoot.visible=false;if(shieldRoot)shieldRoot.removeFromParent();if(mode==='war')sendWar('equipment',{shieldActive:false});grenadeRoot.visible=true;grenadeRoot.userData.raisedAt=performance.now();grenadeRoot.position.y=grenadeRoot.userData.readyPosition.y-.34;updateUI();
}
function stowHeldItem() { if(gunRoot)gunRoot.visible=true;if(shieldRoot)shieldRoot.removeFromParent();if(grenadeRoot)grenadeRoot.removeFromParent();heldItem='gun';aimHeld=false;if(mode==='war')sendWar('equipment',{shieldActive:false});ui.crosshair.style.transform='translate(-50%,-50%)';updateUI(); }
async function changeGun(name) {
  if (reloading) return;
  if(heldItem!=='gun')stowHeldItem();
  currentGun = name;
  if (!gunRoot) return;
  while (gunRoot.children.length) gunRoot.remove(gunRoot.children[0]);
  if (!guns[name]) {
    try { guns[name] = name === 'm1911' ? await objLoader.loadAsync('/models/weapon/guns/m1911/M1911.obj') : (await loader.loadAsync('/models/weapon/guns/bren2/bren2.glb')).scene; }
    catch { guns[name] = new THREE.Mesh(new THREE.BoxGeometry(.13,.13,.55),new THREE.MeshStandardMaterial({color:0x252525,metalness:.7,roughness:.3})); }
  }
  const weapon = guns[name].clone(true);
  weapon.scale.setScalar(name === 'm1911' ? 1.4 : .10);
  weapon.rotation.set(0, Math.PI, 0);
  if (name === 'm1911') {
    const steel = new THREE.MeshStandardMaterial({ color: 0x444746, metalness: .62, roughness: .38 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x191c1b, metalness: .12, roughness: .72 });
    weapon.traverse(part => { if (part.isMesh) { part.material = /grip/i.test(part.name) ? grip : steel; part.castShadow = false; } });
  }
  gunRoot.add(weapon);
  if(mode==='war')sendWar('weapon',{weapon:name});
  updateUI();
}
function enemyRoot(object) { let node = object; while(node) { if(node.userData?.enemy) return node; node=node.parent; } return null; }
function showHitmarker(kill = false) { clearTimeout(hitmarkerTimeout); ui.hitmarker.classList.toggle('kill', kill); ui.hitmarker.classList.remove('visible'); void ui.hitmarker.offsetWidth; ui.hitmarker.classList.add('visible'); hitmarkerTimeout = setTimeout(() => ui.hitmarker.classList.remove('visible', 'kill'), kill ? 230 : 155); }
function playGunshot() { const sound=gameAudio.gunshot;sound.pause();sound.currentTime=0;sound.volume=.68;sound.play().catch(()=>{}); }
function playEmptyClick() { const sound=gameAudio.emptyClick;sound.pause();sound.currentTime=0;sound.volume=.7;sound.play().catch(()=>{}); }
function playRicochet() { const sound=gameAudio.ricochet[Math.random()<.5?0:1];sound.pause();sound.currentTime=0;sound.volume=.52;sound.play().catch(()=>{}); }
function stopAutoFire() { leftMouseHeld=false;if(autoFireTimer){clearInterval(autoFireTimer);autoFireTimer=0;} }
function startAutoFire() {
  stopAutoFire();leftMouseHeld=true;
  if(currentGun!=='bren2'||ammo.bren2<=0)return;
  autoFireTimer=setInterval(()=>{
    if(!leftMouseHeld||currentGun!=='bren2'||heldItem!=='gun'||reloading||!running){stopAutoFire();return;}
    if(ammo.bren2<=0){playEmptyClick();stopAutoFire();return;}
    fire();
  },130);
}
function fire() {
  if (!running || (mode!=='war'&&!pointer) || reloading || heldItem!=='gun'||(mode==='war'&&(warPhase!=='running'||health<=0))) return;
  if (ammo[currentGun] <= 0) { playEmptyClick(); return; }
  playGunshot();
  ammo[currentGun]--;
  const aimingScale = aimHeld ? .62 : 1;
  recoilPitch = Math.min(recoilPitch + (currentGun === 'm1911' ? .024 : .038) * aimingScale, .105);
  recoilYaw = THREE.MathUtils.clamp(recoilYaw + (Math.random() - .5) * (currentGun === 'm1911' ? .012 : .019) * aimingScale, -.035, .035);
  gunKick = Math.min(gunKick + (currentGun === 'm1911' ? .72 : .9), 1.45);
  updateUI();
  const origin = camera.getWorldPosition(v1), direction = camera.getWorldDirection(v2);
  raycaster.set(origin, direction); raycaster.far = 180;
  const shootableEnemies=mode==='war'?enemies.filter(enemy=>camera.position.distanceTo(enemy.position)<88):enemies;
  const hit = intersectFirst(mode === 'cqb'||mode==='war' ? [...houseMeshes, ...shootableEnemies] : [practiceTarget])[0];
  if (!hit) {if(mode==='war')sendWar('fire',{weapon:currentGun,targetId:'',origin:{x:origin.x,y:origin.y,z:origin.z},direction:{x:direction.x,y:direction.y,z:direction.z},wallDistance:250});return;}
  if (mode === 'practice') { score++; levelHits++; showHitmarker(); moveTarget(true); if(levelHits >= 7) { if(level < 5) { level++; levelHits = 0; announce(`LEVEL ${level}`, true); } else { updateUI(); finish(true); return; } } updateUI(); return; }
  const enemy = enemyRoot(hit.object);
  if(mode==='war'){const wallDistance=intersectFirst(houseMeshes)[0]?.distance??250;sendWar('fire',{weapon:currentGun,targetId:enemy?.userData.warId||'',origin:{x:origin.x,y:origin.y,z:origin.z},direction:{x:direction.x,y:direction.y,z:direction.z},wallDistance});if(!enemy)playRicochet();return;}
  if (enemy) { enemy.userData.health -= gunData[currentGun].damage; const killed = enemy.userData.health <= 0; showHitmarker(killed); if (killed) killEnemy(enemy); }
}
function killEnemy(enemy) { score+=3;enemies=enemies.filter(e=>e!==enemy);scene.remove(enemy);const generation=matchGeneration;setTimeout(()=>{if(running&&mode==='cqb'&&enemyTemplate&&generation===matchGeneration)spawnEnemy(enemyTemplate,Math.random());},2000);updateUI(); }
function moveTarget(hit=false) { if(!practiceTarget) return; if(level===1||level===2)return;const interval=level>=5?1.05:1.7;if((hit||elapsed-practiceTarget.userData.lastMove>interval)&&(level===3||level===4||level===5)){practiceTarget.position.x=(Math.random()-.5)*(level>=4?18:14);practiceTarget.position.y=2.2+Math.random()*(level>=4?5:4);practiceTarget.userData.lastMove=elapsed;} }
function reload() {
  if (!running || (mode==='war'&&(warPhase!=='running'||health<=0)) || heldItem!=='gun' || reloading || (mode!=='war'&&reloads<=0) || ammo[currentGun] === gunData[currentGun].capacity || (mode!=='war'&&reserves[currentGun]<=0) || !gunRoot) return;
  gameAudio.gunshot.pause();
  const needed = gunData[currentGun].capacity - ammo[currentGun];
  const added = Math.min(needed, reserves[currentGun]);
  reloading = true;
  reloadStage = 'animating';
  reloadStartedAt = performance.now();
  reloadPending = { gun: currentGun, ammo: added, reserve: added };
  reloadStartPosition.copy(gunRoot.position);
  reloadStartQuaternion.copy(gunRoot.quaternion);
  reloadStartScale.copy(gunRoot.scale);
  reloadSideQuaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, 'YXZ'));
  ui.hud.classList.add('reloading');
  updateUI();
  playReloadSound();
}
function playReloadSound() {
  const sound = gameAudio.reload;
  sound.pause();
  sound.currentTime = 0;
  sound.volume = .82;
  if (Number.isFinite(sound.duration)) reloadDurationMs = sound.duration * 1000;
  reloadEndedHandler = finishReloadSound;
  reloadErrorHandler = finishReloadSound;
  sound.addEventListener('ended', reloadEndedHandler, { once: true });
  sound.addEventListener('error', reloadErrorHandler, { once: true });
  reloadTimer = setTimeout(finishReloadSound, reloadDurationMs + 700);
  sound.play().catch(finishReloadSound);
}
function finishReloadSound() {
  if (!running || !reloading || reloadStage !== 'animating' || !reloadPending) return;
  clearTimeout(reloadTimer);
  const sound = gameAudio.reload;
  if (reloadEndedHandler) sound.removeEventListener('ended', reloadEndedHandler);
  if (reloadErrorHandler) sound.removeEventListener('error', reloadErrorHandler);
  reloadEndedHandler = reloadErrorHandler = null;
  const { gun, ammo: added, reserve } = reloadPending;
  if(mode==='war') {
    // Server owns WAR ammunition; wait for its acknowledgement rather than
    // optimistically changing the local copy that incoming snapshots replace.
    sendWar('reload',{weapon:gun});
  } else {
    ammo[gun] += added;
    reserves[gun] -= reserve;
    reloads--;
  }
  reloadPending = null;
  reloading = false;
  reloadStage = '';
  ui.hud.classList.remove('reloading');
  updateUI();
}
function cancelReload() {
  clearTimeout(reloadTimer);
  const sound = gameAudio.reload;
  sound.pause();
  sound.currentTime = 0;
  if (reloadEndedHandler) sound.removeEventListener('ended', reloadEndedHandler);
  if (reloadErrorHandler) sound.removeEventListener('error', reloadErrorHandler);
  reloadEndedHandler = reloadErrorHandler = null;
  reloadPending = null;
  reloadStage = '';
  reloading = false;
  ui.hud.classList.remove('reloading');
}
function updateReloadAnimation() {
  if (!gunRoot) return;
  const progress = THREE.MathUtils.clamp((performance.now() - reloadStartedAt) / reloadDurationMs, 0, 1);
  const raiseEnd = .16, returnStart = .82;
  const ease = value => value * value * (3 - 2 * value);
  if (progress < raiseEnd) {
    const t = ease(progress / raiseEnd);
    gunRoot.position.lerpVectors(reloadStartPosition, reloadCenterPosition, t);
    gunRoot.quaternion.slerpQuaternions(reloadStartQuaternion, reloadSideQuaternion, t);
    gunRoot.scale.lerpVectors(reloadStartScale, reloadLargeScale, t);
  } else if (progress < returnStart) {
    const pulse = Math.sin(((progress - raiseEnd) / (returnStart - raiseEnd)) * Math.PI * 2) * .045;
    gunRoot.position.copy(reloadCenterPosition);
    gunRoot.position.z += pulse;
    gunRoot.quaternion.copy(reloadSideQuaternion);
    gunRoot.scale.copy(reloadLargeScale);
  } else {
    const t = ease((progress - returnStart) / (1 - returnStart));
    gunRoot.position.lerpVectors(reloadCenterPosition, reloadStartPosition, t);
    gunRoot.quaternion.slerpQuaternions(reloadSideQuaternion, reloadStartQuaternion, t);
    gunRoot.scale.lerpVectors(reloadLargeScale, reloadStartScale, t);
  }
  ui.hud.classList.add('reloading');
}
function flashDamage() { clearTimeout(damageTimeout);ui.damage.classList.remove('active');void ui.damage.offsetWidth;ui.damage.classList.add('active');damageTimeout=setTimeout(()=>ui.damage.classList.remove('active'),720); }
function feetPosition() { return new THREE.Vector3(camera.position.x,camera.position.y-eyeHeight,camera.position.z); }
function movePlayer(dt) {
  if(mode==='practice') { if(!pointer)return; const forward=camera.getWorldDirection(v1);forward.y=0;forward.normalize();const right=v2.crossVectors(forward,camera.up).normalize();const delta=new THREE.Vector3();if(keys.has('KeyW'))delta.add(forward);if(keys.has('KeyS'))delta.sub(forward);if(keys.has('KeyD'))delta.add(right);if(keys.has('KeyA'))delta.sub(right);if(delta.lengthSq())camera.position.add(delta.normalize().multiplyScalar(dt*4.3));return; }
  if(mode==='war') { moveWarPlayer(dt); return; }
  const feet=feetPosition();
  const canControlMovement=pointer;
  if(canControlMovement) {
    // Use the explicit aim yaw rather than a renderer camera vector. This
    // keeps movement independent from pointer-lock/focus and camera updates.
    const forward=new THREE.Vector3(-Math.sin(aimYaw),0,-Math.cos(aimYaw));
    const right=new THREE.Vector3(Math.cos(aimYaw),0,-Math.sin(aimYaw));
    const delta=new THREE.Vector3();
    if(keys.has('KeyW'))delta.add(forward);if(keys.has('KeyS'))delta.sub(forward);if(keys.has('KeyD'))delta.add(right);if(keys.has('KeyA'))delta.sub(right);
    if(delta.lengthSq()) {
      delta.normalize().multiplyScalar(dt*(mode==='war'?4.2:4.0));
      // Axis-separated tests allow sliding along walls and allow a player who
      // began slightly inside a merged seat mesh to move out of it.
      for(const axis of ['x','z']) {
        const step=new THREE.Vector3(axis==='x'?delta.x:0,0,axis==='z'?delta.z:0);
        if(!step.lengthSq())continue;
        const next=feet.clone().add(step);
        if(canMove(next,step)){camera.position.x=next.x;camera.position.z=next.z;feet.copy(next);}
      }
    }
  }
  verticalVelocity-=18*dt;camera.position.y+=verticalVelocity*dt;
  const currentFeet=feetPosition(), rayOrigin=currentFeet.clone().add(new THREE.Vector3(0,.14,0));raycaster.set(rayOrigin,new THREE.Vector3(0,-1,0));raycaster.far=Math.max(.5,Math.min(1.4,-verticalVelocity*dt+.28));
  const floor=raycaster.intersectObjects(houseMeshes,false).find(hit=>hit.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y>.62);
  if(floor&&verticalVelocity<=0&&floor.distance<=raycaster.far){camera.position.y=floor.point.y+eyeHeight+actorGroundClearance;verticalVelocity=0;grounded=true;}else grounded=false;
  if(playerBody){playerBody.position.set(camera.position.x,camera.position.y-eyeHeight+playerSize.y/2,camera.position.z);}
}
function moveWarPlayer(dt) {
  if(warPhase!=='running'||health<=0)return;
  const feet=feetPosition(),previousFeet=feet.clone(),forward=new THREE.Vector3(-Math.sin(aimYaw),0,-Math.cos(aimYaw)),right=new THREE.Vector3(Math.cos(aimYaw),0,-Math.sin(aimYaw)),wish=new THREE.Vector3();
  if(warMovementKeys.has('KeyW'))wish.add(forward);if(warMovementKeys.has('KeyS'))wish.sub(forward);if(warMovementKeys.has('KeyD'))wish.add(right);if(warMovementKeys.has('KeyA'))wish.sub(right);
  if(wish.lengthSq()){
    wish.normalize().multiplyScalar(Math.min(dt,.05)*4.2);
    for(const axis of ['x','z']){
      const step=new THREE.Vector3(axis==='x'?wish.x:0,0,axis==='z'?wish.z:0);if(!step.lengthSq())continue;
      const next=feet.clone().add(step);if(next.x<mapBox.min.x||next.x>mapBox.max.x||next.z<mapBox.min.z||next.z>mapBox.max.z)continue;
      const direction=step.clone().normalize(),bodyCenter=new THREE.Vector3(camera.position.x,camera.position.y-eyeHeight+warPlayerHeight*.5,camera.position.z);let blockedRays=0;
      for(const height of [.08,warPlayerHeight*.38,warPlayerHeight*.78]){
        raycaster.set(bodyCenter.clone().add(new THREE.Vector3(0,height-warPlayerHeight*.5,0)),direction);raycaster.far=step.length()+playerSize.x*.48;
        const obstruction=intersectFirst(houseMeshes).find(hit=>hit.distance>.06&&hit.distance<raycaster.far&&hit.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).dot(direction)<-.12);
        if(obstruction)blockedRays++;
      }
      if(blockedRays>=2)continue;
      const floor=warGroundSurfaceAt(next.x,next.z,feet.y);
      if(!floor||!warFloorHasFooting(floor.point))continue;
      const floorDelta=floor.point.y-feet.y;
      if(grounded){
        if(floorDelta>.38||floorDelta<-.62)continue;
        camera.position.x=next.x;camera.position.z=next.z;camera.position.y=floor.point.y+eyeHeight+actorGroundClearance;feet.set(next.x,floor.point.y+actorGroundClearance,next.z);
      }else if(floorDelta<=.38&&floorDelta>=-1.65){
        // Air control stays over the selected arena floor. Never let a missed
        // landing ray turn an airborne player into an uncontrolled void fall.
        camera.position.x=next.x;camera.position.z=next.z;feet.copy(next);
      }
    }
  }
  const stepDt=Math.min(dt,.05);
  verticalVelocity-=18*stepDt;camera.position.y+=verticalVelocity*stepDt;
  const currentFeet=feetPosition();
  if(verticalVelocity<=0){
    // Sweep from the previous foot height down to the new one. A ray starting
    // only below the player misses the floor once a slow frame has already
    // moved the camera through that triangle.
    const sweepTop=Math.max(previousFeet.y,currentFeet.y)+.22,sweepDepth=Math.max(.36,previousFeet.y-currentFeet.y+.44);
    const supportRadius=playerSize.x*.3,supportOffsets=[[0,0],[-supportRadius,-supportRadius],[supportRadius,-supportRadius],[-supportRadius,supportRadius],[supportRadius,supportRadius]],supportHits=[];
    for(const [offsetX,offsetZ] of supportOffsets){
      raycaster.set(new THREE.Vector3(currentFeet.x+offsetX,sweepTop,currentFeet.z+offsetZ),new THREE.Vector3(0,-1,0));raycaster.far=sweepDepth;
      const hit=raycaster.intersectObjects(houseMeshes,false).find(candidate=>candidate.face&&candidate.point.y<=previousFeet.y+.2&&candidate.point.y>=currentFeet.y-.24&&isWarArenaFloor(candidate.point.y)&&isWalkableHit(candidate,warRequiredHeadroom));
      if(hit)supportHits.push(hit.point.y);
    }
    // Require a real floor patch under most of the footprint. This catches
    // triangle seams without allowing a single seat/ledge vertex to support
    // the player.
    const landingCluster=supportHits.map(height=>supportHits.filter(other=>Math.abs(other-height)<.32)).find(cluster=>cluster.length>=3);
    const landingY=landingCluster?landingCluster.reduce((sum,height)=>sum+height,0)/landingCluster.length:null;
    if(landingY!==null){camera.position.y=landingY+eyeHeight+actorGroundClearance;verticalVelocity=0;grounded=true;}else grounded=false;
  }else grounded=false;
  if(grounded)warLastSafePosition=new THREE.Vector3(camera.position.x,camera.position.y-eyeHeight-actorGroundClearance,camera.position.z);
  else if(warFloorRange&&warLastSafePosition&&camera.position.y-eyeHeight<warFloorRange.min-1.5){setPlayerPosition(warLastSafePosition);verticalVelocity=0;grounded=true;}
  if(playerBody)playerBody.position.set(camera.position.x,camera.position.y-eyeHeight+playerSize.y/2,camera.position.z);
}
function warGroundSurfaceAt(x,z,referenceY) {
  if(!warFloorRange)return null;
  const height=mapBox.max.y-mapBox.min.y;raycaster.set(new THREE.Vector3(x,Math.min(mapBox.max.y+1,referenceY+.55),z),new THREE.Vector3(0,-1,0));raycaster.far=Math.min(height+2,2.25);
  for(const hit of raycaster.intersectObjects(houseMeshes,false)){const delta=hit.point.y-referenceY;if(delta< -1.65||delta>.38||!isWarArenaFloor(hit.point.y))continue;if(isWalkableHit(hit,warRequiredHeadroom)&&warFloorHasFooting(hit.point))return hit;}return null;
}
function isWarArenaFloor(y){return Boolean(warFloorRange&&y>=warFloorRange.min&&y<=warFloorRange.max);}
function warTick(dt) {
  const now=performance.now();
  if(warPhase==='waiting'){ui.warCountdown.textContent='다른 플레이어를 기다리는 중';ui.warCountdown.classList.add('visible');ui.warCountdown.classList.add('waiting');}
  else if(warPhase==='countdown'){ui.warCountdown.classList.remove('waiting');const seconds=Math.max(1,Math.ceil(((warState?.countdownEndsAt||Date.now())-Date.now())/1000));ui.warCountdown.textContent=String(seconds);ui.warCountdown.classList.add('visible');}
  else if(warPhase==='running'){ui.warCountdown.classList.remove('visible','waiting');}
  for(const enemy of enemies)if(enemy.userData.warId){enemy.position.lerp(enemy.userData.netTarget,Math.min(1,dt*12));}
  for(const remote of warRemotePlayers.values()){remote.model.position.lerp(remote.target,Math.min(1,dt*12));remote.model.rotation.y=THREE.MathUtils.damp(remote.model.rotation.y,remote.yaw,10,dt);remote.model.scale.y=remote.actorHeight/(remote.model.userData.baseHeight||warActorHeight);}
  for(const shot of [...warProjectiles]){
    const from=shot.mesh.position.clone(),step=Math.min(shot.speed*dt,shot.distance-shot.traveled),to=from.clone().addScaledVector(shot.direction,step);let blocked=false;
    if(step>0){raycaster.set(from,shot.direction);raycaster.far=step+.025;const wall=intersectFirst(houseMeshes)[0],wallDistance=wall?.distance??Infinity;let playerDistance=Infinity;if(shot.targetId===warMyId){const feetY=camera.position.y-eyeHeight-actorGroundClearance;for(const fraction of [.18,.5,.82]){const target=new THREE.Vector3(camera.position.x,feetY+warPlayerHeight*fraction,camera.position.z),along=target.clone().sub(from).dot(shot.direction);if(along<0||along>step)continue;const closest=from.clone().addScaledVector(shot.direction,along);if(closest.distanceTo(target)<=playerSize.x*.55+.06)playerDistance=Math.min(playerDistance,along);}}if(playerDistance<wallDistance){sendWar('enemy-impact',{shotId:shot.id,hit:true});shot.resolved=true;}else if(wall){blocked=true;playRicochet();}}
    if(!blocked)shot.mesh.position.copy(to);shot.traveled+=Math.max(step,0);
    if(blocked||shot.resolved||shot.traveled>=shot.distance){if(!blocked&&!shot.resolved&&shot.traveled>=shot.distance)playRicochet();scene.remove(shot.mesh);shot.mesh.geometry.dispose();shot.mesh.material.dispose();warProjectiles.splice(warProjectiles.indexOf(shot),1);}
  }
  for(const effect of [...warBlastEffects]){const progress=(performance.now()-effect.started)/effect.duration;if(progress>=1){scene.remove(effect.mesh);effect.mesh.geometry.dispose();effect.mesh.material.dispose();warBlastEffects.splice(warBlastEffects.indexOf(effect),1);}else{effect.mesh.scale.setScalar(.2+progress*4.4);effect.mesh.material.opacity=.62*(1-progress);}}
  if(warSocket?.readyState===WebSocket.OPEN&&warPhase==='running'&&now-warLastInputAt>80){warLastInputAt=now;const visibleEnemies=[];for(const enemy of enemies){const origin=enemy.position.clone().add(new THREE.Vector3(0,warActorHeight*.72,0)),target=camera.position.clone().add(new THREE.Vector3(0,-warPlayerHeight*.28,0)),offset=target.clone().sub(origin),distance=offset.length();if(distance>45)continue;raycaster.set(origin,offset.normalize());raycaster.far=Math.max(.01,distance-.2);if(!intersectFirst(houseMeshes)[0])visibleEnemies.push(enemy.userData.warId);}const feet=feetPosition();sendWar('input',{x:feet.x,y:feet.y-actorGroundClearance,z:feet.z,yaw:aimYaw,pitch:aimPitch,visibleEnemies,crouched:warCrouched,actorHeight:warPlayerHeight});}
  if(warCullAt<now){warCullAt=now+500;for(const mesh of houseMeshes){if(!mesh.geometry.boundingSphere)mesh.geometry.computeBoundingSphere();const sphere=mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);mesh.visible=camera.position.distanceTo(sphere.center)-sphere.radius<88;}for(const enemy of enemies)if(enemy.userData.warId)enemy.visible=camera.position.distanceTo(enemy.position)<88;for(const remote of warRemotePlayers.values())remote.model.visible=camera.position.distanceTo(remote.model.position)<88;}
}
let warCullAt=0;
function canMove(nextFeet,delta) {
  if(nextFeet.x<mapBox.min.x-1||nextFeet.x>mapBox.max.x+1||nextFeet.z<mapBox.min.z-1||nextFeet.z>mapBox.max.z+1)return false;
  const playerHeight=mode==='war'?warPlayerHeight:warActorHeight,distance=delta.length(),direction=delta.clone().normalize(),center=new THREE.Vector3(camera.position.x,camera.position.y-eyeHeight+playerHeight*.5,camera.position.z);
  raycaster.far=distance+playerSize.x*.52;
  // A single ray can hit the arena's merged obstacle/floor triangles and report
  // a false wall. Require the obstacle to block both the lower body and chest
  // rays before stopping the player; this still blocks full-height walls.
  let blockedHeights=0;
  for(const y of [.12,.62]){raycaster.set(center.clone().add(new THREE.Vector3(0,y,0)),direction);const hits=intersectFirst(houseMeshes);if(hits.some(hit=>hit.distance>.045&&hit.distance<raycaster.far&&hit.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).dot(direction)<-.12))blockedHeights++;}
  if(blockedHeights===2)return false;
  for(const enemy of enemies){const dx=nextFeet.x-enemy.position.x,dz=nextFeet.z-enemy.position.z;if(dx*dx+dz*dz<.62*.62&&Math.abs(nextFeet.y-enemy.position.y)<1.25)return false;}
  return true;
}
function grenadePhysicsTick(dt) {
  if(!grenades.length)return;
  grenadeWorld.step(1/60,Math.min(dt,.05),3);
  for(const grenade of [...grenades]){
    const body=grenade.body,from=grenade.previous.copy(grenade.position),to=new THREE.Vector3(body.position.x,body.position.y,body.position.z),travel=to.clone().sub(from),distance=travel.length();
    if(distance>.0001){raycaster.set(from,travel.multiplyScalar(1/distance));raycaster.far=distance+.14;const hit=intersectFirst(houseMeshes)[0];if(hit){explodeGrenade(grenade,hit.point.clone());continue;}}
    grenade.position.copy(to);grenade.mesh.position.copy(to);grenade.mesh.quaternion.set(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);
    if(elapsed-grenade.startedAt>5.5)explodeGrenade(grenade,to);
  }
}
function throwGrenade() {
  if(!running||(mode!=='cqb'&&mode!=='war')||(mode==='war'&&(warPhase!=='running'||health<=0))||heldItem!=='grenade'||grenadeCount<=0||!grenadeRoot)return;
  const direction=camera.getWorldDirection(new THREE.Vector3()).normalize(),origin=camera.getWorldPosition(new THREE.Vector3()).addScaledVector(direction,.62).add(new THREE.Vector3(0,-.16,0));
  const warGrenadeId=mode==='war'?(globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`):'';if(mode==='war')sendWar('grenade-throw',{id:warGrenadeId});
  const body=new CANNON.Body({mass:.42,shape:new CANNON.Sphere(.13),linearDamping:.035,angularDamping:.22,allowSleep:true});body.position.set(origin.x,origin.y,origin.z);body.velocity.set(direction.x*13,direction.y*13+1.8,direction.z*13);body.angularVelocity.set(5,8,3);grenadeWorld.addBody(body);
  const mesh=new THREE.Group();mesh.add(grenadeRoot.children[0].clone(true));mesh.position.copy(origin);scene.add(mesh);grenades.push({body,mesh,position:origin.clone(),previous:origin.clone(),startedAt:elapsed,warId:warGrenadeId});grenadeCount--;stowHeldItem();
}
function explodeGrenade(grenade,position) {
  const index=grenades.indexOf(grenade);if(index<0)return;grenades.splice(index,1);grenadeWorld.removeBody(grenade.body);scene.remove(grenade.mesh);
  if(mode==='war'){sendWar('grenade-explode',{id:grenade.warId,x:position.x,y:position.y,z:position.z});return;}
  const radius=4.1;for(const enemy of [...enemies]){const center=enemy.position.clone().add(new THREE.Vector3(0,.62,0));if(center.distanceTo(position)<=radius){enemy.userData.health-=9;if(enemy.userData.health<=0)killEnemy(enemy);}}
  if(camera.position.distanceTo(position)<=radius)takeDamage(3,position);
}
function visibleToPlayer(enemy) {
  const eye=enemy.position.clone().add(new THREE.Vector3(0,1.0,0)),target=camera.position.clone().add(new THREE.Vector3(0,-.3,0)),offset=target.sub(eye),distance=offset.length();
  if(distance>40)return false;raycaster.set(eye,offset.normalize());raycaster.far=distance-.2;const wall=intersectFirst(houseMeshes)[0];return !wall;
}
function moveEnemy(enemy,target,dt) {
  const toTarget=new THREE.Vector3(target.x-enemy.position.x,0,target.z-enemy.position.z),distance=toTarget.length();if(distance<2.35)return;
  const forward=toTarget.normalize(),side=new THREE.Vector3(-forward.z,0,forward.x),step=Math.min(dt*2.05,distance-2.2),directions=[forward,side.clone().multiplyScalar(enemy.userData.navSide||1),side.clone().multiplyScalar(-(enemy.userData.navSide||1))];
  for(const direction of directions){const next=enemy.position.clone().addScaledVector(direction,step),blocked=[.35,.72,1.05].some(height=>{raycaster.set(enemy.position.clone().add(new THREE.Vector3(0,height,0)),direction);raycaster.far=step+.3;return intersectFirst(houseMeshes).some(hit=>hit.distance<raycaster.far);});if(blocked)continue;
    raycaster.set(new THREE.Vector3(next.x,enemy.position.y+1.5,next.z),new THREE.Vector3(0,-1,0));raycaster.far=2.4;const floor=raycaster.intersectObjects(houseMeshes,false).find(hit=>hit.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y>.62&&hit.point.y>=enemy.position.y-.35&&hit.point.y<=enemy.position.y+.35);if(!floor)continue;
    enemy.position.set(next.x,floor.point.y+actorGroundClearance,next.z);enemy.rotation.y=Math.atan2(direction.x,direction.z);return;
  }
  if(Math.random()<dt*.7)enemy.userData.navSide*=-1;
}
function cqbTick(dt) {
  for(const orb of [...healthOrbs]){orb.position.y=orb.userData.baseY+Math.sin(elapsed*2+orb.userData.phase)*.08;const dx=orb.position.x-camera.position.x,dz=orb.position.z-camera.position.z;if(dx*dx+dz*dz<.72&&Math.abs(orb.position.y-(camera.position.y-eyeHeight))<1.1){health=Math.min(14,health+5);healthOrbs=healthOrbs.filter(o=>o!==orb);scene.remove(orb);setTimeout(()=>{if(running&&mode==='cqb')spawnOrb(Math.random());},700);updateUI();}}
  const feet=feetPosition(),activeFlag=flags.find(flag=>{const point=flag.userData.capturePoint,dx=point.x-feet.x,dz=point.z-feet.z;return dx*dx+dz*dz<2.35*2.35&&Math.abs(point.y-feet.y)<1.25;});
  const anchor=camera.userData.capturePosition||feet;const moved=feet.distanceToSquared(anchor)>.0025;
  if(activeFlag&&!moved){captureTime+=dt;ui.capture.style.display='block';ui.captureBar.style.width=`${Math.min(100,captureTime/10*100)}%`;if(captureTime>=10)captureFlag(activeFlag);}else{captureTime=0;camera.userData.capturePosition=feet.clone();ui.capture.style.display='none';ui.captureBar.style.width='0%';}
  const playerFeet=feetPosition();for(const enemy of enemies){const eye=enemy.position.clone().add(new THREE.Vector3(0,1.0,0)),target=camera.position.clone().add(new THREE.Vector3(0,-.3,0)),toPlayer=target.sub(eye),distance=toPlayer.length(),visible=visibleToPlayer(enemy);if(visible){enemy.userData.lastSeen=playerFeet.clone();enemy.userData.lastSeenAt=elapsed;if(distance>2.5)moveEnemy(enemy,playerFeet,dt);}else if(enemy.userData.lastSeen&&elapsed-enemy.userData.lastSeenAt<2.5)moveEnemy(enemy,enemy.userData.lastSeen,dt);if(visible&&distance<34&&elapsed>=enemy.userData.nextShot){enemy.rotation.y=Math.atan2(toPlayer.x,toPlayer.z);enemy.userData.nextShot=elapsed+1.35;takeDamage(2,enemy.position);}}
}
function captureFlag(flag) { flags=flags.filter(item=>item!==flag);scene.remove(flag);captured++;health=14;captureTime=0;ui.capture.style.display='none';ui.captureBar.style.width='0%';const audio=new Audio('/sound/flag.ogg');audio.play().catch(()=>{});announce('FLAG 점령');updateUI();if(captured===3) finish(true); }
function takeDamage(amount,sourcePosition=null) { if(heldItem==='shield'&&shieldCharges>0&&sourcePosition){const towardSource=sourcePosition.clone().sub(camera.position).normalize(),facing=camera.getWorldDirection(new THREE.Vector3());if(facing.dot(towardSource)>.25){shieldCharges--;announce(shieldCharges?`방패 방어 · ${shieldCharges}`:'방패 파손');if(shieldCharges===0)stowHeldItem();else updateUI();return;}}health-=amount;lastDamage=elapsed;flashDamage();updateUI();if(health<=0)finish(false); }
async function finish(cleared) { if(!running)return;running=false;cancelReload();document.exitPointerLock?.();ui.hud.style.display='none';const isPractice=mode==='practice';const title=isPractice?(cleared?'레벨 클리어!':'훈련 종료'):(cleared?'작전 성공':'임무실패');ui.resultMode.textContent=isPractice?'PRACTICE':`CQB · ${selectedMap.replace('_',' ').toUpperCase()}`;ui.resultTitle.textContent=title;ui.resultScore.textContent=isPractice?`명중 ${score}회 · 도달 레벨 ${level}`:`처치 점수 ${score}점 · 점령 ${captured} / 3`;show(ui.result);try{await rankSessionReady;if(!rankSessionToken)throw new Error('Rank session unavailable');const response=await fetch('/api/ranks',{method:'POST',headers:{'Content-Type':'application/json','X-Soldiers-Session':rankSessionToken},body:JSON.stringify({name:playerName,score,level:isPractice?level:0,mode:mode.toUpperCase()})});if(!response.ok)throw new Error('Rank request failed');const rows=await response.json();ui.ranks.innerHTML=rows.slice(0,8).map(row=>{const combined=row.practiceScore!==null&&row.cqbScore!==null;const scoreLabel=combined?`${row.practiceScore} + ${row.cqbScore} = ${row.totalScore}`:`${row.totalScore} · ${row.mode}`;return `<li><span>${row.rank}. ${escapeHTML(row.name)}${row.practiceLevel?` · L${row.practiceLevel}`:''}</span><span>${scoreLabel}</span></li>`;}).join('');}catch{ui.ranks.innerHTML='<li><span>기록 저장에 실패했습니다.</span></li>';} }
function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));}
function tick() {
  requestAnimationFrame(tick);const dt=Math.min(clock.getDelta(),.05);
  if(running){elapsed+=dt;remaining-=dt;movePlayer(dt);recoilPitch*=Math.exp(-7.8*dt);recoilYaw*=Math.exp(-9.5*dt);gunKick*=Math.exp(-17*dt);camera.rotation.order='YXZ';camera.rotation.x=THREE.MathUtils.clamp(aimPitch+recoilPitch,-1.35,1.35);camera.rotation.y=aimYaw+recoilYaw;camera.rotation.z=THREE.MathUtils.clamp(recoilYaw*1.8,-.035,.035);const targetFov=aimHeld?48:72;camera.fov=THREE.MathUtils.damp(camera.fov,targetFov,12,dt);camera.updateProjectionMatrix();if(reloading)updateReloadAnimation();else if(gunRoot&&heldItem==='gun'){gunRoot.position.set(.2,-.25-gunKick*.075,-.52+gunKick*.2);gunRoot.rotation.set(-.08-gunKick*.12,-.23+recoilYaw*.25,0);}for(const item of [shieldRoot,grenadeRoot])if(item?.visible&&item.userData.raisedAt){const t=THREE.MathUtils.clamp((performance.now()-item.userData.raisedAt)/340,0,1),ease=1-(1-t)*(1-t);item.position.y=THREE.MathUtils.lerp(item.userData.readyPosition.y-(item===shieldRoot?1.15:.34),item.userData.readyPosition.y,ease);if(t>=1)item.userData.raisedAt=0;}
    if(mode==='practice'){if(level===2&&practiceTarget)practiceTarget.position.x=Math.sin(elapsed*2.4)*10;if(level===4&&practiceTarget)practiceTarget.position.x=Math.sin(elapsed*3.8)*13;moveTarget(false);if(remaining<=0)finish(false);}
    else if(mode==='war'){grenadePhysicsTick(dt);warTick(dt);}
    else if(remaining<=0)finish(true);else{grenadePhysicsTick(dt);cqbTick(dt);}
    updateUI();
  }
  renderer.render(scene,camera);
}
document.querySelectorAll('.mode-button').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;if(mode==='cqb'){show(ui.mapScreen);return;}ui.mode.textContent=mode.toUpperCase();show(ui.name);ui.nameInput.focus();}));
document.querySelectorAll('.map-button').forEach(button=>button.addEventListener('click',()=>{selectedMap=button.dataset.map;ui.mode.textContent=`CQB · ${selectedMap.replace('_',' ').toUpperCase()}`;show(ui.name);ui.nameInput.focus();}));
document.querySelector('.map-back').addEventListener('click',()=>show(ui.landing));document.querySelector('.back').addEventListener('click',()=>show(mode==='cqb'?ui.mapScreen:ui.landing));$('begin-button').addEventListener('click',start);$('return-button').addEventListener('click',()=>{resetWorld();scene.fog=new THREE.Fog(0x6e7678,42,170);ui.hud.style.display='none';show(ui.landing);});
document.addEventListener('pointerlockchange',()=>{pointer=document.pointerLockElement===renderer.domElement;if(!pointer)aimHeld=false;});renderer.domElement.addEventListener('click',()=>{if(running&&!pointer)lockPointer();});
document.addEventListener('mousemove',event=>{if(!pointer)return;aimYaw-=event.movementX*.002;aimPitch=THREE.MathUtils.clamp(aimPitch-event.movementY*.002,-1.35,1.35);});
document.addEventListener('mousedown',event=>{if(event.button===0){fire();if(currentGun==='bren2'&&ammo.bren2>0)startAutoFire();}if(event.button===2&&running){if(heldItem==='grenade')throwGrenade();else if(heldItem==='gun'){aimHeld=true;ui.crosshair.style.transform='translate(-50%,-50%) scale(.65)';}}});document.addEventListener('mouseup',event=>{if(event.button===0)stopAutoFire();if(event.button===2&&heldItem==='gun'){aimHeld=false;ui.crosshair.style.transform='translate(-50%,-50%)';}});document.addEventListener('contextmenu',event=>event.preventDefault());
document.addEventListener('keydown',event=>{if(mode==='war'&&running&&['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(event.code))event.preventDefault();if(event.code==='ShiftLeft'||event.code==='ShiftRight'){setWarCrouched(true);}if(event.code==='Space'){event.preventDefault();if((mode==='cqb'||mode==='war')&&running&&grounded&&health>0&&!event.repeat){verticalVelocity=6.2;grounded=false;} }keys.add(event.code);if(event.repeat)return;if(event.code==='KeyR')reload();if(event.code==='KeyF')toggleShield();if(event.code==='Digit1')changeGun('m1911');if(event.code==='Digit2')changeGun('bren2');if(event.code==='Digit3')selectGrenade();});document.addEventListener('keyup',event=>{keys.delete(event.code);if(event.code==='ShiftLeft'||event.code==='ShiftRight')setWarCrouched(false);});
// Capture movement keys before browser/page controls can consume them.
const movementKeyCodes=new Map([['KeyW','KeyW'],['KeyA','KeyA'],['KeyS','KeyS'],['KeyD','KeyD'],['w','KeyW'],['a','KeyA'],['s','KeyS'],['d','KeyD'],['W','KeyW'],['A','KeyA'],['S','KeyS'],['D','KeyD']]);
window.addEventListener('keydown',event=>{if(mode!=='war'||!running)return;const code=movementKeyCodes.get(event.code)||movementKeyCodes.get(event.key);if(code){event.preventDefault();warMovementKeys.add(code);keys.add(code);}},{capture:true});
window.addEventListener('keyup',event=>{const code=movementKeyCodes.get(event.code)||movementKeyCodes.get(event.key);if(code){warMovementKeys.delete(code);keys.delete(code);}},{capture:true});
window.addEventListener('blur',()=>{keys.clear();warMovementKeys.clear();stopAutoFire();setWarCrouched(false);});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
tick();

async function reportStationPresence() {
  try {
    await rankSessionReady;
    if (!rankSessionToken) return;
    const activeScreen = document.querySelector('.screen.active')?.id || '';
    const state = running ? (mode === 'war' ? warPhase.toUpperCase() : 'PLAYING') : activeScreen === 'name-screen' ? 'READY' : activeScreen === 'map-screen' ? 'MAP SELECT' : 'MENU';
    const reportedMode = running || activeScreen === 'name-screen' || activeScreen === 'map-screen' ? mode.toUpperCase() : 'MENU';
    const response = await fetch('/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Soldiers-Session': rankSessionToken },
      body: JSON.stringify({ name: playerName, mode: reportedMode, map: mode === 'war' ? 'ARENA' : mode === 'cqb' ? selectedMap : '-', state, visible: document.visibilityState === 'visible' }),
      cache: 'no-store',
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.command === 'home') returnToLandingByOperator();
  } catch { /* Keep the game usable if the presence endpoint is unavailable. */ }
}
setInterval(reportStationPresence, 3500);
void reportStationPresence();
