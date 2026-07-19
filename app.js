'use strict';

const SUPABASE_URL = 'https://vspqkebqikxakauvfxiy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wUg7_jDdKtyXxx78kiN3Lg_NrTAwh_4';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let user = null;
let state = { ingredients: [], menus: [], plans: [], shopping: [] };
let ingredientFilter = '전체';
let realtimeChannel = null;
let weekStart = startOfWeek(new Date());

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));

function setLoading(value) { $('loading').classList.toggle('hidden', !value); }
function message(text, isError = false) { $('authMsg').textContent = text; $('authMsg').style.color = isError ? '#c0392b' : '#82797b'; }
function fail(error) { console.error(error); alert(error?.message || '처리 중 오류가 발생했어요.'); }
function dateToday() { return new Date().toLocaleDateString('sv-SE'); }
function toDateString(date) { return date.toLocaleDateString('sv-SE'); }
function startOfWeek(date) { const d = new Date(date); d.setHours(0,0,0,0); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day; d.setDate(d.getDate() + diff); return d; }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function daysLeft(date) { if (!date) return null; const today = new Date(`${dateToday()}T00:00:00`); const target = new Date(`${date}T00:00:00`); return Math.round((target - today) / 86400000); }
function expiryHtml(date) {
  const days = daysLeft(date);
  if (days === null) return '';
  if (days < 0) return `<span class="expiry-overdue">${Math.abs(days)}일 지남</span>`;
  if (days === 0) return '<span class="expiry-today">오늘까지</span>';
  return `<span class="expiry-upcoming">D-${days}</span>`;
}
function formatDateTime(value) { if (!value) return ''; return new Date(value).toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }); }

async function signIn() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password) return message('이메일과 비밀번호를 입력해 주세요.', true);
  setLoading(true);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  setLoading(false);
  if (error) return message(`로그인 실패: ${error.message}`, true);
}
async function signOut() { await sb.auth.signOut(); }

sb.auth.onAuthStateChange(async (_event, session) => {
  user = session?.user || null;
  if (user) {
    $('authView').classList.add('hidden');
    $('appView').classList.remove('hidden');
    $('accountEmail').textContent = user.email || '';
    await loadAll();
    subscribeRealtime();
  } else {
    if (realtimeChannel) { await sb.removeChannel(realtimeChannel); realtimeChannel = null; }
    $('appView').classList.add('hidden');
    $('authView').classList.remove('hidden');
    state = { ingredients: [], menus: [], plans: [], shopping: [] };
  }
});

async function loadAll() {
  if (!user) return;
  setLoading(true);
  const [ingredientsResult, menusResult, plansResult, shoppingResult] = await Promise.all([
    sb.from('ingredients').select('*').order('depleted').order('created_at', { ascending: false }),
    sb.from('menus').select('*').order('created_at', { ascending: false }),
    sb.from('meal_plans').select('*').order('meal_date', { ascending: true }),
    sb.from('shopping_items').select('*').order('done').order('created_at', { ascending: false })
  ]);
  setLoading(false);
  for (const result of [ingredientsResult, menusResult, plansResult, shoppingResult]) if (result.error) return fail(result.error);
  state.ingredients = ingredientsResult.data || [];
  state.menus = menusResult.data || [];
  state.plans = plansResult.data || [];
  state.shopping = shoppingResult.data || [];
  render();
}

function subscribeRealtime() {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel(`babymeal-${user.id}`)
    .on('postgres_changes', { event:'*', schema:'public', table:'ingredients', filter:`user_id=eq.${user.id}` }, loadAll)
    .on('postgres_changes', { event:'*', schema:'public', table:'menus', filter:`user_id=eq.${user.id}` }, loadAll)
    .on('postgres_changes', { event:'*', schema:'public', table:'meal_plans', filter:`user_id=eq.${user.id}` }, loadAll)
    .on('postgres_changes', { event:'*', schema:'public', table:'shopping_items', filter:`user_id=eq.${user.id}` }, loadAll)
    .subscribe();
}

function resetIngredientForm() {
  $('ingredientEditId').value = '';
  $('ingredientFormTitle').textContent = '식재료 추가';
  $('ingredientSaveButton').textContent = '추가';
  $('ingredientCancelButton').classList.add('hidden');
  $('ingName').value = '';
  $('ingQty').value = '1';
  $('ingExpiry').value = '';
  $('ingPortionAmount').value = '';
  $('ingPortionCount').value = '';
}

