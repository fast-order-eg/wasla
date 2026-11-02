import { EventEmitter } from 'node:events';

export class NotificationListener extends EventEmitter {
  constructor() {
    super();
    this.active = true;
    this.recentNotifications = [];
  }

  parseFacebookEmailSubject(subject, body = '') {
    // أنماط إشعارات فيسبوك الشهيرة
    // 1. رسائل الماركت بليس
    if (/sent you a message about|أرسل لك رسالة بخصوص/i.test(subject)) {
      const match = subject.match(/(?:from|بخصوص)\s*(.+)/i) || [];
      return {
        type: 'marketplace_message',
        productHint: match[1]?.trim() || '',
        preview: body.slice(0, 300)
      };
    }
    // 2. كومنت على منشور أو فيديو
    if (/commented on your|علّق على/i.test(subject)) {
      return {
        type: 'comment',
        preview: body.slice(0, 300)
      };
    }
    // 3. رسالة شخصية جديدة
    if (/sent you a message|أرسل لك رسالة/i.test(subject)) {
      return {
        type: 'personal_message',
        preview: body.slice(0, 300)
      };
    }
    return { type: 'general', preview: body.slice(0, 300) };
  }

  receiveNotification(payload) {
    const entry = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      accountId: payload.accountId || 'account_primary',
      senderName: payload.senderName || 'عميل محتمل',
      type: payload.type || 'marketplace_message',
      text: payload.text || payload.preview || '',
      url: payload.url || '',
      receivedAt: new Date().toISOString()
    };

    this.recentNotifications.unshift(entry);
    if (this.recentNotifications.length > 50) this.recentNotifications.pop();

    this.emit('instant_trigger', entry);
    return entry;
  }
}

export const notificationHub = new NotificationListener();
