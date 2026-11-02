import { preparePage } from './browser-manager.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function warmAccount(browserInstance, { durationSeconds = 90, onProgress = () => {} } = {}) {
  const page = await preparePage(browserInstance.browser);
  const log = msg => onProgress({ time: new Date().toISOString(), message: msg });

  log('فتح فيسبوك للتدفئة والتنشيط…');
  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(randomBetween(3000, 6000));

  // تحقق هل الأكونت مسجل دخول
  const isLoginPage = await page.evaluate(() => {
    return Boolean(document.querySelector('input[name="email"]') || document.querySelector('button[name="login"]'));
  });

  if (isLoginPage) {
    log('⚠️ الأكونت محتاج تسجيل دخول يدوي لأول مرة أو حفظ الـ Session في هذا البروفايل.');
    return { status: 'needs_login', loggedIn: false };
  }

  log('الأكونت مسجل دخول بنجاح. بدء جلسة التصفح والتفاعل البشري…');

  const startTime = Date.now();
  const maxDurationMs = durationSeconds * 1000;
  let scrollCount = 0;
  let likedCount = 0;

  while (Date.now() - startTime < maxDurationMs) {
    // 1. سكرول عشوائي شبيه بالبشر
    const scrollDelta = randomBetween(250, 700);
    await page.evaluate(delta => window.scrollBy({ top: delta, behavior: 'smooth' }), scrollDelta);
    scrollCount++;
    log(`تصفح الفيد… (سكرول رقم ${scrollCount})`);

    // 2. وقفة عشوائية للقراءة (من 3 إلى 7 ثواني)
    await sleep(randomBetween(3000, 7000));

    // 3. احتمالية 20% لعمل لايك لبوست ظاهر في الشاشة
    if (Math.random() < 0.25 && likedCount < 3) {
      try {
        const liked = await page.evaluate(() => {
          const likeButtons = Array.from(document.querySelectorAll('div[aria-label="أعجبني"], div[aria-label="Like"]'));
          const visible = likeButtons.filter(b => {
            const rect = b.getBoundingClientRect();
            return rect.top >= 100 && rect.bottom <= window.innerHeight - 100;
          });
          if (visible.length > 0) {
            visible[0].click();
            return true;
          }
          return false;
        });
        if (liked) {
          likedCount++;
          log(`👍 تم التفاعل وعمل لايك لبوست طبيعي (إجمالي التفاعلات: ${likedCount})`);
          await sleep(randomBetween(2000, 4000));
        }
      } catch {}
    }
  }

  // 4. فحص طلبات الصداقة وقبول طلب أو اثنين إذا وجد
  try {
    log('فحص طلبات الصداقة المعلقة…');
    await page.goto('https://www.facebook.com/friends/requests', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(randomBetween(3000, 5000));

    const accepted = await page.evaluate(() => {
      const confirmBtns = Array.from(document.querySelectorAll('div[aria-label="تأكيد"], div[aria-label="Confirm"]'));
      if (confirmBtns.length > 0) {
        confirmBtns[0].click();
        return 1;
      }
      return 0;
    });

    if (accepted > 0) {
      log('🤝 تم قبول طلب صداقة جديد بنجاح.');
      await sleep(2000);
    } else {
      log('لا توجد طلبات صداقة معلقة جديدة.');
    }
  } catch {}

  log('✅ انتهت جلسة التدفئة والتنشيط بنجاح.');
  return {
    status: 'completed',
    loggedIn: true,
    scrolls: scrollCount,
    likes: likedCount,
    durationSeconds: Math.round((Date.now() - startTime) / 1000)
  };
}
