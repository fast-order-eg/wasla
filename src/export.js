function cell(value) {
  let text = String(value ?? '');
  // Quoting alone does not prevent spreadsheet formulas from executing.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function ordersCsv(orders) {
  const columns = ['رقم الطلب', 'تاريخ الإنشاء', 'الحالة', 'المنتج', 'الكمية', 'سعر القطعة بالجنيه', 'الشحن بالجنيه', 'الإجمالي بالجنيه', 'الاسم', 'التليفون', 'المحافظة', 'العنوان', 'اللون', 'المقاس'];
  const rows = orders.map(order => [order.id, order.createdAt, order.status, order.productName || order.productId, order.quantity, (order.unitPricePiasters / 100).toFixed(2), (order.shippingPiasters / 100).toFixed(2), (order.totalPiasters / 100).toFixed(2), order.customer?.name, order.customer?.phone, order.customer?.governorate, order.customer?.address, order.customer?.color, order.customer?.size]);
  return '\uFEFF' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
