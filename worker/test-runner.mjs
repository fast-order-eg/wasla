import { listAdbDevices, rotateMobileIp, getPublicIp } from './mobile-rotator.mjs';
import { launchBrowser, preparePage, checkAdsPower } from './browser-manager.mjs';
import { warmAccount } from './warmer.mjs';
import { generateKeywordsForProduct } from './group-hunter.mjs';

const args = process.argv.slice(2);
const action = args[0] || '--help';

console.log('========================================================');
console.log('🤖 منصة وصلة — المشغل الآلي للأتمتة وتفادي الحظر');
console.log('========================================================\n');

async function main() {
  if (action === '--test-ip') {
    console.log('📱 1. فحص الاتصال بالهاتف وعنوان الآي بي الحالي...');
    const currentIp = await getPublicIp();
    console.log(`📡 عنوان IP الحالي: ${currentIp || 'تعذر القراءة'}`);

    const devices = await listAdbDevices();
    console.log(`🔌 أجهزة أندرويد المتصلة عبر ADB: ${devices.length > 0 ? devices.join(', ') : 'لا يوجد جهاز متصل حالياً'}`);

    if (devices.length > 0) {
      console.log('🔄 جاري تفعيل وضع الطيران ثم إلغاؤه لاختبار تغيير الآي بي...');
      const result = await rotateMobileIp();
      console.log('نتيجة تدوير الآي بي:', result);
    } else {
      console.log('💡 ملاحظة: عند توصيل الموبايل بكابل USB وتفعيل تصحيح USB (USB Debugging)، سيتم تغيير الآي بي تلقائياً.');
    }
  } else if (action === '--test-browser') {
    console.log('🌐 2. فحص متصفح العزل ومكافحة الحظر (Stealth / AdsPower)...');
    const adspowerReady = await checkAdsPower();
    console.log(`حالة AdsPower API: ${adspowerReady ? '🟢 متصل وشغال' : '⚪ غير شغال (سيتم استخدام المتصفح المحلي المعزول Stealth)'}`);

    console.log('جاري فتح المتصفح المعزول واختبار حجب البصمة...');
    const instance = await launchBrowser({ profileName: 'Wasla_Test_Account_1' });
    const page = await preparePage(instance.browser);

    console.log('فحص صفحة كشف الروبوتات العالمية (sannysoft)...');
    await page.goto('https://bot.sannysoft.com', { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('✅ تم فتح الصفحة بنجاح وفحص المتصفح.');
    console.log('اضغط Ctrl+C في أي وقت للإغلاق.');
  } else if (action === '--test-keywords') {
    const product = args[1] || 'طرحة كابيشوه';
    console.log(`🔍 3. توليد كلمات بحث ذكية لجروبات فيسبوك لمنتج: "${product}"...`);
    const keywords = await generateKeywordsForProduct(product);
    console.log('الكلمات المقترحة:');
    keywords.forEach((k, idx) => console.log(`  ${idx + 1}. ${k}`));
  } else if (action === '--test-warm') {
    console.log('🔥 4. اختبار تدفئة وتنشيط الحساب...');
    const instance = await launchBrowser({ profileName: 'Wasla_Test_Account_1' });
    const result = await warmAccount(instance, {
      durationSeconds: 30,
      onProgress: p => console.log(`[${p.time.slice(11, 19)}] ${p.message}`)
    });
    console.log('نتيجة التدفئة:', result);
    await instance.close();
  } else {
    console.log('الخيارات المتاحة للتشغيل والاختبار:');
    console.log('  node worker/test-runner.mjs --test-ip         (فحص أجهزة الموبايل وتدوير الآي بي)');
    console.log('  node worker/test-runner.mjs --test-browser    (فتح متصفح العزل وفحص البصمة)');
    console.log('  node worker/test-runner.mjs --test-keywords   (توليد كلمات بحث الجروبات بالذكاء الاصطناعي)');
    console.log('  node worker/test-runner.mjs --test-warm       (تجربة جلسة تدفئة وتنشيط)');
  }
}

main().catch(err => {
  console.error('❌ حدث خطأ:', err);
});
