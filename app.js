'use strict';

const SUPABASE_URL = 'https://vspqkebqikxakauvfxiy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wUg7_jDdKtyXxx78kiN3Lg_NrTAwh_4';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let user = null;
let state = { ingredients: [], plans: [], shopping: [], reactions: [] };
let mealEditor = { date: '', slot: '', reactions: {} };
let ingredientFilter = '전체';
let realtimeChannel = null;
let weekStart = startOfWeek(new Date());

const $ = (id) => document.getElementById(id);
const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

function setLoading(value) {
  $('loading').classList.toggle('hidden', !value);
}

function message(text, isError = false) {
  $('authMsg').textContent = text;
  $('authMsg').style.color = isError ? '#c94f4f' : '#887c65';
}

function fail(error) {
  console.error(error);
  alert(error?.message || '처리 중 오류가 발생했어요.');
}

function dateToday() {
  return new Date().toLocaleDateString('sv-SE');
}

function toDateString(date) {
  return date.toLocaleDateString('sv-SE');
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysLeft(date) {
  if (!date) return null;
  const today = new Date(`${dateToday()}T00:00:00`);
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function expiryHtml(date) {
  const days = daysLeft(date);
  if (days === null) return '';
  if (days < 0) return `<span class="expiry-overdue">${Math.abs(days)}일 지남</span>`;
  if (days === 0) return '<span class="expiry-today">오늘까지</span>';
  return `<span class="expiry-upcoming">D-${days}</span>`;
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setStatus(value) {
  $('ingStatus').value = value;
  document.querySelectorAll('.status-option').forEach((button) => {
    const selected = button.dataset.status === value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function activateTab(tabName) {
  document.querySelectorAll('main > section').forEach((section) => section.classList.toggle('active', section.id === tabName));
  document.querySelectorAll('.bottom-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tabName));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function signIn() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password) return message('이메일과 비밀번호를 입력해 주세요.', true);
  setLoading(true);
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    message('');
  } catch (error) {
    message(error.message || '로그인하지 못했어요.', true);
  } finally {
    setLoading(false);
  }
}

async function signOut() {
  setLoading(true);
  try {
    await sb.auth.signOut();
  } finally {
    setLoading(false);
  }
}

async function handleSession(session) {
  user = session?.user || null;
  $('authView').classList.toggle('hidden', Boolean(user));
  $('appView').classList.toggle('hidden', !user);

  if (!user) {
    state = { ingredients: [], plans: [], shopping: [], reactions: [] };
    if (realtimeChannel) {
      await sb.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    return;
  }

  $('accountEmail').textContent = user.email || '';
  $('planDate').value = dateToday();
  weekStart = startOfWeek(new Date());
  await loadAll();
  subscribeRealtime();
}

async function loadAll() {
  if (!user) return;
  setLoading(true);
  try {
    const [ingredientsResult, plansResult, shoppingResult, reactionsResult] = await Promise.all([
      sb.from('ingredients').select('*').order('created_at', { ascending: false }),
      sb.from('meal_plans').select('*').order('meal_date', { ascending: true }).order('created_at', { ascending: true }),
      sb.from('shopping_items').select('*').order('done', { ascending: true }).order('created_at', { ascending: false }),
      sb.from('meal_reactions').select('*').order('meal_date', { ascending: false }).order('created_at', { ascending: false })
    ]);

    if (ingredientsResult.error) throw ingredientsResult.error;
    if (plansResult.error) throw plansResult.error;
    if (shoppingResult.error) throw shoppingResult.error;
    if (reactionsResult.error) throw reactionsResult.error;

    state.ingredients = ingredientsResult.data || [];
    state.plans = plansResult.data || [];
    state.shopping = shoppingResult.data || [];
    state.reactions = reactionsResult.data || [];
    renderAll();
  } catch (error) {
    fail(error);
  } finally {
    setLoading(false);
  }
}

function subscribeRealtime() {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel(`babymeal-${user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients', filter: `user_id=eq.${user.id}` }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_plans', filter: `user_id=eq.${user.id}` }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter: `user_id=eq.${user.id}` }, loadAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meal_reactions', filter: `user_id=eq.${user.id}` }, loadAll)
    .subscribe();
}

function resetIngredientForm() {
  $('ingredientEditId').value = '';
  $('ingredientFormTitle').textContent = '재고 추가';
  $('ingredientSaveButton').textContent = '추가';
  $('ingredientCancelButton').classList.add('hidden');
  $('ingName').value = '';
  $('ingCategory').value = '육류';
  setStatus('구매');
  $('ingExpiry').value = '';
  $('ingPortionAmount').value = '';
  $('ingPortionUnit').value = 'g';
  $('ingPortionCount').value = '';
}

async function saveIngredient() {
  const id = $('ingredientEditId').value;
  const name = $('ingName').value.trim();
  const expiryDate = $('ingExpiry').value;
  const portionAmountRaw = $('ingPortionAmount').value;
  const portionCountRaw = $('ingPortionCount').value;

  if (!name) return alert('품목명을 입력해 주세요.');
  if (!expiryDate) return alert('유통기한을 입력해 주세요.');

  const portionAmount = portionAmountRaw === '' ? null : Number(portionAmountRaw);
  const portionCount = portionCountRaw === '' ? null : Number(portionCountRaw);
  if ((portionAmount !== null && (!Number.isFinite(portionAmount) || portionAmount <= 0)) ||
      (portionCount !== null && (!Number.isInteger(portionCount) || portionCount <= 0))) {
    return alert('소분 용량과 개수는 0보다 크게 입력해 주세요.');
  }
  if ((portionAmount === null) !== (portionCount === null)) {
    return alert('소분 용량과 개수를 모두 입력하거나 모두 비워 주세요.');
  }

  const category = $('ingCategory').value;
  const status = $('ingStatus').value;
  const portionUnit = portionAmount === null ? null : $('ingPortionUnit').value;
  const payload = {
    user_id: user.id,
    name,
    category,
    status,
    expiry_date: expiryDate,
    portion_amount: portionAmount,
    portion_count: portionCount,
    portion_unit: portionUnit,
    quantity: portionCount ?? 1,
    unit: portionUnit ?? '개',
    storage_place: category === '실온 간식' ? '상온' : (category === '냉동 간식' || category === '완제품' ? '냉동' : '냉장'),
    depleted: false
  };

  const result = id
    ? await sb.from('ingredients').update(payload).eq('id', id)
    : await sb.from('ingredients').insert(payload);

  if (result.error) return fail(result.error);
  resetIngredientForm();
  await loadAll();
}

function editIngredient(id) {
  const item = state.ingredients.find((value) => value.id === id);
  if (!item) return;

  $('ingredientEditId').value = item.id;
  $('ingredientFormTitle').textContent = '재고 수정';
  $('ingredientSaveButton').textContent = '수정 저장';
  $('ingredientCancelButton').classList.remove('hidden');
  $('ingName').value = item.name || '';
  $('ingCategory').value = item.category || '기타';
  setStatus(item.status || '구매');
  $('ingExpiry').value = item.expiry_date || '';
  $('ingPortionAmount').value = item.portion_amount ?? '';
  $('ingPortionUnit').value = item.portion_unit || item.unit || 'g';
  $('ingPortionCount').value = item.portion_count ?? '';
  activateTab('ingredients');
}

async function toggleDepleted(id) {
  const item = state.ingredients.find((value) => value.id === id);
  if (!item) return;
  const { error } = await sb.from('ingredients').update({ depleted: !item.depleted }).eq('id', id);
  if (error) return fail(error);
  await loadAll();
}

async function addPlan() {
  const mealDate = $('planDate').value;
  const menuName = $('planCustom').value.trim();
  if (!mealDate) return alert('날짜를 선택해 주세요.');
  if (!menuName) return alert('음식을 입력해 주세요.');

  const { error } = await sb.from('meal_plans').insert({
    user_id: user.id,
    meal_date: mealDate,
    meal_slot: $('planSlot').value,
    menu_name: menuName
  });
  if (error) return fail(error);
  $('planCustom').value = '';
  await loadAll();
}

const BULK_SLOTS = ['아침', '점심', '간식', '저녁'];
const BULK_DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function renderBulkPlanEditor(loadExisting = false) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  $('bulkPlanHead').innerHTML = `<tr><th>끼니</th>${days.map((date, dayIndex) =>
    `<th>${BULK_DAY_NAMES[dayIndex]}<span class="bulk-date">${date.getMonth() + 1}/${date.getDate()}</span></th>`
  ).join('')}</tr>`;

  $('bulkPlanBody').innerHTML = BULK_SLOTS.map((slot, slotIndex) => {
    const cells = days.map((date, dayIndex) => {
      const dateString = toDateString(date);
      let value = '';
      if (loadExisting) {
        value = state.plans
          .filter((item) => item.meal_date === dateString && item.meal_slot === slot)
          .map((item) => item.menu_name)
          .join(' · ');
      }
      return `<td><textarea class="bulk-plan-input" data-day="${dayIndex}" data-slot="${slotIndex}" aria-label="${BULK_DAY_NAMES[dayIndex]}요일 ${slot}">${esc(value)}</textarea></td>`;
    }).join('');
    return `<tr><th>${slot}</th>${cells}</tr>`;
  }).join('');
  bindBulkPasteHandlers();
}

function bulkInputs() {
  return Array.from(document.querySelectorAll('.bulk-plan-input'));
}

function parseClipboardTable(text) {
  return text.replace(/\r/g, '').split('\n')
    .filter((row, index, rows) => !(index === rows.length - 1 && row === ''))
    .map((row) => row.split('\t'));
}

function clipboardCellText(cell) {
  const clone = cell.cloneNode(true);
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  clone.querySelectorAll('div, p').forEach((block) => {
    if (block.nextSibling) block.append('\n');
  });
  return (clone.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function parseClipboardHtml(html) {
  if (!html) return null;
  const documentFromClipboard = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(documentFromClipboard.querySelectorAll('table tr'));
  if (!rows.length) return null;
  return rows.map((row) => Array.from(row.querySelectorAll(':scope > th, :scope > td')).map(clipboardCellText));
}

function bindBulkPasteHandlers() {
  bulkInputs().forEach((input) => input.addEventListener('paste', (event) => {
    const clipboard = event.clipboardData;
    const html = clipboard?.getData('text/html') || '';
    const text = clipboard?.getData('text/plain') || '';
    const htmlTable = parseClipboardHtml(html);
    const table = htmlTable || parseClipboardTable(text);
    const isMultiCellPaste = Boolean(htmlTable) || text.includes('\t') || text.includes('\n');
    if (!isMultiCellPaste || !table.length) return;

    event.preventDefault();
    const startDay = Number(input.dataset.day);
    const startSlot = Number(input.dataset.slot);
    table.forEach((row, rowOffset) => {
      row.forEach((value, columnOffset) => {
        const targetSlot = startSlot + rowOffset;
        const targetDay = startDay + columnOffset;
        const target = document.querySelector(`.bulk-plan-input[data-day="${targetDay}"][data-slot="${targetSlot}"]`);
        if (target) target.value = value.trim();
      });
    });
  }));
}

function clearBulkPlanEditor() {
  bulkInputs().forEach((input) => { input.value = ''; });
}

async function saveBulkPlan() {
  if (!user) return;
  if (!confirm('현재 주의 기존 식단을 표 내용으로 교체할까요?')) return;

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const rows = [];
  bulkInputs().forEach((input) => {
    const menuName = input.value.trim();
    if (!menuName) return;
    const dayIndex = Number(input.dataset.day);
    const slotIndex = Number(input.dataset.slot);
    rows.push({
      user_id: user.id,
      meal_date: toDateString(days[dayIndex]),
      meal_slot: BULK_SLOTS[slotIndex],
      menu_name: menuName
    });
  });

  setLoading(true);
  try {
    const weekEnd = toDateString(days[6]);
    const weekStartString = toDateString(days[0]);
    const { error: deleteError } = await sb.from('meal_plans')
      .delete()
      .gte('meal_date', weekStartString)
      .lte('meal_date', weekEnd);
    if (deleteError) throw deleteError;

    if (rows.length) {
      const { error: insertError } = await sb.from('meal_plans').insert(rows);
      if (insertError) throw insertError;
    }
    await loadAll();
    renderBulkPlanEditor(true);
    alert('이번 주 식단을 저장했어요.');
  } catch (error) {
    fail(error);
  } finally {
    setLoading(false);
  }
}

async function addShopping() {
  const name = $('shopName').value.trim();
  if (!name) return;
  const { error } = await sb.from('shopping_items').insert({
    user_id: user.id,
    name,
    done: false,
    completed_at: null
  });
  if (error) return fail(error);
  $('shopName').value = '';
  await loadAll();
}

async function completeShopping(id, done) {
  const { error } = await sb.from('shopping_items').update({
    done,
    completed_at: done ? new Date().toISOString() : null
  }).eq('id', id);
  if (error) return fail(error);
  await loadAll();
}

async function removeRow(table, id) {
  if (!confirm('삭제할까요?')) return;
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) return fail(error);
  await loadAll();
}

function ingredientMatchesFilter(item) {
  if (ingredientFilter === '전체') return !item.depleted;
  if (ingredientFilter === '소진') return item.depleted;
  if (ingredientFilter === '완제품') return item.category === '완제품' && !item.depleted;
  return item.status === ingredientFilter && !item.depleted;
}

function splitMenuLines(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function menuLinesHtml(value, className = 'menu-line') {
  return splitMenuLines(value).map((line) => `<span class="${className}">${esc(line)}</span>`).join('');
}

function reactionFor(mealDate, mealSlot, menuName) {
  return state.reactions.find((item) => item.meal_date === mealDate && item.meal_slot === mealSlot && item.menu_name === menuName)?.reaction || '미기록';
}

function closeMealEditor() {
  $('mealEditModal').classList.add('hidden');
  mealEditor = { date: '', slot: '', reactions: {} };
}

function renderMealReactionRows() {
  const lines = splitMenuLines($('mealEditText').value);
  const next = {};
  lines.forEach((line) => { next[line] = mealEditor.reactions[line] || reactionFor(mealEditor.date, mealEditor.slot, line); });
  mealEditor.reactions = next;
  $('mealReactionRows').innerHTML = lines.length ? lines.map((line) => {
    const selected = next[line] || '미기록';
    return `<div class="reaction-row"><div class="reaction-menu">${esc(line)}</div><div class="reaction-buttons">
      ${['잘 먹음','보통','거부'].map((reaction) => `<button type="button" class="reaction-button ${selected === reaction ? 'selected' : ''}" data-menu="${esc(line)}" data-reaction="${reaction}">${reaction === '잘 먹음' ? '♥' : reaction === '보통' ? '•' : '×'} ${reaction}</button>`).join('')}
    </div></div>`;
  }).join('') : '<div class="empty">메뉴를 한 줄에 하나씩 입력해 주세요.</div>';
  document.querySelectorAll('.reaction-button').forEach((button) => button.addEventListener('click', () => {
    const menu = button.dataset.menu;
    const reaction = button.dataset.reaction;
    mealEditor.reactions[menu] = mealEditor.reactions[menu] === reaction ? '미기록' : reaction;
    renderMealReactionRows();
  }));
}

function editWeeklyCell(mealDate, mealSlot) {
  const entries = state.plans.filter((item) => item.meal_date === mealDate && item.meal_slot === mealSlot);
  const currentValue = entries.map((item) => item.menu_name).filter(Boolean).join('\n');
  mealEditor = { date: mealDate, slot: mealSlot, reactions: {} };
  splitMenuLines(currentValue).forEach((line) => { mealEditor.reactions[line] = reactionFor(mealDate, mealSlot, line); });
  $('mealEditTitle').textContent = `${mealSlot} 식단`;
  $('mealEditSubtitle').textContent = mealDate;
  $('mealEditText').value = currentValue;
  $('mealEditModal').classList.remove('hidden');
  renderMealReactionRows();
  $('mealEditText').focus();
}

async function saveMealEditor(deleteOnly = false) {
  const mealDate = mealEditor.date;
  const mealSlot = mealEditor.slot;
  if (!mealDate || !mealSlot) return;
  const lines = deleteOnly ? [] : splitMenuLines($('mealEditText').value);
  if (deleteOnly && !confirm('이 식단과 반응 기록을 삭제할까요?')) return;
  setLoading(true);
  try {
    const { error: planDeleteError } = await sb.from('meal_plans').delete().eq('user_id', user.id).eq('meal_date', mealDate).eq('meal_slot', mealSlot);
    if (planDeleteError) throw planDeleteError;
    const { error: reactionDeleteError } = await sb.from('meal_reactions').delete().eq('user_id', user.id).eq('meal_date', mealDate).eq('meal_slot', mealSlot);
    if (reactionDeleteError) throw reactionDeleteError;
    if (lines.length) {
      const { error: planInsertError } = await sb.from('meal_plans').insert({ user_id: user.id, meal_date: mealDate, meal_slot: mealSlot, menu_name: lines.join('\n') });
      if (planInsertError) throw planInsertError;
      const reactionRows = lines.filter((line) => ['잘 먹음','보통','거부'].includes(mealEditor.reactions[line])).map((line) => ({
        user_id: user.id, meal_date: mealDate, meal_slot: mealSlot, menu_name: line, reaction: mealEditor.reactions[line]
      }));
      if (reactionRows.length) {
        const { error: reactionInsertError } = await sb.from('meal_reactions').insert(reactionRows);
        if (reactionInsertError) throw reactionInsertError;
      }
    }
    closeMealEditor();
    await loadAll();
  } catch (error) { fail(error); } finally { setLoading(false); }
}

function mealLinesWithReactionHtml(value, mealDate, mealSlot, className = 'menu-line') {
  return splitMenuLines(value).map((line) => {
    const reaction = reactionFor(mealDate, mealSlot, line);
    const mark = reaction === '잘 먹음' ? '<span class="reaction-mark good" title="잘 먹음">♥</span>' : reaction === '거부' ? '<span class="reaction-mark refuse" title="거부">×</span>' : '';
    return `<span class="${className}">${esc(line)}${mark}</span>`;
  }).join('');
}

function renderIngredients() {
  const list = state.ingredients.filter(ingredientMatchesFilter);
  $('ingredientList').innerHTML = list.length ? list.map((item) => {
    const portionText = item.portion_amount && item.portion_count
      ? `<div class="portion">${Number(item.portion_amount)}${esc(item.portion_unit || item.unit || '')} × ${Number(item.portion_count)}</div>`
      : '<div class="meta">소분 정보 없음</div>';

    return `<div class="card item">
      <div class="item-main ${item.depleted ? 'depleted' : ''}">
        <div class="item-title">${esc(item.name)}</div>
        <div><span class="tag">${esc(item.category || '기타')}</span><span class="tag status">${esc(item.status || '구매')}</span></div>
        ${portionText}
        <div class="meta">유통기한 ${esc(item.expiry_date || '')} · ${expiryHtml(item.expiry_date)}</div>
      </div>
      <div class="toolbar">
        <button class="btn soft" type="button" onclick="editIngredient('${item.id}')">수정</button>
        <button class="btn soft" type="button" onclick="toggleDepleted('${item.id}')">${item.depleted ? '복구' : '소진'}</button>
        <button class="btn danger" type="button" onclick="removeRow('ingredients','${item.id}')">삭제</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty">해당 재고가 없어요.</div>';
}

function renderWeeklyPlan() {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const slots = ['아침', '점심', '간식', '저녁'];
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const today = dateToday();

  $('weekTitle').textContent = `${toDateString(days[0])} ~ ${toDateString(days[6])}`;

  const headers = days.map((date, index) => {
    const dateString = toDateString(date);
    const isToday = dateString === today;
    return `<th class="${isToday ? 'today-column' : ''}">
      ${dayNames[index]}<br>
      <span class="meta">${date.getMonth() + 1}/${date.getDate()}</span>
      ${isToday ? '<span class="today-badge">오늘</span>' : ''}
    </th>`;
  }).join('');

  const rows = slots.map((slot) => {
    const cells = days.map((date) => {
      const dateString = toDateString(date);
      const isToday = dateString === today;
      const entries = state.plans.filter((item) => item.meal_date === dateString && item.meal_slot === slot);
      const combinedMenu = entries.map((item) => item.menu_name).filter(Boolean).join('\n');
      return `<td class="${isToday ? 'today-column' : ''}"><button class="weekly-cell-button" type="button" onclick="editWeeklyCell('${dateString}','${slot}')" aria-label="${dateString} ${slot} 식단 수정">
        ${combinedMenu ? mealLinesWithReactionHtml(combinedMenu, dateString, slot, 'weekly-menu-line') : '<span class="weekly-empty">비어 있음</span>'}
      </button></td>`;
    }).join('');
    return `<tr><td>${slot}</td>${cells}</tr>`;
  }).join('');

  $('weeklyTable').innerHTML = `<table class="weekly-table"><thead><tr><th>구분</th>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
  if (!$('bulkPlanPanel').classList.contains('hidden')) renderBulkPlanEditor(true);
}

function renderShopping() {
  const pending = state.shopping.filter((item) => !item.done);
  const completed = state.shopping.filter((item) => item.done);

  $('shoppingPendingList').innerHTML = pending.length ? pending.map((item) => `<div class="shopping-row">
    <span>${esc(item.name)}</span>
    <div class="toolbar">
      <button class="btn primary" type="button" onclick="completeShopping('${item.id}',true)">구매 완료</button>
      <button class="btn danger" type="button" onclick="removeRow('shopping_items','${item.id}')">삭제</button>
    </div>
  </div>`).join('') : '<div class="empty">구매할 품목이 없어요.</div>';

  $('shoppingCompletedList').innerHTML = completed.length ? completed.map((item) => `<div class="shopping-row">
    <span>${esc(item.name)} <span class="meta">${formatDateTime(item.completed_at)}</span></span>
    <div class="toolbar">
      <button class="btn ghost" type="button" onclick="completeShopping('${item.id}',false)">미구매로</button>
      <button class="btn danger" type="button" onclick="removeRow('shopping_items','${item.id}')">삭제</button>
    </div>
  </div>`).join('') : '<div class="empty">완료한 품목이 없어요.</div>';
}

function renderHome() {
  const today = dateToday();
  const todayDate = new Date(`${today}T00:00:00`);
  $('homeDate').textContent = todayDate.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

  const todayMeals = state.plans.filter((item) => item.meal_date === today);
  const slotOrder = ['아침', '점심', '간식', '저녁'];
  $('todayMeals').innerHTML = todayMeals.length ? slotOrder.map((slot) => {
    const values = todayMeals.filter((item) => item.meal_slot === slot).map((item) => item.menu_name).filter(Boolean);
    if (!values.length) return '';
    return `<div class="today-meal"><div class="today-meal-slot">${esc(slot)}</div><div class="today-meal-menu">${mealLinesWithReactionHtml(values.join('\n'), today, slot, 'today-menu-line')}</div></div>`;
  }).join('') : '<div class="empty">오늘 식단이 아직 비어 있어요.</div>';

  const goodCounts = state.reactions.filter((item) => item.reaction === '잘 먹음').reduce((acc, item) => {
    const key = item.menu_name.trim();
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const favorites = Object.entries(goodCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).slice(0, 8);
  $('favoriteMealsList').innerHTML = favorites.length ? `<div class="favorite-list">${favorites.map(([name, count]) => `<div class="favorite-row"><span><span class="favorite-heart">♥</span>${esc(name)}</span><strong>${count}회</strong></div>`).join('')}</div>` : '<div class="empty">잘 먹은 메뉴를 기록하면 여기에 모아드려요.</div>';

  const activeIngredients = state.ingredients.filter((item) => !item.depleted);
  const expirySoon = activeIngredients
    .filter((item) => {
      const days = daysLeft(item.expiry_date);
      return days !== null && days <= 3;
    })
    .sort((a, b) => (daysLeft(a.expiry_date) ?? 9999) - (daysLeft(b.expiry_date) ?? 9999));
  const needCooking = activeIngredients.filter((item) => item.status === '조리 필요');
  const pendingShopping = state.shopping.filter((item) => !item.done);

  $('mExpirySoon').textContent = expirySoon.length;
  $('mNeedCooking').textContent = needCooking.length;
  $('mShopping').textContent = pendingShopping.length;

  $('expirySoonList').innerHTML = expirySoon.length ? `<div class="mini-list">${expirySoon.slice(0, 5).map((item) => `<div class="mini-row"><span>${esc(item.name)}</span><span>${expiryHtml(item.expiry_date)}</span></div>`).join('')}</div>` : '<div class="empty">임박한 재고가 없어요.</div>';
  $('needCookingList').innerHTML = needCooking.length ? `<div class="mini-list">${needCooking.slice(0, 5).map((item) => `<div class="mini-row"><span>${esc(item.name)}</span><span>${esc(item.category)}</span></div>`).join('')}</div>` : '<div class="empty">조리할 품목이 없어요.</div>';
}

function renderAll() {
  renderHome();
  renderIngredients();
  renderWeeklyPlan();
  renderShopping();
}

function bindEvents() {
  $('loginButton').addEventListener('click', signIn);
  $('logoutButton').addEventListener('click', signOut);
  $('authPassword').addEventListener('keydown', (event) => { if (event.key === 'Enter') signIn(); });

  document.querySelectorAll('.bottom-tab').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  document.querySelectorAll('[data-jump]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.filterJump) {
      ingredientFilter = button.dataset.filterJump;
      document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === ingredientFilter));
      renderIngredients();
    }
    activateTab(button.dataset.jump);
  }));

  document.querySelectorAll('.status-option').forEach((button) => button.addEventListener('click', () => setStatus(button.dataset.status)));
  $('mealEditText').addEventListener('input', renderMealReactionRows);
  $('mealEditCloseButton').addEventListener('click', closeMealEditor);
  $('mealEditBackdrop').addEventListener('click', closeMealEditor);
  $('mealEditSaveButton').addEventListener('click', () => saveMealEditor(false));
  $('mealEditDeleteButton').addEventListener('click', () => saveMealEditor(true));

  $('ingredientSaveButton').addEventListener('click', saveIngredient);
  $('ingredientCancelButton').addEventListener('click', resetIngredientForm);

  document.querySelectorAll('.filter-chip').forEach((button) => button.addEventListener('click', () => {
    ingredientFilter = button.dataset.filter;
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip === button));
    renderIngredients();
  }));

  $('planAddButton').addEventListener('click', addPlan);
  $('toggleBulkPlanButton').addEventListener('click', () => {
    const panel = $('bulkPlanPanel');
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    $('toggleBulkPlanButton').textContent = willOpen ? '표 닫기' : '표 열기';
    if (willOpen) renderBulkPlanEditor(true);
  });
  $('loadCurrentWeekButton').addEventListener('click', () => renderBulkPlanEditor(true));
  $('clearBulkPlanButton').addEventListener('click', clearBulkPlanEditor);
  $('saveBulkPlanButton').addEventListener('click', saveBulkPlan);
  $('prevWeekButton').addEventListener('click', () => { weekStart = addDays(weekStart, -7); renderWeeklyPlan(); });
  $('nextWeekButton').addEventListener('click', () => { weekStart = addDays(weekStart, 7); renderWeeklyPlan(); });
  $('shoppingAddButton').addEventListener('click', addShopping);
  $('shopName').addEventListener('keydown', (event) => { if (event.key === 'Enter') addShopping(); });
}

window.editIngredient = editIngredient;
window.toggleDepleted = toggleDepleted;
window.completeShopping = completeShopping;
window.removeRow = removeRow;

bindEvents();

sb.auth.getSession().then(({ data }) => handleSession(data.session));
sb.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => handleSession(session), 0);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.error));
}
