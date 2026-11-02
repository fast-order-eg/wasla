const app = document.querySelector('#app');
const money = value => {
  const num = (Number(value) || 0) / 100;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(num) + ' ج.م';
};
const number = value => new Intl.NumberFormat('en-US').format(Number(value) || 0);
const date = value => {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  const dp = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
  const tp = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d);
  return `${dp} · ${tp}`;
};
const topbarDate = () => {
  const d = new Date();
  const dayName = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', timeZone: 'Africa/Cairo' }).format(d);
  const dp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const tp = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return `${dayName}، ${dp} · ${tp}`;
};
const state = { authenticated: false, demoMode: false, page: 'overview', health: {}, products: [], channels: [], conversations: [], orders: [], tasks: [], workers: [], groups: [], crmSettings: {}, selectedConversation: null };
const pages = { overview: ['نظرة عامة', '◈'], products: ['المنتجات', '▧'], conversations: ['المحادثات', '☷'], orders: ['الأوردرات', '▤'], publishing: ['تجهيز النشر', '↗'], automation: ['أتمتة وحسابات فيسبوك', '⚡'], connections: ['القنوات والتشغيل', '⌘'] };
const labels = { draft: 'مسودة', awaiting_confirmation: 'مستني تأكيد العميل', confirmed: 'مؤكد', preparing: 'قيد التجهيز', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي', returned: 'مرتجع', bot_active: 'مساعد الردود متاح', human_takeover: 'متابعة بشرية', closed: 'مغلقة', ready: 'جاهز للنشر', published: 'نشر مسجل يدويًا', pending_approval: 'مستني موافقة الجروب', rejected: 'مرفوض', needs_attention: 'محتاج تدخل', manual: 'متابعة يدوية', unconfigured: 'غير مربوط', connected: 'استقبال إشعارات متحقق', online: 'متصل', offline: 'غير متصل', degraded: 'اتصال غير مستقر', warming: 'تحت التدفئة والتنشيط', cooldown: 'فترة تبريد', checkpoint: 'محتاج فحص', auto: 'تلقائي', admin_review: 'موافقة أدمن', active: 'نشط ومتاح' };
let requestVersion = 0;
let toastTimer;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (key === 'value') node.value = value ?? '';
    else if (key === 'disabled') node.disabled = Boolean(value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(text, action, kind = '', attrs = {}) { return el('button', { type: 'button', class: `btn ${kind}`, onclick: action, ...attrs }, text); }
function badge(status) { const color = ['confirmed', 'delivered', 'connected', 'online', 'ready'].includes(status) ? 'good' : ['awaiting_confirmation', 'human_takeover', 'pending_approval', 'needs_attention', 'unconfigured', 'degraded'].includes(status) ? 'warn' : ['cancelled', 'rejected', 'offline'].includes(status) ? 'bad' : ['shipped', 'preparing'].includes(status) ? 'blue' : ''; return el('span', { class: `badge ${color}` }, labels[status] || status || 'غير محدد'); }
function toast(message) { const node = document.querySelector('#toast'); clearTimeout(toastTimer); node.textContent = message; node.classList.add('visible'); toastTimer = setTimeout(() => node.classList.remove('visible'), 4500); }
function errorBox(error) { return el('div', { class: 'error-box', role: 'alert' }, error?.message || String(error)); }
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, body: options.body == null ? undefined : JSON.stringify(options.body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) { state.authenticated = false; renderLogin(); }
    throw new Error(data.error || `تعذّر تنفيذ الطلب (${response.status}). جرّب تاني.`);
  }
  return data;
}
function heading(title, subtitle, action) { return el('div', { class: 'page-heading' }, el('div', {}, el('p', { class: 'eyebrow' }, 'مساحة شغلك، بشكل أوضح'), el('h1', {}, title), el('p', {}, subtitle)), action); }
function panel(title, subtitle, content, action) { return el('section', { class: 'panel' }, el('div', { class: 'panel-head' }, el('div', {}, el('h2', {}, title), subtitle ? el('p', {}, subtitle) : null), action), content); }
function empty(title, text, action) { return el('div', { class: 'empty' }, el('div', { class: 'empty-icon', 'aria-hidden': true }, '◌'), el('strong', {}, title), el('div', {}, text), action ? el('div', { class: 'space-top' }, action) : null); }
function table(headers, rows) { return el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, headers.map(t => el('th', { scope: 'col' }, t)))), el('tbody', {}, rows.map(row => el('tr', {}, row.map(cell => el('td', {}, cell))))))); }
function field(label, name, value = '', options = {}) {
  const { type = 'text', full = false, hint, required = false, ...rest } = options;
  const id = `field-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const input = type === 'textarea' ? el('textarea', { id, name, required, ...rest }, value) : el('input', { id, name, type, value, required, ...rest });
  return el('div', { class: `field ${full ? 'full' : ''}` }, el('label', { for: id }, label, required ? ' *' : ''), input, hint ? el('small', {}, hint) : null);
}
function selectField(label, name, values, value, { full = false, required = false, hint } = {}) {
  const id = `field-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const select = el('select', { id, name, required }, values.map(item => el('option', { value: item.value }, item.label)));
  select.value = value ?? '';
  return el('div', { class: `field ${full ? 'full' : ''}` }, el('label', { for: id }, label, required ? ' *' : ''), select, hint ? el('small', {}, hint) : null);
}
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'فشل رفع الملف من جهازك');
  return data;
}
function fileUploadField(label, inputName, initialUrl, hint) {
  const container = el('div', { class: 'field full upload-field' });
  const hiddenInput = el('input', { type: 'hidden', name: inputName, value: initialUrl || '' });
  const preview = el('div', { class: 'upload-preview' });
  const status = el('span', { class: 'subtle' });
  const updatePreview = url => {
    hiddenInput.value = url || '';
    if (url) {
      if (/\.(mp4|mov|webm)$/i.test(url)) {
        preview.replaceChildren(el('video', { src: url, controls: true, class: 'preview-media' }));
      } else if (/\.pdf$/i.test(url)) {
        preview.replaceChildren(el('a', { href: url, target: '_blank', class: 'materials-link' }, '📄 مستند PDF مرفوع'));
      } else {
        preview.replaceChildren(el('img', { src: url, class: 'preview-media', alt: 'معاينة' }));
      }
      preview.append(button('حذف', () => updatePreview(''), 'small danger'));
    } else {
      preview.replaceChildren(el('span', { class: 'muted' }, 'لم يتم رفع ملف'));
    }
  };
  updatePreview(initialUrl);

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*,video/*,application/pdf',
    style: 'display:none',
    onchange: async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      status.textContent = 'جاري الرفع…';
      try {
        const res = await uploadFile(file);
        updatePreview(res.url);
        status.textContent = 'تم الرفع بنجاح ✓';
        toast('اترفع الملف بنجاح على السيرفر');
      } catch (err) {
        status.textContent = '';
        toast(err.message);
      }
    }
  });

  const uploadBtn = button('📁 اختر ملف من جهازك', () => fileInput.click(), 'small');
  const urlToggle = button('أو رابط خارجي', () => {
    const entered = window.prompt('أدخل رابط الملف أو الصورة (URL):', hiddenInput.value);
    if (entered !== null) updatePreview(entered.trim());
  }, 'small ghost');

  container.append(
    el('label', {}, label),
    el('div', { class: 'upload-controls' }, fileInput, uploadBtn, urlToggle, status),
    preview,
    hiddenInput,
    hint ? el('small', {}, hint) : null
  );
  return container;
}

async function uploadFiles(files) {
  const formData = new FormData();
  for (const file of files) formData.append('files', file);
  const response = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'فشل رفع الملفات من جهازك');
  return data;
}

function mediaVersionsField(product) {
  let versions = Array.isArray(product?.mediaVersions) && product.mediaVersions.length
    ? JSON.parse(JSON.stringify(product.mediaVersions))
    : [
        {
          id: 'v1',
          name: 'إصدار 1 (الأساسي)',
          files: [
            ...(product?.imageUrl ? [{ url: product.imageUrl, type: 'image', name: 'صورة المنتج الأساسية' }] : []),
            ...(product?.materialsUrl && product.materialsUrl !== product?.imageUrl ? [{ url: product.materialsUrl, type: /\.(mp4|mov|webm)$/i.test(product.materialsUrl) ? 'video' : 'file', name: 'رابط الماتريال' }] : [])
          ]
        }
      ];

  let activeIndex = 0;
  let primaryImage = product?.imageUrl || versions[0]?.files?.find(f => f.type === 'image')?.url || '';

  const container = el('div', { class: 'field full media-versions-field' });
  const hiddenVersions = el('input', { type: 'hidden', name: 'mediaVersions' });
  const hiddenImage = el('input', { type: 'hidden', name: 'imageUrl' });
  const hiddenMaterials = el('input', { type: 'hidden', name: 'materialsUrl' });

  const sync = () => {
    if (!primaryImage) {
      primaryImage = versions.flatMap(v => v.files || []).find(f => f.type === 'image')?.url || '';
    }
    hiddenVersions.value = JSON.stringify(versions);
    hiddenImage.value = primaryImage || '';
    hiddenMaterials.value = versions[0]?.files?.[0]?.url || product?.materialsUrl || '';
  };

  const tabsHolder = el('div', { class: 'version-tabs' });
  const contentHolder = el('div', { class: 'version-pane' });

  const draw = () => {
    sync();
    if (activeIndex >= versions.length) activeIndex = Math.max(0, versions.length - 1);
    const activeVersion = versions[activeIndex] || versions[0];

    tabsHolder.replaceChildren(
      ...versions.map((v, idx) => el('button', {
        type: 'button',
        class: `version-tab ${idx === activeIndex ? 'active' : ''}`,
        onclick: () => { activeIndex = idx; draw(); }
      }, v.name || `إصدار ${idx + 1}`, el('span', { class: 'file-count' }, `${v.files?.length || 0}`))),
      button('+ إضافة إصدار جديد (فيرجن)', () => {
        versions.push({
          id: `v${Date.now()}`,
          name: `إصدار ${versions.length + 1}`,
          files: []
        });
        activeIndex = versions.length - 1;
        draw();
      }, 'small ghost')
    );

    const nameInput = el('input', {
      type: 'text',
      value: activeVersion.name,
      placeholder: 'اسم هذا الإصدار (مثال: فيرجن 1 - صور الألوان بالأكواد)',
      oninput: e => { activeVersion.name = e.target.value.trim() || `إصدار ${activeIndex + 1}`; sync(); }
    });

    const uploadStatus = el('span', { class: 'subtle' });
    const fileInput = el('input', {
      type: 'file',
      multiple: true,
      accept: 'image/*,video/*,application/pdf',
      style: 'display:none',
      onchange: async event => {
        const fileList = Array.from(event.target.files || []);
        if (!fileList.length) return;
        uploadStatus.textContent = `جاري رفع ${fileList.length} ملف…`;
        try {
          const res = await uploadFiles(fileList);
          const uploaded = res.files || (res.url ? [{ url: res.url, originalName: fileList[0].name, type: res.type || 'image' }] : []);
          activeVersion.files = [...(activeVersion.files || []), ...uploaded.map(f => ({
            url: f.url,
            type: f.type || (/\.(mp4|mov|webm)$/i.test(f.url) ? 'video' : 'image'),
            name: f.originalName || f.name || 'ملف مرفوع'
          }))];
          if (!primaryImage && uploaded.find(f => f.type === 'image')) {
            primaryImage = uploaded.find(f => f.type === 'image').url;
          }
          uploadStatus.textContent = 'تم الرفع بنجاح ✓';
          toast(`اترفع ${uploaded.length} ملف بنجاح في ${activeVersion.name}`);
          draw();
        } catch (err) {
          uploadStatus.textContent = '';
          toast(err.message);
        }
      }
    });

    const addFilesBtn = button('📁 ارفع صور أو فيديوهات من جهازك (متعدد)', () => fileInput.click(), 'primary small');
    const addUrlBtn = button('🔗 إضافة رابط خارجي (درايف/يوتيوب)', () => {
      const url = window.prompt('أدخل رابط الماتريال الخارجي:');
      if (!url) return;
      const name = window.prompt('اسم أو عنوان الرابط:', 'مجلد درايف خارجي') || 'رابط خارجي';
      activeVersion.files = [...(activeVersion.files || []), {
        url: url.trim(),
        type: /\.(mp4|mov|webm)$/i.test(url) ? 'video' : (/\.(jpg|png|webp|gif)$/i.test(url) ? 'image' : 'file'),
        name: name.trim()
      }];
      draw();
    }, 'small ghost');

    const deleteVersionBtn = versions.length > 1
      ? button('حذف هذا الإصدار', () => {
          if (!window.confirm(`هل تريد حذف "${activeVersion.name}"؟`)) return;
          versions.splice(activeIndex, 1);
          activeIndex = Math.max(0, activeIndex - 1);
          draw();
        }, 'small danger')
      : null;

    const grid = el('div', { class: 'media-grid' });
    if (!activeVersion.files?.length) {
      grid.replaceChildren(el('div', { class: 'empty-media' }, 'لسه مفيش صور أو فيديوهات في هذا الإصدار. اضغط على «ارفع صور أو فيديوهات» للاختيار من جهازك (تقدر تختار أكتر من صورة وأكتر من فيديو مع بعض).'));
    } else {
      activeVersion.files.forEach((f, fIdx) => {
        const isPrimary = f.url === primaryImage;
        const card = el('div', { class: `media-card ${isPrimary ? 'is-primary' : ''}` });
        if (isPrimary) card.append(el('span', { class: 'primary-badge' }, 'الصورة الأساسية ⭐'));

        if (f.type === 'video' || /\.(mp4|mov|webm)$/i.test(f.url)) {
          card.append(el('video', { src: f.url, controls: true, class: 'media-card-preview' }));
        } else if (f.type === 'image' || /\.(jpg|jpeg|png|webp|gif)$/i.test(f.url)) {
          card.append(el('img', { src: f.url, alt: f.name || 'صورة', class: 'media-card-preview' }));
        } else {
          card.append(el('div', { class: 'media-card-doc' }, el('span', {}, '📄'), el('a', { href: f.url, target: '_blank', class: 'cell-sub' }, f.name || 'ملف خارجي')));
        }

        const actions = el('div', { class: 'media-card-actions' });
        if (f.type === 'image' || /\.(jpg|jpeg|png|webp|gif)$/i.test(f.url)) {
          if (!isPrimary) {
            actions.append(button('تعيين أساسية', () => { primaryImage = f.url; draw(); }, 'small ghost'));
          }
        }
        actions.append(button('✕', () => {
          activeVersion.files.splice(fIdx, 1);
          if (primaryImage === f.url) primaryImage = '';
          draw();
        }, 'small danger', { 'aria-label': 'حذف الملف' }));

        card.append(
          el('div', { class: 'media-card-body' },
            el('span', { class: 'media-card-title', title: f.name || f.url }, f.name || 'ملف'),
            actions
          )
        );
        grid.append(card);
      });
    }

    contentHolder.replaceChildren(
      el('div', { class: 'version-meta' },
        el('label', {}, 'اسم الإصدار:'),
        nameInput,
        deleteVersionBtn
      ),
      el('div', { class: 'media-controls' },
        addFilesBtn,
        addUrlBtn,
        uploadStatus,
        fileInput
      ),
      grid
    );
  };

  draw();

  container.append(
    el('div', { class: 'media-versions-head' },
      el('div', { class: 'media-versions-title' }, 'ماتريال الصور والفيديوهات (إصدارات متعددة / Versions)'),
      el('small', { class: 'media-versions-hint' }, 'ارفع أكتر من صورة وأكتر من فيديو لكل إصدار. تقدر تقسم الماتريال لفيرجن 1، فيرجن 2... لتنويع النشر والمحتوى.')
    ),
    tabsHolder,
    contentHolder,
    hiddenVersions,
    hiddenImage,
    hiddenMaterials
  );

  return container;
}
function productOptions(placeholder = true) { return [...(placeholder ? [{ value: '', label: 'اختار المنتج' }] : []), ...state.products.map(p => ({ value: p.id, label: `${p.name} — ${money(p.pricePiasters)}${p.material ? ` (${p.material})` : ''}` }))]; }
function productName(id) { return state.products.find(p => p.id === id)?.name || 'منتج غير متاح'; }
function channelName(id) { return state.channels.find(p => p.id === id)?.name || 'قناة غير متاحة'; }
function dialog(title, build, submit, submitLabel = 'حفظ') {
  const dlg = el('dialog', { 'aria-label': title });
  const errors = el('div');
  const form = el('form');
  const close = () => dlg.close();
  const content = build(form);
  const save = el('button', { type: 'submit', class: 'btn primary' }, submitLabel);
  form.append(content, errors, el('div', { class: 'form-actions' }, button('إلغاء', close, 'ghost'), save));
  form.addEventListener('submit', async event => {
    event.preventDefault(); errors.replaceChildren(); save.disabled = true;
    try { await submit(new FormData(form), form, dlg); if (dlg.open) dlg.close(); } catch (error) { errors.append(errorBox(error)); } finally { save.disabled = false; }
  });
  dlg.append(el('div', { class: 'dialog-head' }, el('h2', {}, title), button('×', close, 'small', { 'aria-label': 'إغلاق' })), el('div', { class: 'dialog-body' }, form));
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  document.body.append(dlg); dlg.showModal();
  return dlg;
}
async function mutate(path, method, body, message) { await api(path, { method, body }); toast(message); await refresh(); }

function renderLogin(error) {
  const features = [
    { icon: '🤖', title: 'مساعد ذكي بـ Vertex AI', desc: 'صياغة ردود ذكية باللهجة المصرية واستخراج تلقائي لبيانات العنوان والمقاس وكود الصورة.' },
    { icon: '📦', title: 'ماتريال المنتجات وإصداراته', desc: 'تنظيم الفيديوهات والصور بعدة إصدارات (Versions) لتنويع محتوى النشر على الماركت بليس.' },
    { icon: '✓', title: 'إدارة وتأكيد الأوردرات', desc: 'تسجيل موافقة العميل الصريحة، متابعة حالات الشحن، وتصدير التقارير بضغطة زر.' }
  ];
  app.replaceChildren(
    el('div', { class: 'login-page' },
      el('main', { class: 'login-form-side', id: 'main' }, loginForm(error)),
      el('section', { class: 'login-story' },
        el('div', { class: 'story-brand' },
          el('img', { src: '/logo-mark.svg', alt: 'وصلة', class: 'story-logo' }),
          el('div', {},
            el('div', { class: 'story-brand-name' }, 'وصلة'),
            el('span', { class: 'story-brand-badge' }, 'WASLA COMMERCE')
          )
        ),
        el('h1', { class: 'story-headline' }, 'من أول رسالة عميل،', el('br'), 'لحد تسليم الأوردر.'),
        el('p', { class: 'story-desc' }, 'المنصة المتكاملة لإدارة مبيعات السوشيال ميديا، صفحات فيسبوك، جروبات التسويق، والماركت بليس بدون تعقيد.'),
        el('div', { class: 'story-features' },
          features.map(f => el('div', { class: 'story-feature-card' },
            el('span', { class: 'story-feature-icon' }, f.icon),
            el('div', {},
              el('strong', {}, f.title),
              el('p', {}, f.desc)
            )
          ))
        ),
        el('div', { class: 'story-badges' },
          el('span', { class: 'trust-pill' }, '🔒 مساحة مؤمنة محلياً'),
          el('span', { class: 'trust-pill' }, '⚡ بدون اشتراكات عزل متصفح'),
          el('span', { class: 'trust-pill' }, '🇪🇬 مخصص لعمليات التجارة في مصر')
        )
      )
    )
  );
}
function loginForm(error) {
  const errors = el('div', {}, error ? errorBox(error) : null);
  const passwordInput = el('input', { type: 'password', name: 'password', id: 'login-password', placeholder: 'أدخل كلمة مرور الإدارة…', required: true, autocomplete: 'current-password' });
  const eyeSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeSlashSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';
  let passwordVisible = false;
  const toggleEye = el('button', {
    type: 'button',
    class: 'btn-toggle-password',
    'aria-label': 'إظهار كلمة المرور',
    title: 'إظهار / إخفاء كلمة المرور',
    tabindex: '-1',
    onclick: () => {
      passwordVisible = !passwordVisible;
      passwordInput.type = passwordVisible ? 'text' : 'password';
      toggleEye.setAttribute('aria-label', passwordVisible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      toggleEye.innerHTML = passwordVisible ? eyeSlashSvg : eyeSvg;
      passwordInput.focus();
    }
  });
  toggleEye.innerHTML = eyeSvg;

  const submit = el('button', { class: 'btn primary login-submit-btn', type: 'submit' }, 'تسجيل الدخول إلى مساحة العمل ←');

  const doLogin = async pwd => {
    submit.disabled = true;
    errors.replaceChildren();
    try {
      await api('/auth/login', { method: 'POST', body: { password: pwd } });
      await boot();
    } catch (err) {
      errors.append(errorBox(err));
    } finally {
      submit.disabled = false;
    }
  };

  const form = el('form', {
    class: 'login-form-inner',
    onsubmit: async event => {
      event.preventDefault();
      await doLogin(passwordInput.value);
    }
  },
    el('div', { class: 'field full' },
      el('label', { for: 'login-password' }, 'كلمة مرور لوحة التحكم *'),
      el('div', { class: 'password-input-wrap' },
        passwordInput,
        toggleEye
      )
    ),
    errors,
    submit
  );

  const demoCard = state.demoMode ? el('div', { class: 'login-demo-card' },
    el('div', { class: 'demo-card-head' },
      el('span', { class: 'connection-dot' }),
      el('strong', {}, 'بيئة تجريبية محلية (Demo)')
    ),
    el('p', {}, 'كلمة المرور الافتراضية: ', el('code', {}, 'demo-only')),
    button('⚡ دخول سريع للتجربة (بنقرة واحدة)', async () => {
      passwordInput.value = 'demo-only';
      await doLogin('demo-only');
    }, 'btn small ghost demo-quick-btn')
  ) : null;

  return el('div', { class: 'login-card' },
    el('div', { class: 'login-brand-header' },
      el('img', { src: '/logo-mark.svg', alt: 'وصلة', class: 'login-logo-img' }),
      el('div', {},
        el('h2', { class: 'login-brand-title' }, 'وصلة'),
        el('span', { class: 'login-brand-sub' }, 'WASLA · إدارة البيع والمحادثات')
      )
    ),
    el('div', { class: 'login-card-intro' },
      el('p', { class: 'eyebrow' }, 'مرحباً بك مجدداً'),
      el('h3', { class: 'login-welcome' }, 'تسجيل الدخول للوحة التحكم'),
      el('p', { class: 'login-sub' }, 'أدِر محادثات العملاء، المنتجات، والأوردرات من شاشة واحدة منظمة.')
    ),
    form,
    demoCard,
    el('div', { class: 'login-footer' }, 'وصلة · منصة التجارة والمحادثات الذكية')
  );
}
function shell() {
  const nav = el('nav', { class: 'nav', 'aria-label': 'القائمة الرئيسية' }, Object.entries(pages).map(([id, [name, icon]]) => el('a', { href: `#${id}`, class: state.page === id ? 'active' : '', 'aria-current': state.page === id ? 'page' : null }, el('span', { class: 'nav-icon', 'aria-hidden': true }, icon), name)));
  app.replaceChildren(el('div', { class: 'layout' }, el('aside', { class: 'sidebar' }, el('div', { class: 'brand' }, el('img', { src: '/logo-mark.svg', alt: 'وصلة', class: 'brand-logo-img' }), el('div', {}, el('div', { class: 'brand-name' }, 'وصلة'), el('small', {}, 'إدارة البيع والمحادثات · WASLA'))), el('div', { class: 'nav-label' }, 'مساحة العمل'), nav, el('div', { class: 'sidebar-note' }, el('strong', {}, el('span', { class: 'connection-dot' }), 'أنت المتحكم في كل خطوة'), 'الردود مسودات للمراجعة. النشر وتأكيد موافقة العميل بإجراء واضح منك.')), el('div', { class: 'workspace' }, el('header', { class: 'topbar' }, el('div', { class: 'breadcrumb' }, 'مساحة العمل /', el('strong', {}, pages[state.page][0])), el('div', { class: 'topbar-actions' }, el('span', { class: 'date' }, topbarDate()), button('تحديث', () => refresh(), 'small ghost'), button('خروج', async () => { try { await api('/auth/logout', { method: 'POST' }); await boot(); } catch (error) { toast(error.message); } }, 'small ghost'), el('div', { class: 'avatar', 'aria-label': 'حساب الإدارة' }, 'م'))), state.demoMode ? el('div', { class: 'demo-banner' }, el('strong', {}, '◉ وضع التجربة'), el('span', {}, 'بيانات محلية للتجربة. مفيش إرسال تلقائي للعملاء أو نشر على فيسبوك.')) : el('div', { class: 'demo-banner' }, el('strong', {}, '◉ وضع المراجعة'), el('span', {}, 'الردود المقترحة لا تُرسل تلقائيًا. حالة كل قناة موضّحة في القنوات والتشغيل.')), el('main', { class: 'main', id: 'main', tabindex: '-1' }))));
}
async function refresh() {
  if (!state.authenticated) return;
  const version = ++requestVersion;
  const main = document.querySelector('#main');
  main.replaceChildren(el('div', { class: 'loading' }, 'بنحدّث بياناتك…', el('div', { class: 'skeleton' })));
  try {
    const paths = ['/products', '/channels', '/conversations', '/orders', '/publishing-tasks', '/workers', '/health', '/groups', '/settings/crm'];
    const values = await Promise.all(paths.map(path => api(path).catch(() => [])));
    if (version !== requestVersion || !state.authenticated) return;
    [state.products, state.channels, state.conversations, state.orders, state.tasks, state.workers, state.health, state.groups, state.crmSettings] = values;
    if (state.page === 'overview') await renderOverview(main, version);
    else if (state.page === 'products') renderProducts(main);
    else if (state.page === 'conversations') await renderConversations(main, version);
    else if (state.page === 'orders') renderOrders(main);
    else if (state.page === 'publishing') renderPublishing(main);
    else if (state.page === 'automation') await renderAutomation(main, version);
    else await renderConnections(main, version);
  } catch (error) { if (version === requestVersion && state.authenticated) main.replaceChildren(errorBox(error), button('حاول تاني', refresh)); }
}
async function renderOverview(main, version) {
  const summary = await api('/summary'); if (version !== requestVersion) return;
  const metrics = [ ['محادثات مفتوحة', summary.openConversations, 'محادثات محتاجة متابعة', '☷'], ['طلبات محتاجة تأكيد', summary.pendingOrders, 'التأكيد بعد موافقة العميل فقط', '▤'], ['طلبات مؤكدة', summary.confirmedOrders, 'متابعة التنفيذ من شاشة الأوردرات', '✓'], ['مبيعات تم تسليمها', money(summary.revenuePiasters), `${number(summary.deliveredOrders)} أوردر تم تسليمه`, '↗'] ];
  main.replaceChildren(heading('شغلك كله قدامك', 'تابع اللي محتاج اهتمامك، وخد الخطوة الجاية من هنا.', button('+ إضافة منتج', () => productDialog(), 'primary')), el('div', { class: 'cards' }, metrics.map(([title, value, note, icon]) => el('section', { class: 'stat' }, el('div', { class: 'stat-top' }, title, el('span', { class: 'stat-icon', 'aria-hidden': true }, icon)), el('div', { class: 'stat-value' }, typeof value === 'number' ? number(value) : value), el('div', { class: 'stat-note' }, note)))), el('div', { class: 'dashboard-grid' }, el('div', {}, panel('آخر الأوردرات', 'من جمع البيانات لحد التسليم', state.orders.length ? orderTable(state.orders.slice().reverse().slice(0, 5)) : empty('لسه مفيش أوردرات', 'ابدأ محادثة وسجّل أول طلب بعد مراجعة بيانات العميل.'), el('a', { class: 'btn small ghost', href: '#orders' }, 'كل الأوردرات ←')), panel('جاهز للخطوة الجاية', 'جهّز المحتوى وسجّل نتيجة النشر بنفسك', state.tasks.length ? taskTable(state.tasks.slice().reverse().slice(0, 3)) : empty('قائمة النشر فاضية', 'اختار منتج وجهّزله محتوى مناسب للمكان اللي هتنشر فيه.', button('تجهيز منشور', () => publishingDialog(), 'small')))), el('div', {}, panel('من رسالة لأوردر', '', el('div', { class: 'panel-body' }, [['1', 'ضيف المنتج ومعلوماته', 'السعر والمخزون وحقول العميل المطلوبة.'], ['2', 'راجع الرد المقترح', 'المساعد يجهّز الرد، وأنت تراجعه وتنسخه.'], ['3', 'أكد الطلب بوضوح', 'راجع الإجمالي وسجّل موافقة العميل قبل التجهيز.']].map(([n, title, text]) => el('div', { class: 'step' }, el('span', { class: 'step-num' }, n), el('div', {}, el('strong', {}, title), el('p', {}, text)))))), panel('حالة مساحة العمل', '', el('div', { class: 'panel-body' }, integrationRow('القنوات المضافة', `${number(state.channels.length)} قناة`, 'كل قناة لها طريقة متابعة مستقلة'), integrationRow('المساعد', ['gemini', 'vertex'].includes(state.health.integrations?.ai) ? 'Vertex AI مهيّأ' : 'قواعد محلية', 'كل الردود مسودات للمراجعة'), integrationRow('النشر', 'تجهيز يدوي', 'لا يوجد ناشر تلقائي متصل')), el('a', { href: '#connections', class: 'btn small ghost' }, 'التفاصيل')))), el('p', { class: 'footer-note' }, 'الأرقام من البيانات المسجّلة هنا فقط. قيمة المبيعات المُسلَّمة تشمل إجمالي الطلبات، ومش صافي الربح.'));
}
function integrationRow(title, value, note) { return el('div', { class: 'integration-row' }, el('div', {}, title, el('small', {}, note)), el('span', { class: 'badge' }, value)); }
function renderProducts(main) {
  const holder = el('div');
  const draw = query => {
    const products = state.products.filter(p => `${p.name} ${p.description || ''} ${p.material || ''}`.toLowerCase().includes(query.toLowerCase()));
    holder.replaceChildren(products.length ? panel('كتالوج المنتجات', `${number(products.length)} منتج`, table(['المنتج', 'السعر', 'المخزون', 'الحالة', ''], products.map(p => [
      el('div', { class: 'item-cell' },
        p.imageUrl ? el('img', { class: 'product-thumb-img', src: p.imageUrl, alt: p.name, onerror: e => { e.target.style.display = 'none'; } }) : el('div', { class: 'product-thumb', 'aria-hidden': true }, '▧'),
        el('div', {},
          el('strong', {}, p.name),
          p.variants?.length ? el('span', { class: 'cell-sub' }, p.variants.join(' · ')) : (p.description ? el('span', { class: 'cell-sub' }, p.description) : null),
          p.materialsUrl ? el('a', { class: 'materials-link', href: p.materialsUrl, target: '_blank', rel: 'noopener' }, '📁 ماتريال الصور والفيديو') : null
        )
      ),
      money(p.pricePiasters),
      (p.stock && p.stock < 999999) ? `${number(p.stock)} قطعة` : el('span', { class: 'muted-note' }, 'غير محدود'),
      el('span', { class: `badge ${p.active !== false ? 'good' : ''}` }, p.active !== false ? 'متاح' : 'متوقف'),
      el('div', { class: 'button-row' },
        button('تعديل', () => productDialog(p), 'small'),
        button('حذف', async () => {
          if (!window.confirm(`هل تريد حذف المنتج "${p.name}" نهائياً من المتجر؟`)) return;
          try {
            await api(`/products/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
            toast('تم حذف المنتج بنجاح');
            await refresh();
          } catch (err) {
            toast(err.message);
          }
        }, 'small danger')
      )
    ]))) : empty('مفيش منتجات بالوصف ده', query ? 'جرّب كلمة بحث مختلفة.' : 'ضيف أول منتج بسعره ومخزونه وخامته.', button('إضافة منتج', () => productDialog(), 'primary')));
  };
  const search = el('input', { type: 'search', placeholder: 'ابحث باسم المنتج أو الوصف أو الخامة…', 'aria-label': 'البحث في المنتجات', oninput: event => draw(event.target.value) });
  main.replaceChildren(heading('منتجاتك', 'بيانات واضحة عشان الرد والسعر والخامة والأوردر يبقوا صح.', button('+ إضافة منتج', () => productDialog(), 'primary')), el('div', { class: 'toolbar' }, search), holder);
  draw('');
}
const standardFields = [
  { id: 'name', label: 'الاسم' },
  { id: 'phone', label: 'رقم الموبايل' },
  { id: 'governorate', label: 'المحافظة' },
  { id: 'address', label: 'العنوان بالتفصيل' },
  { id: 'variant', label: 'المتغير (كود الموديل / العرض / الصورة)' },
  { id: 'color', label: 'اللون' },
  { id: 'size', label: 'المقاس' }
];
function productDialog(product) {
  const currentRequired = new Set(product?.requiredFields || ['name', 'phone', 'governorate', 'address']);
  dialog(product ? 'تعديل المنتج' : 'إضافة منتج جديد', () => el('div', { class: 'form-grid' },
    field('اسم المنتج', 'name', product?.name, { required: true, full: true, maxlength: 180, placeholder: 'مثال: طاقيه كابيشوه 3 في 1' }),
    field('الخامة / الماتريال', 'material', product?.material, { full: true, placeholder: 'مثال: شيفون خفيف مع دنتيل شيك ناعم', hint: 'الخامة بتساعد المساعد الذكي يرد على أسئلة العملاء وتتكتب في مواصفات النشر.' }),
    field('السعر بالجنيه', 'price', product ? (product.pricePiasters / 100) : '', { type: 'number', min: 0, step: '.01', required: true, placeholder: '350.00' }),
    field('المخزون المتوفر (اختياري)', 'stock', (product?.stock && product.stock < 999999) ? product.stock : '', { type: 'number', min: 0, step: 1, required: false, placeholder: 'اتركه فارغاً لمخزون مفتوح غير محدود' }),
    mediaVersionsField(product),
    field('وصف المنتج وتفاصيل البيع', 'description', product?.description, { type: 'textarea', full: true, placeholder: 'اكتب مواصفات المنتج، وطريقة اللبس، ومميزات القطعة...' }),
    field('تعليمات الذكاء الاصطناعي', 'botInstructions', product?.botInstructions, { type: 'textarea', full: true, placeholder: 'اكتب هنا تعليماتك للبوت عن تفاصيل المنتج، أكواد الصور، العروض، كيفية الرد على المقاسات والألوان...' }),
    field('الاختيارات المتاحة (ألوان ومقاسات أو أكواد)', 'variants', (product?.variants || []).join('، '), { full: true, hint: 'اكتب الاختيارات مفصولة بفاصلة، مثال: كود 15، كود 16، أو أسود، أبيض، M، L' }),
    el('div', { class: 'field full' },
      el('label', {}, 'البيانات المطلوبة من العميل عند الطلب'),
      el('div', { class: 'checkbox-group' }, standardFields.map(f => el('label', { class: 'chip-checkbox' }, el('input', { type: 'checkbox', name: 'req_field', value: f.id, checked: currentRequired.has(f.id) }), f.label))),
      el('small', {}, 'علم على البيانات اللي محتاجها عشان تأكد الأوردر (الاسم، الموبايل، المتغير لكود الصورة أو العرض، إلخ).')
    ),
    el('label', { class: 'check-label field full' }, el('input', { type: 'checkbox', name: 'active', checked: product?.active !== false }), 'المنتج متاح للبيع حالياً')
  ), async data => {
    const selectedFields = data.getAll('req_field').map(String);
    if (!selectedFields.includes('name')) selectedFields.unshift('name');
    if (!selectedFields.includes('phone')) selectedFields.push('phone');
    let parsedVersions = [];
    try { parsedVersions = JSON.parse(data.get('mediaVersions') || '[]'); } catch {}
    await mutate(`/products${product ? `/${encodeURIComponent(product.id)}` : ''}`, product ? 'PATCH' : 'POST', {
      name: data.get('name').trim(),
      material: data.get('material').trim(),
      description: data.get('description').trim(),
      botInstructions: (data.get('botInstructions') || '').trim(),
      imageUrl: data.get('imageUrl')?.trim() || '',
      materialsUrl: data.get('materialsUrl')?.trim() || '',
      mediaVersions: parsedVersions,
      pricePiasters: Math.round(Number(data.get('price')) * 100),
      stock: data.get('stock') ? Number(data.get('stock')) : 999999,
      active: data.has('active'),
      requiredFields: [...new Set(selectedFields)],
      variants: data.get('variants').split(/[,،]/).map(s => s.trim()).filter(Boolean)
    }, 'اتحفظت بيانات المنتج والماتريال بنجاح');
  });
}
async function renderConversations(main, version) {
  const detail = el('div', { class: 'conversation-detail' });
  const list = el('div', { class: 'conversation-list', 'aria-label': 'قائمة المحادثات' });
  main.replaceChildren(heading('المحادثات', 'راجع الرسائل، جهّز الرد، وحوّل التفاصيل لأوردر.', button('+ محادثة يدوية', () => conversationDialog(), 'primary')), el('div', { class: 'feature-note' }, 'الرسالة المضافة يدويًا مش مزامنة مع فيسبوك. زر «اقترح رد» بيجهّز مسودة؛ النسخ لا يعني إن الرد اتبعت للعميل.'), el('section', { class: 'panel inbox' }, list, detail));
  if (!state.conversations.length) { list.append(empty('مفيش محادثات', 'ابدأ محادثة يدوية.')); detail.append(empty('كل عميل له متابعة واضحة', 'سجّل المحادثة والمنتج، وبعدها اطلب مساعدة في الرد.')); return; }
  if (!state.conversations.some(c => c.id === state.selectedConversation)) state.selectedConversation = state.conversations[0].id;
  const drawList = () => list.replaceChildren(...state.conversations.map(c => el('button', { class: `conversation-item ${c.id === state.selectedConversation ? 'selected' : ''}`, type: 'button', onclick: async () => { state.selectedConversation = c.id; drawList(); await loadConversation(detail, c.id, version); } }, el('strong', {}, c.senderName || 'عميل'), el('div', { class: 'subtle' }, channelName(c.channelId)), badge(c.status))));
  drawList(); await loadConversation(detail, state.selectedConversation, version);
}
function conversationDialog() {
  const channels = state.channels.filter(c => c.type === 'manual');
  if (!channels.length) { toast('ضيف قناة متابعة يدوية الأول من القنوات والتشغيل.'); location.hash = 'connections'; return; }
  dialog('محادثة يدوية جديدة', () => el('div', { class: 'form-grid' }, field('اسم العميل', 'senderName', '', { required: true, full: true }), selectField('قناة المتابعة', 'channelId', channels.map(c => ({ value: c.id, label: c.name })), channels[0].id, { required: true }), selectField('المنتج', 'productId', productOptions(), '')), async data => { const created = await api('/conversations', { method: 'POST', body: { senderName: data.get('senderName').trim(), channelId: data.get('channelId'), ...(data.get('productId') ? { productId: data.get('productId') } : {}) } }); state.selectedConversation = created.id; toast('اتفتحت المحادثة اليدوية'); await refresh(); }, 'فتح المحادثة');
}
async function loadConversation(holder, id, version) {
  holder.replaceChildren(el('div', { class: 'loading' }, 'بنفتح المحادثة…'));
  try {
    const c = await api(`/conversations/${encodeURIComponent(id)}`);
    if (version !== requestVersion || id !== state.selectedConversation) return;
    const errors = el('div');
    const toggle = button(c.status === 'human_takeover' ? 'إتاحة المساعد' : 'استلام المحادثة', async () => { try { await mutate(`/conversations/${encodeURIComponent(id)}`, 'PATCH', { status: c.status === 'human_takeover' ? 'bot_active' : 'human_takeover' }, 'اتحدثت حالة المحادثة'); } catch (error) { toast(error.message); } }, 'small');
    const productSelect = selectField('المنتج المرتبط بالمحادثة', 'productId', productOptions(), c.productId);
    productSelect.querySelector('select').addEventListener('change', async event => { try { await mutate(`/conversations/${encodeURIComponent(id)}`, 'PATCH', { productId: event.target.value || null }, 'اتحدث المنتج المرتبط'); } catch (error) { toast(error.message); } });
    const messages = el('div', { class: 'messages', 'aria-label': 'رسائل المحادثة' }, (c.messages || []).map(m => el('div', { class: `bubble ${m.direction === 'outbound' || m.role === 'assistant' ? 'outbound' : ''}` }, m.text || m.content || '', el('small', {}, `${m.source === 'manual' ? 'إدخال يدوي · ' : ''}${date(m.createdAt)}`))));
    if (!(c.messages || []).length) messages.append(empty('المحادثة لسه فاضية', 'ضيف رسالة العميل عشان تبدأ.'));
    const inboundForm = el('form', { class: 'inline-form' });
    const inbound = el('textarea', { name: 'text', placeholder: 'انقل رسالة العميل هنا…', 'aria-label': 'رسالة العميل المدخلة يدويًا', required: true, maxlength: 10000 });
    const add = el('button', { type: 'submit', class: 'btn' }, 'تسجيل الرسالة');
    inboundForm.append(inbound, add); inboundForm.addEventListener('submit', async event => { event.preventDefault(); add.disabled = true; errors.replaceChildren(); try { await mutate(`/conversations/${encodeURIComponent(id)}/messages`, 'POST', { text: inbound.value.trim() }, 'اتسجلت الرسالة محليًا'); } catch (error) { errors.append(errorBox(error)); } finally { add.disabled = false; } });
    const draftBox = el('div');
    const showDraft = result => {
      const reply = typeof result === 'string' ? result : result?.replyText || '';
      if (!reply) return;
      draftBox.replaceChildren(el('div', { class: 'draft' }, el('strong', {}, 'مسودة للمراجعة — لم تُرسل'), el('p', {}, reply), result?.needsHuman ? el('div', { class: 'warning-box' }, 'الاقتراح محتاج مراجعة بشرية قبل الاستخدام. راجع طلب العميل وبيانات المنتج.') : null, button('نسخ الرد', async () => { try { await navigator.clipboard.writeText(reply); toast('اتنسخ الرد. ابعته بنفسك بعد المراجعة.'); } catch { toast('المتصفح منع النسخ. حدد نص الرد وانسخه يدويًا.'); } }, 'small')));
      if (result?.extractedData && Object.keys(result.extractedData).length) draftBox.append(el('div', {class:'draft'}, el('strong',{},'بيانات مقترحة — راجعها قبل الحفظ'), el('div',{class:'detail-meta'},Object.entries(result.extractedData).map(([key,value])=>el('div',{},el('small',{},customerLabels[key]||key),el('strong',{},value)))), button('مراجعة البيانات المقترحة',()=>customerDialog({...c,customer:{...c.customer,...result.extractedData}}),'small')));
    };
    if (c.draftReply) showDraft(c.suggestion || c.draftReply);
    const suggest = button('✧ اقترح رد', async () => { suggest.disabled = true; errors.replaceChildren(); try { const result = await api(`/conversations/${encodeURIComponent(id)}/suggest`, { method: 'POST', body: c.productId ? { productId: c.productId } : {} }); showDraft(result); toast('المسودة جاهزة للمراجعة'); } catch (error) { errors.append(errorBox(error)); } finally { suggest.disabled = false; } }, 'primary', { disabled: c.status !== 'bot_active' });
    holder.replaceChildren(el('div', { class: 'conversation-top' }, el('div', {}, el('h2', {}, c.senderName || 'عميل'), badge(c.status)), el('div', { class: 'button-row' }, toggle, button('بيانات العميل', () => customerDialog(c), 'small'), button('إنشاء أوردر', () => orderDialog(c), 'small'))), productSelect, messages, inboundForm, el('p', { class: 'subtle' }, 'تسجيل رسالة واردة يدويًا فقط؛ لا يتم إرسال أي رسالة للعميل.'), errors, el('div', { class: 'button-row space-top' }, suggest, c.status === 'human_takeover' ? el('span', { class: 'muted' }, 'المساعد متوقف أثناء المتابعة البشرية.') : null), draftBox);
    messages.scrollTop = messages.scrollHeight;
  } catch (error) { if (id === state.selectedConversation) holder.replaceChildren(errorBox(error)); }
}
const customerLabels = { name: 'اسم العميل', phone: 'رقم الموبايل', governorate: 'المحافظة', address: 'العنوان بالتفصيل', variant: 'المتغير (كود الموديل / العرض / الصورة)', color: 'اللون', size: 'المقاس', notes: 'ملاحظات' };
function customerFields(customer = {}, requiredFields = [], extra = []) { return el('div', { class: 'form-grid' }, [...new Set(['name', 'phone', 'governorate', 'address', 'variant', 'color', 'size', 'notes', ...requiredFields, ...extra])].map(key => field(customerLabels[key] || key, `customer_${key}`, customer[key] || '', { required: requiredFields.includes(key), full: ['address', 'notes'].includes(key), type: key === 'phone' ? 'tel' : 'text', ...(key === 'phone' ? { dir: 'ltr', inputmode: 'tel' } : {}) }))); }
function readCustomer(data) { return Object.fromEntries([...data.entries()].filter(([key]) => key.startsWith('customer_')).map(([key, value]) => [key.slice(9), String(value).trim()]).filter(([, value]) => value)); }
function customerDialog(c) { dialog('بيانات العميل', () => customerFields(c.customer, [], Object.keys(c.customer || {})), async data => { await mutate(`/conversations/${encodeURIComponent(c.id)}`, 'PATCH', { customer: readCustomer(data) }, 'اتحفظت بيانات العميل'); }); }
function orderDialog(c) {
  if (!state.products.length) { toast('ضيف منتج قبل تسجيل الأوردر.'); return; }
  const product = state.products.find(p => p.id === c?.productId) || state.products[0];
  dialog('تسجيل أوردر للمراجعة', form => {
    const total = el('div', { class: 'order-total' });
    const required = el('div');
    const customer = customerFields(c?.customer, [], state.products.flatMap(p => p.requiredFields || []));
    const update = () => { const data = new FormData(form); const p = state.products.find(item => item.id === data.get('productId')) || product; const quantity = Number(data.get('quantity') || 1); const shipping = Math.round(Number(data.get('shipping') || 0) * 100); total.replaceChildren('الإجمالي المتوقع', el('strong', {}, money(p.pricePiasters * quantity + shipping))); required.textContent = `الحقول المطلوبة: ${(p.requiredFields || []).map(k => customerLabels[k] || k).join('، ') || 'حسب بيانات المنتج'}. المخزون: ${number(p.stock)} قطعة.`; customer.querySelectorAll('input').forEach(input => { input.required = (p.requiredFields || []).includes(input.name.slice(9)); }); };
    const content = el('div', {}, el('div', { class: 'warning-box' }, 'ده تسجيل طلب للمراجعة. التأكيد وحجز المخزون بيحصلوا بعد تسجيل موافقة العميل على التفاصيل.'), el('div', { class: 'form-grid' }, selectField('المنتج', 'productId', productOptions(false), product.id, { required: true, full: true }), field('الكمية', 'quantity', 1, { type: 'number', min: 1, step: 1, required: true }), field('الشحن بالجنيه', 'shipping', '', { type: 'number', min: 0, step: '.01', required: true, hint: 'اكتب تكلفة الشحن المتفق عليها؛ لا تُحسب تلقائيًا.' })), el('p', { class: 'muted' }, required), customer, total);
    form.addEventListener('input', update); form.addEventListener('change', update); queueMicrotask(update); return content;
  }, async data => { await mutate('/orders', 'POST', { conversationId: c?.id, productId: data.get('productId'), quantity: Number(data.get('quantity')), shippingPiasters: Math.round(Number(data.get('shipping')) * 100), customer: readCustomer(data) }, 'اتسجل الطلب. راجع موافقة العميل قبل تأكيده.'); }, 'تسجيل الطلب');
}
function renderOrders(main) {
  const holder = el('div');
  const filter = el('select', { 'aria-label': 'فلترة حالة الأوردر', class: 'status-filter' }, el('option', { value: '' }, 'كل الحالات'), ['awaiting_confirmation', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled', 'returned'].map(s => el('option', { value: s }, labels[s])));
  const draw = () => { const orders = state.orders.filter(o => !filter.value || o.status === filter.value).slice().reverse(); holder.replaceChildren(orders.length ? panel('متابعة الأوردرات', `${number(orders.length)} أوردر`, orderTable(orders)) : empty('مفيش أوردرات في الحالة دي', 'الأوردر بيتسجّل من داخل المحادثة بعد مراجعة البيانات.')); };
  filter.addEventListener('change', draw); main.replaceChildren(heading('الأوردرات', 'تأكيد واضح، مخزون مضبوط، ومتابعة لحد التسليم.', el('a', {class:'btn', href:'/api/orders/export.csv', download:'orders.csv'}, 'تصدير CSV')), el('div', { class: 'toolbar' }, filter), holder); draw();
}
function orderTable(orders) { return table(['العميل / الطلب', 'المنتج', 'الإجمالي', 'الحالة', ''], orders.map(o => [el('div', {}, el('strong', {}, o.customer?.name || 'عميل'), o.customer?.variant ? el('span', { class: 'badge good', style: 'margin-right:6px;font-size:12px' }, o.customer.variant) : null, o.externalSync?.success ? el('span', { class: 'badge', style: 'background:#e8f7f2;color:#117258;font-size:11px;margin-right:4px' }, 'CRM ✓') : null, el('span', { class: 'cell-sub', dir: 'ltr' }, String(o.id).slice(-8))), el('div', {}, productName(o.productId), el('span', { class: 'cell-sub' }, `${number(o.quantity)} قطعة${o.customer?.variant ? ` · ${o.customer.variant}` : ''}`)), money(o.totalPiasters), badge(o.status), button('التفاصيل', () => orderDetails(o), 'small')])); }
function orderDetails(order) {
  const dlg = el('dialog', { 'aria-label': 'تفاصيل الأوردر' }); const errors = el('div');
  const prod = state.products.find(p => p.id === order.productId);
  const content = el('div', { class: 'dialog-body' }, el('div', { class: 'status-line space-bottom' }, badge(order.status), el('span', { class: 'subtle' }, date(order.createdAt))), el('div', { class: 'detail-meta' }, [['العميل', order.customer?.name], ['المنتج', productName(order.productId)], ...(prod?.material ? [['الخامة / الماتريال', prod.material]] : []), ['الكمية', number(order.quantity)], ['سعر القطعة', money(order.unitPricePiasters)], ['الشحن', money(order.shippingPiasters)], ['الإجمالي', money(order.totalPiasters)], ...(order.externalSync ? [['ربط الـ CRM', order.externalSync.success ? 'تم الإرسال بنجاح ✓' : 'فشل الإرسال']] : []), ...Object.entries(order.customer || {}).filter(([k]) => k !== 'name').map(([k,v]) => [customerLabels[k] || k, v])].map(([key, value]) => el('div', {}, el('small', {}, key), el('strong', {}, value || '—')))), errors);
  const actions = el('div', { class: 'button-row' });
  const move = async status => { try { await api(`/orders/${encodeURIComponent(order.id)}/status`, { method: 'PATCH', body: { status } }); dlg.close(); toast('اتحدثت حالة الأوردر'); await refresh(); } catch (error) { errors.replaceChildren(errorBox(error)); } };
  if (['draft', 'awaiting_confirmation'].includes(order.status)) actions.append(button('تسجيل موافقة العميل وتأكيد الطلب', () => { dlg.close(); confirmOrder(order); }, 'primary'));
  if (['confirmed', 'preparing', 'shipped', 'delivered'].includes(order.status)) {
    actions.append(button('إرسال للـ CRM الخارجي ↗', async () => {
      try {
        await api(`/orders/${encodeURIComponent(order.id)}/relay`, { method: 'POST' });
        toast('تم إرسال الأوردر للـ CRM الخارجي بنجاح');
        dlg.close();
        await refresh();
      } catch (err) {
        errors.replaceChildren(errorBox(err));
      }
    }, 'small'));
  }
  const transitions = { confirmed: ['preparing', 'cancelled'], preparing: ['shipped', 'cancelled'], shipped: ['delivered', 'returned'], delivered: ['returned'], draft: ['cancelled'], awaiting_confirmation: ['cancelled'] };
  for (const status of transitions[order.status] || []) actions.append(button(labels[status], () => { if (['cancelled', 'returned'].includes(status)) { if (!window.confirm(status === 'returned' ? 'سجّل المرتجع فقط بعد استلام القطع وفحصها؛ هيرجع المخزون. هل تم ده؟' : 'هل تريد إلغاء الطلب؟')) return; } move(status); }, status === 'cancelled' || status === 'returned' ? 'danger' : ''));
  content.append(actions, el('p', { class: 'footer-note' }, 'تغيير الحالة تسجيل داخلي؛ لا يرسل إشعارًا للعميل أو أمرًا لشركة الشحن.'));
  if (order.history?.length) content.append(el('ul', { class: 'history' }, order.history.map(h => el('li', {}, labels[h.status || h.to] || h.status || h.to || h.action || 'تحديث', ' · ', date(h.at || h.createdAt || h.timestamp), h.note ? ` — ${h.note}` : ''))));
  dlg.append(el('div', { class: 'dialog-head' }, el('h2', {}, 'تفاصيل الأوردر'), button('×', () => dlg.close(), 'small', { 'aria-label': 'إغلاق' })), content); dlg.addEventListener('close', () => dlg.remove(), { once: true }); document.body.append(dlg); dlg.showModal();
}
function confirmOrder(order) {
  dialog('تأكيد موافقة العميل', () => el('div', {}, el('div', { class: 'warning-box' }, `راجع مع العميل: ${productName(order.productId)}، الكمية ${number(order.quantity)}، والإجمالي ${money(order.totalPiasters)} شامل الشحن. هنعيد التحقق من السعر والمخزون وقت التأكيد.`), field('نص موافقة العميل أو مرجعها', 'confirmationNote', '', { type: 'textarea', required: true, full: true, minlength: 3, hint: 'مثل: العميل قال «أكد الطلب» بعد إرسال الملخص بتاريخ ووقت محددين.' }), el('label', { class: 'check-label space-top' }, el('input', { type: 'checkbox', name: 'customerConfirmed', required: true }), 'العميل وافق صراحة على المنتج والكمية والسعر والشحن والعنوان.')), async data => { await mutate(`/orders/${encodeURIComponent(order.id)}/confirm`, 'POST', { customerConfirmed: data.has('customerConfirmed'), confirmationNote: data.get('confirmationNote').trim() }, 'اتأكد الطلب واتحدث المخزون'); }, 'تأكيد وحجز المخزون');
}
function renderPublishing(main) { main.replaceChildren(heading('تجهيز النشر', 'محتوى جاهز للمراجعة، ونتيجة كل محاولة مسجّلة.', button('+ تجهيز منشور', () => publishingDialog(), 'primary')), el('div', { class: 'feature-note' }, 'النظام بيجهّز المحتوى فقط. انشر بنفسك في القناة المناسبة، وبعدها سجّل الحالة والرابط. مفيش نشر تلقائي أو تغيير IP إجباري.'), state.tasks.length ? panel('قائمة المحتوى', `${number(state.tasks.length)} مهمة`, taskTable(state.tasks.slice().reverse())) : empty('جهّز أول منشور', 'اختار المنتج، حدد المكان، وراجع النص قبل النشر.', button('تجهيز منشور', () => publishingDialog(), 'primary'))); }
function taskTable(tasks) { return table(['المحتوى', 'مكان النشر', 'الحالة', ''], tasks.map(t => [el('div', {}, el('strong', {}, t.title || productName(t.productId)), el('span', { class: 'cell-sub' }, productName(t.productId))), t.destination, badge(t.status), button('مراجعة', () => taskDetails(t), 'small')])); }
function publishingDialog() {
  if (!state.products.length) { toast('ضيف منتج الأول عشان تجهّز المنشور.'); return; }
  dialog('تجهيز منشور جديد', () => el('div', { class: 'form-grid' }, selectField('المنتج', 'productId', productOptions(), '', { required: true, full: true }), field('مكان النشر', 'destination', '', { required: true, full: true, placeholder: 'مثل: ماركت بليس / جروب سكان مدينة نصر' }), field('عنوان المنشور', 'title', '', { full: true, hint: 'سيتم استخدام اسم المنتج لو الحقل فاضي.' }), field('نص المنشور', 'body', '', { type: 'textarea', full: true, hint: 'سيتم تجهيز النص من بيانات المنتج لو الحقل فاضي.' })), async data => { await mutate('/publishing-tasks', 'POST', { productId: data.get('productId'), destination: data.get('destination').trim(), ...(data.get('title').trim() ? { title: data.get('title').trim() } : {}), ...(data.get('body').trim() ? { body: data.get('body').trim() } : {}) }, 'اتجهزت مهمة النشر للمراجعة'); }, 'تجهيز المحتوى');
}
function taskDetails(task) {
  dialog('مراجعة مهمة النشر', () => el('div', {}, el('div', { class: 'draft task-draft' }, el('strong', {}, task.title || productName(task.productId)), el('p', {}, task.body || 'مفيش نص مسجّل'), button('نسخ المحتوى', async () => { try { await navigator.clipboard.writeText(`${task.title || ''}\n\n${task.body || ''}`); toast('اتنسخ المحتوى. راجعه وانشره بنفسك.'); } catch { toast('حدد النص وانسخه يدويًا.'); } }, 'small')), el('div', { class: 'form-grid' }, selectField('حالة النشر المسجّلة', 'status', ['draft', 'ready', 'published', 'pending_approval', 'rejected', 'needs_attention'].map(status => ({ value: status, label: labels[status] })), task.status, { full: true }), field('رابط المنشور بعد النشر', 'resultUrl', task.resultUrl, { type: 'url', full: true, dir: 'ltr', placeholder: 'https://…' })), el('p', { class: 'muted' }, 'اختيار «نشر مسجل يدويًا» معناه إنك نشرت بنفسك؛ البرنامج لا ينشر على فيسبوك.')), async data => { await mutate(`/publishing-tasks/${encodeURIComponent(task.id)}`, 'PATCH', { status: data.get('status'), resultUrl: data.get('resultUrl').trim() }, 'اتحفظت نتيجة مهمة النشر'); });
}
const platformLabels = {
  facebook_marketplace: 'فيسبوك ماركت بليس',
  facebook_groups: 'جروبات فيسبوك',
  messenger: 'صفحة فيسبوك رسمية',
  whatsapp: 'واتساب بيزنس',
  instagram: 'إنستجرام',
  other: 'حساب آخر'
};
const platformOptions = [
  { value: 'facebook_marketplace', label: 'فيسبوك ماركت بليس (حساب شخصي)' },
  { value: 'facebook_groups', label: 'جروبات فيسبوك (حساب نشر ومتابعة)' },
  { value: 'messenger', label: 'صفحة فيسبوك رسمية (Facebook Page)' },
  { value: 'whatsapp', label: 'واتساب بيزنس (رقم مبيعات)' },
  { value: 'instagram', label: 'إنستجرام' },
  { value: 'other', label: 'حساب / قناة أخرى' }
];

function accountDialog(channel) {
  dialog(channel ? 'تعديل بيانات حساب فيسبوك' : 'إضافة حساب فيسبوك جديد للأتمتة والتدفئة', () => el('div', { class: 'form-grid' },
    field('اسم الحساب أو صاحبه', 'name', channel?.name, { required: true, full: true, placeholder: 'مثال: حساب منى 1 - ماركت بليس' }),
    field('معرف البروفايل المعزول (Browser Profile)', 'browserProfileId', channel?.browserProfileId || `profile_${Math.floor(Math.random()*900)+100}`, { full: true, hint: 'كل حساب له مجلد بيانات متصفح معزول ومستقل لتجنب تتبع فيسبوك' }),
    field('حساب الدخول (إيميل أو رقم موبايل)', 'loginAccount', channel?.loginAccount || channel?.phone, { dir: 'ltr', placeholder: 'user@example.com أو 01xxxxxxxxx' }),
    selectField('حالة الحساب', 'accountStatus', [
      { value: 'warming', label: '🔥 تحت التدفئة والتنشيط (تصفح، تفاعل، سكرول)' },
      { value: 'ready', label: '✅ جاهز ومؤهل للنشر (ماركت بليس وجروبات)' },
      { value: 'cooldown', label: '⏳ في فترة تبريد (Cooldown)' },
      { value: 'checkpoint', label: '⚠️ محتاج فحص ومراجعة أمنية' }
    ], channel?.accountStatus || 'warming'),
    field('الحد اليومي لنشر الماركت بليس', 'dailyPostsLimit', channel?.dailyPostsLimit || 2, { type: 'number' }),
    field('الحد اليومي لنشر الجروبات', 'dailyGroupsLimit', channel?.dailyGroupsLimit || 4, { type: 'number' }),
    field('مؤشر ثقة الحساب (Trust Score %)', 'trustScore', channel?.trustScore || 85, { type: 'number', hint: 'من 0 إلى 100%' }),
    field('ملاحظات وتخصص الحساب', 'notes', channel?.notes, { type: 'textarea', full: true, placeholder: 'مثال: حساب قديم من 2021 مخصص لجروبات الملابس والماركت بليس...' })
  ), async data => {
    const payload = {
      name: data.get('name').trim(),
      type: 'manual',
      platform: 'facebook_marketplace',
      browserProfileId: data.get('browserProfileId').trim(),
      loginAccount: data.get('loginAccount').trim(),
      accountStatus: data.get('accountStatus'),
      dailyPostsLimit: Number(data.get('dailyPostsLimit')) || 2,
      dailyGroupsLimit: Number(data.get('dailyGroupsLimit')) || 4,
      trustScore: Number(data.get('trustScore')) || 85,
      notes: data.get('notes').trim()
    };
    await mutate(channel ? `/channels/${encodeURIComponent(channel.id)}` : '/channels', channel ? 'PATCH' : 'POST', payload, 'اتحفظت بيانات الحساب بنجاح');
  });
}

function bulkAccountsDialog() {
  dialog('إضافة واستيراد حسابات فيسبوك دفعة واحدة', () => el('div', { class: 'form-grid' },
    field('اكتب أو الصق الحسابات (كل سطر حساب جديد)', 'accountsText', '', {
      type: 'textarea',
      full: true,
      rows: 6,
      placeholder: 'اكتب كل حساب في سطر منفصل بالشكل:\nاسم الحساب | الإيميل أو الموبايل\nأو مجرد اسم الحساب في كل سطر مثل:\nحساب ماركت بليس 1\nحساب ماركت بليس 2\nحساب ماركت بليس 3'
    }),
    selectField('حالة نشاط الحسابات الافتراضية', 'accountStatus', [
      { value: 'warming', label: '🔥 تحت التدفئة والتنشيط (موصى به للحسابات الجديدة)' },
      { value: 'ready', label: '✅ جاهز للنشر مباشرة (للحسابات القديمة المستقرة)' }
    ], 'warming', { full: true })
  ), async data => {
    const raw = data.get('accountsText').trim();
    if (!raw) { toast('أدخل حساب واحد على الأقل'); return; }
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const status = data.get('accountStatus');
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split('|').map(p => p.trim());
      const name = parts[0];
      const login = parts[1] || '';
      const profileId = `profile_${Date.now().toString().slice(-4)}_${i + 1}`;
      await api('/channels', {
        method: 'POST',
        body: {
          name,
          loginAccount: login,
          phone: login.startsWith('01') ? login : '',
          type: 'manual',
          platform: 'facebook_marketplace',
          browserProfileId: profileId,
          accountStatus: status,
          trustScore: status === 'ready' ? 90 : 70,
          dailyPostsLimit: 2,
          dailyGroupsLimit: 4
        }
      });
      count++;
    }
    toast(`تم استيراد ${count} حساب بنجاح، وتخصيص بروفايل معزول لكل حساب!`);
    await refresh();
  }, 'بدء الاستيراد');
}

function groupHunterPanel() {
  const panelEl = el('div', { class: 'panel' });
  const keywordsHolder = el('div', { style: 'margin: 12px 0; display:flex; flex-wrap:wrap; gap:8px' });

  const inputName = el('input', {
    type: 'text',
    placeholder: 'اكتب اسم المنتج (مثل: طرحة، عبايات، فساتين سواريه...)',
    value: state.products[0]?.name || '',
    style: 'flex:1; min-width:240px; padding:10px 14px; border:1px solid var(--line); border-radius:8px'
  });

  const searchBtn = button('🔍 استخراج الكلمات والبحث الذكي', async () => {
    const pName = inputName.value.trim();
    if (!pName) { toast('اكتب اسم المنتج أولاً'); return; }
    searchBtn.disabled = true;
    keywordsHolder.replaceChildren(el('div', { class: 'loading', style: 'padding:15px' }, 'جاري توليد الكلمات البحثية بالذكاء الاصطناعي (Vertex AI)...'));
    try {
      const res = await api('/automation/group-hunter/keywords', { method: 'POST', body: { productName: pName, count: 12 } });
      const kwList = res.keywords || [];
      keywordsHolder.replaceChildren(
        el('strong', { style: 'display:block; width:100%; margin-bottom:6px; font-size:14px' }, `الكلمات المقترحة لـ "${pName}":`),
        ...kwList.map(kw => el('button', {
          class: 'btn small ghost',
          style: 'background:#edf5f2; border-color:#d4eee5; color:#127d72; border-radius:20px; font-size:13px',
          onclick: () => addGroupModal(kw)
        }, `+ ${kw}`))
      );
    } catch (err) {
      keywordsHolder.replaceChildren(el('p', { class: 'muted' }, 'فشل استخراج الكلمات. حاول مرة تانية.'));
    } finally {
      searchBtn.disabled = false;
    }
  }, 'primary');

  const addGroupModal = (presetKeyword = '') => {
    dialog('إضافة جروب فيسبوك جديد', () => el('div', { class: 'form-grid' },
      field('اسم الجروب', 'name', '', { required: true, full: true, placeholder: 'مثال: سوق محجبات مصر للملابس والطرح' }),
      field('رابط الجروب على فيسبوك', 'url', '', { required: true, type: 'url', dir: 'ltr', full: true, placeholder: 'https://www.facebook.com/groups/...' }),
      selectField('نوع الجروب', 'type', [
        { value: 'public', label: 'عامة (Public) - نشر مباشر' },
        { value: 'private', label: 'خاصة (Private)' }
      ], 'public'),
      selectField('الموافقة على المنشورات', 'approval', [
        { value: 'auto', label: 'نشر تلقائي بدون موافقة أدمن (Auto-approval)' },
        { value: 'admin_review', label: 'موافقة أدمن مطلوبة' }
      ], 'auto'),
      field('عدد الأعضاء التقريبي', 'memberCount', 50000, { type: 'number' }),
      field('الكلمة البحثية / المنتج', 'productKeyword', presetKeyword || inputName.value.trim(), { full: true }),
      selectField('الحساب الموزع عليه', 'assignedChannelId', [
        { value: '', label: 'بدون تخصيص (توزيع تلقائي لاحقاً)' },
        ...state.channels.map(c => ({ value: c.id, label: c.name }))
      ], '')
    ), async data => {
      await mutate('/groups', 'POST', {
        name: data.get('name').trim(),
        url: data.get('url').trim(),
        type: data.get('type'),
        approval: data.get('approval'),
        memberCount: Number(data.get('memberCount')) || 0,
        productKeyword: data.get('productKeyword').trim(),
        assignedChannelId: data.get('assignedChannelId')
      }, 'تمت إضافة الجروب بنجاح');
    });
  };

  const distributeBtn = button('⚖️ توزيع الجروبات على الحسابات بالتساوي', async () => {
    const activeChans = state.channels.filter(c => ['facebook_marketplace', 'facebook_groups'].includes(c.platform) || c.browserProfileId);
    if (!activeChans.length) { toast('أضف حسابات فيسبوك أولاً لتوزيع الجروبات عليها'); return; }
    if (!state.groups.length) { toast('لا توجد جروبات مسجلة بعد'); return; }
    let updated = 0;
    for (let i = 0; i < state.groups.length; i++) {
      const g = state.groups[i];
      const targetChan = activeChans[i % activeChans.length];
      if (g.assignedChannelId !== targetChan.id) {
        await api(`/groups/${encodeURIComponent(g.id)}`, { method: 'PATCH', body: { assignedChannelId: targetChan.id } });
        updated++;
      }
    }
    toast(`تم توزيع الجروبات بنجاح على ${activeChans.length} حسابات (${updated} تعديل)`);
    await refresh();
  }, 'ghost');

  panelEl.append(
    el('div', { class: 'panel-head' },
      el('div', {},
        el('h2', {}, 'صياد الجروبات الذكي (Vertex AI Group Hunter)'),
        el('p', { class: 'muted' }, 'اكتب اسم المنتج والذكاء الاصطناعي هيولد مصطلحات البحث لاصطياد أفضل الجروبات وتوزيعها بمعدل 4-5 جروبات لكل حساب')
      ),
      el('div', { class: 'button-row' },
        button('+ إضافة جروب يدوياً', () => addGroupModal(), 'small'),
        distributeBtn
      )
    ),
    el('div', { class: 'panel-body' },
      el('div', { style: 'display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px' }, inputName, searchBtn),
      keywordsHolder,
      state.groups.length ? table(['اسم الجروب', 'النوع والموافقة', 'الأعضاء', 'الحساب المخصص', 'الحالة', ''], state.groups.map(g => [
        el('div', {},
          el('strong', {}, g.name),
          g.url ? el('a', { href: g.url, target: '_blank', rel: 'noopener noreferrer', style: 'display:block; font-size:12px; color:var(--teal); direction:ltr' }, 'فتح الجروب ↗') : null
        ),
        el('div', {},
          el('span', { class: 'badge', style: g.type === 'public' ? 'background:#e8f7f2;color:#117258' : 'background:#fef3c7;color:#92400e' }, g.type === 'public' ? 'عامة' : 'خاصة'),
          el('span', { class: 'cell-sub' }, g.approval === 'auto' ? 'نشر فوري' : 'مراجعة أدمن')
        ),
        number(g.memberCount || 0),
        state.channels.find(c => c.id === g.assignedChannelId)?.name || 'غير مخصص',
        badge(g.status || 'active'),
        button('حذف', async () => {
          if (confirm(`حذف الجروب "${g.name}"؟`)) {
            await api(`/groups/${encodeURIComponent(g.id)}`, { method: 'DELETE' });
            toast('تم حذف الجروب');
            await refresh();
          }
        }, 'small danger')
      ])) : empty('مفيش جروبات مسجلة بعد', 'اكتب اسم المنتج واضغط "استخراج الكلمات" لاكتشاف وإضافة الجروبات المستهدفة.')
    )
  );
  return panelEl;
}

function crmIntegrationPanel(crm) {
  return panel('ربط الأوردرات بالـ CRM الخارجي (External API / Cashier Relay)', 'ترحيل الأوردرات فورياً لمنصة الكاشير أو السيستم الخارجي بمجرد تأكيد موافقة العميل في الشات',
    el('div', { class: 'panel-body' },
      el('form', {
        class: 'form-grid',
        onsubmit: async e => {
          e.preventDefault();
          const fd = new FormData(e.target);
          await mutate('/settings/crm', 'PUT', {
            apiUrl: fd.get('apiUrl').trim(),
            apiKey: fd.get('apiKey').trim(),
            autoRelayOnConfirm: fd.has('autoRelayOnConfirm')
          }, 'تم حفظ إعدادات ربط الـ CRM الخارجي بنجاح');
        }
      },
        field('رابط الـ API الخارجي لتسجيل الأوردرات (Webhook / Endpoint URL)', 'apiUrl', crm.apiUrl || '', {
          full: true, dir: 'ltr', type: 'url', placeholder: 'https://crm.fast-order-eg.tech/api/orders/webhook أو مسار الـ API الخاص بك'
        }),
        field('مفتاح المصادقة (Bearer Token / API Key)', 'apiKey', crm.apiKey || '', {
          full: true, dir: 'ltr', placeholder: 'مثال: Bearer sk_live_... أو مفتاح الـ API'
        }),
        el('label', { class: 'check-label full space-top' },
          el('input', { type: 'checkbox', name: 'autoRelayOnConfirm', checked: Boolean(crm.autoRelayOnConfirm) }),
          'إرسال الأوردر للـ CRM الخارجي تلقائياً بمجرد تأكيد العميل واستخراج بياناته كاملة'
        ),
        el('div', { class: 'button-row full space-top' },
          button('حفظ إعدادات الـ CRM', null, 'primary', { type: 'submit' }),
          button('اختبار إرسال تجريبي (Test Connection)', async () => {
            if (!crm.apiUrl) { toast('احفظ رابط الـ API أولاً قبل الاختبار'); return; }
            toast('جاري تجربة الاتصال بالـ API الخارجي...');
            try {
              const testOrder = state.orders[0] || { id: 'ord_test_sample', customer: { name: 'عميل تجريبي', phone: '01012345678', address: 'مدينة نصر، القاهرة', governorate: 'القاهرة' }, productName: 'منتج تجريبي', totalPiasters: 25000 };
              await api(`/orders/${testOrder.id || 'test'}/relay`, { method: 'POST', body: { apiUrl: crm.apiUrl, apiKey: crm.apiKey } });
              toast('نجح الاتصال بالـ API الخارجي بنجاح! ✓');
            } catch (err) {
              toast(`فشل الاختبار: ${err.message}`);
            }
          }, 'ghost')
        )
      )
    )
  );
}

function fastResponderPanel() {
  const previewBox = el('div', { class: 'instructions-box space-top', style: 'display:none' });

  return panel('محرك الرد اللحظي ومحول الكومنتات (Real-Time Auto-Responder)', 'الرد في نفس الدقيقة بمحاكاة بشرية كاملة، وتحويل كومنتات الريلز والجروبات لشاتات ماسنجر بدون حظر',
    el('div', { class: 'panel-body' },
      el('div', { class: 'settings-grid' },
        el('div', {},
          integrationRow('مستمع الإشعارات الفوري (Instant Trigger)', 'نشط ومفعل', 'يراقب رسايل الماركت بليس وكومنتات الريلز في نفس ثانية وصولها'),
          integrationRow('فاحص الشاتات السريع (Fast Poller)', 'كل 35 ثانية', 'يفحص الأكونتات دورياً بخفة وبدون استهلاك رامات الكمبيوتر'),
          integrationRow('محاكي الكتابة البشرية', 'مفعل (... يكتب الآن)', 'تأخير تفكير طبيعي (2-4 ثواني) وكتابة متقطعة 70ms لكل حرف')
        ),
        el('div', {},
          integrationRow('حماية طلبات المراسلة (Anti-Spam)', 'تحويل آمن (m.me)', 'يرد في الكومنت برابط شات مباشر ليجعل العميل يبدأ المراسلة بنفسه ويمنع الحظر 100%'),
          integrationRow('موديل الذكاء الاصطناعي', 'Gemini 3.8 Flash', 'تحليل فوري للهجة المصرية العامية واستخراج بيانات الأوردر'),
          integrationRow('استجابة المتجر والأسعار', 'ردود مدعمة بالصور', 'إرسال صور الماتريال والأسعار وكود الموديل المطلوب في الشات')
        )
      ),
      el('div', { class: 'button-row space-top' },
        button('⚡ تجربة محاكاة إشعار فوري وارد', async () => {
          toast('جاري محاكاة استقبال رسالة عميل جديدة وتوليد رد بشري...');
          try {
            const res = await api('/automation/responder/test-trigger', {
              method: 'POST',
              body: { text: 'مساء الخير، عاجبني الموديل ده وعايز أعرف متوفر مقاس L والشحن بكام للجيزة؟' }
            });
            previewBox.style.display = 'block';
            previewBox.replaceChildren(
              el('strong', {}, '✓ تمت تجربة الاستجابة اللحظية بنجاح:'),
              el('p', {}, `استلم المحرك رسالة العميل، وحسب وقت تفكير بشري قدره (${res.estimatedReplyTimeSeconds} ثانية)، وشغّل مؤشر "يكتب الآن..." لتجهيز الرد بالصور والسعر تلقائياً بدون أي تأخير!`)
            );
            toast('نجحت المحاكاة اللحظية! راجع التفاصيل في الصندوق أدناه');
          } catch (err) {
            toast(`فشل التجربة: ${err.message}`);
          }
        }, 'primary'),
        button('💬 معاينة رد الكومنت الآمن (بدون روابط)', async () => {
          try {
            const res = await api('/automation/comments/preview', {
              method: 'POST',
              body: { customerName: 'أحمد محمود', strategy: 'safe_dm_request' }
            });
            previewBox.style.display = 'block';
            previewBox.replaceChildren(
              el('strong', {}, 'نموذج الرد الذكي الآمن على الكومنت (بدون روابط أو أرقام لتجنب الحظر):'),
              el('p', { style: 'background:white; padding:12px; border-radius:8px; border:1px solid #c2e5d9; margin-top:6px; line-height:1.8' }, res.commentReply),
              el('small', { style: 'color:var(--muted); display:block; margin-top:4px' }, `الاستراتيجية: ${res.reason}`)
            );
          } catch (err) {
            toast(`خطأ: ${err.message}`);
          }
        }, 'ghost')
      ),
      previewBox
    )
  );
}

async function renderAutomation(main, version) {
  const [mobileStatus, crmSettings] = await Promise.all([
    api('/automation/mobile/status').catch(() => ({ devices: [], publicIp: null })),
    api('/settings/crm').catch(() => ({ apiUrl: '', apiKey: '', autoRelayOnConfirm: false }))
  ]);
  if (version !== requestVersion) return;

  const fbAccounts = state.channels.filter(c => ['facebook_marketplace', 'facebook_groups'].includes(c.platform) || c.browserProfileId);
  const readyAccounts = fbAccounts.filter(c => c.accountStatus === 'ready').length;
  const warmingAccounts = fbAccounts.filter(c => c.accountStatus !== 'ready').length;

  const metrics = [
    ['الحسابات الجاهزة للنشر', readyAccounts, 'حسابات مستقرة وتخطت مرحلة التدفئة', '✓'],
    ['تحت التنشيط والتدفئة', warmingAccounts, 'تصفح وتفاعل طبيعي لرفع الـ Trust Score', '🔥'],
    ['الجروبات المجمعة', state.groups.length, 'جروبات تم اصطيادها بـ Vertex AI', '☷'],
    ['شبكة 4G والـ IP', mobileStatus.devices?.length ? `متصل (${mobileStatus.devices[0]})` : 'موبايل غير متصل', mobileStatus.publicIp ? `IP: ${mobileStatus.publicIp}` : 'وصل الموبايل عبر USB', '⚡']
  ];

  main.replaceChildren(
    heading('أتمتة وحسابات فيسبوك (Facebook Automation Engine)', 'مزارع الحسابات، التدفئة والمحاكاة البشرية، صياد الجروبات بـ Vertex AI، وربط الـ CRM.',
      el('div', { class: 'button-row' },
        button('+ إضافة حساب فيسبوك', () => accountDialog(), 'primary'),
        button('📥 استيراد دفعة حسابات', () => bulkAccountsDialog(), 'ghost'),
        button('⚡ تدوير الـ IP الآن', async () => {
          toast('جاري تفعيل وضع الطيران لتدوير الـ IP...');
          try {
            const res = await api('/automation/mobile/rotate-ip', { method: 'POST' });
            if (res.changed) toast(`نجح تدوير الـ IP! الـ IP الجديد: ${res.newIp}`);
            else if (res.skipped) toast(res.reason || 'الموبايل غير متصل عبر ADB');
            else toast(`الـ IP الحالي: ${res.newIp || res.oldIp}`);
            await refresh();
          } catch (err) {
            toast(`خطأ في التدوير: ${err.message}`);
          }
        }, 'ghost')
      )
    ),
    el('div', { class: 'cards' }, metrics.map(([title, value, note, icon]) => el('section', { class: 'stat' },
      el('div', { class: 'stat-top' }, title, el('span', { class: 'stat-icon', 'aria-hidden': true }, icon)),
      el('div', { class: 'stat-value' }, typeof value === 'number' ? number(value) : value),
      el('div', { class: 'stat-note' }, note)
    ))),
    
    panel('حسابات فيسبوك ومحاكي التدفئة البشرية (Account Farming & Anti-Ban)', 'محاكاة كاملة للتصفح، السكرول، اللايكات، وقبول طلبات الصداقة لرفع Trust Score وتجنب الحظر',
      fbAccounts.length ? table(['الحساب / الإيميل', 'بروفايل العزل', 'مؤشر الثقة (Trust)', 'الحالة', 'آخر تدفئة', ''], fbAccounts.map(acc => [
        el('div', {}, el('strong', {}, acc.name), acc.phone || acc.loginAccount ? el('span', { class: 'cell-sub', dir: 'ltr' }, acc.phone || acc.loginAccount) : null),
        el('span', { class: 'badge', style: 'background:#f0f4f8;color:#2c3e50' }, acc.browserProfileId || 'محلي معزول'),
        el('div', { style: 'min-width:90px' },
          el('div', { style: 'display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px' },
            el('span', {}, `${acc.trustScore || 85}%`),
            el('span', { style: 'color:var(--muted)' }, (acc.trustScore || 85) > 80 ? 'ممتاز' : 'متوسط')
          ),
          el('div', { style: 'height:6px;background:#eee;border-radius:3px;overflow:hidden' },
            el('div', { style: `height:100%;width:${acc.trustScore || 85}%;background:${(acc.trustScore || 85) > 80 ? '#10b981' : '#f59e0b'}` })
          )
        ),
        badge(acc.accountStatus || 'warming'),
        acc.lastWarmedAt ? date(acc.lastWarmedAt) : 'لم يتم التنشيط بعد',
        el('div', { class: 'button-row' },
          button('🔥 تنشيط وتدفئة', async () => {
            toast(`جاري فتح المتصفح وتدفئة الحساب "${acc.name}" بمحاكاة بشرية...`);
            try {
              const res = await api(`/automation/accounts/${encodeURIComponent(acc.id)}/warm`, { method: 'POST' });
              if (res.result?.loggedIn) {
                toast(`انتهت جلسة التدفئة بنجاح! (${res.result.scrolls} سكرول · ${res.result.likes} لايك)`);
              } else {
                toast('تنبيه: الحساب يحتاج تسجيل دخول في البروفايل لأول مرة.');
              }
              await refresh();
            } catch (err) {
              toast(`فشل التنشيط: ${err.message}`);
            }
          }, 'small primary'),
          button('تعديل', () => accountDialog(acc), 'small'),
          button('حذف', async () => {
            if (confirm(`هل أنت متأكد من حذف الحساب "${acc.name}"؟`)) {
              await api(`/channels/${encodeURIComponent(acc.id)}`, { method: 'DELETE' });
              toast('تم حذف الحساب بنجاح');
              await refresh();
            }
          }, 'small danger')
        )
      ])) : empty('مفيش حسابات فيسبوك مسجلة', 'أضف أول حساب فيسبوك لبدء التدفئة والنشر الآمن بدون حظر.', button('+ إضافة حساب فيسبوك', () => accountDialog(), 'primary'))
    ),

    groupHunterPanel(),

    fastResponderPanel(),

    crmIntegrationPanel(crmSettings)
  );
}

async function renderConnections(main, version) {
  const [events, botSettings] = await Promise.all([
    api('/events'),
    api('/settings/bot-instructions').catch(() => ({ instructions: '', tone: 'friendly_concise' }))
  ]);
  if (version !== requestVersion) return;
  const meta = state.health.integrations?.meta;

  main.replaceChildren(
    heading('القنوات والتشغيل', 'إدارة حسابات النشر وقنوات البيع وتعليمات الذكاء الاصطناعي.', button('+ إضافة حساب / قناة بيع', () => channelDialog(), 'primary')),
    panel('قواعد وتعليمات البوت للمتجر (Vertex AI)', 'السياسات العامة اللي الذكاء الاصطناعي بيلتزم بيها في كل الردود', el('div', { class: 'panel-body' },
      el('div', { class: 'instructions-box' },
        el('strong', {}, 'التعليمات وسياسات المتجر النشطة حالياً:'),
        el('p', {}, botSettings.instructions || 'مفيش تعليمات عامة مضافة بعد. اضغط تعديل لإضافة سياسة المعاينة ومواعيد الشحن ونبرة الرد.')
      ),
      button('تعديل تعليمات وسياسات البوت', () => botInstructionsDialog(botSettings), 'primary')
    )),
    el('div', { class: 'settings-grid' },
      panel('حسابات وقنوات البيع والنشر', `${number(state.channels.length)} حساب مسجل للمتابعة والنشر`, state.channels.length ? table(['الحساب / القناة', 'المنصة', 'المسؤول', 'الحالة', ''], state.channels.map(c => [
        el('div', {}, el('strong', {}, c.name), c.phone ? el('span', { class: 'cell-sub', dir: 'ltr' }, c.phone) : null),
        platformLabels[c.platform] || (c.type === 'messenger' ? 'صفحة Messenger' : 'متابعة يدوية'),
        c.accountOwner || '—',
        badge(c.status),
        el('div', { class: 'button-row' },
          button('تعديل', () => channelDialog(c), 'small'),
          button('حذف', async () => {
            if (confirm(`هل أنت متأكد من حذف الحساب "${c.name}"؟`)) {
              await api(`/channels/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
              toast('تم حذف الحساب بنجاح');
              await refresh();
            }
          }, 'small danger')
        )
      ])) : empty('مفيش حسابات مسجلة', 'سجل حسابات فيسبوك أو الماركت بليس أو الواتساب اللي بتنشر وترد منها.', button('إضافة حساب', () => channelDialog(), 'primary'))),
      panel('إعدادات الربط والذكاء الاصطناعي', '', el('div', { class: 'panel-body' },
        integrationRow('مساعد الردود', ['gemini', 'vertex'].includes(state.health.integrations?.ai) ? 'Vertex AI مهيّأ' : 'قواعد محلية', 'يجهّز مسودات ذكية تلتزم بتعليمات المتجر والمنتج.'),
        integrationRow('Meta Messenger', meta === 'configured' ? 'الإعدادات موجودة' : 'غير مهيّأ', 'وجود الإعدادات لا يثبت وصول رسائل حقيقية.'),
        integrationRow('قاعدة البيانات', state.demoMode ? 'تجربة محلية (SQLite)' : 'حسب إعداد السيرفر (MySQL)', 'البيانات محفوظة محلياً على السيرفر.'),
        el('p', { class: 'footer-note' }, 'مفاتيح الربط تتضبط في إعدادات السيرفر، ومش بتظهر في المتصفح.')
      ))
    ),
    panel('أجهزة التشغيل المحلية', 'الموبايل خيار أساسي للمتصفح، من غير تدوير إجباري للـIP', state.workers.length ? table(['الجهاز', 'آخر اتصال', 'حالة الجهاز', 'الشبكة'], state.workers.map(w => [w.name || w.id || w.workerId, date(w.lastSeenAt || w.lastSeen || w.updatedAt), badge(Date.now() - new Date(w.lastSeenAt || w.lastSeen || w.updatedAt || 0).getTime() > 120000 ? 'offline' : w.status || 'online'), w.network?.configured === false ? 'بروكسي غير مهيّأ' : w.network?.proxyReachable === true ? 'منفذ البروكسي متاح' : 'فحص البروكسي لم ينجح'])) : empty('مفيش جهاز متصل', 'وكيل التشغيل اختياري.')),
    panel('سجل التشغيل والأحداث', 'أحداث داخل النظام للمراجعة', el('div', { class: 'panel-body event-list' }, events.length ? events.slice().reverse().slice(0, 30).map(e => el('div', { class: 'event' }, e.message || e.type || e.action || 'حدث تشغيل', el('small', {}, date(e.createdAt || e.at)))) : el('p', { class: 'muted' }, 'مفيش أحداث مسجّلة لسه.')))
  );
}

function botInstructionsDialog(settings) {
  dialog('تعديل تعليمات وقواعد البوت للمتجر', () => el('div', { class: 'form-grid' },
    field('قواعد وسياسات المتجر (Vertex AI)', 'instructions', settings?.instructions || '', { type: 'textarea', full: true, hint: 'اكتب هنا سياسة المعاينة قبل الاستلام، مدة التوصيل، طرق الدفع، ونبرة الرد. البوت هيلتزم بيها في كل شات.' }),
    selectField('أسلوب ونبرة الرد', 'tone', [
      { value: 'friendly_concise', label: 'ودود، سريع ومختصر بالعامية المصرية (موصى به)' },
      { value: 'sales_closer', label: 'بياع شاطر يركز على حسم الأوردر وطلب رقم الهاتف' },
      { value: 'formal', label: 'رسمي واحترافي' }
    ], settings?.tone || 'friendly_concise', { full: true })
  ), async data => {
    await mutate('/settings/bot-instructions', 'PUT', {
      instructions: data.get('instructions').trim(),
      tone: data.get('tone')
    }, 'تم حفظ تعليمات وسياسات البوت بنجاح');
  });
}

function channelDialog(channel) {
  dialog(channel ? 'تعديل بيانات الحساب / القناة' : 'إضافة حساب أو قناة بيع ونشر', () => el('div', { class: 'form-grid' },
    field('اسم الحساب أو القناة', 'name', channel?.name, { required: true, full: true, placeholder: 'مثال: بروفايل أحمد - ماركت بليس' }),
    selectField('المنصة / نوع الحساب', 'platform', platformOptions, channel?.platform || (channel?.type === 'messenger' ? 'messenger' : 'facebook_marketplace'), { full: true }),
    field('الموظف المسؤول عن الحساب', 'accountOwner', channel?.accountOwner, { placeholder: 'مثال: أحمد علي (مبيعات)' }),
    field('رقم الموبايل المرتبط بالحساب', 'phone', channel?.phone, { dir: 'ltr', placeholder: '01xxxxxxxxx' }),
    field('معرف بروفايل المتصفح المعزول (Browser Profile)', 'browserProfileId', channel?.browserProfileId || '', { full: true, placeholder: 'profile_1 (يترك فارغاً للتوليد التلقائي)' }),
    selectField('حالة نشاط الحساب', 'accountStatus', [
      { value: 'warming', label: '🔥 تحت التدفئة والتنشيط' },
      { value: 'ready', label: '✅ جاهز للنشر' },
      { value: 'cooldown', label: '⏳ في فترة تبريد' },
      { value: 'checkpoint', label: '⚠️ محتاج فحص ومراجعة' }
    ], channel?.accountStatus || 'warming'),
    field('رابط الحساب أو البروفايل (URL)', 'accountUrl', channel?.accountUrl, { type: 'url', dir: 'ltr', full: true, placeholder: 'https://facebook.com/...' }),
    field('ملاحظات وتخصص الحساب', 'notes', channel?.notes, { type: 'textarea', full: true, placeholder: 'مثال: حساب مخصص لنشر التيشيرتات في جروبات أكتوبر والشيخ زايد...' }),
    channel?.type === 'messenger' ? field('رقم صفحة Meta (اختياري)', 'externalPageId', channel?.externalPageId, { full: true, dir: 'ltr' }) : null
  ), async data => {
    const platform = data.get('platform');
    const type = platform === 'messenger' ? 'messenger' : 'manual';
    const payload = {
      name: data.get('name').trim(),
      type,
      platform,
      accountOwner: data.get('accountOwner').trim(),
      phone: data.get('phone').trim(),
      browserProfileId: data.get('browserProfileId').trim(),
      accountStatus: data.get('accountStatus'),
      accountUrl: data.get('accountUrl').trim(),
      notes: data.get('notes').trim(),
      ...(data.get('externalPageId')?.trim() ? { externalPageId: data.get('externalPageId').trim() } : {})
    };
    await mutate(channel ? `/channels/${encodeURIComponent(channel.id)}` : '/channels', channel ? 'PATCH' : 'POST', payload, 'اتحفظت بيانات الحساب بنجاح');
  });
}
async function boot() {
  try { const session = await api('/auth/session'); Object.assign(state, { authenticated: session.authenticated, demoMode: session.demoMode }); if (!state.authenticated) { renderLogin(); return; } state.page = Object.hasOwn(pages, location.hash.slice(1)) ? location.hash.slice(1) : 'overview'; shell(); await refresh(); } catch (error) { renderLogin(error); }
}
window.addEventListener('hashchange', () => { if (!state.authenticated) return; state.page = Object.hasOwn(pages, location.hash.slice(1)) ? location.hash.slice(1) : 'overview'; shell(); refresh(); });
boot();





