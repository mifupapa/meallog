'use strict';

const DB_NAME = 'MealLogDB';
const DB_VERSION = 1;
const STORE_NAME = 'meals';

class MealDB {
  constructor() {
    this.db = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('datetime', 'datetime', { unique: false });
        }
      };

      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror  = (e) => reject(e.target.error);
    });
  }

  _store(mode) {
    return this.db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  _wrap(idbReq) {
    return new Promise((resolve, reject) => {
      idbReq.onsuccess = (e) => resolve(e.target.result);
      idbReq.onerror  = (e) => reject(e.target.error);
    });
  }

  _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  async addMeal({ imageBlob, memo = '', datetime = null }) {
    const now    = new Date();
    const isoNow = now.toISOString();
    // ローカル日付を使用（toISOString()はUTC日付になるため日本時間と1日ズレる場合がある）
    const localDate = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    const dt   = datetime || isoNow;
    const date = datetime ? datetime.slice(0, 10) : localDate;
    const meal = {
      id: this._genId(),
      date,
      datetime: dt,
      imageBlob,
      memo,
      createdAt: isoNow,
      updatedAt: isoNow,
    };
    await this._wrap(this._store('readwrite').add(meal));
    return meal;
  }

  async getMealsByDate(date) {
    const idx   = this._store('readonly').index('date');
    const meals = await this._wrap(idx.getAll(IDBKeyRange.only(date)));
    return meals.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  }

  async getDatesWithMeals(yearMonth) {
    // yearMonth: 'YYYY-MM'
    const start = `${yearMonth}-01`;
    const end   = `${yearMonth}-31`;
    const idx   = this._store('readonly').index('date');
    // getAllKeys() returns only the index keys (dates), not full records with image blobs
    const dates = await this._wrap(idx.getAllKeys(IDBKeyRange.bound(start, end)));
    return [...new Set(dates)];
  }

  async updateMeal(id, { memo }) {
    const store = this._store('readwrite');
    const meal  = await this._wrap(store.get(id));
    if (!meal) throw new Error('Record not found');
    meal.memo      = memo;
    meal.updatedAt = new Date().toISOString();
    await this._wrap(store.put(meal));
    return meal;
  }

  async deleteMeal(id) {
    await this._wrap(this._store('readwrite').delete(id));
  }

  deleteMealsByMonth(yearMonth) {
    // yearMonth: 'YYYY-MM'
    const start = `${yearMonth}-01`;
    const end   = `${yearMonth}-31`;
    const range = IDBKeyRange.bound(start, end);
    return new Promise((resolve, reject) => {
      const store = this._store('readwrite');
      const req   = store.index('date').openCursor(range);
      let count   = 0;
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { cursor.delete(); count++; cursor.continue(); }
        else resolve(count);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  estimateStorage() {
    return navigator.storage?.estimate?.() ?? Promise.resolve(null);
  }
}
