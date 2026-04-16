'use strict';

// ─── Utilities ────────────────────────────────────────────────────────────────

function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function compressImage(blob, maxWidth = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

// ─── App ─────────────────────────────────────────────────────────────────────

class MealLogApp {
  constructor() {
    this.db            = new MealDB();
    this.todayISO      = getTodayISO();
    this.activeScreen  = 'today';
    this.calYear       = new Date().getFullYear();
    this.calMonth      = new Date().getMonth() + 1;
    this.selectedDate  = null;
    this.stream        = null;
    this.facingMode    = 'environment';
    this.capturedBlob  = null;
    this.pendingDelId      = null;
    this.pendingEditId     = null;
    this._confirmCallback  = null;
    this.objectURLs    = [];
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async init() {
    try {
      await this.db.open();
    } catch (e) {
      alert('データベースの初期化に失敗しました。ブラウザを再読み込みしてください。');
      return;
    }
    this._bindNav();
    this._bindCapture();
    this._bindCameraModal();
    this._bindConfirmModal();
    this._bindEditModal();
    document.getElementById('btn-delete-month').addEventListener('click', () => this.openMonthDeleteModal());
    await this.renderToday();
    await this.checkStorage();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  _bindNav() {
    document.querySelectorAll('.nav-btn[data-screen]').forEach((btn) => {
      btn.addEventListener('click', () => this.showScreen(btn.dataset.screen));
    });
  }

  async showScreen(name) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
    document.querySelectorAll('.nav-btn[data-screen]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.screen === name);
    });
    document.getElementById(`screen-${name}`).classList.remove('hidden');
    this.activeScreen = name;

    if (name === 'today') {
      this.todayISO = getTodayISO();
      await this.renderToday();
    } else if (name === 'calendar') {
      await this.renderCalendar();
    }
  }

  // ── Today screen ───────────────────────────────────────────────────────────

  async renderToday() {
    const list     = document.getElementById('today-list');
    const empty    = document.getElementById('today-empty');
    const countEl  = document.getElementById('today-count');
    this._revokeURLs();
    const meals = await this.db.getMealsByDate(this.todayISO);
    countEl.textContent = meals.length > 0 ? `${meals.length}件` : '';

    if (meals.length === 0) {
      list.innerHTML = '';
      list.classList.add('hidden');
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      list.classList.remove('hidden');
      list.innerHTML = '';
      meals.forEach((m) => this._appendCard(m, list));
    }
  }

  // ── Day detail screen ──────────────────────────────────────────────────────

  async showDayDetail(dateISO) {
    this.selectedDate = dateISO;
    this.activeScreen = 'day';

    document.querySelectorAll('.screen').forEach((el) => el.classList.add('hidden'));
    document.querySelectorAll('.nav-btn[data-screen]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.screen === 'calendar');
    });
    document.getElementById('screen-day').classList.remove('hidden');
    document.getElementById('day-title').textContent = fmtDate(dateISO);

    const list  = document.getElementById('day-list');
    const empty = document.getElementById('day-empty');
    this._revokeURLs();

    const meals = await this.db.getMealsByDate(dateISO);

    if (meals.length === 0) {
      list.innerHTML = '';
      list.classList.add('hidden');
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      list.classList.remove('hidden');
      list.innerHTML = '';
      meals.forEach((m) => this._appendCard(m, list));
    }

    document.getElementById('day-back').onclick = () => this.showScreen('calendar');
  }

  // ── Meal card ──────────────────────────────────────────────────────────────

  _appendCard(meal, container) {
    const url = URL.createObjectURL(meal.imageBlob);
    this.objectURLs.push(url);

    const card = document.createElement('article');
    card.className = 'meal-card';
    card.dataset.id = meal.id;
    card.innerHTML = `
      <img src="${url}" class="meal-img" alt="食事の写真" loading="lazy">
      <div class="meal-body">
        <time class="meal-time">${fmtTime(meal.datetime)}</time>
        ${meal.memo
          ? `<p class="meal-memo">${esc(meal.memo)}</p>`
          : `<p class="meal-memo no-memo">メモなし</p>`}
        <div class="meal-actions">
          <button class="btn-sm btn-edit" data-id="${meal.id}">編集</button>
          <button class="btn-sm btn-delete danger" data-id="${meal.id}">削除</button>
        </div>
      </div>
    `;
    card.querySelector('.btn-edit').addEventListener('click', () => this.openEditModal(meal.id, meal.memo));
    card.querySelector('.btn-delete').addEventListener('click', () => this.openDeleteModal(meal.id));
    container.appendChild(card);
  }

  _revokeURLs() {
    this.objectURLs.forEach((u) => URL.revokeObjectURL(u));
    this.objectURLs = [];
  }

  // ── Calendar ───────────────────────────────────────────────────────────────

  async renderCalendar() {
    const { calYear: y, calMonth: m } = this;
    document.getElementById('cal-title').textContent = `${y}年${m}月`;

    const ym       = `${y}-${String(m).padStart(2, '0')}`;
    const marked   = new Set(await this.db.getDatesWithMeals(ym));
    const today    = getTodayISO();
    const firstDow = new Date(y, m - 1, 1).getDay();
    const daysMax  = new Date(y, m, 0).getDate();

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    // Header row: day names
    const hdRow = document.createElement('div');
    hdRow.className = 'cal-row';
    ['日', '月', '火', '水', '木', '金', '土'].forEach((d, i) => {
      const cell = document.createElement('div');
      cell.className = `cal-cell cal-hd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`;
      cell.textContent = d;
      hdRow.appendChild(cell);
    });
    grid.appendChild(hdRow);

    let row = this._newCalRow();

    // Empty leading cells
    for (let i = 0; i < firstDow; i++) {
      row.appendChild(this._emptyCell());
    }

    for (let day = 1; day <= daysMax; day++) {
      const dow    = (firstDow + day - 1) % 7;
      const dateISO = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (dateISO === today)        cell.classList.add('cal-today');
      if (dow === 0)                cell.classList.add('sun');
      if (dow === 6)                cell.classList.add('sat');

      const btn = document.createElement('button');
      btn.className = 'cal-day';
      btn.textContent = day;
      btn.setAttribute('aria-label', `${fmtDate(dateISO)}の記録を見る`);
      btn.addEventListener('click', () => this.showDayDetail(dateISO));

      if (marked.has(dateISO)) {
        const dot = document.createElement('span');
        dot.className = 'cal-dot';
        cell.appendChild(dot);
      }

      cell.appendChild(btn);
      row.appendChild(cell);

      if (dow === 6) { grid.appendChild(row); row = this._newCalRow(); }
    }
    if (row.children.length) grid.appendChild(row);

    document.getElementById('cal-prev').onclick = () => this._calMove(-1);
    document.getElementById('cal-next').onclick = () => this._calMove(1);
  }

  _newCalRow() {
    const r = document.createElement('div');
    r.className = 'cal-row';
    return r;
  }

  _emptyCell() {
    const c = document.createElement('div');
    c.className = 'cal-cell';
    return c;
  }

  _calMove(delta) {
    this.calMonth += delta;
    if (this.calMonth > 12) { this.calMonth = 1;  this.calYear++; }
    if (this.calMonth < 1)  { this.calMonth = 12; this.calYear--; }
    this.renderCalendar();
  }

  // ── Capture modal ──────────────────────────────────────────────────────────

  _bindCapture() {
    document.getElementById('main-capture-btn').addEventListener('click', () => this.openCapture());
  }

  openCapture() {
    this.capturedBlob = null;
    this._step('choose');
    document.getElementById('camera-modal').classList.remove('hidden');
    document.getElementById('memo-input').value = '';
    document.getElementById('memo-count').textContent = '0/100';
  }

  closeCapture() {
    this.stopCamera();
    document.getElementById('camera-modal').classList.add('hidden');
    // reset gallery input
    document.getElementById('gallery-input').value = '';
  }

  _step(name) {
    ['choose', 'cam', 'memo'].forEach((s) => {
      document.getElementById(`step-${s}`).classList.toggle('hidden', s !== name);
    });
  }

  _bindCameraModal() {
    document.getElementById('btn-open-camera').addEventListener('click', () => this.startCamera());
    document.getElementById('btn-open-gallery').addEventListener('click', () =>
      document.getElementById('gallery-input').click()
    );
    document.getElementById('gallery-input').addEventListener('change', (e) => this._onGalleryFile(e));

    document.getElementById('btn-switch-cam').addEventListener('click', () => this.switchCamera());
    document.getElementById('btn-shutter').addEventListener('click', () => this.captureFrame());

    document.querySelector('#step-choose .modal-close').addEventListener('click', () => this.closeCapture());
    document.querySelector('#step-cam .modal-close').addEventListener('click', () => {
      this.stopCamera(); this._step('choose');
    });

    const memoInput = document.getElementById('memo-input');
    memoInput.addEventListener('input', () => {
      document.getElementById('memo-count').textContent = `${memoInput.value.length}/100`;
    });

    document.getElementById('btn-memo-cancel').addEventListener('click', () => this.closeCapture());
    document.getElementById('btn-memo-save').addEventListener('click', () => this.saveCapture());

    document.querySelector('#camera-modal .modal-overlay').addEventListener('click', () => this.closeCapture());
  }

  async startCamera() {
    this._step('cam');
    await this._initStream();
  }

  async _initStream() {
    this.stopCamera();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode, width: { ideal: 1280 } },
        audio: false,
      });
      const v = document.getElementById('cam-video');
      v.srcObject = this.stream;
    } catch (err) {
      alert('カメラを起動できませんでした。カメラへのアクセスを許可してください。');
      this._step('choose');
    }
  }

  stopCamera() {
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  }

  async switchCamera() {
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    await this._initStream();
  }

  captureFrame() {
    const video  = document.getElementById('cam-video');
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    this.stopCamera();
    canvas.toBlob((blob) => { if (blob) this._setBlob(blob); }, 'image/jpeg', 0.92);
  }

  _onGalleryFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) this._setBlob(file);
  }

  _setBlob(blob) {
    this.capturedBlob = blob;
    const url = URL.createObjectURL(blob);
    const img = document.getElementById('preview-img');
    img.onload = () => URL.revokeObjectURL(url);
    img.src = url;
    this._step('memo');
  }

  async saveCapture() {
    if (!this.capturedBlob) return;
    const memo    = document.getElementById('memo-input').value.slice(0, 100);
    const saveBtn = document.getElementById('btn-memo-save');
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      const compressed = await compressImage(this.capturedBlob);
      await this.db.addMeal({ imageBlob: compressed, memo });
      this.closeCapture();
      await this._refreshList();
      await this.checkStorage();
    } catch (err) {
      alert('保存に失敗しました。もう一度お試しください。');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '保存する';
    }
  }

  // ── 汎用確認モーダル ────────────────────────────────────────────────────────

  _bindConfirmModal() {
    document.getElementById('btn-del-cancel').addEventListener('click', () => this.closeConfirmModal());
    document.getElementById('btn-del-confirm').addEventListener('click', () => this._runConfirm());
    document.querySelector('#confirm-modal .modal-overlay').addEventListener('click', () => this.closeConfirmModal());
  }

  openConfirmModal({ title, desc, onConfirm }) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-desc').textContent  = desc;
    this._confirmCallback = onConfirm;
    document.getElementById('confirm-modal').classList.remove('hidden');
  }

  closeConfirmModal() {
    this._confirmCallback = null;
    document.getElementById('confirm-modal').classList.add('hidden');
  }

  async _runConfirm() {
    const cb = this._confirmCallback;
    this.closeConfirmModal();
    if (!cb) return;
    try {
      await cb();
    } catch (err) {
      alert('削除に失敗しました。');
    }
  }

  // ── 1件削除 ────────────────────────────────────────────────────────────────

  openDeleteModal(id) {
    this.openConfirmModal({
      title:     'この記録を削除しますか？',
      desc:      '削除した記録は元に戻すことができません。',
      onConfirm: async () => {
        await this.db.deleteMeal(id);
        await this._refreshList();
        if (!document.getElementById('screen-calendar').classList.contains('hidden')) {
          await this.renderCalendar();
        }
      },
    });
  }

  // ── 月一括削除 ─────────────────────────────────────────────────────────────

  openMonthDeleteModal() {
    const { calYear: y, calMonth: m } = this;
    const ym    = `${y}-${String(m).padStart(2, '0')}`;
    const label = `${y}年${m}月`;
    this.openConfirmModal({
      title:     `${label}のデータをすべて削除しますか？`,
      desc:      `${label}に記録されたすべての食事データを削除します。この操作は元に戻せません。`,
      onConfirm: async () => {
        await this.db.deleteMealsByMonth(ym);
        await this.renderCalendar();
      },
    });
  }

  // ── Edit modal ─────────────────────────────────────────────────────────────

  _bindEditModal() {
    const inp = document.getElementById('edit-memo-input');
    inp.addEventListener('input', () => {
      document.getElementById('edit-memo-count').textContent = `${inp.value.length}/100`;
    });
    document.getElementById('btn-edit-close').addEventListener('click', () => this.closeEditModal());
    document.getElementById('btn-edit-cancel').addEventListener('click', () => this.closeEditModal());
    document.getElementById('btn-edit-save').addEventListener('click', () => this.confirmEdit());
    document.querySelector('#edit-modal .modal-overlay').addEventListener('click', () => this.closeEditModal());
  }

  openEditModal(id, currentMemo) {
    this.pendingEditId = id;
    const inp = document.getElementById('edit-memo-input');
    inp.value = currentMemo || '';
    document.getElementById('edit-memo-count').textContent = `${inp.value.length}/100`;
    document.getElementById('edit-modal').classList.remove('hidden');
    inp.focus();
  }

  closeEditModal() {
    this.pendingEditId = null;
    document.getElementById('edit-modal').classList.add('hidden');
  }

  async confirmEdit() {
    if (!this.pendingEditId) return;
    const memo = document.getElementById('edit-memo-input').value.slice(0, 100);
    try {
      await this.db.updateMeal(this.pendingEditId, { memo });
      this.closeEditModal();
      await this._refreshList();
    } catch (err) {
      alert('保存に失敗しました。');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  async _refreshList() {
    if (this.activeScreen === 'today') {
      await this.renderToday();
    } else if (this.activeScreen === 'day') {
      await this.showDayDetail(this.selectedDate);
    }
  }

  async checkStorage() {
    const est = await this.db.estimateStorage();
    if (!est) return;
    const usedMB = est.usage / 1024 / 1024;
    if (usedMB > 200) {
      const warn = document.getElementById('storage-warning');
      warn.classList.remove('hidden');
      setTimeout(() => warn.classList.add('hidden'), 6000);
    }
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const app = new MealLogApp();
document.addEventListener('DOMContentLoaded', () => app.init());
