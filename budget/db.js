const DB = {
  _db: null,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('budget-tracker-v1', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        const exp = db.createObjectStore('expenses', { keyPath: 'id' });
        exp.createIndex('date', 'date');
        exp.createIndex('categoryId', 'categoryId');
        exp.createIndex('type', 'type');
        exp.createIndex('recurringId', 'recurringId');
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('recurring', { keyPath: 'id' });
        db.createObjectStore('exchangeRates', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'id' });
      };
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  async get(store, id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  },

  async put(store, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async delete(store, id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async getAll(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getByDateRange(start, end) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound(start, end);
      const req = db.transaction('expenses', 'readonly').objectStore('expenses').index('date').getAll(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  genId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  },

  async exportAll() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      expenses:      await this.getAll('expenses'),
      categories:    await this.getAll('categories'),
      recurring:     await this.getAll('recurring'),
      exchangeRates: await this.getAll('exchangeRates'),
      settings:      await this.getAll('settings'),
    };
  },

  async importAll(data) {
    for (const store of ['expenses', 'categories', 'recurring', 'exchangeRates', 'settings']) {
      const db = await this.open();
      await new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).clear();
        req.onsuccess = res;
        tx.onerror = () => rej(tx.error);
      });
      for (const record of (data[store] || [])) await this.put(store, record);
    }
  },

  async seed() {
    const cats = await this.getAll('categories');
    if (!cats.length) {
      const defaults = [
        { id: 'cat_food',          name: 'Food & Groceries', icon: '🛒', color: '#4CAF50', isDefault: true, order: 1 },
        { id: 'cat_transport',     name: 'Transport',         icon: '🚌', color: '#2196F3', isDefault: true, order: 2 },
        { id: 'cat_housing',       name: 'Housing & Rent',    icon: '🏠', color: '#9C27B0', isDefault: true, order: 3 },
        { id: 'cat_health',        name: 'Health',            icon: '💊', color: '#F44336', isDefault: true, order: 4 },
        { id: 'cat_leisure',       name: 'Leisure & Hobbies', icon: '🎮', color: '#FF9800', isDefault: true, order: 5 },
        { id: 'cat_dining',        name: 'Dining Out',        icon: '🍽️', color: '#E91E63', isDefault: true, order: 6 },
        { id: 'cat_shopping',      name: 'Shopping',          icon: '🛍️', color: '#00BCD4', isDefault: true, order: 7 },
        { id: 'cat_utilities',     name: 'Utilities',         icon: '💡', color: '#607D8B', isDefault: true, order: 8 },
        { id: 'cat_travel',        name: 'Travel',            icon: '✈️', color: '#795548', isDefault: true, order: 9 },
        { id: 'cat_education',     name: 'Education',         icon: '📚', color: '#3F51B5', isDefault: true, order: 10 },
        { id: 'cat_subscriptions', name: 'Subscriptions',     icon: '📱', color: '#009688', isDefault: true, order: 11 },
        { id: 'cat_other',         name: 'Other',             icon: '📦', color: '#9E9E9E', isDefault: true, order: 12 },
      ];
      for (const cat of defaults) await this.put('categories', cat);
    }

    if (!await this.get('exchangeRates', 'latest')) {
      await this.put('exchangeRates', {
        id: 'latest', base: 'CHF',
        rates: {
          EUR: 0.955, USD: 0.899, GBP: 0.791, JPY: 134.5,
          CAD: 1.228, AUD: 1.388, CNY: 6.521, INR: 74.89,
          NOK: 9.515, SEK: 9.874, DKK: 6.704, PLN: 3.942,
          CZK: 22.45, HUF: 362.1, SGD: 1.208, HKD: 7.025,
          NZD: 1.485, ZAR: 16.78, MXN: 15.43, BRL: 4.97,
        },
        fetchedAt: new Date().toISOString(),
        source: 'hardcoded',
      });
    }

    if (!await this.get('settings', 'prefs')) {
      await this.put('settings', { id: 'prefs', defaultCurrency: 'CHF', displayCurrency: 'CHF' });
    }
  },
};
