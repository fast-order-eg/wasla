export function buildCommentResponse({
  customerName = '',
  product = null,
  accountUsername = '',
  whatsappPhone = '',
  strategy = 'safe_dm_request' // 'safe_dm_request' (بدون روابط نهائياً - موصى به) | 'messenger_cta' | 'public_price'
} = {}) {
  // تنويع العبارات الترحيبية لمنع تشابه الكومنتات وتجنب حظر التكرار (Spintax Variations)
  const greetings = [
    customerName ? `أهلاً بحضرتك يا فندم (${customerName}) 🌸` : 'أهلاً بحضرتك يا فندم 🌸',
    customerName ? `يا هلا بيك يا فندم (${customerName}) ✨` : 'يا هلا بيك يا فندم ✨',
    customerName ? `مساء الورد يا فندم (${customerName}) 💐` : 'مساء الورد يا فندم 💐',
    customerName ? `تحت أمرك يا فندم (${customerName}) 🌷` : 'تحت أمرك يا فندم 🌷'
  ];
  const salutation = greetings[Math.floor(Math.random() * greetings.length)];

  const priceVal = product?.pricePiasters ? `${(product.pricePiasters / 100).toFixed(0)} جنيه` : 'سعر العرض المميز';

  // 1. استراتيجية الأمان الأقصى (بدون أي لينكات أو أرقام هواتف - فكرة المستخدم الذكية)
  if (strategy === 'safe_dm_request' || !accountUsername) {
    const variations = [
      `${salutation} السعر ${priceVal} والشحن متاح لجميع المحافظات والمعاينة قبل الاستلام مع المندوب. عشان نبعتلك باقي الصور والموديلات ونحجزلك، ابعتلنا رسالة خاصة على الحساب فيها الاسم والعنوان ورقم الموبايل وهنرد عليك فوراً!`,
      `${salutation} متاح بـ ${priceVal} فقط والمعاينة حقك قبل الاستلام. ابعتلنا رسالة خاصة على بروفايل الحساب فيها بياناتك (الاسم والعنوان ورقم التليفون) وهنأكد معاك الأوردر في نفس الدقيقة!`,
      `${salutation} متوفر حالياً بسعر ${priceVal} ومعاه ميزة المعاينة قبل الدفع. اضغط على صورة البروفايل وابعتلنا مسج بالاسم والعنوان ورقم الموبايل عشان نجهزلك الأوردر ونتواصل معاك فوراً!`
    ];
    return {
      commentReply: variations[Math.floor(Math.random() * variations.length)],
      hasLinks: false,
      hasPhone: false,
      reason: 'أعلى معدل أمان ضد الحظر: خالي تماماً من أي روابط أو أرقام، ويجعل العميل يبدأ المحادثة بنفسه من البروفايل لتفتح مباشرة في الـ Inbox الأساسي.'
    };
  }

  // 2. استراتيجية رابط الماسنجر (إذا طُلبت صراحة)
  const messengerUrl = accountUsername ? `https://m.me/${accountUsername}` : '';
  return {
    commentReply: `${salutation} متاح بسعر ${priceVal} والمعاينة قبل الاستلام. اضغط هنا وراسلنا على الماسنجر فوراً للموديلات والألوان: ${messengerUrl}`,
    hasLinks: true,
    hasPhone: false,
    reason: 'رابط مباشر لتحويل العميل إلى الماسنجر بنقرة واحدة.'
  };
}
