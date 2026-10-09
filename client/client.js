import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/OBJLoader.js';

const $ = (id) => document.getElementById(id);
const ui = { landing: $('landing'), name: $('name-screen'), hud: $('hud'), result: $('result'), loader: $('loader'), nameInput: $('player-name'), mode: $('selected-mode'), timer: $('timer'), objective: $('objective'), level: $('level-banner'), crosshair: $('crosshair'), capture: $('capture'), captureBar: document.querySelector('#capture span'), hpBar: document.querySelector('#health i'), hp: document.querySelector('#health b'), weapon: $('weapon-name'), mag: $('magazine'), reserve: $('reserve'), reloads: document.querySelector('#ammo small'), resultMode: $('result-mode'), resultTitle: $('result-title'), resultScore: $('result-score'), ranks: $('rank-list') };
const loader = new GLTFLoader(), objLoader = new OBJLoader();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6e7678);
scene.fog = new THREE.Fog(0x6e7678, 42, 170);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .04, 260);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
} catch (error) {
  // Keep the menus usable on browser-automation hosts without an available GPU.
  const canvas = document.createElement('canvas');
  renderer = { domElement: canvas, setSize() {}, render() {} };
  console.warn('WebGL is unavailable in this browser session.', error);
}
$('render-root').append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xe9edf0, 0x343b38, 2.1));
const sun = new THREE.DirectionalLight(0xfff9e7, 2.4); sun.position.set(16, 24, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
const clock = new THREE.Clock(), raycaster = new THREE.Raycaster(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const keys = new Set();
let mode = 'practice', playerName = '', running = false, pointer = false, elapsed = 0, score = 0, level = 1, levelTime = 15, health = 14, remaining = 0, captureTime = 0, captured = 0, lastDamage = 0;
let house = null, houseMeshes = [], floorCandidates = [], enemyTemplate = null, practiceGroup = null, practiceTarget = null, gunRoot = null, playerBody = null, currentGun = 'm1911', guns = {}, flags = [], enemies = [], healthOrbs = [], mapBox = new THREE.Box3(new THREE.Vector3(-28, 0, -28), new THREE.Vector3(28, 20, 28));
const playerSize = new THREE.Vector3(.72, 1.8, .72), eyeHeight = 1.58;
let verticalVelocity = 0, grounded = false;
const gunData = { m1911: { label: 'M1911', capacity: 12, damage: 9, reserve: 84 }, bren2: { label: 'BREN 2', capacity: 7, damage: 5, reserve: 49 } };
let ammo = { m1911: 12, bren2: 7 }, reserves = { m1911: 84, bren2: 49 }, reloads = 2;

function show(...screens) { document.querySelectorAll('.screen').forEach(item => item.classList.remove('active')); screens.forEach(item => item.classList.add('active')); }
function loading(showing) { ui.loader.classList.toggle('show', showing); }
function resetWorld() { for (const child of [...scene.children]) if (child !== scene.children[0] && child !== scene.children[1]) scene.remove(child); while(camera.children.length)camera.remove(camera.children[0]);house = null; houseMeshes = []; floorCandidates = []; enemyTemplate = null; practiceGroup = null; practiceTarget = null; playerBody = null; flags = []; enemies = []; healthOrbs = []; gunRoot = null; guns = {}; }
function setHUD() { ui.hud.style.display = 'block'; ui.crosshair.style.display = 'block'; ui.objective.style.display = mode === 'cqb' ? 'block' : 'none'; $('health').style.display = mode === 'cqb' ? 'flex' : 'none'; }
function updateUI() { const mins = Math.floor(Math.max(0, remaining) / 60), secs = Math.ceil(Math.max(0, remaining) % 60); ui.timer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`; ui.objective.textContent = `점령 ${captured} / 3`; ui.hp.textContent = health; ui.hpBar.style.width = `${(health / 14) * 100}%`; const data = gunData[currentGun]; ui.weapon.textContent = data.label; ui.mag.textContent = ammo[currentGun]; ui.reserve.textContent = reserves[currentGun]; ui.reloads.textContent = `재장전 ${reloads}`; }
function announce(text) { ui.level.textContent = text; ui.level.classList.add('visible'); setTimeout(() => ui.level.classList.remove('visible'), 1400); }
function setPointer(active) { pointer = active; if (!active && running) document.exitPointerLock?.(); }
function lockPointer() { try { const request=renderer.domElement.requestPointerLock?.(); if(request?.catch) request.catch(()=>{}); } catch {} }

async function start() {
  playerName = ui.nameInput.value.trim(); if (!playerName) { ui.nameInput.focus(); return; }
  lockPointer(); running = false; loading(true); resetWorld();
  elapsed = 0; score = 0; level = 1; levelTime = 15; health = 14; captured = 0; captureTime = 0; reloads = 2; ammo = { m1911: 12, bren2: 7 }; reserves = { m1911: 84, bren2: 49 }; currentGun = 'm1911'; remaining = mode === 'practice' ? 45 : 150; verticalVelocity = 0; grounded = false;
  try { if (mode === 'practice') await createPractice(); else await createCQB(); await attachGun(); } catch (error) { console.warn(error); announce('모델 로딩 오류 — 대체 훈련 구역'); if (mode === 'practice') createPracticeFallback(); else createCQBFallback(); }
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
async function createCQB() {
  floorPlane(190);
  const gltf = await loader.loadAsync('/models/american_house.glb'); house = gltf.scene; const rawBox = new THREE.Box3().setFromObject(house); const center = rawBox.getCenter(new THREE.Vector3()); house.position.sub(center); house.rotation.y = 0; scene.add(house); house.updateMatrixWorld(true); mapBox.setFromObject(house); houseMeshes = houseMeshList(house);
  floorCandidates = findInteriorFloors();
  const spawn = floorCandidates.length ? floorCandidates[Math.floor(floorCandidates.length / 2)].clone() : (floorPoint(new THREE.Vector3(0,mapBox.max.y+10,0)) || new THREE.Vector3(0,mapBox.min.y+.1,0));
  setPlayerPosition(spawn); camera.rotation.set(0, 0, 0);
  await Promise.all([makeFlags(), makeEnemies(), makeOrbs()]);
}
function createCQBFallback() { floorPlane(140); const shell = new THREE.Mesh(new THREE.BoxGeometry(55, 5, 55), new THREE.MeshBasicMaterial({ color:0x4b5252, wireframe:true })); shell.position.y = 2.5; scene.add(shell); mapBox.set(new THREE.Vector3(-27, 0, -27), new THREE.Vector3(27, 8, 27)); houseMeshes = [shell]; floorCandidates = []; for(let x=-20;x<=20;x+=5)for(let z=-20;z<=20;z+=5)floorCandidates.push(new THREE.Vector3(x,0,z)); setPlayerPosition(new THREE.Vector3(0,0,8)); camera.rotation.set(0,0,0); makeFlags(); makeEnemies(); makeOrbs(); }
function setPlayerPosition(feetPosition) { const feet=feetPosition.clone();feet.y+=.03;if(playerBody)scene.remove(playerBody);playerBody=new THREE.Mesh(new THREE.BoxGeometry(playerSize.x,playerSize.y,playerSize.z),new THREE.MeshBasicMaterial({color:0xe9e7df,transparent:true,opacity:.08,depthWrite:false}));playerBody.position.set(feet.x,feet.y+playerSize.y/2,feet.z);playerBody.userData.player=true;scene.add(playerBody);camera.position.set(feet.x,feet.y+eyeHeight,feet.z);grounded=true;verticalVelocity=0;camera.userData.capturePosition=feet.clone(); }
function findInteriorFloors() { const candidates=[],spanX=mapBox.max.x-mapBox.min.x,spanZ=mapBox.max.z-mapBox.min.z,height=mapBox.max.y-mapBox.min.y,up=new THREE.Vector3(0,1,0),down=new THREE.Vector3(0,-1,0);for(let ix=1;ix<12;ix++)for(let iz=1;iz<12;iz++){const x=mapBox.min.x+spanX*ix/12,z=mapBox.min.z+spanZ*iz/12;raycaster.set(new THREE.Vector3(x,mapBox.max.y+3,z),down);raycaster.far=height+8;const hits=raycaster.intersectObjects(houseMeshes,false);for(const hit of hits){if(!hit.face)continue;const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);if(normal.dot(up)<.72||hit.point.y>mapBox.min.y+height*.72)continue;raycaster.set(hit.point.clone().add(new THREE.Vector3(0,.12,0)),up);raycaster.far=2.15;const ceiling=raycaster.intersectObjects(houseMeshes,false)[0];if(ceiling&&ceiling.distance<1.82)continue;candidates.push(hit.point.clone());break;}}return candidates; }
function floorPoint(point) { if(!houseMeshes.length)return new THREE.Vector3(point.x,0,point.z);raycaster.set(new THREE.Vector3(point.x,mapBox.max.y+3,point.z),new THREE.Vector3(0,-1,0));raycaster.far=mapBox.max.y-mapBox.min.y+8;const hits=raycaster.intersectObjects(houseMeshes,false);const floor=hits.find(hit=>hit.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y>.68&&hit.point.y<=mapBox.min.y+(mapBox.max.y-mapBox.min.y)*.72);return floor?.point||null; }
function mapPosition(seed=Math.random(),occupied=[]) { if(floorCandidates.length){const offset=Math.abs(Math.floor(seed*997))%floorCandidates.length;for(let step=0;step<floorCandidates.length;step++){const candidate=floorCandidates[(offset+step)%floorCandidates.length];if(occupied.every(point=>point.distanceToSquared(candidate)>9))return candidate.clone();}return floorCandidates[offset].clone();}const width=mapBox.max.x-mapBox.min.x,depth=mapBox.max.z-mapBox.min.z,angle=seed*Math.PI*2;return floorPoint(new THREE.Vector3(Math.cos(angle)*width*.25,mapBox.max.y+20,Math.sin(angle)*depth*.25))||new THREE.Vector3(0,mapBox.min.y,0); }
async function makeFlags() { let source;try{source=(await loader.loadAsync('/models/flag_in_the_wind.glb')).scene;}catch{source=flagFallback();}const placed=[];for(let i=0;i<3;i++){const pos=mapPosition(.12+i*.31,placed);placed.push(pos);const flag=source.clone(true);flag.position.copy(pos);flag.rotation.y=i*2.1;flag.scale.setScalar(1.1);flag.userData.flag=true;flag.userData.capturePoint=pos.clone();scene.add(flag);flags.push(flag);} }
function flagFallback() { const group = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,2.6), new THREE.MeshStandardMaterial({color:0xddddcf})); pole.position.y=1.3; const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1,.65),new THREE.MeshStandardMaterial({color:0x65746a,side:THREE.DoubleSide})); cloth.position.set(.55,2.15,0);group.add(pole,cloth);return group; }
async function makeEnemies() { let source; try { source=(await loader.loadAsync('/models/enemy.glb')).scene; } catch { source=enemyFallback(); } enemyTemplate=source;for(let i=0;i<3;i++)spawnEnemy(enemyTemplate,i/3+.16); }
function enemyFallback() { const g=new THREE.Group(); const body=new THREE.Mesh(new THREE.CapsuleGeometry(.28,1.15,4,8),new THREE.MeshStandardMaterial({color:0x49504a}));body.position.y=1;g.add(body);return g; }
function spawnEnemy(source, seed) { const model=source.clone(true);model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());const height=Math.max(size.y,.01),scale=1.72/height;model.scale.multiplyScalar(scale);model.position.add(new THREE.Vector3(-center.x*scale,-bounds.min.y*scale,-center.z*scale));const enemy=new THREE.Group();enemy.add(model);const occupied=[camera.position,...enemies.map(item=>item.position),...flags.map(flag=>flag.userData.capturePoint)],pos=mapPosition(seed+Math.random()*.1,occupied);enemy.position.copy(pos);enemy.userData.enemy=true;enemy.userData.health=10;enemy.userData.nextShot=elapsed+1.8+Math.random()*1.1;enemy.traverse(n=>{if(n.isMesh){n.castShadow=false;n.userData.enemyRoot=enemy;}});scene.add(enemy);enemies.push(enemy); }
async function makeOrbs() { for(let i=0;i<3;i++) spawnOrb(i*.27+.2); }
function spawnOrb(seed) { const orb = new THREE.Mesh(new THREE.SphereGeometry(.18,16,12),new THREE.MeshStandardMaterial({color:0x67ae70, emissive:0x1e542e, emissiveIntensity:.75, roughness:.25})); const light = new THREE.PointLight(0x6dbc72,.45,4); orb.add(light); orb.position.copy(mapPosition(seed)); orb.position.y += .42; orb.userData.orb=true; orb.userData.baseY=orb.position.y; orb.userData.phase=Math.random()*6.28;scene.add(orb);healthOrbs.push(orb); }
async function attachGun() { const group = new THREE.Group(); group.position.set(.32,-.28,-.55); group.rotation.set(-.08,-.23,0); camera.add(group); scene.add(camera); gunRoot = group; await changeGun('m1911'); }
async function changeGun(name) { currentGun=name; if (!gunRoot) return; while(gunRoot.children.length) gunRoot.remove(gunRoot.children[0]); if (!guns[name]) { try { guns[name] = name === 'm1911' ? await objLoader.loadAsync('/models/weapon/guns/m1911/M1911.obj') : (await loader.loadAsync('/models/weapon/guns/bren2/bren2.glb')).scene; } catch { guns[name] = new THREE.Mesh(new THREE.BoxGeometry(.13,.13,.55),new THREE.MeshStandardMaterial({color:0x252525,metalness:.7,roughness:.3})); } } const weapon=guns[name].clone(true); weapon.scale.setScalar(name === 'm1911' ? .008 : .10); weapon.rotation.set(0,Math.PI,0); gunRoot.add(weapon); updateUI(); }
function enemyRoot(object) { let node = object; while(node) { if(node.userData?.enemy) return node; node=node.parent; } return null; }
function fire() { if (!running || !pointer || ammo[currentGun] <= 0) return; ammo[currentGun]--; gunRoot.position.z = -.48; setTimeout(()=>{if(gunRoot)gunRoot.position.z=-.55;},55); updateUI(); const origin=camera.getWorldPosition(v1), direction=camera.getWorldDirection(v2); raycaster.set(origin,direction); raycaster.far=180; const objects=mode==='cqb'?[...houseMeshes,...enemies]:[practiceTarget]; const hit=raycaster.intersectObjects(objects,true)[0]; if(!hit) return; if(mode==='practice') { score++; moveTarget(true); updateUI(); return; } const enemy=enemyRoot(hit.object); if(enemy) { enemy.userData.health-=gunData[currentGun].damage; if(enemy.userData.health<=0) killEnemy(enemy); } }
function killEnemy(enemy) { score+=3;enemies=enemies.filter(e=>e!==enemy);scene.remove(enemy);setTimeout(()=>{if(running&&mode==='cqb'&&enemyTemplate)spawnEnemy(enemyTemplate,Math.random());},500);updateUI(); }
function moveTarget(hit=false) { if(!practiceTarget) return; if(level===2) return; if(level===3 && (hit || elapsed-practiceTarget.userData.lastMove>1.7)) { practiceTarget.position.x=(Math.random()-.5)*14;practiceTarget.position.y=2.2+Math.random()*4;practiceTarget.userData.lastMove=elapsed; } }
function reload() { if(!running || reloads<=0 || ammo[currentGun]===gunData[currentGun].capacity || reserves[currentGun]<=0) return; const needed=gunData[currentGun].capacity-ammo[currentGun], added=Math.min(needed,reserves[currentGun]); ammo[currentGun]+=added;reserves[currentGun]-=added;reloads--;updateUI();announce('재장전 완료'); }
function feetPosition() { return new THREE.Vector3(camera.position.x,camera.position.y-eyeHeight,camera.position.z); }
function movePlayer(dt) {
  if(mode!=='cqb') { if(!pointer)return; const forward=camera.getWorldDirection(v1);forward.y=0;forward.normalize();const right=v2.crossVectors(forward,camera.up).normalize();const delta=new THREE.Vector3();if(keys.has('KeyW'))delta.add(forward);if(keys.has('KeyS'))delta.sub(forward);if(keys.has('KeyD'))delta.add(right);if(keys.has('KeyA'))delta.sub(right);if(delta.lengthSq())camera.position.add(delta.normalize().multiplyScalar(dt*4.3));return; }
  const feet=feetPosition();
  if(pointer) { const forward=camera.getWorldDirection(v1);forward.y=0;forward.normalize();const right=v2.crossVectors(forward,camera.up).normalize();const delta=new THREE.Vector3();if(keys.has('KeyW'))delta.add(forward);if(keys.has('KeyS'))delta.sub(forward);if(keys.has('KeyD'))delta.add(right);if(keys.has('KeyA'))delta.sub(right);if(delta.lengthSq()){delta.normalize().multiplyScalar(dt*4.0);const next=feet.clone().add(delta);if(canMove(next,delta)){camera.position.x=next.x;camera.position.z=next.z;}} }
  verticalVelocity-=18*dt;camera.position.y+=verticalVelocity*dt;
  const currentFeet=feetPosition(), rayOrigin=currentFeet.clone().add(new THREE.Vector3(0,.14,0));raycaster.set(rayOrigin,new THREE.Vector3(0,-1,0));raycaster.far=Math.max(.5,Math.min(1.4,-verticalVelocity*dt+.28));
  const floor=raycaster.intersectObjects(houseMeshes,false).find(hit=>hit.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y>.62);
  if(floor&&verticalVelocity<=0&&floor.distance<=raycaster.far){camera.position.y=floor.point.y+eyeHeight+.03;verticalVelocity=0;grounded=true;}else grounded=false;
  if(playerBody){playerBody.position.set(camera.position.x,camera.position.y-eyeHeight+playerSize.y/2,camera.position.z);}
}
function canMove(nextFeet,delta) {
  if(nextFeet.x<mapBox.min.x-1||nextFeet.x>mapBox.max.x+1||nextFeet.z<mapBox.min.z-1||nextFeet.z>mapBox.max.z+1)return false;
  const distance=delta.length(),direction=delta.clone().normalize(),center=new THREE.Vector3(camera.position.x,camera.position.y-.72,camera.position.z);
  raycaster.far=distance+playerSize.x*.52;
  for(const y of [.12,.82]){raycaster.set(center.clone().add(new THREE.Vector3(0,y,0)),direction);if(raycaster.intersectObjects(houseMeshes,false).some(hit=>hit.distance<raycaster.far))return false;}
  for(const enemy of enemies){const dx=nextFeet.x-enemy.position.x,dz=nextFeet.z-enemy.position.z;if(dx*dx+dz*dz<.72*.72&&Math.abs(nextFeet.y-enemy.position.y)<1.5)return false;}
  return true;
}
function cqbTick(dt) {
  for(const orb of [...healthOrbs]){orb.position.y=orb.userData.baseY+Math.sin(elapsed*2+orb.userData.phase)*.08;const dx=orb.position.x-camera.position.x,dz=orb.position.z-camera.position.z;if(dx*dx+dz*dz<.72&&Math.abs(orb.position.y-(camera.position.y-eyeHeight))<1.1){health=Math.min(14,health+5);healthOrbs=healthOrbs.filter(o=>o!==orb);scene.remove(orb);setTimeout(()=>{if(running&&mode==='cqb')spawnOrb(Math.random());},700);updateUI();}}
  const feet=feetPosition(),activeFlag=flags.find(flag=>{const point=flag.userData.capturePoint,dx=point.x-feet.x,dz=point.z-feet.z;return dx*dx+dz*dz<2.35*2.35&&Math.abs(point.y-feet.y)<1.25;});
  const anchor=camera.userData.capturePosition||feet;const moved=feet.distanceToSquared(anchor)>.0025;
  if(activeFlag&&!moved){captureTime+=dt;ui.capture.style.display='block';ui.captureBar.style.width=`${Math.min(100,captureTime/10*100)}%`;if(captureTime>=10)captureFlag(activeFlag);}else{captureTime=0;camera.userData.capturePosition=feet.clone();ui.capture.style.display='none';ui.captureBar.style.width='0%';}
  for(const enemy of enemies){const eye=enemy.position.clone();eye.y+=1.35;const target=camera.position.clone();target.y-=.45;const toPlayer=target.sub(eye),distance=toPlayer.length();if(distance>38||elapsed<enemy.userData.nextShot)continue;raycaster.set(eye,toPlayer.clone().normalize());raycaster.far=distance-.25;const wall=raycaster.intersectObjects(houseMeshes,false)[0];if(!wall){enemy.rotation.y=Math.atan2(toPlayer.x,toPlayer.z);enemy.userData.nextShot=elapsed+1.35;takeDamage(2);}}
}
function captureFlag(flag) { flags=flags.filter(item=>item!==flag);scene.remove(flag);captured++;health=14;captureTime=0;ui.capture.style.display='none';ui.captureBar.style.width='0%';const audio=new Audio('/sound/flag.ogg');audio.play().catch(()=>{});announce('FLAG 점령');updateUI();if(captured===3) finish(true); }
function takeDamage(amount) { health-=amount;lastDamage=elapsed;updateUI();if(health<=0)finish(false); }
async function finish(cleared) { if(!running)return;running=false;document.exitPointerLock?.();ui.hud.style.display='none';const isPractice=mode==='practice'; const title=isPractice?(cleared?'레벨 클리어!':'훈련 종료'):(cleared?'작전 성공':'실패ㅠㅠ');ui.resultMode.textContent=mode.toUpperCase();ui.resultTitle.textContent=title;ui.resultScore.textContent=isPractice?`명중 ${score}회 · 도달 레벨 ${level}`:`처치 점수 ${score}점 · 점령 ${captured} / 3`;show(ui.result);try{const response=await fetch('/api/ranks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:playerName,score,level:isPractice?level:0,mode:mode.toUpperCase()})});const rows=await response.json();ui.ranks.innerHTML=rows.slice(0,8).map(row=>`<li><span>${row.rank}. ${escapeHTML(row.name)} ${row.mode==='PRACTICE'?`· L${row.level}`:''}</span><span>${row.score}</span></li>`).join('');}catch{ui.ranks.innerHTML='<li><span>기록 저장에 실패했습니다.</span></li>';} }
function escapeHTML(value){return String(value).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));}
function tick() { requestAnimationFrame(tick); const dt=Math.min(clock.getDelta(),.05);if(running){elapsed+=dt;remaining-=dt;movePlayer(dt);if(mode==='practice'){if(level===2&&practiceTarget)practiceTarget.position.x=Math.sin(elapsed*2.4)*10;moveTarget(false);if(elapsed>=level*15&&level<3){level++;announce(`LEVEL ${level}`);}if(remaining<=0)finish(level===3);}else cqbTick(dt);updateUI();}renderer.render(scene,camera); }
document.querySelectorAll('.mode-button').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.mode;ui.mode.textContent=mode.toUpperCase();show(ui.name);ui.nameInput.focus();}));
document.querySelector('.back').addEventListener('click',()=>show(ui.landing));$('begin-button').addEventListener('click',start);$('return-button').addEventListener('click',()=>{resetWorld();ui.hud.style.display='none';show(ui.landing);});
document.addEventListener('pointerlockchange',()=>{pointer=document.pointerLockElement===renderer.domElement;});renderer.domElement.addEventListener('click',()=>{if(running&&!pointer)lockPointer();});
document.addEventListener('mousemove',event=>{if(!pointer)return;camera.rotation.order='YXZ';camera.rotation.y-=event.movementX*.002;camera.rotation.x=Math.max(-1.35,Math.min(1.35,camera.rotation.x-event.movementY*.002));});
document.addEventListener('mousedown',event=>{if(event.button===0)fire();if(event.button===2&&running){camera.fov=48;camera.updateProjectionMatrix();ui.crosshair.style.transform='translate(-50%,-50%) scale(.65)';}});document.addEventListener('mouseup',event=>{if(event.button===2){camera.fov=72;camera.updateProjectionMatrix();ui.crosshair.style.transform='translate(-50%,-50%)';}});document.addEventListener('contextmenu',event=>event.preventDefault());
document.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();if(mode==='cqb'&&running&&grounded&&!event.repeat){verticalVelocity=6.2;grounded=false;} }keys.add(event.code);if(event.code==='KeyR')reload();if(event.code==='Digit1')changeGun('m1911');if(event.code==='Digit2')changeGun('bren2');});document.addEventListener('keyup',event=>keys.delete(event.code));
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
tick();
