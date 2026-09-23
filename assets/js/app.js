/* Паспорт интерьера — движок анкеты.
 * Все тексты вопросов и координаты берутся из content/<тип>/questions.json.
 * Страницы — рендер исходного PDF; поверх них по координатам (pt A4) кладутся
 * кнопки-чекбоксы, рамки выбранных фото, лупы и линии для текста.
 * Совместимость: iOS Safari 14+, Android Chrome 90+ (без сборки и фреймворков). */
(function () {
  'use strict';

  var CFG = window.PASSPORT_CONFIG || {};
  var TYPE = detectType();
  var project = readProject();
  var FONT_PT = 9;          // кегль вписанного текста, pt
  var data, k = 1;          // k — пикселей на 1 pt
  var state = { v: {}, emails: [], phone: '', draftId: '', savedAt: 0 };
  var units = [];           // вопросы для счётчика: {id, label, answered(), anchor}
  var fields = {};          // текстовые поля: key -> {label, lines, els}
  var optEls = {};          // qid -> [{o, el(tick), frame, hits}]
  var measureCtx;

  // ——— Утилиты ———
  function detectType() {
    var parts = location.pathname.split('/').filter(Boolean);
    var last = parts[parts.length - 1] || '';
    if (/\.html?$/.test(last)) { parts.pop(); last = parts[parts.length - 1] || ''; }
    return /^[a-z0-9-]+$/.test(last) ? last : 'standard';
  }
  function readProject() {
    var m = /[?&]p=([^&#]*)/.exec(location.search);
    var p = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    return /^[\w-]{1,40}$/.test(p) ? p : '';
  }
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var a in attrs) if (attrs.hasOwnProperty(a)) e.setAttribute(a, attrs[a]);
    return e;
  }
  function pt(v) { return 'calc(var(--k) * ' + v + 'px)'; }
  function place(page, e, r) {
    e.style.left = pt(r[0]); e.style.top = pt(r[1]);
    e.style.width = pt(r[2] - r[0]); e.style.height = pt(r[3] - r[1]);
    pages[page].appendChild(e);
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function val(key) { return state.v[key] || ''; }
  function filled(key) { return /\S/.test(val(key)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function imgUrl(file, w) { return 'assets/img/' + TYPE + '/' + file + '-' + w + '.webp'; }

  var ICON_ZOOM = '<svg viewBox="0 0 24 24" fill="none" stroke="#231F20" stroke-width="2.2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';
  var ICON_TICK = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.6 5.2 4 7.6 8.9 1.8" fill="none" stroke="#151313" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ——— Ответы не сохраняются на устройстве: каждое открытие ссылки — пустая анкета ———
  function save() { state.savedAt = Date.now(); }
  // Стираем черновики, оставшиеся от прежних версий сайта
  function purgeOldDrafts() {
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var key = localStorage.key(i);
        if (key && key.indexOf('passport-draft-') === 0) localStorage.removeItem(key);
      }
    } catch (e) { /* хранилище недоступно — стирать нечего */ }
  }

  // ——— Перенос текста по линиям (общая логика с pdf.js) ———
  function measure(text) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = '300 ' + (FONT_PT * 10) + 'px Gilroy, Arial, sans-serif';
    return measureCtx.measureText(text).width / 10;   // ширина в pt
  }
  // Раскладывает текст по линиям заданной ширины (pt). Возвращает {lines, overflow}
  function wrap(text, widths, measureFn) {
    var m = measureFn || measure;
    var out = [], overflow = false;
    var words = String(text || '').replace(/\s*\n\s*/g, ' \n ').split(/ +/).filter(function (w) { return w !== ''; });
    var i = 0, cur = '';
    for (var li = 0; li < widths.length; li++) {
      var w = widths[li] - 4;
      cur = '';
      while (i < words.length) {
        var word = words[i];
        if (word === '\n') { i++; if (cur) break; else continue; }
        var cand = cur ? cur + ' ' + word : word;
        if (m(cand) <= w) { cur = cand; i++; continue; }
        if (!cur) {                      // слово длиннее линии — режем по буквам
          var cut = word.length;
          while (cut > 1 && m(word.slice(0, cut)) > w) cut--;
          cur = word.slice(0, cut); words[i] = word.slice(cut);
        }
        break;
      }
      out.push(cur);
      if (i >= words.length) break;
    }
    while (i < words.length && words[i] === '\n') i++;
    if (i < words.length) {
      overflow = true;
      var last = out.length - 1, lw = widths[last] - 4, s = out[last];
      while (s && m(s + ' …') > lw) s = s.slice(0, -1);
      out[last] = s + ' …';
    }
    return { lines: out, overflow: overflow };
  }

  // ——— Построение страниц ———
  var pages = {};
  function buildPages(root) {
    var doc = el('main', 'doc');
    data.pages.forEach(function (p) {
      var page = el('section', 'page', { 'aria-label': 'Страница ' + p.n });
      var img = el('img', 'bg', { alt: '', decoding: 'async' });
      img.setAttribute('srcset', imgUrl('pages/' + p.file, 1000) + ' 1000w, ' + imgUrl('pages/' + p.file, 1654) + ' 1654w');
      img.setAttribute('sizes', '(max-width: 916px) calc(100vw - 16px), 900px');
      img.src = imgUrl('pages/' + p.file, 1000);
      if (p.n > 2) img.setAttribute('loading', 'lazy');
      page.appendChild(img);
      doc.appendChild(page);
      pages[p.n] = page;
    });
    root.appendChild(doc);
    return doc;
  }

  function addTextField(key, label, lines, opts) {
    var f = { key: key, label: label, lines: lines, els: [], opts: opts || {} };
    lines.forEach(function (l, i) {
      var b = el('button', 'tline', { type: 'button' });
      b.addEventListener('click', function () { openEditor(key); });
      place(l[0], b, [l[1] + 2, l[2] - 13, l[3], l[2] + 1]);
      f.els.push(b);
    });
    fields[key] = f;
    renderField(key);
  }
  function renderField(key) {
    var f = fields[key];
    if (!f) return;
    var w = wrap(val(key), f.lines.map(function (l) { return l[3] - l[1]; }));
    f.els.forEach(function (b, i) {
      b.textContent = w.lines[i] || '';
      b.setAttribute('aria-label', f.label + (i === 0 ? ': ' + (val(key) || 'пусто, нажмите, чтобы написать') : ', продолжение'));
    });
  }

  function addZoom(page, photo, img) {
    var z = el('button', 'zoom', { type: 'button', 'aria-label': 'Увеличить фото' });
    z.innerHTML = ICON_ZOOM;
    z.addEventListener('click', function (e) { e.stopPropagation(); openLightbox(img); });
    place(page, z, [photo[2] - 14, photo[3] - 14, photo[2] - 4, photo[3] - 4]);
  }

  function buildQuestion(q) {
    if (q.type === 'text') {
      addTextField(q.id, q.label, q.lines);
      units.push({ q: q, answered: function () { return filled(q.id); } });
      return;
    }
    if (q.type === 'fields') {
      q.fields.forEach(function (f) { addTextField(q.id + '.' + f.id, q.label.replace(/:$/, '') + ' — ' + f.label, f.lines); });
      (q.gallery || []).forEach(function (g) { addZoom(g.page, g.photo, g.img); });
      units.push({ q: q, answered: function () { return q.fields.some(function (f) { return !f.optional && filled(q.id + '.' + f.id); }); } });
      return;
    }
    // choice
    optEls[q.id] = [];
    var photoN = 0;
    q.options.forEach(function (o) {
      var key = 'q:' + q.id + ':' + o.id;
      var rec = { o: o, key: key };
      if (o.drawBox) place(o.page, el('span', 'drawbox'), o.box);
      var tick = el('span', 'tick'); tick.innerHTML = ICON_TICK;
      rec.tick = place(o.page, tick, [o.box[0] - 0.5, o.box[1] - 1.5, o.box[0] + 8.5, o.box[1] + 7.5]);
      if (o.photo) rec.frame = place(o.page, el('span', 'frame'), o.photo);
      var name = o.label || ('Фото ' + (++photoN));
      rec.name = name;
      rec.hits = o.hits.map(function (r) {
        var b = el('button', 'hit', { type: 'button', 'aria-label': q.label + ' — ' + name, 'aria-pressed': 'false' });
        b.addEventListener('click', function () { toggle(q, o); });
        return place(o.page, b, r);
      });
      if (o.img) addZoom(o.page, o.photo, o.img);
      if (o.detail) addTextField(q.id + '.' + o.id, name + ' — ' + o.detail.label, o.detail.lines, { autoSelect: [q, o] });
      optEls[q.id].push(rec);
    });
    if (q.other) addTextField(q.id + '.other', q.label.replace(/:$/, '') + ' — ' + q.other.label, q.other.lines);
    if (q.comment) addTextField(q.id + '.comment', q.label.replace(/:$/, '') + ' — ' + q.comment.label, q.comment.lines);
    (q.gallery || []).forEach(function (g) { addZoom(g.page, g.photo, g.img); });
    units.push({ q: q, answered: function () {
      return q.options.some(function (o) { return state.v['q:' + q.id + ':' + o.id]; }) ||
        (q.other && filled(q.id + '.other')) || (q.comment && filled(q.id + '.comment'));
    } });
    renderChoice(q);
  }

  function toggle(q, o, force) {
    var key = 'q:' + q.id + ':' + o.id;
    var on = force === undefined ? !state.v[key] : force;
    if (on) {
      state.v[key] = true;   // любые варианты можно отмечать вместе, в т. ч. «На усмотрение дизайнера»
    } else {
      delete state.v[key];
    }
    renderChoice(q);
    save(); updateBar();
  }
  function renderChoice(q) {
    (optEls[q.id] || []).forEach(function (r) {
      var on = !!state.v[r.key];
      r.tick.classList.toggle('on', on);
      if (r.frame) r.frame.classList.toggle('on', on);
      r.hits.forEach(function (h) { h.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    });
  }

  function build() {
    var root = document.getElementById('app');
    root.innerHTML = '';
    document.title = data.title + ' — Antonovych Design';
    buildPages(root);
    data.cover.forEach(function (c) {
      addTextField('cover.' + c.id, c.label, c.lines);
      if (c.required) units.push({ q: { id: 'cover.' + c.id, label: c.label, lines: c.lines, cover: true }, answered: function () { return filled('cover.' + c.id); } });
    });
    data.sections.forEach(function (s) { s.questions.forEach(buildQuestion); });
    buildBar(root);
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', function () { setTimeout(fit, 300); });
    var loaded = document.fonts && document.fonts.load ? document.fonts.load('300 9px Gilroy') : Promise.resolve();
    loaded.then(function () { Object.keys(fields).forEach(renderField); });
  }
  function fit() {
    var p = pages[1];
    if (!p) return;
    k = p.getBoundingClientRect().width / data.pageSize[0];
    document.documentElement.style.setProperty('--k', String(k));
  }

  // ——— Нижняя панель и счётчик ———
  var bar = {};
  function buildBar(root) {
    var b = el('div', 'bar', { role: 'region', 'aria-label': 'Статус заполнения' });
    b.innerHTML = '<div class="gold"></div><div class="in"><div class="left"><span class="cnt"></span> ' +
      '<button type="button" class="linkbtn show">Показать</button></div>' +
      '<button type="button" class="btn send">Отправить</button></div>';
    root.appendChild(b);
    bar.cnt = b.querySelector('.cnt'); bar.show = b.querySelector('.show'); bar.gold = b.querySelector('.gold');
    bar.show.addEventListener('click', showFirstMissing);
    b.querySelector('.send').addEventListener('click', openSend);
    updateBar();
  }
  function missing() { return units.filter(function (u) { return !u.answered(); }); }
  function updateBar() {
    if (!bar.cnt) return;
    var m = missing().length, n = units.length;
    bar.cnt.innerHTML = m ? 'Без ответа: <b>' + m + '</b> из ' + n : 'Все вопросы отвечены';
    bar.show.style.display = m ? '' : 'none';
    bar.gold.style.width = Math.round((n - m) / n * 100) + '%';
  }
  function areaOf(q) {
    // Прямоугольник вопроса на первой его странице: объединение квадратиков, фото и линий
    var rects = [];
    (q.options || []).forEach(function (o) { rects.push([o.page].concat(o.hits[0])); if (o.photo) rects.push([o.page].concat(o.photo)); });
    function addLines(ls) { (ls || []).forEach(function (l) { rects.push([l[0], l[1], l[2] - 13, l[3], l[2] + 2]); }); }
    addLines(q.lines);
    (q.fields || []).forEach(function (f) { addLines(f.lines); });
    if (q.other) addLines(q.other.lines);
    if (!rects.length) return null;
    var page = Math.min.apply(null, rects.map(function (r) { return r[0]; }));
    rects = rects.filter(function (r) { return r[0] === page; });
    return [page,
      Math.min.apply(null, rects.map(function (r) { return r[1]; })) - 4,
      Math.min.apply(null, rects.map(function (r) { return r[2]; })) - 4,
      Math.max.apply(null, rects.map(function (r) { return r[3]; })) + 4,
      Math.max.apply(null, rects.map(function (r) { return r[4]; })) + 4];
  }
  function flashQuestion(q) {
    var a = areaOf(q);
    if (!a) return;
    var f = place(a[0], el('span', 'flash'), a.slice(1));
    var top = pages[a[0]].getBoundingClientRect().top + window.pageYOffset + a[2] * k - 80;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 2600);
  }
  function showFirstMissing() {
    var m = missing();
    if (m.length) flashQuestion(m[0].q);
  }

  // ——— Окна ———
  function sheet(html, opts) {
    var bg = el('div', 'sheet-bg');
    var s = el('div', 'sheet' + (opts && opts.center ? ' center' : ''), { role: 'dialog', 'aria-modal': 'true' });
    s.innerHTML = html;
    bg.appendChild(s);
    if (!(opts && opts.modal)) bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    document.body.appendChild(bg);
    document.body.style.overflow = 'hidden';
    function close() { if (bg.parentNode) bg.parentNode.removeChild(bg); document.body.style.overflow = ''; }
    return { el: s, close: close };
  }

  function openEditor(key) {
    var f = fields[key];
    var sh = sheet('<h2></h2><p class="muted">Ответ появится на линиях документа.</p>' +
      '<textarea rows="5" aria-label=""></textarea>' +
      '<div class="row"><button type="button" class="btn ghost cancel">Отмена</button><button type="button" class="btn ok">Готово</button></div>');
    sh.el.querySelector('h2').textContent = f.label;
    var ta = sh.el.querySelector('textarea');
    ta.setAttribute('aria-label', f.label);
    ta.value = val(key);
    sh.el.querySelector('.cancel').addEventListener('click', sh.close);
    sh.el.querySelector('.ok').addEventListener('click', function () {
      var v = ta.value.replace(/\s+$/, '');
      if (v) state.v[key] = v; else delete state.v[key];
      if (v && f.opts.autoSelect && !state.v['q:' + f.opts.autoSelect[0].id + ':' + f.opts.autoSelect[1].id]) {
        toggle(f.opts.autoSelect[0], f.opts.autoSelect[1], true);   // вписал размер — позиция отмечается сама
      }
      renderField(key); save(); updateBar(); sh.close();
    });
    setTimeout(function () { ta.focus(); }, 50);
  }

  function openLightbox(img) {
    var lb = el('div', 'lb', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Фото' });
    var w = img.widths[img.widths.length - 1];
    lb.innerHTML = '<img alt=""><button type="button" class="close" aria-label="Закрыть">×</button>';
    lb.querySelector('img').src = imgUrl(img.file, w);
    function close() { if (lb.parentNode) lb.parentNode.removeChild(lb); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    lb.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(lb);
  }

  // ——— Сводка ответов (для экрана отправки и для pdf.js) ———
  function answersList() {
    var out = [];
    data.cover.forEach(function (c) { out.push({ q: c.label, a: val('cover.' + c.id), unit: { id: 'cover.' + c.id, label: c.label, lines: c.lines } }); });
    data.sections.forEach(function (s) {
      s.questions.forEach(function (q) {
        var parts = [];
        if (q.type === 'text') { if (filled(q.id)) parts.push(val(q.id)); }
        else if (q.type === 'fields') {
          q.fields.forEach(function (f) { if (filled(q.id + '.' + f.id)) parts.push(f.label + ': ' + val(q.id + '.' + f.id)); });
        } else {
          (optEls[q.id] || []).forEach(function (r) {
            if (!state.v[r.key]) return;
            var d = r.o.detail && filled(q.id + '.' + r.o.id) ? ' — ' + val(q.id + '.' + r.o.id) : '';
            parts.push(r.name + d);
          });
          (optEls[q.id] || []).forEach(function (r) {   // размер вписан, а галочка снята
            if (!state.v[r.key] && r.o.detail && filled(q.id + '.' + r.o.id)) parts.push(r.name + ' — ' + val(q.id + '.' + r.o.id));
          });
          if (q.other && filled(q.id + '.other')) parts.push(q.other.label + ': ' + val(q.id + '.other'));
          if (q.comment && filled(q.id + '.comment')) parts.push(q.comment.label + ': ' + val(q.id + '.comment'));
        }
        out.push({ q: (q.num ? q.num + '. ' : '') + q.label.replace(/:$/, ''), a: parts.join('; '), parts: parts, unit: q });
      });
    });
    return out;
  }

  // ——— Отправка ———
  var EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
  var lastPdf = null;

  function openSend() {
    if (!state.emails.length) state.emails = [CFG.defaultEmail || ''];
    var list = answersList();
    var m = missing().length;
    var coverMissing = data.cover.filter(function (c) { return c.required && !filled('cover.' + c.id); });
    var html = '<h2>Проверьте ответы</h2>';
    if (m) html += '<div class="warn">Без ответа ' + m + ' из ' + units.length + '. Можно отправить и так или вернуться и дополнить.</div>';
    html += '<ul class="summary">' + list.map(function (it, i) {
      return '<li><button type="button" class="linkbtn edit" data-i="' + i + '" style="color:var(--taupe)">Изменить</button>' +
        '<span class="q">' + esc(it.q) + '</span>' + (it.a ? esc(it.a) : '<span class="miss">—</span>') + '</li>';
    }).join('') + '</ul>';
    html += '<h3>Куда прислать PDF</h3>' +
      '<div class="field"><label for="ph">' + esc(data.contact.label) + '</label>' +
      '<input id="ph" type="tel" autocomplete="tel" inputmode="tel" placeholder="+7"></div>' +
      '<div class="field"><label>На какую почту прислать PDF с ответами</label><div class="emails"></div>' +
      '<button type="button" class="linkbtn add" style="color:var(--charcoal)">+ Добавить ещё адрес</button>' +
      '<div class="muted">PDF придёт на указанные адреса в течение минуты.</div></div>' +
      '<div class="hp" aria-hidden="true"><label>Не заполняйте это поле<input type="text" class="trap" tabindex="-1" autocomplete="off"></label></div>' +
      '<div class="err msg" role="alert"></div>' +
      '<div class="row"><button type="button" class="btn ghost back">Изменить</button><button type="button" class="btn go">Отправить</button></div>';
    var sh = sheet(html);
    var s = sh.el;
    var ph = s.querySelector('#ph'); ph.value = state.phone || '';
    ph.addEventListener('input', function () { state.phone = ph.value; save(); validate(); });
    var box = s.querySelector('.emails'), add = s.querySelector('.add'), go = s.querySelector('.go'), msg = s.querySelector('.msg');
    function drawEmails() {
      box.innerHTML = '';
      state.emails.forEach(function (e, i) {
        var row = el('div', 'email-row');
        var inp = el('input', '', { type: 'email', autocomplete: 'email', inputmode: 'email', 'aria-label': 'Адрес ' + (i + 1) });
        inp.value = e;
        inp.addEventListener('input', function () { state.emails[i] = inp.value.trim(); save(); validate(); });
        row.appendChild(inp);
        if (state.emails.length > 1) {
          var rm = el('button', '', { type: 'button', 'aria-label': 'Убрать адрес' }); rm.textContent = '×';
          rm.addEventListener('click', function () { state.emails.splice(i, 1); save(); drawEmails(); validate(); });
          row.appendChild(rm);
        }
        box.appendChild(row);
      });
      add.style.display = state.emails.length < (CFG.maxEmails || 3) ? '' : 'none';
    }
    add.addEventListener('click', function () { state.emails.push(''); drawEmails(); validate(); var ins = box.querySelectorAll('input'); ins[ins.length - 1].focus(); });
    function validEmails() { return state.emails.map(function (e) { return e.trim(); }).filter(function (e) { return e; }); }
    function validate() {
      var em = validEmails(), bad = em.filter(function (e) { return !EMAIL_RE.test(e); });
      var problems = [];
      if (coverMissing.length) problems.push('Заполните на обложке: ' + coverMissing.map(function (c) { return c.label.toLowerCase(); }).join(', ') + '.');
      if ((state.phone || '').replace(/\D/g, '').length < 10) problems.push('Укажите телефон для связи.');
      if (!em.length) problems.push('Укажите хотя бы один адрес почты.');
      if (bad.length) problems.push('Проверьте адрес: ' + bad.join(', '));
      msg.textContent = problems.join(' ');
      go.disabled = problems.length > 0;
      return !problems.length;
    }
    s.querySelectorAll('.edit').forEach(function (b) {
      b.addEventListener('click', function () { sh.close(); flashQuestion(list[+b.getAttribute('data-i')].unit); });
    });
    s.querySelector('.back').addEventListener('click', sh.close);
    go.addEventListener('click', function () {
      if (!validate()) return;
      send(sh, validEmails(), s.querySelector('.trap').value);
    });
    drawEmails(); validate();
  }

  function toBase64(bytes) {
    var bin = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function fileName() {
    var d = new Date(), pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var name = val('cover.name').replace(/[^\wА-Яа-яЁё -]/g, '').trim().replace(/\s+/g, '_') || 'заказчик';
    return 'Паспорт_интерьера_' + name + '_' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.pdf';
  }
  function makePdf() {
    return window.PassportPDF.build({
      data: data, type: TYPE, value: val, selected: function (qid, oid) { return !!state.v['q:' + qid + ':' + oid]; },
      wrap: wrap, answers: answersList(), project: project, phone: state.phone, config: CFG, fontPt: FONT_PT
    });
  }
  function download(bytes) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = el('a', '', { href: url, download: fileName() });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function send(sh, emails, trap) {
    var s = sh.el;
    s.innerHTML = '<h2>Отправляем…</h2><p class="muted"><span class="spinner"></span><span class="st">Собираем PDF с ответами</span></p>';
    var st = s.querySelector('.st');
    makePdf().then(function (bytes) {
      lastPdf = bytes;
      if (!CFG.appsScriptUrl) throw { user: 'Отправка писем ещё не подключена. Скачайте PDF и перешлите его студии.' };
      st.textContent = 'Отправляем письмо';
      var payload = {
        pdf: toBase64(bytes), filename: fileName(), emails: emails, name: val('cover.name'), phone: state.phone,
        project: project, passportType: data.passportType, title: data.title, draftId: state.draftId, website: trap
      };
      return fetch(CFG.appsScriptUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); }, function () { throw { user: 'Не удалось отправить, проверьте интернет.' }; })
        .then(function (res) { if (!res || !res.ok) throw { user: (res && res.error) || 'Письмо не отправилось. Попробуйте ещё раз.' }; });
    }).then(function () {
      apply({ v: {} });   // анкета ушла — страница снова пустая
      s.innerHTML = '<h2>Спасибо! Анкета отправлена</h2><p>PDF с ответами придёт на ' + esc(emails.join(', ')) + '.</p>' +
        '<div class="row"><button type="button" class="btn ghost dl">Скачать мои ответы (PDF)</button><button type="button" class="btn ok">Закрыть</button></div>';
      s.querySelector('.dl').addEventListener('click', function () { download(lastPdf); });
      s.querySelector('.ok').addEventListener('click', function () { sh.close(); window.scrollTo(0, 0); });
    }, function (err) {
      var text = (err && err.user) || 'Не удалось собрать PDF. Попробуйте ещё раз.';
      if (err && !err.user && window.console) console.error(err);
      s.innerHTML = '<h2>Не отправлено</h2><p class="err"></p><p class="muted">Не закрывайте и не обновляйте страницу — иначе ответы пропадут.</p>' +
        '<div class="row"><button type="button" class="btn ghost dl">Скачать PDF</button><button type="button" class="btn retry">Повторить</button></div>';
      s.querySelector('.err').textContent = text;
      var dl = s.querySelector('.dl');
      if (!lastPdf) dl.style.display = 'none';
      dl.addEventListener('click', function () { download(lastPdf); });
      s.querySelector('.retry').addEventListener('click', function () { send(sh, emails, trap); });
    });
  }

  // ——— Старт ———
  function apply(draft) {
    state = { v: draft.v || {}, emails: draft.emails || [], phone: draft.phone || '', draftId: draft.draftId || uid(), savedAt: draft.savedAt || 0 };
    Object.keys(fields).forEach(renderField);
    Object.keys(optEls).forEach(function (qid) {
      data.sections.forEach(function (s) { s.questions.forEach(function (q) { if (q.id === qid) renderChoice(q); }); });
    });
    updateBar();
  }

  fetch('content/' + TYPE + '/questions.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (json) {
      data = json;
      state.draftId = uid();
      purgeOldDrafts();
      build();
    })
    .catch(function () {
      document.getElementById('app').innerHTML = '<p class="loading">Не удалось загрузить анкету. Проверьте интернет и обновите страницу.</p>';
    });
})();