async function saveIngredient() {
  const id = $('ingredientEditId').value;
  const name = $('ingName').value.trim();
  const expiryDate = $('ingExpiry').value;
  const quantity = Number($('ingQty').value);
  const portionAmountRaw = $('ingPortionAmount').value;
  const portionCountRaw = $('ingPortionCount').value;
  if (!name) return alert('식재료명을 입력해 주세요.');
  if (!expiryDate) return alert('유통기한을 입력해 주세요.');
  if (!Number.isFinite(quantity) || quantity < 0) return alert('수량은 0 이상이어야 해요.');
  const portionAmount = portionAmountRaw === '' ? null : Number(portionAmountRaw);
  const portionCount = portionCountRaw === '' ? null : Number(portionCountRaw);
  if ((portionAmount !== null && (!Number.isFinite(portionAmount) || portionAmount <= 0)) || (portionCount !== null && (!Number.isInteger(portionCount) || portionCount <= 0))) return alert('소분 용량과 개수는 0보다 크게 입력해 주세요.');
  if ((portionAmount === null) !== (portionCount === null)) return alert('소분 용량과 개수를 모두 입력하거나 모두 비워 주세요.');

  const payload = {
    user_id: user.id,
    name,
    category: $('ingCategory').value,
    storage_place: $('ingPlace').value,
    quantity,
    unit: $('ingUnit').value,
    expiry_date: expiryDate,
    portion_amount: portionAmount,
    portion_count: portionCount,
    portion_unit: portionAmount === null ? null : $('ingPortionUnit').value
  };
  const result = id ? await sb.from('ingredients').update(payload).eq('id', id) : await sb.from('ingredients').insert(payload);
  if (result.error) return fail(result.error);
  resetIngredientForm();
  await loadAll();
}

function editIngredient(id) {
  const item = state.ingredients.find((value) => value.id === id);
  if (!item) return;
  $('ingredientEditId').value = item.id;
  $('ingredientFormTitle').textContent = '식재료 수정';
  $('ingredientSaveButton').textContent = '수정 저장';
  $('ingredientCancelButton').classList.remove('hidden');
  $('ingName').value = item.name || '';
  $('ingCategory').value = item.category || '기타';
  $('ingPlace').value = item.storage_place || '냉장';
  $('ingQty').value = item.quantity ?? 0;
  $('ingUnit').value = item.unit || '개';
  $('ingExpiry').value = item.expiry_date || '';
  $('ingPortionAmount').value = item.portion_amount ?? '';
  $('ingPortionUnit').value = item.portion_unit || 'g';
  $('ingPortionCount').value = item.portion_count ?? '';
  window.scrollTo({ top: $('ingredients').offsetTop - 90, behavior: 'smooth' });
}

async function changeQty(id, delta) {
  const item = state.ingredients.find((value) => value.id === id); if (!item) return;
  const quantity = Math.max(0, Number((Number(item.quantity) + delta).toFixed(2)));
  const { error } = await sb.from('ingredients').update({ quantity, depleted: quantity === 0 ? true : item.depleted }).eq('id', id);
  if (error) return fail(error); await loadAll();
}
async function toggleDepleted(id) { const item = state.ingredients.find((value) => value.id === id); if (!item) return; const { error } = await sb.from('ingredients').update({ depleted: !item.depleted }).eq('id', id); if (error) return fail(error); await loadAll(); }

function resetMenuForm() {
  $('menuEditId').value = '';
  $('menuFormTitle').textContent = '메뉴 저장';
  $('menuSaveButton').textContent = '저장';
  $('menuCancelButton').classList.add('hidden');
  $('menuName').value = '';
  $('menuIngredients').value = '';
  $('menuExpiry').value = '';
  $('menuTotalQty').value = '';
  $('menuTotalUnit').value = 'g';
  $('menuReaction').value = '반응 미기록';
  $('menuMemo').value = '';
}

async function saveMenu() {
  const id = $('menuEditId').value;
  const name = $('menuName').value.trim();
  const expiryDate = $('menuExpiry').value;
  const totalQuantityRaw = $('menuTotalQty').value;
  if (!name) return alert('메뉴명을 입력해 주세요.');
  if (!expiryDate) return alert('유통기한을 입력해 주세요.');
  const totalQuantity = totalQuantityRaw === '' ? null : Number(totalQuantityRaw);
  if (totalQuantity !== null && (!Number.isFinite(totalQuantity) || totalQuantity < 0)) return alert('완제품 총량은 0 이상이어야 해요.');
  const payload = {
    user_id: user.id,
    name,
    ingredients_text: $('menuIngredients').value.trim(),
    reaction: $('menuReaction').value,
    memo: $('menuMemo').value.trim(),
    expiry_date: expiryDate,
    total_quantity: totalQuantity,
    total_unit: totalQuantity === null ? null : $('menuTotalUnit').value
  };
  const result = id ? await sb.from('menus').update(payload).eq('id', id) : await sb.from('menus').insert(payload);
  if (result.error) return fail(result.error);
  resetMenuForm();
  await loadAll();
}

