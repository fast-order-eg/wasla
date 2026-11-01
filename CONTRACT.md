# Shared implementation contract

Local-first social commerce workspace. Node.js 22 ESM + Express. No publishing, sending to customers, creating external accounts, IP rotation, anti-detection, or unattended personal-account automation in demo mode. Arabic RTL frontend, EGP monetary amounts stored as integer piasters.

## Ownership
- Root: package.json, src/server.js, src/auth.js, src/assistant.js, src/meta.js, integration tests, docs.
- Backend agent: src/db.js, src/domain.js, src/routes.js, migrations/, tests/domain.test.js.
- UI agent: public/ only.
- Worker agent: worker/, tests/worker.test.js, docs/WORKER.md.

## Backend interface
`await createStore({ driver: 'sqlite'|'mysql', filename, mysqlUrl })` from src/db.js. Methods async `all(collection)`, `get(collection,id)`, `put(collection,record)`, `remove(collection,id)`, `transaction(async tx=>...)`, `close()`. Record has id. Transaction callback receives equivalent store; nested transaction not needed. Collections: products, channels, conversations, messages, orders, publishing_tasks, events, workers, settings. Persistent SQLite for local; MySQL production adapter. Transactions must rollback and isolate concurrent changes.

`createServices(store,{assistant})` from src/domain.js. Assistant signature `await assistant.suggest({product, messages, customer, shippingPiasters})` returns `{replyText, extractedData, needsHuman, reason}`; assistant cannot set confirmed status/prices. Export services with `seedDemo()`, `receiveMessage({channelId,externalMessageId,externalConversationId,senderName,text})` (deduplicate atomically), `list(collection)` as well as route handlers' internal methods. Demo should seed clearly labeled sample products/channel/conversation, no invented completed sales. `receiveMessage` stores messages and drafts only, no external sends. `createApiRouter(services)` default/named export from src/routes.js mounts under /api after authentication.

## JSON API
Errors `{error: readable text}` with appropriate 400/401/404/409/422/503. Lists return bare arrays; single/create/update endpoints return record.
- GET /api/summary => {products,openConversations,pendingOrders,confirmedOrders,deliveredOrders,revenuePiasters,manualTasks}
- GET/POST /api/products; PATCH /api/products/:id. Product {id,name,description,pricePiasters,stock,active,requiredFields:['name','phone','address','governorate'],variants:[],imageUrl?}. Validate integer nonnegative price/stock and required name.
- GET/POST /api/channels. {id,name,type:'manual'|'messenger',status:'manual'|'unconfigured'|'connected',autoReply:false}. Client cannot forge connected status.
- GET /api/conversations; GET /api/conversations/:id => conversation with messages array. Conversation {id,channelId,senderName,status:'bot_active'|'human_takeover'|'closed',productId?,customer:{},draftReply?}
- POST /api/conversations/:id/messages {text} stores manually entered inbound text, clearly no remote sync.
- POST /api/conversations/:id/suggest {productId?} => {replyText,extractedData,needsHuman,reason}; persist draft; no remote send.
- PATCH /api/conversations/:id {status,productId?,customer?}; takeover suppresses automatic suggestions.
- POST /api/orders {conversationId,productId,quantity,customer,shippingPiasters} => order draft/awaiting_confirmation; required customer fields validated. Order {id,conversationId,productId,quantity,unitPricePiasters,shippingPiasters,totalPiasters,customer,status,createdAt,history:[]}
- POST /api/orders/:id/confirm {customerConfirmed:true,confirmationNote:string} => atomically recheck price,stock, explicit confirmation and prevent duplicate confirmation/stock decrement. Status confirmed.
- PATCH /api/orders/:id/status {status:'preparing'|'shipped'|'delivered'|'cancelled'|'returned'} transition validation. Restore stock at most once on eligible cancellation/return.
- GET /api/orders
- GET/POST /api/publishing-tasks {productId,destination,title?,body?}; PATCH /api/publishing-tasks/:id {status:'draft'|'ready'|'published'|'pending_approval'|'rejected'|'needs_attention',resultUrl?}; manually recorded publication, no remote publisher.
- GET /api/workers; GET /api/events (redacted operational logs).

## Root endpoints and security
- GET /api/auth/session => {authenticated,demoMode}; POST /api/auth/login {password}; POST /api/auth/logout. HttpOnly SameSite=Strict session cookie, same-origin write protection. Demo password demo-only, localhost-only. UI labels demo password; production supplied ADMIN_PASSWORD required.
- GET /api/health => {status,mode,integrations:{meta,ai},...}; authenticated details if necessary.
- GET /webhooks/meta verification; POST /webhooks/meta checks HMAC over raw body, persists/deduplicates inbound events; no automatic outbound messages in this version.
- POST /api/worker/heartbeat uses x-worker-api-key, body {workerId,name,capabilities,network:{mode,proxyReachable,publicIp?},status}; returns {ok:true,serverTime}.
- GET /api/worker/config same key => {networkMode:'mobile_primary',rotateIp:false,ipHistoryBlocks:false,automaticPublishing:false,automaticPersonalMessages:false}.

## UI
Login; overview; product create/edit; conversations with product selection, inbound manual entry, suggestion, copy draft, customer fields and order creation; explicit customer confirmation form; order transitions; publishing preparation/status; channel/worker health and settings explanation. No fake connection or sent status. Use DOM textContent for untrusted text. Demo banner permanent. Basic accessible mobile navigation, meaningful empty/error/loading states. Format price display EGP; convert form EGP to piasters.

## Tests and dependencies
Use built-in node:test and assert. Dependencies root installs express, mysql2, dotenv. Node built-in node:sqlite in local mode (experimental on 22). No additional npm dependencies without coordination. All changes must stay in assigned paths.
