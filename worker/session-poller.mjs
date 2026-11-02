export class SessionPoller {
  constructor({ intervalSeconds = 35, onUnreadFound = () => {} } = {}) {
    this.intervalMs = intervalSeconds * 1000;
    this.onUnreadFound = onUnreadFound;
    this.running = false;
    this.timer = null;
    this.stats = {
      lastCycleAt: null,
      totalChecks: 0,
      unreadFound: 0
    };
  }

  start(accountsProvider) {
    if (this.running) return;
    this.running = true;

    const cycle = async () => {
      if (!this.running) return;
      try {
        const accounts = typeof accountsProvider === 'function' ? await accountsProvider() : accountsProvider;
        const activeAccounts = (accounts || []).filter(a => a.accountStatus === 'ready' || a.accountStatus === 'warming');

        this.stats.lastCycleAt = new Date().toISOString();
        this.stats.totalChecks++;

        // فحص سريع خفيف لكل حساب
        for (const acc of activeAccounts) {
          if (!this.running) break;
          // التحقق من وجود جلسة أو إشعار غير مقروء
          // إذا وُجد تفاعل غير مقروء، يتم استدعاء callback الرد الفوري
          if (acc.hasPendingUnread) {
            this.stats.unreadFound++;
            await this.onUnreadFound(acc);
          }
        }
      } catch (err) {
        console.warn('Session poller error:', err.message);
      } finally {
        if (this.running) {
          this.timer = setTimeout(cycle, this.intervalMs);
        }
      }
    };

    cycle();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
