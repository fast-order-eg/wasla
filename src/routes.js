import express from 'express';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { ordersCsv } from './export.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uploadsDir = path.resolve(root, 'public', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const cleanExt = /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : '.jpg';
    const safeName = `up_${Date.now()}_${randomBytes(6).toString('hex')}${cleanExt}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|gif|mp4|mov|pdf|zip)$/i;
    if (!allowed.test(file.originalname)) {
      const err = new Error('نوع الملف غير مدعوم؛ المسموح صور وفيديوهات ومستندات فقط');
      err.status = 422;
      return cb(err);
    }
    cb(null, true);
  }
});

export function createApiRouter(services) {
  const router=express.Router();
  const handle=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
  const body=req=>{
    if(!req.body||Array.isArray(req.body)||typeof req.body!=='object') {const error=new Error('جسم الطلب لازم يكون JSON object');error.status=400;throw error;}
    return req.body;
  };
  router.get('/summary',handle(async(req,res)=>res.json(await services.summary())));
  router.get('/orders/export.csv',handle(async(req,res)=>{
    res.set('Content-Disposition','attachment; filename="orders.csv"');
    res.type('text/csv; charset=utf-8').send(ordersCsv(await services.list('orders')));
  }));
  router.post('/upload', upload.any(), handle(async(req, res) => {
    const files = req.files || (req.file ? [req.file] : []);
    if (!files.length) { const err = new Error('لم يتم إرسال أي ملف'); err.status = 400; throw err; }
    const fileList = files.map(f => ({
      url: `/uploads/${f.filename}`,
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
      type: f.mimetype.startsWith('video/') ? 'video' : (f.mimetype.startsWith('image/') ? 'image' : 'file')
    }));
    res.json({
      url: fileList[0].url,
      filename: fileList[0].filename,
      size: fileList[0].size,
      mimetype: fileList[0].mimetype,
      type: fileList[0].type,
      files: fileList
    });
  }));
  router.get('/settings/bot-instructions', handle(async (req, res) => {
    const val = (await services.getSetting('bot_instructions')) || {
      instructions: 'المعاينة متاحة قبل الاستلام مع المندوب. مدة التوصيل 2-3 أيام داخل القاهرة والجيزة، ومن 3-5 أيام للمحافظات. الرد بأسلوب ودود ومختصر وبلهجة مصرية، مع استخراج المقاس واللون والاسم والعنوان فوراً.',
      tone: 'friendly_concise'
    };
    res.json(val);
  }));
  router.put('/settings/bot-instructions', handle(async (req, res) => {
    const b = body(req);
    res.json(await services.saveSetting('bot_instructions', {
      instructions: typeof b.instructions === 'string' ? b.instructions.slice(0, 10000) : '',
      tone: typeof b.tone === 'string' ? b.tone.slice(0, 50) : 'friendly_concise'
    }));
  }));
  for(const [pathKey,collection] of Object.entries({products:'products',channels:'channels',conversations:'conversations',orders:'orders','publishing-tasks':'publishing_tasks',workers:'workers',events:'events'})) router.get('/'+pathKey,handle(async(req,res)=>res.json(await services.list(collection))));
  router.post('/products',handle(async(req,res)=>res.status(201).json(await services.saveProduct(body(req)))));
  router.patch('/products/:id',handle(async(req,res)=>res.json(await services.saveProduct(body(req),req.params.id))));
  router.delete('/products/:id',handle(async(req,res)=>res.json(await services.deleteProduct(req.params.id))));
  router.post('/channels',handle(async(req,res)=>res.status(201).json(await services.createChannel(body(req)))));
  router.patch('/channels/:id',handle(async(req,res)=>res.json(await services.updateChannel(req.params.id,body(req)))));
  router.post('/conversations',handle(async(req,res)=>res.status(201).json(await services.createConversation(body(req)))));
  router.get('/conversations/:id',handle(async(req,res)=>res.json(await services.getConversation(req.params.id))));
  router.patch('/conversations/:id',handle(async(req,res)=>res.json(await services.updateConversation(req.params.id,body(req)))));
  router.post('/conversations/:id/messages',handle(async(req,res)=>res.status(201).json(await services.addMessage(req.params.id,body(req)))));
  router.post('/conversations/:id/suggest',handle(async(req,res)=>res.json(await services.suggest(req.params.id,body(req)))));
  router.post('/orders',handle(async(req,res)=>res.status(201).json(await services.createOrder(body(req)))));
  router.post('/orders/:id/confirm',handle(async(req,res)=>res.json(await services.confirmOrder(req.params.id,body(req)))));
  router.patch('/orders/:id/status',handle(async(req,res)=>res.json(await services.transitionOrder(req.params.id,body(req).status))));
  router.post('/publishing-tasks',handle(async(req,res)=>res.status(201).json(await services.createPublishingTask(body(req)))));
  router.patch('/publishing-tasks/:id',handle(async(req,res)=>res.json(await services.updatePublishingTask(req.params.id,body(req)))));
  return router;
}
export default createApiRouter;
