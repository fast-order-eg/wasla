import { randomUUID, createHash } from 'node:crypto';

export class DomainError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const now = () => new Date().toISOString();
const newId = prefix => `${prefix}_${randomUUID()}`;
const cleanText = (value, name, max = 4000, required = false) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new DomainError(`${name}: قيمة غير صحيحة`, 422);
  return value.trim();
};
const integer = (value, name, min = 0, max = 1000000000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new DomainError(`${name}: مطلوب عدد صحيح بين ${min} و${max}`, 422);
  return value;
};
const phoneDigits = value => String(value).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[\s()-]/g, '');
function customerData(value = {}) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new DomainError('بيانات العميل غير صحيحة', 422);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key) || ['__proto__','constructor','prototype'].includes(key)) throw new DomainError('اسم حقل العميل غير صحيح', 422);
    result[key] = cleanText(entry, key, 1500);
  }
  if (result.phone) result.phone = phoneDigits(result.phone);
  return result;
}
function customerRequirements(customer, product) {
  for (const field of product.requiredFields) if (!customer[field]?.trim()) throw new DomainError(`بيانات ناقصة: ${field}`, 422);
  if (customer.phone && !/^(?:01[0125]\d{8}|\+201[0125]\d{8})$/.test(customer.phone)) throw new DomainError('رقم الموبايل المصري غير صحيح؛ استخدم 11 رقم أو +20', 422);
}
const safeUrl = (value, name) => {
  if (!value) return '';
  const text = cleanText(value, name, 2000);
  if (/^\/uploads\/[a-zA-Z0-9_.-]+$/i.test(text) || text.startsWith('/uploads/')) return text;
  let url; try { url = new URL(text); } catch { throw new DomainError(`${name}: رابط غير صحيح`, 422); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new DomainError(`${name}: الرابط يجب أن يبدأ بـ https أو http`, 422);
  return text;
};
async function required(tx, collection, id) {
  if (typeof id !== 'string' || !id) throw new DomainError('المعرف مطلوب', 422);
  const record = await tx.get(collection, id);
  if (!record) throw new DomainError('العنصر غير موجود', 404);
  return record;
}
async function log(tx, type, entityId, details = {}) {
  await tx.put('events', {id:newId('evt'), type, entityId, details, createdAt:now()});
}
const publicCollections = new Set(['products','channels','conversations','orders','publishing_tasks','workers','events','groups']);
const messageOrder = (a,b) => a.createdAt.localeCompare(b.createdAt) || (a.sequence || 0) - (b.sequence || 0);

export function createServices(store, { assistant } = {}) {
  const services = {
    async list(collection) {
      if (!publicCollections.has(collection)) throw new DomainError('قائمة غير متاحة', 404);
      const records = await store.all(collection);
      const sorted = records.sort((a,b) => (b.createdAt || b.updatedAt || '').localeCompare(a.createdAt || a.updatedAt || ''));
      if (collection === 'workers') return sorted.map(record => ({...record,status:!record.lastSeenAt || Date.now()-Date.parse(record.lastSeenAt)>120000 ? 'offline' : record.status}));
      if (collection === 'events') return sorted.map(record => {
        const safe = {};
        for (const field of ['id','type','kind','status','attempts','createdAt','updatedAt']) if (record[field] !== undefined) safe[field] = record[field];
        // Never expose raw webhook payloads, recipient IDs, error bodies, claim tokens,
        // or arbitrary event metadata through the operational dashboard.
        if (record.error) safe.error = 'حدث خطأ أثناء المعالجة؛ راجع إعدادات الربط';
        if (typeof record.details?.status === 'string') safe.details = {status:record.details.status};
        return safe;
      });
      return sorted;
    },
    async summary() {
      return store.transaction(async tx => {
        const [products, conversations, orders, tasks] = await Promise.all(['products','conversations','orders','publishing_tasks'].map(c=>tx.all(c)));
        return {products:products.length, openConversations:conversations.filter(c=>c.status!=='closed').length,
          pendingOrders:orders.filter(o=>['draft','awaiting_confirmation'].includes(o.status)).length,
          confirmedOrders:orders.filter(o=>['confirmed','preparing','shipped'].includes(o.status)).length,
          deliveredOrders:orders.filter(o=>o.status==='delivered').length,
          revenuePiasters:orders.filter(o=>o.status==='delivered').reduce((sum,o)=>sum+o.totalPiasters,0),
          manualTasks:tasks.filter(t=>!['published','rejected'].includes(t.status)).length};
      });
    },
    async saveProduct(input, id) {
      return store.transaction(async tx => {
        const old = id ? await required(tx,'products',id) : null;
        const data = {...old,...input};
        const fields = data.requiredFields ?? ['name','phone','address','governorate'];
        if (!Array.isArray(fields) || fields.length > 20 || fields.some(f=>typeof f!=='string'|| !/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(f) || ['constructor','prototype','__proto__'].includes(f))) throw new DomainError('حقول العميل المطلوبة غير صحيحة',422);
        const variants = data.variants ?? [];
        if (!Array.isArray(variants) || variants.length > 100 || variants.some(v=>typeof v!=='string'||v.length>100)) throw new DomainError('الاختيارات تكون قائمة نصوص',422);
        if (data.active !== undefined && typeof data.active !== 'boolean') throw new DomainError('حالة المنتج غير صحيحة',422);
        const mediaVersions = Array.isArray(data.mediaVersions) ? data.mediaVersions.map((v, i) => ({
          id: String(v.id || `v${i+1}`),
          name: cleanText(v.name || `إصدار ${i+1}`, 'اسم إصدار الماتريال', 100),
          files: Array.isArray(v.files) ? v.files.map(f => ({
            url: safeUrl(f.url, 'رابط الملف'),
            type: ['video', 'image', 'file'].includes(f.type) ? f.type : 'image',
            name: cleanText(f.name || '', 'اسم الملف', 200)
          })) : [],
          notes: cleanText(v.notes || '', 'ملاحظات الإصدار', 500)
        })) : [];
        const defaultImage = mediaVersions.flatMap(v => v.files || []).find(f => f.type === 'image')?.url || '';
        const record = {id:old?.id || newId('prd'), name:cleanText(data.name,'اسم المنتج',200,true), description:cleanText(data.description,'الوصف',10000),
          material:cleanText(data.material,'الخامة / الماتريال',500), materialsUrl:safeUrl(data.materialsUrl,'رابط ماتريال الصور والفيديو'),
          mediaVersions,
          botInstructions:cleanText(data.botInstructions,'تعليمات البوت الخاصة بالمنتج',5000),
          pricePiasters:integer(data.pricePiasters,'السعر'), stock:integer(data.stock,'المخزون',0,1000000), active:data.active ?? true,
          requiredFields:[...new Set(fields)],variants, imageUrl:safeUrl(data.imageUrl || defaultImage,'رابط الصورة'), createdAt:old?.createdAt||now(),updatedAt:now()};
        await tx.put('products',record); await log(tx, old?'product_updated':'product_created', record.id); return record;
      });
    },
    async deleteProduct(id) {
      return store.transaction(async tx => {
        const product = await required(tx, 'products', id);
        await tx.remove('products', id);
        await log(tx, 'product_deleted', id, { name: product.name });
        return { ok: true, id };
      });
    },
    async createChannel(input) {
      if (!['manual','messenger'].includes(input.type)) throw new DomainError('نوع القناة غير صحيح',422);
      const record = {id:newId('chn'),name:cleanText(input.name,'اسم الحساب أو القناة',200,true),type:input.type,
        platform:cleanText(input.platform || (input.type === 'messenger' ? 'messenger' : 'facebook_marketplace'),'المنصة',64),
        accountOwner:cleanText(input.accountOwner,'الموظف المسؤول',100),
        accountUrl:safeUrl(input.accountUrl,'رابط الحساب أو البروفايل'),
        phone:cleanText(input.phone,'رقم الموبايل',50),
        notes:cleanText(input.notes,'ملاحظات الحساب',1000),
        status:input.type==='manual'?'manual':'unconfigured',autoReply:false,
        browserProfileId:input.browserProfileId ? cleanText(input.browserProfileId, 'معرف البروفايل المعزول', 100) : '',
        accountStatus:['ready', 'warming', 'cooldown', 'checkpoint'].includes(input.accountStatus) ? input.accountStatus : 'warming',
        trustScore:typeof input.trustScore === 'number' ? Math.min(100, Math.max(0, input.trustScore)) : 85,
        dailyPostsLimit:typeof input.dailyPostsLimit === 'number' ? integer(input.dailyPostsLimit, 'الحد اليومي للنشر', 1, 50) : 2,
        dailyGroupsLimit:typeof input.dailyGroupsLimit === 'number' ? integer(input.dailyGroupsLimit, 'الحد اليومي للجروبات', 1, 100) : 4,
        loginAccount:cleanText(input.loginAccount || '', 'حساب الدخول أو الإيميل', 200),
        lastWarmedAt:input.lastWarmedAt || null,
        externalPageId:cleanText(input.externalPageId,'معرف الصفحة',100),createdAt:now(),updatedAt:now()};
      return store.transaction(async tx => {
        if (record.externalPageId && (await tx.all('channels')).some(c=>c.externalPageId===record.externalPageId)) throw new DomainError('معرف الصفحة مسجل بالفعل',409);
        await tx.put('channels',record); return record;
      });
    },
    async updateChannel(id, input) {
      return store.transaction(async tx => {
        const old = await required(tx, 'channels', id);
        const record = {
          ...old,
          name: input.name !== undefined ? cleanText(input.name, 'اسم الحساب أو القناة', 200, true) : old.name,
          platform: input.platform !== undefined ? cleanText(input.platform, 'المنصة', 64) : old.platform,
          accountOwner: input.accountOwner !== undefined ? cleanText(input.accountOwner, 'الموظف المسؤول', 100) : old.accountOwner,
          accountUrl: input.accountUrl !== undefined ? safeUrl(input.accountUrl, 'رابط الحساب أو البروفايل') : old.accountUrl,
          phone: input.phone !== undefined ? cleanText(input.phone, 'رقم الموبايل', 50) : old.phone,
          notes: input.notes !== undefined ? cleanText(input.notes, 'ملاحظات الحساب', 1000) : old.notes,
          browserProfileId: input.browserProfileId !== undefined ? cleanText(input.browserProfileId, 'معرف البروفايل', 100) : old.browserProfileId,
          accountStatus: input.accountStatus && ['ready', 'warming', 'cooldown', 'checkpoint'].includes(input.accountStatus) ? input.accountStatus : old.accountStatus,
          trustScore: typeof input.trustScore === 'number' ? Math.min(100, Math.max(0, input.trustScore)) : old.trustScore,
          dailyPostsLimit: typeof input.dailyPostsLimit === 'number' ? integer(input.dailyPostsLimit, 'الحد اليومي للنشر', 1, 50) : old.dailyPostsLimit,
          dailyGroupsLimit: typeof input.dailyGroupsLimit === 'number' ? integer(input.dailyGroupsLimit, 'الحد اليومي للجروبات', 1, 100) : old.dailyGroupsLimit,
          loginAccount: input.loginAccount !== undefined ? cleanText(input.loginAccount, 'حساب الدخول', 200) : old.loginAccount,
          lastWarmedAt: input.lastWarmedAt !== undefined ? input.lastWarmedAt : old.lastWarmedAt,
          updatedAt: now()
        };
        await tx.put('channels', record);
        return record;
      });
    },
    async deleteChannel(id) {
      return store.transaction(async tx => {
        const old = await required(tx, 'channels', id);
        await tx.remove('channels', id);
        await log(tx, 'channel_deleted', id, { name: old.name });
        return { ok: true, id };
      });
    },
    async createConversation(input) {
      return store.transaction(async tx => {
        await required(tx,'channels',input.channelId);
        if (input.productId) await required(tx,'products',input.productId);
        const record={id:newId('conv'),channelId:input.channelId,senderName:cleanText(input.senderName,'اسم العميل',200,true),status:'bot_active',productId:input.productId||null,customer:customerData(input.customer),draftReply:null,createdAt:now(),updatedAt:now(),source:'manual'};
        await tx.put('conversations',record);return record;
      });
    },
    async getConversation(id) {
      return store.transaction(async tx => {
        const conversation=await required(tx,'conversations',id);
        return {...conversation,messages:(await tx.all('messages')).filter(m=>m.conversationId===id).sort(messageOrder)};
      });
    },
    async updateConversation(id,input) {
      return store.transaction(async tx => {
        const old=await required(tx,'conversations',id);
        if (input.status!==undefined && !['bot_active','human_takeover','closed'].includes(input.status)) throw new DomainError('حالة المحادثة غير صحيحة',422);
        if (input.productId) await required(tx,'products',input.productId);
        const record={...old,status:input.status??old.status,productId:input.productId===undefined?old.productId:input.productId,customer:input.customer===undefined?old.customer:customerData(input.customer),updatedAt:now(),revision:(old.revision||0)+1};
        if (input.status==='human_takeover'||input.status==='closed'||input.productId!==undefined||input.customer!==undefined) { record.draftReply=null; record.suggestion=null; }
        await tx.put('conversations',record);return record;
      });
    },
    async addMessage(id,input) {
      const text=cleanText(input.text,'نص الرسالة',12000,true);
      return store.transaction(async tx => {
        const conversation=await required(tx,'conversations',id);
        if(conversation.status==='closed') throw new DomainError('المحادثة مغلقة؛ أعد فتحها أولاً',409);
        const message={id:newId('msg'),conversationId:id,direction:'inbound',text,source:'manual',sequence:(conversation.revision||0)+1,createdAt:now()};
        await tx.put('messages',message);await tx.put('conversations',{...conversation,updatedAt:now(),draftReply:null,suggestion:null,revision:(conversation.revision||0)+1});return message;
      });
    },
    async receiveMessage(input) {
      const channelId=cleanText(input.channelId,'القناة',191,true);
      const externalMessageId=cleanText(input.externalMessageId,'معرف الرسالة',500,true);
      const externalConversationId=cleanText(input.externalConversationId,'معرف المحادثة',500,true);
      const id='in_'+createHash('sha256').update(JSON.stringify([channelId,externalMessageId])).digest('hex');
      const text=cleanText(input.text,'الرسالة',12000,true);
      return store.transaction(async tx => {
        const channel=await required(tx,'channels',channelId);
        if(channel.type!=='messenger') throw new DomainError('القناة ليست Messenger',422);
        const duplicate=await tx.get('messages',id);
        if(duplicate) return {duplicate:true,message:duplicate,conversation:await tx.get('conversations',duplicate.conversationId)};
        let conversation=(await tx.all('conversations')).find(c=>c.channelId===channelId && c.externalConversationId===externalConversationId);
        if(!conversation) conversation={id:newId('conv'),channelId,externalConversationId,senderName:cleanText(input.senderName||'عميل Messenger','اسم العميل',200,true),status:'bot_active',productId:null,customer:{},draftReply:null,source:'messenger',createdAt:now()};
        conversation={...conversation,updatedAt:now(),revision:(conversation.revision||0)+1,draftReply:null,suggestion:null,status:conversation.status==='closed'?'human_takeover':conversation.status};
        const message={id,conversationId:conversation.id,externalMessageId,direction:'inbound',text,source:'messenger',sequence:conversation.revision,createdAt:now()};
        await tx.put('conversations',conversation);await tx.put('messages',message);return {duplicate:false,conversation,message};
      });
    },
    async suggest(id,input={}) {
      const snapshot=await store.transaction(async tx => {
        const conversation=await required(tx,'conversations',id);
        if(conversation.status!=='bot_active') throw new DomainError('المساعد متوقف في المحادثة دي؛ استأنفه أولاً',409);
        const product=await required(tx,'products',input.productId||conversation.productId);
        const messages=(await tx.all('messages')).filter(m=>m.conversationId===id).sort(messageOrder);
        return {conversation,product,messages};
      });
      if(!assistant?.suggest) throw new DomainError('مساعد الردود غير مهيأ',503);
      const general = (await store.get('settings', 'bot_instructions')) || {};
      const result=await assistant.suggest({product:snapshot.product,messages:snapshot.messages,customer:snapshot.conversation.customer,shippingPiasters:null,generalInstructions:general.instructions||''});
      const safe={replyText:cleanText(result.replyText,'الرد المقترح',12000),extractedData:customerData(result.extractedData),needsHuman:Boolean(result.needsHuman),reason:cleanText(result.reason,'سبب المراجعة',2000)};
      return store.transaction(async tx=>{
        const current=await required(tx,'conversations',id);
        if(current.status!=='bot_active'||(current.revision||0)!==(snapshot.conversation.revision||0)) throw new DomainError('المحادثة اتغيرت أثناء تجهيز الرد؛ راجعها وجرّب تاني',409);
        await tx.put('conversations',{...current,productId:snapshot.product.id,draftReply:safe.replyText,suggestion:safe,updatedAt:now()});
        return safe;
      });
    },
    async createOrder(input) {
      return store.transaction(async tx=>{
        const conversation=await required(tx,'conversations',input.conversationId);
        const product=await required(tx,'products',input.productId);
        if(!product.active) throw new DomainError('المنتج غير متاح للبيع',409);
        const quantity=integer(input.quantity,'الكمية',1,1000000);
        const shippingPiasters=integer(input.shippingPiasters,'الشحن');
        const customer=customerData(input.customer);customerRequirements(customer,product);
        if(quantity>product.stock) throw new DomainError('المخزون غير كافي',409);
        if((await tx.all('orders')).some(o=>o.conversationId===conversation.id&&o.productId===product.id&&!['cancelled','returned','delivered'].includes(o.status))) throw new DomainError('يوجد طلب مفتوح لنفس المنتج والمحادثة',409);
        const totalPiasters=product.pricePiasters*quantity+shippingPiasters;
        if(!Number.isSafeInteger(totalPiasters))throw new DomainError('قيمة الطلب أكبر من الحد المدعوم',422);
        const order={id:newId('ord'),conversationId:conversation.id,productId:product.id,productName:product.name,quantity,unitPricePiasters:product.pricePiasters,shippingPiasters,totalPiasters,customer,status:'awaiting_confirmation',stockReserved:false,stockRestored:false,createdAt:now(),updatedAt:now(),history:[{status:'awaiting_confirmation',at:now()}]};
        await tx.put('orders',order);await tx.put('conversations',{...conversation,customer,productId:product.id,draftReply:null,suggestion:null,updatedAt:now(),revision:(conversation.revision||0)+1});await log(tx,'order_created',order.id);return order;
      });
    },
    async confirmOrder(id,input) {
      if(input.customerConfirmed!==true)throw new DomainError('مطلوب تأكيد صريح من العميل',422);
      const confirmationNote=cleanText(input.confirmationNote,'نص تأكيد العميل',2000,true);
      return store.transaction(async tx=>{
        const order=await required(tx,'orders',id);
        if(order.status!=='awaiting_confirmation')throw new DomainError('الطلب ليس في انتظار التأكيد',409);
        const product=await required(tx,'products',order.productId);
        if(!product.active||product.stock<order.quantity)throw new DomainError('المنتج أو الكمية لم تعد متاحة',409);
        if(product.pricePiasters!==order.unitPricePiasters)throw new DomainError('السعر اتغير؛ ألغِ المسودة واعرض السعر الجديد على العميل',409);
        customerRequirements(order.customer,product);
        const result={...order,status:'confirmed',stockReserved:true,confirmationNote,updatedAt:now(),history:[...order.history,{status:'confirmed',at:now()}]};
        await tx.put('products',{...product,stock:product.stock-order.quantity,updatedAt:now()});await tx.put('orders',result);await log(tx,'order_confirmed',id);return result;
      });
    },
    async transitionOrder(id,status) {
      const transitions={awaiting_confirmation:['cancelled'],confirmed:['preparing','cancelled'],preparing:['shipped','cancelled'],shipped:['delivered','returned'],delivered:['returned'],cancelled:[],returned:[]};
      return store.transaction(async tx=>{
        const order=await required(tx,'orders',id);
        if(!transitions[order.status]?.includes(status))throw new DomainError('الانتقال لحالة الطلب دي غير مسموح',409);
        const restore=['cancelled','returned'].includes(status)&&order.stockReserved&&!order.stockRestored;
        if(restore){const product=await required(tx,'products',order.productId);await tx.put('products',{...product,stock:product.stock+order.quantity,updatedAt:now()});}
        const result={...order,status,stockRestored:order.stockRestored||restore,updatedAt:now(),history:[...order.history,{status,at:now()}]};
        await tx.put('orders',result);await log(tx,'order_status_changed',id,{status});return result;
      });
    },
    async createPublishingTask(input) {
      return store.transaction(async tx=>{
        const product=await required(tx,'products',input.productId);
        const materialPart = product.material ? `\nالخامة / الماتريال: ${product.material}` : '';
        const mediaPart = product.materialsUrl ? `\nماتريال الصور والتسويق: ${product.materialsUrl}` : '';
        const record={id:newId('pub'),productId:product.id,destination:cleanText(input.destination,'مكان النشر',500,true),title:cleanText(input.title||product.name,'العنوان',200,true),body:cleanText(input.body||`${product.description}${materialPart}${mediaPart}\nالسعر: ${(product.pricePiasters/100).toFixed(2)} جنيه`,'نص المنشور',12000,true),imageUrl:product.imageUrl,status:'draft',executionMode:'manual',resultUrl:'',createdAt:now(),updatedAt:now()};
        await tx.put('publishing_tasks',record);return record;
      });
    },
    async updatePublishingTask(id,input) {
      if(!['draft','ready','published','pending_approval','rejected','needs_attention'].includes(input.status))throw new DomainError('حالة النشر غير صحيحة',422);
      return store.transaction(async tx=>{
        const old=await required(tx,'publishing_tasks',id);
        const result={...old,status:input.status,resultUrl:input.resultUrl===undefined?old.resultUrl:safeUrl(input.resultUrl,'رابط المنشور'),updatedAt:now(),manuallyRecorded:true};
        await tx.put('publishing_tasks',result);await log(tx,'publication_status_recorded',id,{status:input.status});return result;
      });
    },
    async saveGroup(input, id) {
      return store.transaction(async tx => {
        const old = id ? await required(tx, 'groups', id) : null;
        const name = cleanText(input.name || old?.name, 'اسم المجموعة', 300, true);
        const url = safeUrl(input.url || old?.url, 'رابط المجموعة');
        const type = ['public', 'private'].includes(input.type) ? input.type : (old?.type || 'public');
        const approval = ['auto', 'admin_review'].includes(input.approval) ? input.approval : (old?.approval || 'auto');
        const memberCount = typeof input.memberCount === 'number' ? input.memberCount : (old?.memberCount || 0);
        const productKeyword = cleanText(input.productKeyword || old?.productKeyword, 'الكلمة البحثية أو المنتج', 200);
        const assignedChannelId = cleanText(input.assignedChannelId || old?.assignedChannelId, 'الحساب المخصص', 100);
        const status = ['active', 'posted', 'pending', 'skipped'].includes(input.status) ? input.status : (old?.status || 'active');

        const record = {
          id: old?.id || newId('grp'),
          name,
          url,
          type,
          approval,
          memberCount,
          productKeyword,
          assignedChannelId,
          status,
          createdAt: old?.createdAt || now(),
          updatedAt: now()
        };
        await tx.put('groups', record);
        return record;
      });
    },
    async deleteGroup(id) {
      return store.transaction(async tx => {
        await required(tx, 'groups', id);
        await tx.remove('groups', id);
        return { ok: true, id };
      });
    },
    async generateKeywords({ productName, count = 10 } = {}) {
      if (assistant?.generateKeywords) {
        return assistant.generateKeywords({ productName, count });
      }
      return [
        `جروبات بيع وشراء ${productName}`,
        `سوق ${productName} مصر`,
        `ملابس وتسوق ${productName}`,
        `جروب سيدات وبنات مصر للتسوق`,
        `بيع أونلاين جملة وقطاعي ${productName}`,
        `سوق القاهرة والجيزة للملابس`,
        `بنات إسكندرية شوبينج وبيع`,
        `عروض وتخفيضات ${productName}`,
        `تجار ومحلات ${productName} في مصر`,
        `جروب محجبات وشوبينج مصر`
      ].slice(0, count);
    },
    async relayOrder(id, { apiUrl, apiKey } = {}) {
      const order = await store.get('orders', id);
      if (!order) throw new DomainError('الأوردر غير موجود', 404);
      const crmSettings = (await store.get('settings', 'crm_settings')) || {};
      const targetUrl = apiUrl || crmSettings.apiUrl;
      const targetKey = apiKey || crmSettings.apiKey;

      if (!targetUrl) throw new DomainError('رابط الـ API الخارجي غير مهيأ بعد', 400);

      const payload = {
        waslaOrderId: order.id,
        customerName: order.customer?.name || '',
        phone: order.customer?.phone || '',
        address: order.customer?.address || '',
        governorate: order.customer?.governorate || '',
        productName: order.productName || '',
        productId: order.productId || '',
        quantity: order.quantity || 1,
        totalPiasters: order.totalPiasters || 0,
        totalEgp: ((order.totalPiasters || 0) / 100).toFixed(2),
        selectedVariant: order.customer?.variant || order.customer?.color || order.customer?.size || '',
        source: 'wasla_auto',
        createdAt: order.createdAt || now()
      };

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(targetKey ? { 'Authorization': `Bearer ${targetKey}`, 'x-api-key': targetKey } : {})
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeout);
        const resText = await res.text();
        let resJson = null;
        try { resJson = JSON.parse(resText); } catch { resJson = resText; }

        const syncResult = {
          success: res.ok,
          status: res.status,
          response: resJson,
          sentAt: now()
        };

        await store.transaction(async tx => {
          const fresh = await tx.get('orders', id);
          if (fresh) {
            fresh.externalSync = syncResult;
            fresh.updatedAt = now();
            await tx.put('orders', fresh);
          }
        });

        if (!res.ok) throw new DomainError(`الـ API الخارجي رد بـ ${res.status}: ${resText.slice(0, 150)}`, 502);
        return syncResult;
      } catch (err) {
        if (err instanceof DomainError) throw err;
        throw new DomainError(`فشل الاتصال بالـ API الخارجي: ${err.message}`, 502);
      }
    },
    async seedDemo() {
      return store.transaction(async tx=>{
        if(await tx.get('settings','demo_seed_v1'))return;
        const product={id:'demo_product',name:'تيشيرت قطن — مثال تجريبي',description:'منتج تجريبي لشرح دورة البيع؛ قطن، ألوان أسود وأبيض، مقاسات M وL وXL.',material:'قطن مصري 100% ميلتون ناعم',materialsUrl:'',pricePiasters:35000,stock:12,active:true,requiredFields:['name','phone','address','governorate','color','size'],variants:['أسود','أبيض','M','L','XL'],imageUrl:'',createdAt:now(),updatedAt:now()};
        const channel={id:'demo_channel',name:'ماركت بليس — إدخال يدوي تجريبي',type:'manual',status:'manual',autoReply:false,externalPageId:'',createdAt:now()};
        const conversation={id:'demo_conversation',channelId:channel.id,senderName:'عميل تجريبي',status:'bot_active',productId:product.id,customer:{},draftReply:null,source:'manual',createdAt:now(),updatedAt:now()};
        await tx.put('products',product);await tx.put('channels',channel);await tx.put('conversations',conversation);
        await tx.put('messages',{id:'demo_message',conversationId:conversation.id,direction:'inbound',text:'التيشيرت بكام ومتوفر أسود XL؟',source:'demo',createdAt:now()});
        await tx.put('settings',{id:'demo_seed_v1',createdAt:now()});
      });
    },
    async getSetting(id) {
      return store.get('settings', id);
    },
    async saveSetting(id, data) {
      return store.transaction(async tx => {
        const record = { id, ...data, updatedAt: now() };
        await tx.put('settings', record);
        return record;
      });
    }
  };
  return services;
}
