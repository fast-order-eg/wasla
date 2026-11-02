export function buildCommentResponse({
  customerName = '',
  product = null,
  accountUsername = '',
  whatsappPhone = '',
  strategy = 'messenger_cta' // 'messenger_cta' | 'public_price' | 'whatsapp_cta'
} = {}) {
  const nameSalutation = customerName ? `أهلاً بحضرتك يا فندم (${customerName}) 🌸` : 'أهلاً بحضرتك يا فندم 🌸';
  const priceText = product?.pricePiasters ? `السعر ${(product.pricePiasters / 100).toFixed(0)} جنيه` : 'سعر العرض متاح';
  const messengerUrl = accountUsername ? `https://m.me/${accountUsername}` : '';
  const waUrl = whatsappPhone ? `https://wa.me/2${whatsappPhone.replace(/[^0-9]/g, '')}` : '';

  if (strategy === 'messenger_cta' && messengerUrl) {
    return {
      commentReply: `${nameSalutation} متاح المعاينة قبل الاستلام. اضغط هنا وراسلنا على الماسنجر فوراً للموديلات والألوان: ${messengerUrl}`,
      directMessageSafe: false,
      reason: 'توجيه العميل لبدء الشات بنفسه لتخطي مجلد طلبات المراسلة (Message Requests) وتجنب الحظر بنسبة 100%.'
    };
  }

  if (strategy === 'whatsapp_cta' && waUrl) {
    return {
      commentReply: `${nameSalutation} التفاصيل والعروض متاحة، تقدر تكلمنا واتساب فوراً للطلب والحجز: ${waUrl}`,
      directMessageSafe: false,
      reason: 'تحويل العميل لشات واتساب مباشر لإتمام الأوردر فورياً.'
    };
  }

  // استراتيجية الرد بالبيانات الأساسية وتأكيد المعاينة
  return {
    commentReply: `${nameSalutation} ${priceText} والشحن متاح لجميع المحافظات والمعاينة قبل الاستلام. ابعتلنا رسالة خاصة على ماسنجر الحساب وهنرد عليك فوراً بالألوان والمقاسات!`,
    directMessageSafe: false,
    reason: 'رد بيعي جذاب يطلب من العميل إرسال رسالة لتكون المحادثة بمبادرة منه (User-Initiated).'
  };
}
