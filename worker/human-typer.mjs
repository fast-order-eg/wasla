export function calculateThinkingDelay(inboundText = '') {
  const words = inboundText.trim().split(/\s+/).filter(Boolean).length;
  const baseMs = 1800;
  const jitter = Math.min(2500, words * 120);
  return baseMs + Math.floor(Math.random() * 800) + jitter;
}

export function calculateTypingDelayPerChar() {
  return Math.floor(Math.random() * (130 - 55 + 1)) + 55;
}

export async function simulateHumanTyping(page, inputSelector, text, { signal } = {}) {
  await page.waitForSelector(inputSelector, { timeout: 10000 });
  await page.click(inputSelector);

  // 1. وقت التفكير والقراءة قبل البدء في الكتابة
  const thinkingMs = calculateThinkingDelay();
  await new Promise(r => setTimeout(r, thinkingMs));

  // 2. كتابة النص حرف بحرف لتفعيل مؤشر "يكتب الآن..." (Typing indicator)
  for (const char of text) {
    if (signal?.aborted) break;
    await page.keyboard.type(char, { delay: calculateTypingDelayPerChar() });

    // وقفة بشرية طبيعية بعد علامات الترقيم أو الفواصل
    if ([',', '،', '.', '!', '؟', '?', '\n'].includes(char)) {
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 350) + 150));
    }
  }

  // 3. تأخير قصير جداً قبل الضغط على Enter أو زر الإرسال
  await new Promise(r => setTimeout(r, Math.floor(Math.random() * 400) + 300));
}
