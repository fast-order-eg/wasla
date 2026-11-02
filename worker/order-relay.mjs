export async function forwardOrderToExternalApi(order, { apiUrl = process.env.EXTERNAL_ORDER_API_URL, apiKey = process.env.EXTERNAL_ORDER_API_KEY, headers = {} } = {}) {
  if (!apiUrl) {
    return {
      success: false,
      skipped: true,
      reason: 'لم يتم تعيين رابط EXTERNAL_ORDER_API_URL بعد. تم حفظ الأوردر محلياً داخل وصلة بنجاح.'
    };
  }

  const payload = {
    waslaOrderId: order.id,
    customerName: order.customerName || order.name || '',
    phone: order.phone || '',
    address: order.address || '',
    governorate: order.governorate || '',
    productName: order.productName || order.product?.name || '',
    productId: order.productId || '',
    quantity: order.quantity || 1,
    totalPiasters: order.totalPiasters || order.pricePiasters || 0,
    totalEgp: ((order.totalPiasters || order.pricePiasters || 0) / 100).toFixed(2),
    selectedVariant: order.variant || order.color || order.size || '',
    source: order.source || 'facebook_automation',
    createdAt: order.createdAt || new Date().toISOString()
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}`, 'x-api-key': apiKey } : {}),
        ...headers
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const responseText = await res.text();
    let responseData = null;
    try { responseData = JSON.parse(responseText); } catch { responseData = responseText; }

    if (!res.ok) {
      throw new Error(`External API returned HTTP ${res.status}: ${responseText.slice(0, 200)}`);
    }

    return {
      success: true,
      status: res.status,
      response: responseData,
      sentAt: new Date().toISOString()
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      failedAt: new Date().toISOString()
    };
  }
}