function editMenu(id) {
  const item = state.menus.find((value) => value.id === id); if (!item) return;
  $('menuEditId').value = item.id;
  $('menuFormTitle').textContent = '메뉴 수정';
  $('menuSaveButton').textContent = '수정 저장';
  $('menuCancelButton').classList.remove('hidden');
  $('menuName').value = item.name || '';
  $('menuIngredients').value = item.ingredients_text || '';
  $('menuExpiry').value = item.expiry_date || '';
  $('menuTotalQty').value = item.total_quantity ?? '';
  $('menuTotalUnit').value = item.total_unit || 'g';
  $('menuReaction').value = item.reaction || '반응 미기록';
  $('menuMemo').value = item.memo || '';
  window.scrollTo({ top: $('menus').offsetTop - 90, behavior: 'smooth' });
}

async function addPlan() {
  const mealDate = $('planDate').value;
  const menuName = $('planCustom').value.trim() || $('planMenu').value;
  if (!mealDate) return alert('날짜를 선택해 주세요.');
  if (!menuName) return alert('메뉴를 입력해 주세요.');
  const { error } = await sb.from('meal_plans').insert({ user_id:user.id, meal_date:mealDate, meal_slot:$('planSlot').value, menu_name:menuName });
  if (error) return fail(error); $('planCustom').value = ''; await loadAll();
}

async function addShopping() { const name = $('shopName').value.trim(); if (!name) return; const { error } = await sb.from('shopping_items').insert({ user_id:user.id, name, done:false, completed_at:null }); if (error) return fail(error); $('shopName').value = ''; await loadAll(); }
async function completeShopping(id, done) { const { error } = await sb.from('shopping_items').update({ done, completed_at: done ? new Date().toISOString() : null }).eq('id', id); if (error) return fail(error); await loadAll(); }
async function removeRow(table, id) { if (!confirm('삭제할까요?')) return; const { error } = await sb.from(table).delete().eq('id', id); if (error) return fail(error); await loadAll(); }

function renderIngredients() {
  let list = state.ingredients;
  if (ingredientFilter === '소진') list = list.filter((item) => item.depleted);
  else if (ingredientFilter !== '전체') list = list.filter((item) => item.storage_place === ingredientFilter && !item.depleted);
  $('ingredientList').innerHTML = list.length ? list.map((item) => {
    const storageClass = item.storage_place === '상온' ? 'tag-room' : item.storage_place === '냉장' ? 'tag-cold' : 'tag-freeze';
    const portionText = item.portion_amount && item.portion_count ? `<div class="portion">소분 ${Number(item.portion_amount)}${esc(item.portion_unit || item.unit || '')} × ${Number(item.portion_count)}</div>` : '';
    return `<div class="card item"><div class="${item.depleted ? 'depleted' : ''}"><div class="item-title">${esc(item.name)}</div><div class="meta"><span class="tag tag-cat">${esc(item.category)}</span><span class="tag ${storageClass}">${esc(item.storage_place)}</span>${Number(item.quantity)}${esc(item.unit)} · ${expiryHtml(item.expiry_date)}</div>${portionText}</div><div class="toolbar"><button class="btn ghost" type="button" onclick="changeQty('${item.id}',-1)" ${Number(item.quantity) <= 0 ? 'disabled' : ''}>−</button><button class="btn ghost" type="button" onclick="changeQty('${item.id}',1)">＋</button><button class="btn soft" type="button" onclick="editIngredient('${item.id}')">수정</button><button class="btn soft" type="button" onclick="toggleDepleted('${item.id}')">${item.depleted ? '복구' : '소진'}</button><button class="btn danger" type="button" onclick="removeRow('ingredients','${item.id}')">삭제</button></div></div>`;
  }).join('') : '<div class="empty">해당 재고가 없어요.</div>';
}

function renderMenus() {
  $('menuList').innerHTML = state.menus.length ? state.menus.map((item) => {
    const totalText = item.total_quantity !== null && item.total_quantity !== undefined ? ` · 완제품 ${Number(item.total_quantity)}${esc(item.total_unit || '')}` : '';
    return `<div class="card item"><div><div class="item-title">${esc(item.name)}</div><div class="meta">${esc(item.ingredients_text || '재료 미입력')} · ${esc(item.reaction)}${totalText}</div><div class="meta">유통기한 ${esc(item.expiry_date || '')} · ${expiryHtml(item.expiry_date)}</div>${item.memo ? `<div class="meta">${esc(item.memo)}</div>` : ''}</div><div class="toolbar"><button class="btn soft" type="button" onclick="editMenu('${item.id}')">수정</button><button class="btn danger" type="button" onclick="removeRow('menus','${item.id}')">삭제</button></div></div>`;
  }).join('') : '<div class="empty">저장 메뉴가 없어요.</div>';
  $('planMenu').innerHTML = '<option value="">저장 메뉴 선택</option>' + state.menus.map((item) => `<option value="${esc(item.name)}">${esc(item.name)}</option>`).join('');
}

