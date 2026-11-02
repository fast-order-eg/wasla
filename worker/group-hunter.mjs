import { preparePage } from './browser-manager.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateKeywordsForProduct(productName, { count = 10, aiAssistant = null } = {}) {
  if (aiAssistant) {
    try {
      const prompt = `أنا تاجر في مصر وببيع منتج اسمه "${productName}".
عايزك تقترحلي قائمة مكونة من ${count} مصطلحات بحث باللهجة المصرية أبحث بيها على فيسبوك عشان ألاقي الجروبات اللي مهتمة تشتري أو تعرض المنتج ده (زي جروبات بيع حريمي، جروبات تسوق، سوق الجملة، جروبات المحافظات).
اكتب فقط الكلمات مفصولة بفاصلة جديدة في كل سطر بدون ترقيم أو مقدمات.`;

      const response = await aiAssistant.suggestReply({
        customer: 'تاجر',
        history: [{ sender: 'human', text: prompt }],
        product: { name: productName }
      });

      if (response && response.text) {
        const lines = response.text.split('\n').map(l => l.replace(/^[0-9.-•*\s]+/, '').trim()).filter(Boolean);
        if (lines.length >= 3) return lines.slice(0, count);
      }
    } catch {}
  }

  // كلمات بحثية مصرية افتراضية واحترافية حسب نوع المنتج
  return [
    `جروبات بيع وشراء ${productName}`,
    `سوق ${productName} مصر`,
    `ملابس حريمي وتسوق ${productName}`,
    `جروب سيدات وبنات مصر للتسوق`,
    `بيع أونلاين جملة وقطاعي ${productName}`,
    `سوق القاهرة والجيزة للملابس`,
    `بنات إسكندرية شوبينج وبيع`,
    `تجار ومحلات ${productName} في مصر`,
    `عروض وتخفيضات ${productName}`,
    `جروب محجبات وشوبينج مصر`
  ].slice(0, count);
}

export async function scrapeGroupsByKeyword(browserInstance, keyword, { maxGroups = 20, onProgress = () => {} } = {}) {
  const page = await preparePage(browserInstance.browser);
  const log = msg => onProgress({ time: new Date().toISOString(), message: msg });

  log(`البحث عن الجروبات بكلمة: "${keyword}"…`);
  const searchUrl = `https://www.facebook.com/groups/search/groups/?q=${encodeURIComponent(keyword)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(4000);

  // عمل سكرول لتحميل نتائج أكتر
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' }));
    await sleep(2500);
  }

  // استخراج بيانات الجروبات من الصفحة
  const groups = await page.evaluate(maxCount => {
    const results = [];
    const links = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
    const seenUrls = new Set();

    for (const a of links) {
      let href = a.getAttribute('href') || '';
      if (!href) continue;
      // تنظيف الرابط
      const match = href.match(/(https:\/\/(?:www\.)?facebook\.com\/groups\/[^/?&]+)/i) || href.match(/(\/groups\/[^/?&]+)/i);
      if (!match) continue;
      let fullUrl = match[1];
      if (fullUrl.startsWith('/')) fullUrl = `https://www.facebook.com${fullUrl}`;
      if (seenUrls.has(fullUrl) || fullUrl.endsWith('/feed') || fullUrl.endsWith('/search')) continue;
      seenUrls.add(fullUrl);

      const name = a.innerText.trim() || a.getAttribute('aria-label') || 'مجموعة فيسبوك';
      if (!name || name.length < 3 || name === 'مجموعات') continue;

      // البحث عن النص المحيط لمعرفة هل هو عام أو خاص وعدد الأعضاء
      let container = a.closest('div[role="feed"]') || a.parentElement?.parentElement?.parentElement || a.parentElement;
      const textBlock = container ? container.innerText : '';
      const isPublic = textBlock.includes('عامة') || textBlock.includes('Public') || !textBlock.includes('خاصة');

      results.push({
        name,
        url: fullUrl,
        isPublic,
        type: isPublic ? 'public' : 'private',
        discoveredAt: new Date().toISOString()
      });

      if (results.length >= maxCount) break;
    }
    return results;
  }, maxGroups);

  log(`تم العثور على ${groups.length} جروب لكلمة "${keyword}".`);
  return groups;
}
