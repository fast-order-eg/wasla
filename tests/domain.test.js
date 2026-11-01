import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../src/db.js';
import {createServices} from '../src/domain.js';

const customer={name:'عميل اختبار',phone:'01012345678',address:'عنوان اختبار كامل',governorate:'القاهرة'};
async function fixture(t,assistant) {
  const store=await createStore({filename:':memory:'});
  t.after(()=>store.close());
  const service=createServices(store,{assistant});
  const product=await service.saveProduct({name:'منتج',description:'وصف',pricePiasters:10000,stock:1});
  const channel=await service.createChannel({name:'يدوي',type:'manual',status:'connected',autoReply:true});
  const conversation=await service.createConversation({channelId:channel.id,senderName:'عميل'});
  return {store,service,product,channel,conversation};
}
const draft=(f,conversationId=f.conversation.id)=>f.service.createOrder({conversationId,productId:f.product.id,quantity:1,customer,shippingPiasters:5000});
const confirmation={customerConfirmed:true,confirmationNote:'العميل وافق على المنتج والإجمالي والعنوان'};

test('transactions roll back writes and serialize concurrent updates',async t=>{
  const {store}=await fixture(t);
  await assert.rejects(store.transaction(async tx=>{await tx.put('settings',{id:'rollback',value:1});throw new Error('abort');}),/abort/);
  assert.equal(await store.get('settings','rollback'),null);
  await store.put('settings',{id:'counter',value:0});
  await Promise.all(Array.from({length:10},()=>store.transaction(async tx=>{const value=await tx.get('settings','counter');await new Promise(resolve=>setTimeout(resolve,1));await tx.put('settings',{id:'counter',value:value.value+1});})));
  assert.equal((await store.get('settings','counter')).value,10);
});
test('two buyers cannot confirm the last item twice',async t=>{
  const f=await fixture(t);
  const second=await f.service.createConversation({channelId:f.channel.id,senderName:'عميل تاني'});
  const [firstOrder,secondOrder]=await Promise.all([draft(f),draft(f,second.id)]);
  const results=await Promise.allSettled([f.service.confirmOrder(firstOrder.id,confirmation),f.service.confirmOrder(secondOrder.id,confirmation)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
  assert.equal((await f.store.get('products',f.product.id)).stock,0);
});
test('explicit confirmation required; duplicate confirmation does not decrement stock',async t=>{
  const f=await fixture(t);const order=await draft(f);
  await assert.rejects(f.service.confirmOrder(order.id,{customerConfirmed:false,confirmationNote:'x'}),{status:422});
  await assert.rejects(f.service.confirmOrder(order.id,{customerConfirmed:true,confirmationNote:''}),{status:422});
  const confirmed=await f.service.confirmOrder(order.id,confirmation);
  assert.equal(confirmed.totalPiasters,15000);
  await assert.rejects(f.service.confirmOrder(order.id,confirmation),{status:409});
  assert.equal((await f.store.get('products',f.product.id)).stock,0);
});
test('price change invalidates old confirmation and leaves stock untouched',async t=>{
  const f=await fixture(t);const order=await draft(f);
  await f.service.saveProduct({pricePiasters:11000},f.product.id);
  await assert.rejects(f.service.confirmOrder(order.id,confirmation),{status:409});
  assert.equal((await f.store.get('products',f.product.id)).stock,1);
});
test('invalid lifecycle transition rejected and cancellation restores stock once',async t=>{
  const f=await fixture(t);const order=await draft(f);
  await assert.rejects(f.service.transitionOrder(order.id,'shipped'),{status:409});
  await f.service.confirmOrder(order.id,confirmation);
  await f.service.transitionOrder(order.id,'cancelled');
  await assert.rejects(f.service.transitionOrder(order.id,'cancelled'),{status:409});
  await assert.rejects(f.service.transitionOrder(order.id,'confirmed'),{status:409});
  assert.equal((await f.store.get('products',f.product.id)).stock,1);
});
test('return restores stock once and excludes returned orders from revenue',async t=>{
  const f=await fixture(t);const order=await draft(f);
  await f.service.confirmOrder(order.id,confirmation);
  for(const status of ['preparing','shipped','delivered'])await f.service.transitionOrder(order.id,status);
  assert.equal((await f.service.summary()).revenuePiasters,15000);
  await f.service.transitionOrder(order.id,'returned');
  assert.equal((await f.service.summary()).revenuePiasters,0);
  assert.equal((await f.store.get('products',f.product.id)).stock,1);
  await assert.rejects(f.service.transitionOrder(order.id,'returned'),{status:409});
});
test('incoming webhook messages deduplicate atomically per channel',async t=>{
  const f=await fixture(t);
  const channel=await f.service.createChannel({name:'صفحة',type:'messenger',externalPageId:'123',status:'connected'});
  assert.equal(channel.status,'unconfigured');
  const input={channelId:channel.id,externalMessageId:'msg-1',externalConversationId:'person-1',senderName:'عميل',text:'السلام عليكم'};
  const results=await Promise.all([f.service.receiveMessage(input),f.service.receiveMessage(input)]);
  assert.equal(results.filter(r=>r.duplicate).length,1);
  assert.equal((await f.store.all('messages')).length,1);
  assert.equal((await f.store.all('conversations')).filter(c=>c.channelId===channel.id).length,1);
});
test('takeover during AI call discards stale result and does not overwrite customer',async t=>{
  let resolveReply;let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{suggest:()=>{entered();return new Promise(resolve=>{resolveReply=resolve;});}});
  await f.service.updateConversation(f.conversation.id,{productId:f.product.id});
  const suggesting=f.service.suggest(f.conversation.id);
  await started;
  await f.service.updateConversation(f.conversation.id,{status:'human_takeover'});
  resolveReply({replyText:'رد',extractedData:{name:'اسم مقترح'},needsHuman:false,reason:''});
  await assert.rejects(suggesting,{status:409});
  assert.equal((await f.store.get('conversations',f.conversation.id)).draftReply,null);
});
test('new inbound message during AI call discards stale result',async t=>{
  let resolveReply;let entered;const started=new Promise(resolve=>{entered=resolve;});
  const f=await fixture(t,{suggest:()=>{entered();return new Promise(resolve=>{resolveReply=resolve;});}});
  await f.service.updateConversation(f.conversation.id,{productId:f.product.id});
  const suggesting=f.service.suggest(f.conversation.id);await started;
  await f.service.addMessage(f.conversation.id,{text:'لا غيرت رأيي'});
  resolveReply({replyText:'رد قديم',extractedData:{},needsHuman:false,reason:''});
  await assert.rejects(suggesting,{status:409});
});
test('invalid prices, stock, phone, missing data, image scheme and duplicates rejected',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.saveProduct({pricePiasters:1.2},f.product.id),{status:422});
  await assert.rejects(f.service.saveProduct({stock:-1},f.product.id),{status:422});
  await assert.rejects(f.service.saveProduct({imageUrl:'javascript:alert(1)'},f.product.id),{status:422});
  await assert.rejects(f.service.createOrder({conversationId:f.conversation.id,productId:f.product.id,quantity:1,customer:{...customer,phone:'123'},shippingPiasters:0}),{status:422});
  await assert.rejects(f.service.createOrder({conversationId:f.conversation.id,productId:f.product.id,quantity:1,customer:{...customer,address:''},shippingPiasters:0}),{status:422});
  await draft(f);await assert.rejects(draft(f),{status:409});
});
test('demo seed idempotent and does not invent sales',async t=>{
  const store=await createStore({filename:':memory:'});t.after(()=>store.close());const service=createServices(store);
  await service.seedDemo();await service.seedDemo();
  assert.equal((await service.list('products')).length,1);
  assert.equal((await service.list('orders')).length,0);
  assert.equal((await service.summary()).revenuePiasters,0);
});
test('editing customer details invalidates a previously generated draft',async t=>{
  const f=await fixture(t,{suggest:async()=>({replyText:'ممكن الاسم؟',extractedData:{},needsHuman:false,reason:''})});
  await f.service.updateConversation(f.conversation.id,{productId:f.product.id});
  await f.service.suggest(f.conversation.id);
  assert.equal((await f.store.get('conversations',f.conversation.id)).draftReply,'ممكن الاسم؟');
  await f.service.updateConversation(f.conversation.id,{customer});
  const conversation=await f.store.get('conversations',f.conversation.id);
  assert.equal(conversation.draftReply,null);
  assert.equal(conversation.suggestion,null);
});
test('operational event listing redacts webhook PII and processing credentials',async t=>{
  const f=await fixture(t);
  await f.store.put('events',{id:'secret-event',kind:'meta_inbound',status:'failed',payload:{text:'private customer address'},externalMessageId:'external-id',claimId:'claim-secret',error:'private response body',details:{customer:customer},createdAt:new Date().toISOString()});
  const record=(await f.service.list('events')).find(e=>e.id==='secret-event');
  assert.equal(record.payload,undefined);assert.equal(record.externalMessageId,undefined);assert.equal(record.claimId,undefined);assert.equal(record.details,undefined);assert.equal(record.error.includes('private'),false);
});
test('product saves material and media links and reflects them in publishing',async t=>{
  const f=await fixture(t);
  const p=await f.service.saveProduct({name:'سويت شيرت',pricePiasters:45000,stock:5,material:'قطن ميلتون مبطن فرو',materialsUrl:'https://drive.google.com/drive/folders/test-materials',imageUrl:'https://example.com/item.jpg'});
  assert.equal(p.material,'قطن ميلتون مبطن فرو');
  assert.equal(p.materialsUrl,'https://drive.google.com/drive/folders/test-materials');
  const task=await f.service.createPublishingTask({productId:p.id,destination:'ماركت بليس'});
  assert.ok(task.body.includes('قطن ميلتون مبطن فرو'));
  assert.ok(task.body.includes('https://drive.google.com/drive/folders/test-materials'));
});