function renderWeeklyPlan() {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const slots = ['아침','점심','간식','저녁'];
  $('weekTitle').textContent = `${toDateString(days[0])} ~ ${toDateString(days[6])}`;
  const headers = days.map((date) => `<th>${['월','화','수','목','금','토','일'][days.indexOf(date)]}<br><span class="meta">${date.getMonth()+1}/${date.getDate()}</span></th>`).join('');
  const rows = slots.map((slot) => {
    const cells = days.map((date) => {
      const dateString = toDateString(date);
      const entries = state.plans.filter((item) => item.meal_date === dateString && item.meal_slot === slot);
      return `<td><div class="weekly-cell">${entries.length ? entries.map((item) => `<div class="weekly-entry">${esc(item.menu_name)}<button class="btn danger" type="button" onclick="removeRow('meal_plans','${item.id}')">삭제</button></div>`).join('') : '<div class="meta">비어 있음</div>'}</div></td>`;
    }).join('');
    return `<tr><td>${slot}</td>${cells}</tr>`;
  }).join('');
  $('weeklyTable').innerHTML = `<table class="weekly-table"><thead><tr><th>구분</th>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderShopping() {
  const pending = state.shopping.filter((item) => !item.done);
  const completed = state.shopping.filter((item) => item.done);
  $('shoppingPendingList').innerHTML = pending.length ? pending.map((item) => `<div class="item card"><div><div class="item-title">${esc(item.name)}</div><div class="meta">아직 구매하지 않았어요.</div></div><div class="toolbar"><button class="btn success" type="button" onclick="completeShopping('${item.id}',true)">구매 완료</button><button class="btn danger" type="button" onclick="removeRow('shopping_items','${item.id}')">삭제</button></div></div>`).join('') : '<div class="empty">구매할 항목이 없어요.</div>';
  $('shoppingCompletedList').innerHTML = completed.length ? completed.map((item) => `<div class="item card"><div><div class="item-title">${esc(item.name)} <span class="completed-badge">구매 완료</span></div><div class="shopping-complete-time">${formatDateTime(item.completed_at)}</div></div><div class="toolbar"><button class="btn ghost" type="button" onclick="completeShopping('${item.id}',false)">미구매로 되돌리기</button><button class="btn danger" type="button" onclick="removeRow('shopping_items','${item.id}')">삭제</button></div></div>`).join('') : '<div class="empty">완료된 항목이 없어요.</div>';
}

function renderHome() {
  const today = dateToday();
  const todays = state.plans.filter((item) => item.meal_date === today);
  $('mIngredients').textContent = state.ingredients.filter((item) => !item.depleted).length;
  $('mMenus').textContent = state.menus.length;
  $('mToday').textContent = todays.length;
  $('mShopping').textContent = state.shopping.filter((item) => !item.done).length;
  $('todayMeals').innerHTML = todays.length ? todays.map((item) => `<div class="weekly-entry"><strong>${esc(item.meal_slot)}</strong> · ${esc(item.menu_name)}</div>`).join('') : '<div class="empty">오늘 식단이 아직 없어요.</div>';
}
function render() { renderHome(); renderIngredients(); renderMenus(); renderWeeklyPlan(); renderShopping(); }

function bindEvents() {
  $('loginButton').addEventListener('click', signIn);
  $('logoutButton').addEventListener('click', signOut);
  $('ingredientSaveButton').addEventListener('click', saveIngredient);
  $('ingredientCancelButton').addEventListener('click', resetIngredientForm);
  $('menuSaveButton').addEventListener('click', saveMenu);
  $('menuCancelButton').addEventListener('click', resetMenuForm);
  $('planAddButton').addEventListener('click', addPlan);
  $('shoppingAddButton').addEventListener('click', addShopping);
  $('reloadButton').addEventListener('click', loadAll);
  $('prevWeekButton').addEventListener('click', () => { weekStart = addDays(weekStart, -7); renderWeeklyPlan(); });
  $('nextWeekButton').addEventListener('click', () => { weekStart = addDays(weekStart, 7); renderWeeklyPlan(); });
  document.querySelectorAll('nav button').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('main section').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    $(button.dataset.tab).classList.add('active');
  }));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { ingredientFilter = button.dataset.filter; renderIngredients(); }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && user) loadAll(); });
}

bindEvents();
$('planDate').value = dateToday();
(async () => { const { data } = await sb.auth.getSession(); if (!data.session) setLoading(false); })();

window.changeQty = changeQty;
window.toggleDepleted = toggleDepleted;
window.editIngredient = editIngredient;
window.editMenu = editMenu;
window.completeShopping = completeShopping;
window.removeRow = removeRow;
