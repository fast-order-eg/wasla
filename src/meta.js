import { createHash, createHmac, randomUUID } from 'node:crypto';
import express from 'express';
import { safeEqual } from './auth.js';

export function createMeta({ env, store, services, now = Date.now }) {
  const router = express.Router();
  const configured = env.DEMO_MODE === 'false' && !!(env.META_APP_SECRET && env.META_VERIFY_TOKEN && env.META_PAGE_ID && env.META_CHANNEL_ID);
  router.get('/', (req, res) => {
    if (!configured) return res.status(503).send('Webhook is not configured.');
    if (req.query['hub.mode'] !== 'subscribe' || !safeEqual(req.query['hub.verify_token'], env.META_VERIFY_TOKEN)) return res.sendStatus(403);
    const challenge = req.query['hub.challenge'];
    if (typeof challenge !== 'string' || challenge.length > 200) return res.sendStatus(400);
    res.type('text/plain').send(challenge);
  });
  router.post('/', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    if (!configured) return res.sendStatus(503);
    if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
    const signature = `sha256=${createHmac('sha256', env.META_APP_SECRET).update(req.body).digest('hex')}`;
    if (!safeEqual(req.get('x-hub-signature-256'), signature)) return res.sendStatus(403);
    let payload;
    try { payload = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
    if (!payload || typeof payload !== 'object' || payload.object !== 'page' || !Array.isArray(payload.entry) || payload.entry.length > 100) return res.sendStatus(400);
    if (payload.entry.some(entry => !entry || typeof entry !== 'object' || (entry.messaging !== undefined && (!Array.isArray(entry.messaging) || entry.messaging.some(item => !item || typeof item !== 'object'))))) return res.sendStatus(400);
    if (payload.entry.some(entry => String(entry.id) !== env.META_PAGE_ID)) return res.sendStatus(403);
    const id = `meta_${createHash('sha256').update(req.body).digest('hex')}`;
    await store.transaction(async tx => {
      if (await tx.get('events', id)) return;
      await tx.put('events', { id, kind: 'meta_webhook', status: 'queued', attempts: 0, payload, createdAt: new Date(now()).toISOString(), dueAt: now() });
    });
    res.status(200).send('EVENT_RECEIVED');
  });

  async function processPending() {
    if (!configured) return;
    const claimId = randomUUID();
    const event = await store.transaction(async tx => {
      const candidates = (await tx.all('events')).filter(e => e.kind === 'meta_webhook' && ((e.status === 'queued' && e.dueAt <= now()) || (e.status === 'processing' && e.leaseUntil <= now())));
      const value = candidates.sort((a, b) => a.dueAt - b.dueAt)[0];
      if (!value) return null;
      value.status = 'processing'; value.claimId = claimId; value.leaseUntil = now() + 120000;
      await tx.put('events', value); return value;
    });
    if (!event) return;
    try {
      const channel = await store.get('channels', env.META_CHANNEL_ID);
      if (!channel || channel.type !== 'messenger' || (channel.externalPageId && channel.externalPageId !== env.META_PAGE_ID)) throw new Error('channel_configuration');
      for (const entry of event.payload.entry) {
        for (const messageEvent of entry.messaging || []) {
          const message = messageEvent.message;
          if (!message || message.is_echo || !message.mid || !messageEvent.sender?.id) continue;
          if (String(messageEvent.recipient?.id) !== env.META_PAGE_ID) continue;
          const unsupported = typeof message.text !== 'string';
          const received = await services.receiveMessage({ channelId: channel.id, externalMessageId: message.mid, externalConversationId: String(messageEvent.sender.id), senderName: 'عميل Messenger', text: unsupported ? '[رسالة غير نصية — محتاجة مراجعة بشرية في Messenger]' : message.text.slice(0, 5000) });
          if (unsupported && received.conversation) await store.transaction(async tx => {
            const conversation = await tx.get('conversations', received.conversation.id);
            if (conversation) { conversation.status = 'human_takeover'; await tx.put('conversations', conversation); }
          });
        }
      }
      await store.transaction(async tx => {
        const latest = await tx.get('events', event.id);
        if (latest?.claimId !== claimId) return;
        await tx.put('events', { ...latest, status: 'completed', payload: undefined, completedAt: new Date(now()).toISOString() });
        const currentChannel = await tx.get('channels', channel.id);
        if (currentChannel) await tx.put('channels', { ...currentChannel, status: 'connected', lastInboundAt: new Date(now()).toISOString(), autoReply: false });
      });
    } catch {
      await store.transaction(async tx => {
        const latest = await tx.get('events', event.id);
        if (latest?.claimId !== claimId) return;
        const attempts = (latest.attempts || 0) + 1;
        await tx.put('events', { ...latest, status: attempts >= 5 ? 'failed' : 'queued', attempts, dueAt: now() + Math.min(300000, 1000 * 2 ** attempts), error: 'تعذر معالجة إشعار Meta؛ راجع إعداد القناة والسجل التشغيلي.' });
      });
    }
  }
  return { router, configured, processPending };
}
