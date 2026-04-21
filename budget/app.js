const EMOJI_LIST = [
  '🛒','🍔','🍕','🍣','🥗','🌮','☕','🍺','🥂','🍰','🧁','🍜',
  '🚌','🚗','🚇','✈️','⛽','🛵','🚲','🚕','🛳️','🚂',
  '🏠','🏡','💡','🛋️','🔧','🪴','🛁','🔑','📦',
  '💊','🏥','🏃','💪','🧘','🩺','🥗','🧴',
  '🎮','🎬','🎵','📚','🎨','⚽','🏔️','🎭','🎤','🏋️',
  '🛍️','👗','👟','💄','💍','🕶️','👜',
  '💰','💳','💵','🏦','📈','💹','🪙',
  '📱','💻','📺','🖥️','🎧','⌚','📷',
  '🌿','🐶','🐱','☀️','🌙','🌊','🏕️',
  '🎁','🎓','✂️','🔑','🧳','🎪','🎠',
];

function budgetApp() {
  return {
    loading: true,
    currentView: 'dashboard',

    // Sheets
    showAddModal: false,
    showRecurringSheet: false,
    showCurrencyPicker: false,

    // Master data
    categories: [],
    rates: {},
    settings: {},

    // Add/edit form
    form: {
      id: null, type: 'expense', amount: '', currency: 'CHF',
      name: '', categoryId: '', date: '', note: '', showNote: false,
    },

    // Dashboard
    dashYear: new Date().getFullYear(),
    dashMonth: new Date().getMonth() + 1,
    dashStats: { spent: 0, income: 0, net: 0 },
    recentTx: [],
    dueRecurring: [],

    // Transactions
    txYear: new Date().getFullYear(),
    txMonth: new Date().getMonth() + 1,
    txFilter: 'all',
    txSearch: '',
    txGrouped: [],

    // Swipe-to-delete state
    swipeOffsets: {},
    swipeStartX: 0,
    swipeBaseOffset: 0,
    swipingId: null,

    // Reports
    rptPeriod: 'month',
    rptTab: 'category',
    rptYear: new Date().getFullYear(),
    rptMonth: new Date().getMonth() + 1,
    categoryData: [],
    ratesFetchedAt: '',
    ratesUpdating: false,

    // Recurring
    recurringRules: [],
    showAddRecurring: false,
    recurringForm: {
      id: null, name: '', amount: '', currency: 'CHF',
      categoryId: 'cat_subscriptions', frequency: 'monthly',
      dayOfMonth: new Date().getDate(), dayOfWeek: new Date().getDay(),
      monthOfYear: new Date().getMonth() + 1, autoLog: false,
    },

    // Category add/edit
    editCatForm: null,
    showEmojiPicker: false,

    // ── Init ──────────────────────────────────────────────────────────────────

    async init() {
      await DB.seed();
      await this._loadMasterData();
      this._applyTheme(this.settings.theme || 'dark');
      await this.loadDashboard();

      this.$watch('currentView', async view => {
        if (view === 'transactions') await this.loadTransactions();
        if (view === 'recurring') await this.loadRecurring();
        if (view === 'reports') requestAnimationFrame(() => this.loadReports());
      });

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      }
      this.loading = false;
    },

    async _loadMasterData() {
      this.categories = (await DB.getAll('categories')).sort((a, b) => a.order - b.order);
      this.settings = await DB.get('settings', 'prefs') || {};
      const ratesRec = await DB.get('exchangeRates', 'latest');
      this.rates = ratesRec?.rates || {};
      this.ratesFetchedAt = ratesRec?.fetchedAt
        ? new Date(ratesRec.fetchedAt).toLocaleDateString() : '';
      const defaultCurrency = this.settings.defaultCurrency || 'CHF';
      this.form.currency = defaultCurrency;
      this.recurringForm.currency = defaultCurrency;
    },

    // ── Theme ─────────────────────────────────────────────────────────────────

    _applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      this.settings.theme = theme;
    },

    async toggleTheme() {
      const next = this.settings.theme === 'dark' ? 'light' : 'dark';
      this._applyTheme(next);
      await DB.put('settings', this.settings);
    },

    // ── Currency ──────────────────────────────────────────────────────────────

    toCHF(amount, currency) {
      if (currency === 'CHF') return amount;
      const rate = this.rates[currency];
      return rate ? amount / rate : amount;
    },

    fmtAmt(amount, currency) {
      return `${currency} ${Math.abs(amount).toFixed(2)}`;
    },

    fmtCHF(amount) {
      return `CHF ${Math.abs(amount).toFixed(2)}`;
    },

    get allCurrencies() {
      return ['CHF','EUR','USD','GBP','JPY','CAD','AUD','CNY','INR',
              'NOK','SEK','DKK','PLN','CZK','HUF','SGD','HKD','NZD','ZAR','MXN','BRL'];
    },

    // ── Navigation ────────────────────────────────────────────────────────────

    setView(view) {
      this.currentView = view;
    },

    // ── Categories ────────────────────────────────────────────────────────────

    getCat(id) {
      return this.categories.find(c => c.id === id)
        || { name: 'Unknown', icon: '📦', color: '#9E9E9E' };
    },

    get usedEmojis() {
      const editingId = this.editCatForm?.id;
      return new Set(this.categories.filter(c => c.id !== editingId).map(c => c.icon));
    },

    get availableEmojis() {
      return EMOJI_LIST.filter(e => !this.usedEmojis.has(e));
    },

    openCatForm(cat = null) {
      this.showEmojiPicker = false;
      this.editCatForm = cat
        ? { ...cat }
        : { id: null, name: '', icon: '💡', color: '#6366f1', isDefault: false, order: this.categories.length + 1 };
    },

    async saveCatForm() {
      if (!this.editCatForm?.name.trim()) return;
      const cat = {
        ...this.editCatForm,
        id: this.editCatForm.id || DB.genId('cat'),
        name: this.editCatForm.name.trim(),
      };
      await DB.put('categories', cat);
      this.categories = (await DB.getAll('categories')).sort((a, b) => a.order - b.order);
      this.editCatForm = null;
      this.showEmojiPicker = false;
    },

    async deleteCategory(cat) {
      if (cat.isDefault) return;
      if (!confirm(`Delete "${cat.name}"?`)) return;
      await DB.delete('categories', cat.id);
      this.categories = (await DB.getAll('categories')).sort((a, b) => a.order - b.order);
    },

    // ── Add / Edit form ───────────────────────────────────────────────────────

    openAddModal(expense = null) {
      const today = new Date().toISOString().split('T')[0];
      if (expense) {
        this.form = {
          id: expense.id,
          type: expense.type,
          amount: String(expense.amount),
          currency: expense.currency,
          name: expense.name,
          categoryId: expense.categoryId,
          date: expense.date,
          note: expense.note || '',
          showNote: !!expense.note,
        };
      } else {
        this.form = {
          id: null, type: 'expense', amount: '',
          currency: this.settings.defaultCurrency || 'CHF',
          name: '', categoryId: this.categories[0]?.id || 'cat_food',
          date: today, note: '', showNote: false,
        };
      }
      this.showCurrencyPicker = false;
      this.showAddModal = true;
    },

    closeAddModal() {
      this.showAddModal = false;
      this.showCurrencyPicker = false;
    },

    async saveExpense() {
      const amount = parseFloat(this.form.amount);
      if (!amount || amount <= 0 || !this.form.name.trim() || !this.form.date) return;

      const amountCHF = Math.round(this.toCHF(amount, this.form.currency) * 100) / 100;
      const entry = {
        id: this.form.id || DB.genId(this.form.type === 'income' ? 'inc' : 'exp'),
        amount, currency: this.form.currency, amountCHF,
        name: this.form.name.trim(),
        categoryId: this.form.type === 'income' ? '_income' : this.form.categoryId,
        date: this.form.date, note: this.form.note.trim(),
        recurringId: null, type: this.form.type,
      };

      await DB.put('expenses', entry);
      this.closeAddModal();
      await this._refreshCurrentView();
    },

    async deleteExpense(id, noConfirm = false) {
      if (!noConfirm && !confirm('Delete this entry?')) return;
      await DB.delete('expenses', id);
      if (this.swipeOffsets[id] !== undefined) this.swipeOffsets[id] = 0;
      await this._refreshCurrentView();
    },

    async _refreshCurrentView() {
      if (this.currentView === 'dashboard') await this.loadDashboard();
      if (this.currentView === 'transactions') await this.loadTransactions();
    },

    // ── Swipe to delete ───────────────────────────────────────────────────────

    swipeStart(id, e) {
      if (this.swipingId && this.swipingId !== id) {
        this.swipeOffsets[this.swipingId] = 0;
      }
      this.swipingId = id;
      this.swipeStartX = e.touches[0].clientX;
      this.swipeBaseOffset = this.swipeOffsets[id] || 0;
    },

    swipeMove(id, e) {
      const dx = e.touches[0].clientX - this.swipeStartX;
      this.swipeOffsets[id] = Math.max(-220, Math.min(0, this.swipeBaseOffset + dx));
    },

    swipeEnd(id) {
      this.swipingId = null;
      const offset = this.swipeOffsets[id] || 0;
      if (offset < -180) {
        this.swipeOffsets[id] = 0;
        this.deleteExpense(id, true);
      } else if (offset < -60) {
        this.swipeOffsets[id] = -80;
      } else {
        this.swipeOffsets[id] = 0;
      }
    },

    resetSwipe(id) {
      this.swipeOffsets[id] = 0;
    },

    // ── Dashboard ─────────────────────────────────────────────────────────────

    get dashMonthLabel() {
      return new Date(this.dashYear, this.dashMonth - 1)
        .toLocaleString('default', { month: 'long', year: 'numeric' });
    },

    dashPrev() {
      if (this.dashMonth === 1) { this.dashYear--; this.dashMonth = 12; }
      else this.dashMonth--;
      this.loadDashboard();
    },

    dashNext() {
      if (this.dashMonth === 12) { this.dashYear++; this.dashMonth = 1; }
      else this.dashMonth++;
      this.loadDashboard();
    },

    async loadDashboard() {
      const pad = n => String(n).padStart(2, '0');
      const entries = await DB.getByDateRange(
        `${this.dashYear}-${pad(this.dashMonth)}-01`,
        `${this.dashYear}-${pad(this.dashMonth)}-31`
      );
      let spent = 0, income = 0;
      for (const e of entries) {
        if (e.type === 'expense') spent += e.amountCHF;
        else income += e.amountCHF;
      }
      this.dashStats = {
        spent:  Math.round(spent  * 100) / 100,
        income: Math.round(income * 100) / 100,
        net:    Math.round((income - spent) * 100) / 100,
      };
      this.recentTx = [...entries]
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
        .slice(0, 8);
      await this._checkRecurring();
    },

    get savingsPct() {
      if (!this.dashStats.income) return 0;
      return Math.min(100, Math.round((this.dashStats.spent / this.dashStats.income) * 100));
    },

    // ── Transactions ──────────────────────────────────────────────────────────

    get txMonthLabel() {
      return new Date(this.txYear, this.txMonth - 1)
        .toLocaleString('default', { month: 'long', year: 'numeric' });
    },

    txPrev() {
      if (this.txMonth === 1) { this.txYear--; this.txMonth = 12; }
      else this.txMonth--;
      this.loadTransactions();
    },

    txNext() {
      if (this.txMonth === 12) { this.txYear++; this.txMonth = 1; }
      else this.txMonth++;
      this.loadTransactions();
    },

    async loadTransactions() {
      this.swipeOffsets = {};
      const pad = n => String(n).padStart(2, '0');
      let entries = await DB.getByDateRange(
        `${this.txYear}-${pad(this.txMonth)}-01`,
        `${this.txYear}-${pad(this.txMonth)}-31`
      );

      if (this.txFilter !== 'all') entries = entries.filter(e => e.type === this.txFilter);
      const q = this.txSearch.trim().toLowerCase();
      if (q) entries = entries.filter(e => e.name.toLowerCase().includes(q));

      entries.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

      const groups = {};
      for (const e of entries) {
        if (!groups[e.date]) groups[e.date] = [];
        groups[e.date].push(e);
      }
      this.txGrouped = Object.entries(groups)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, items]) => ({ date, label: this._fmtDate(date), items }));
    },

    _fmtDate(ds) {
      const d = new Date(ds + 'T00:00:00');
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const yest = new Date(today); yest.setDate(yest.getDate() - 1);
      if (d.getTime() === today.getTime()) return 'Today';
      if (d.getTime() === yest.getTime()) return 'Yesterday';
      return d.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' });
    },

    // ── Recurring ─────────────────────────────────────────────────────────────

    async _checkRecurring() {
      const today = dayjs();
      const rules = await DB.getAll('recurring');
      const due = [];

      for (const rule of rules) {
        if (!rule.active) continue;
        const last = rule.lastLoggedDate ? dayjs(rule.lastLoggedDate) : null;
        let isDue = false;

        if (rule.frequency === 'monthly') {
          const d = today.date(Math.min(rule.dayOfMonth, today.daysInMonth()));
          isDue = !today.isBefore(d, 'day') && (!last || last.isBefore(d, 'day'));
        } else if (rule.frequency === 'weekly') {
          const sow = today.startOf('week');
          isDue = today.day() >= rule.dayOfWeek && (!last || last.isBefore(sow, 'day'));
        } else if (rule.frequency === 'yearly') {
          const pad = n => String(n).padStart(2, '0');
          const d = dayjs(`${today.year()}-${pad(rule.monthOfYear)}-${pad(Math.min(rule.dayOfMonth, 28))}`);
          isDue = !today.isBefore(d, 'day') && (!last || last.year() < today.year());
        }

        if (isDue) {
          if (rule.autoLog) await this._doLogRecurring(rule);
          else due.push(rule);
        }
      }
      this.dueRecurring = due;
    },

    async _doLogRecurring(rule) {
      const today = new Date().toISOString().split('T')[0];
      await DB.put('expenses', {
        id: DB.genId('exp'), amount: rule.amount, currency: rule.currency,
        amountCHF: Math.round(this.toCHF(rule.amount, rule.currency) * 100) / 100,
        name: rule.name, categoryId: rule.categoryId, date: today,
        note: 'Recurring', recurringId: rule.id, type: 'expense',
      });
      await DB.put('recurring', { ...rule, lastLoggedDate: today });
    },

    async logRecurringItem(rule) {
      await this._doLogRecurring(rule);
      this.dueRecurring = this.dueRecurring.filter(r => r.id !== rule.id);
      if (!this.dueRecurring.length) this.showRecurringSheet = false;
      await this.loadDashboard();
    },

    skipRecurringItem(rule) {
      this.dueRecurring = this.dueRecurring.filter(r => r.id !== rule.id);
      if (!this.dueRecurring.length) this.showRecurringSheet = false;
    },

    async logAllRecurring() {
      for (const rule of [...this.dueRecurring]) await this._doLogRecurring(rule);
      this.dueRecurring = [];
      this.showRecurringSheet = false;
      await this.loadDashboard();
    },

    async loadRecurring() {
      this.recurringRules = await DB.getAll('recurring');
    },

    openAddRecurring(rule = null) {
      if (rule) {
        this.recurringForm = { ...rule, amount: String(rule.amount) };
      } else {
        this.recurringForm = {
          id: null, name: '', amount: '',
          currency: this.settings.defaultCurrency || 'CHF',
          categoryId: 'cat_subscriptions', frequency: 'monthly',
          dayOfMonth: new Date().getDate(), dayOfWeek: 1,
          monthOfYear: new Date().getMonth() + 1, autoLog: false,
          lastLoggedDate: null, active: true,
        };
      }
      this.showAddRecurring = true;
    },

    async saveRecurring() {
      const amount = parseFloat(this.recurringForm.amount);
      if (!amount || amount <= 0 || !this.recurringForm.name.trim()) return;
      const rule = {
        ...this.recurringForm,
        id: this.recurringForm.id || DB.genId('rec'),
        amount, name: this.recurringForm.name.trim(),
        active: true, lastLoggedDate: this.recurringForm.lastLoggedDate || null,
      };
      await DB.put('recurring', rule);
      this.showAddRecurring = false;
      await this.loadRecurring();
    },

    async deleteRecurring(id) {
      if (!confirm('Delete this recurring rule?')) return;
      await DB.delete('recurring', id);
      await this.loadRecurring();
    },

    async toggleRecurring(rule) {
      await DB.put('recurring', { ...rule, active: !rule.active });
      await this.loadRecurring();
    },

    // ── Reports ───────────────────────────────────────────────────────────────

    get rptLabel() {
      if (this.rptPeriod === 'year') return String(this.rptYear);
      if (this.rptPeriod === 'month')
        return new Date(this.rptYear, this.rptMonth - 1)
          .toLocaleString('default', { month: 'long', year: 'numeric' });
      return 'This week';
    },

    rptPrev() {
      if (this.rptPeriod === 'month') {
        if (this.rptMonth === 1) { this.rptYear--; this.rptMonth = 12; }
        else this.rptMonth--;
      } else if (this.rptPeriod === 'year') { this.rptYear--; }
      requestAnimationFrame(() => this.loadReports());
    },

    rptNext() {
      if (this.rptPeriod === 'month') {
        if (this.rptMonth === 12) { this.rptYear++; this.rptMonth = 1; }
        else this.rptMonth++;
      } else if (this.rptPeriod === 'year') { this.rptYear++; }
      requestAnimationFrame(() => this.loadReports());
    },

    async switchRptPeriod(p) {
      this.rptPeriod = p;
      requestAnimationFrame(() => this.loadReports());
    },

    async switchRptTab(t) {
      this.rptTab = t;
      requestAnimationFrame(() => this.loadReports());
    },

    async loadReports() {
      const pad = n => String(n).padStart(2, '0');
      let entries;

      if (this.rptPeriod === 'year') {
        entries = await DB.getByDateRange(`${this.rptYear}-01-01`, `${this.rptYear}-12-31`);
      } else if (this.rptPeriod === 'month') {
        entries = await DB.getByDateRange(
          `${this.rptYear}-${pad(this.rptMonth)}-01`,
          `${this.rptYear}-${pad(this.rptMonth)}-31`
        );
      } else {
        const today = dayjs();
        const mon = today.startOf('week').add(today.day() === 0 ? -6 : 1, 'day');
        entries = await DB.getByDateRange(mon.format('YYYY-MM-DD'), today.format('YYYY-MM-DD'));
      }

      if (this.rptTab === 'category') await this._rptCategory(entries.filter(e => e.type === 'expense'));
      else if (this.rptTab === 'time') await this._rptTime(entries);
      else await this._rptWeekday(entries.filter(e => e.type === 'expense'));
    },

    async _rptCategory(expenses) {
      const groups = {}; let total = 0;
      for (const e of expenses) {
        groups[e.categoryId] = (groups[e.categoryId] || 0) + e.amountCHF;
        total += e.amountCHF;
      }
      this.categoryData = Object.entries(groups)
        .sort(([, a], [, b]) => b - a)
        .map(([id, sum]) => {
          const cat = this.getCat(id);
          return { id, name: cat.name, icon: cat.icon, color: cat.color,
            total: Math.round(sum * 100) / 100,
            percent: total > 0 ? Math.round((sum / total) * 100) : 0 };
        });
      await this.$nextTick();
      Charts.renderCategory('categoryChart', this.categoryData);
    },

    async _rptTime(entries) {
      const expenses = entries.filter(e => e.type === 'expense');
      const income   = entries.filter(e => e.type === 'income');
      let labels, expData, incData;

      if (this.rptPeriod === 'year') {
        labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        expData = Array(12).fill(0); incData = Array(12).fill(0);
        for (const e of expenses) expData[parseInt(e.date.split('-')[1]) - 1] += e.amountCHF;
        for (const e of income)   incData[parseInt(e.date.split('-')[1]) - 1] += e.amountCHF;
      } else if (this.rptPeriod === 'month') {
        const days = new Date(this.rptYear, this.rptMonth, 0).getDate();
        labels = Array.from({ length: days }, (_, i) => String(i + 1));
        expData = Array(days).fill(0); incData = Array(days).fill(0);
        for (const e of expenses) expData[parseInt(e.date.split('-')[2]) - 1] += e.amountCHF;
        for (const e of income)   incData[parseInt(e.date.split('-')[2]) - 1] += e.amountCHF;
      } else {
        labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        expData = Array(7).fill(0); incData = Array(7).fill(0);
        for (const e of expenses) expData[(dayjs(e.date).day() + 6) % 7] += e.amountCHF;
        for (const e of income)   incData[(dayjs(e.date).day() + 6) % 7] += e.amountCHF;
      }

      expData = expData.map(v => Math.round(v * 100) / 100);
      incData = incData.map(v => Math.round(v * 100) / 100);
      await this.$nextTick();
      Charts.renderTime('timeChart', { labels, expData, incData });
    },

    async _rptWeekday(expenses) {
      const sums = Array(7).fill(0), counts = Array(7).fill(0);
      for (const e of expenses) {
        const dow = (dayjs(e.date).day() + 6) % 7;
        sums[dow] += e.amountCHF; counts[dow]++;
      }
      const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const data = sums.map((s, i) => counts[i] ? Math.round(s / counts[i] * 100) / 100 : 0);
      await this.$nextTick();
      Charts.renderWeekday('weekdayChart', { labels, data });
    },

    // ── Backup & Restore ──────────────────────────────────────────────────────

    async downloadBackup() {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), {
        href: url,
        download: `budget-backup-${new Date().toISOString().split('T')[0]}.json`,
      });
      a.click();
      URL.revokeObjectURL(url);
    },

    async restoreBackup(file) {
      if (!file) return;
      if (!confirm('This will replace ALL your data with the backup. Continue?')) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.version || !Array.isArray(data.expenses)) {
          alert('Invalid backup file.'); return;
        }
        await DB.importAll(data);
        await this._loadMasterData();
        this._applyTheme(this.settings.theme || 'dark');
        await this.loadDashboard();
        alert('Restore complete.');
      } catch {
        alert('Failed to restore. The file may be corrupted.');
      }
    },

    // ── Settings ──────────────────────────────────────────────────────────────

    async saveSettings() {
      await DB.put('settings', this.settings);
    },

    async updateRates() {
      this.ratesUpdating = true;
      try {
        const res  = await fetch('https://open.er-api.com/v6/latest/CHF');
        const json = await res.json();
        if (json.result === 'success') {
          await DB.put('exchangeRates', {
            id: 'latest', base: 'CHF', rates: json.rates,
            fetchedAt: new Date().toISOString(), source: 'fetched',
          });
          this.rates = json.rates;
          this.ratesFetchedAt = new Date().toLocaleDateString();
        }
      } catch {
        alert('Could not fetch rates. Check your internet connection.');
      }
      this.ratesUpdating = false;
    },
  };
}
