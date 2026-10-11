const $ = id => document.getElementById(id);
const loginView = $('login-view'), dashboard = $('dashboard'), loginError = $('login-error');
let adminToken = '';
let pollTimer = 0;
let toastTimer = 0;
try { adminToken = sessionStorage.getItem('soldiers-admin-token') || ''; } catch {}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
}
function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2400);
}
function setLoggedIn(value) {
  loginView.classList.toggle('hidden', value);
  dashboard.classList.toggle('hidden', !value);
  $('logout').classList.toggle('hidden', !value);
}
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}), ...(adminToken ? { 'X-Admin-Token': adminToken } : {}) };
  const response = await fetch(url, { ...options, headers, cache: 'no-store' });
  let body = {};
  try { body = await response.json(); } catch {}
  if (response.status === 401 && adminToken) {
    adminToken = '';
    try { sessionStorage.removeItem('soldiers-admin-token'); } catch {}
    clearInterval(pollTimer);
    setLoggedIn(false);
  }
  if (!response.ok) throw new Error(body.error || `요청에 실패했습니다 (${response.status})`);
  return body;
}
async function login(event) {
  event.preventDefault();
  loginError.textContent = '';
  try {
    const result = await api('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('pin').value }) });
    adminToken = result.token;
    try { sessionStorage.setItem('soldiers-admin-token', adminToken); } catch {}
    $('pin').value = '';
    setLoggedIn(true);
    await refresh();
    pollTimer = setInterval(refresh, 3000);
  } catch (error) { loginError.textContent = error.message; }
}
function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value % 3600 / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function formatMatchTime(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function phaseLabel(phase) {
  return ({ waiting:'대기 중', countdown:'카운트다운', running:'진행 중', finished:'종료' })[phase] || phase || '대기 중';
}
function renderStations(stations) {
  $('station-count').textContent = String(stations.length);
  const tbody = $('stations');
  if (!stations.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">접속 중인 스테이션이 없습니다.</td></tr>';
    return;
  }
  tbody.innerHTML = stations.map(station => `<tr>
    <td><strong>PC ${station.id}</strong></td>
    <td>${escapeHTML(station.name || '이름 미입력')}</td>
    <td>${escapeHTML(station.mode)}<small>${escapeHTML(station.map || '-')}</small></td>
    <td><span class="status-pill">${escapeHTML(station.state)}</span></td>
    <td>${station.visible ? '활성' : '백그라운드'}<small>${station.lastSeenSeconds}초 전</small></td>
    <td><button class="home-button" data-home="${station.id}">시작 화면</button></td>
  </tr>`).join('');
  tbody.querySelectorAll('[data-home]').forEach(button => button.addEventListener('click', async () => {
    const station = stations.find(item => item.id === Number(button.dataset.home));
    const war = station?.mode === 'WAR';
    const message = war ? `PC ${station.id}는 WAR 매치에 참가 중입니다. 시작 화면으로 보내면 같은 매치의 모든 참가자가 종료됩니다. 계속할까요?` : `PC ${station.id}를 게임 시작 화면으로 돌려보낼까요?`;
    if (!confirm(message)) return;
    try { const result = await api(`/api/admin/stations/${station.id}/home`, { method: 'POST' }); toast(result.warReset ? 'WAR 참가자 모두를 시작 화면으로 보냈습니다.' : '시작 화면 복귀를 요청했습니다.'); }
    catch (error) { toast(error.message); }
  }));
}
function renderQueue(queue) {
  const list = $('queue-list');
  if (!queue.length) { list.innerHTML = '<li class="empty">대기 중인 방문객이 없습니다.</li>'; return; }
  list.innerHTML = queue.map((entry, index) => `<li><span>${index + 1}. ${escapeHTML(entry.name)}</span><button data-remove="${entry.id}">삭제</button></li>`).join('');
  list.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', async () => {
    try { await api(`/api/admin/queue/${button.dataset.remove}`, { method: 'DELETE' }); await refresh(); }
    catch (error) { toast(error.message); }
  }));
}
async function refresh() {
  if (!adminToken) return;
  try {
    const data = await api('/api/admin/status');
    $('connection').classList.remove('offline');
    $('connection').innerHTML = '<i></i> 실시간 연결';
    renderStations(data.clients || []);
    renderQueue(data.queue || []);
    const war = data.war || {};
    $('war-phase').textContent = war.phase === 'countdown' ? `시작 ${war.countdownSeconds}초 전` : phaseLabel(war.phase);
    $('war-players').textContent = `플레이어 ${war.playerCount || 0} / 2${war.result ? ` · ${war.result}` : ''}`;
    $('war-enemies').textContent = String(war.enemyCount || 0);
    $('war-reinforcements').textContent = `${war.reinforcements || 0} / ${war.reinforcementsMax || 15}`;
    $('war-time').textContent = formatMatchTime(war.elapsed);
    $('war-roster').textContent = (war.players || []).map(player => `${player.name} (${player.kills} K · HP ${player.hp})`).join(' · ') || '-';
    $('uptime').textContent = formatDuration(data.server?.uptime);
    $('memory').textContent = `메모리 ${data.server?.memoryMb ?? '-'} MB`;
    $('updated').textContent = `갱신 ${new Date().toLocaleTimeString('ko-KR')}`;
  } catch (error) {
    $('connection').classList.add('offline');
    $('connection').innerHTML = '<i></i> 연결 끊김';
    if (error.message) console.warn('Operator status refresh failed:', error.message);
  }
}

$('login-form').addEventListener('submit', login);
$('logout').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
  adminToken = '';
  try { sessionStorage.removeItem('soldiers-admin-token'); } catch {}
  clearInterval(pollTimer);
  setLoggedIn(false);
});
$('reset-war').addEventListener('click', async () => {
  if (!confirm('현재 WAR 매치를 종료하고 모든 참가자를 연결 해제할까요?')) return;
  try { const result = await api('/api/admin/war/reset', { method: 'POST' }); toast(`WAR 매치를 초기화했습니다. 참가자 ${result.closed}명 연결 해제.`); await refresh(); }
  catch (error) { toast(error.message); }
});
$('queue-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = $('visitor-name').value.trim();
  if (!name) return;
  try { await api('/api/admin/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); $('visitor-name').value = ''; await refresh(); }
  catch (error) { toast(error.message); }
});
$('next-visitor').addEventListener('click', async () => {
  try { const result = await api('/api/admin/queue/next', { method: 'POST' }); toast(result.entry ? `다음 방문객: ${result.entry.name}` : '대기열이 비어 있습니다.'); await refresh(); }
  catch (error) { toast(error.message); }
});

if (adminToken) {
  setLoggedIn(true);
  void refresh();
  pollTimer = setInterval(refresh, 3000);
}
