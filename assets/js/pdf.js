/* Паспорт интерьера — сборка PDF с ответами на телефоне (pdf-lib + fontkit).
 * Страницы 1–N: исходные страницы анкеты с галочками, рамками фото и вписанным текстом.
 * В конце — «Сводка ответов» текстом: там полностью видны длинные ответы. */
(function () {
  'use strict';

  var libs = null;
  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { fail({ user: 'Не удалось загрузить модуль PDF. Проверьте интернет.' }); };
      document.head.appendChild(s);
    });
  }
  function loadLibs() {
    if (!libs) libs = loadScript('assets/js/vendor/pdf-lib.min.js').then(function () { return loadScript('assets/js/vendor/fontkit.umd.min.js'); });
    return libs;
  }
  function fetchBytes(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw { user: 'Не удалось загрузить файлы анкеты. Проверьте интернет.' };
      return r.arrayBuffer();
    }, function () { throw { user: 'Не удалось загрузить файлы анкеты. Проверьте интернет.' }; });
  }
  // WebP -> JPEG через canvas (pdf-lib встраивает только JPEG/PNG)
  function webpToJpeg(url, quality) {
    return new Promise(function (ok, fail) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        c.toBlob(function (b) {
          if (!b) return fail({ user: 'Не хватило памяти для сборки PDF.' });
          b.arrayBuffer ? b.arrayBuffer().then(ok, fail) : new Response(b).arrayBuffer().then(ok, fail);
        }, 'image/jpeg', quality);
      };
      img.onerror = function () { fail({ user: 'Не удалось загрузить страницы анкеты. Проверьте интернет.' }); };
      img.src = url;
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function build(ctx) {
    var data = ctx.data, H = data.pageSize[1], W = data.pageSize[0];
    return loadLibs().then(function () {
      var PL = window.PDFLib;
      return Promise.all([
        PL.PDFDocument.create(),
        fetchBytes('assets/fonts/pdf/gilroy-light.otf'),
        fetchBytes('assets/fonts/pdf/gilroy-medium.otf')
      ]).then(function (r) {
        var doc = r[0];
        doc.registerFontkit(window.fontkit);
        doc.setTitle(data.title + (ctx.value('cover.name') ? ' — ' + ctx.value('cover.name') : ''));
        doc.setAuthor(ctx.config.studio ? ctx.config.studio.name : 'Antonovych Design');
        doc.setCreator('passport');
        // subset: false — шрифты уже урезаны заранее; повторное урезание в pdf-lib портит CFF-шрифты
        return Promise.all([doc.embedFont(r[1], { subset: false }), doc.embedFont(r[2], { subset: false })]).then(function (f) {
          return render(PL, doc, f[0], f[1]);
        });
      });
    });

    function render(PL, doc, light, medium) {
      // Символы, которых нет в урезанном шрифте (эмодзи и т. п.), заменяем, иначе PDF не соберётся
      var charset = {};
      light.getCharacterSet().forEach(function (c) { charset[c] = true; });
      var clean = function (s) {
        return Array.from(String(s)).map(function (ch) {
          var c = ch.codePointAt(0);
          return charset[c] || ch === '\n' ? ch : (/\s/.test(ch) ? ' ' : '·');
        }).join('');
      };
      var value = ctx.value;
      ctx = Object.assign({}, ctx, {
        value: function (k) { return clean(value(k)); },
        answers: ctx.answers.map(function (a) { return { q: clean(a.q), a: clean(a.parts ? a.parts.join('\n') : a.a) }; }),
        phone: clean(ctx.phone || ''), project: clean(ctx.project || '')
      });
      var ink = PL.rgb(21 / 255, 19 / 255, 19 / 255), taupe = PL.rgb(74 / 255, 69 / 255, 66 / 255);
      var gold = PL.rgb(198 / 255, 131 / 255, 70 / 255), paper = PL.rgb(245 / 255, 245 / 255, 245 / 255);
      var measure = function (s) { return light.widthOfTextAtSize(s, ctx.fontPt); };
      var pages = {};
      var now = new Date();
      var dateStr = pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear();

      // 1. Страницы анкеты — последовательно, чтобы не держать в памяти все картинки сразу
      var chain = Promise.resolve();
      data.pages.forEach(function (p) {
        chain = chain.then(function () {
          return webpToJpeg('assets/img/' + ctx.type + '/pages/' + p.file + '-1654.webp', 0.72);
        }).then(function (jpg) {
          return doc.embedJpg(jpg);
        }).then(function (img) {
          var page = doc.addPage([W, H]);
          page.drawImage(img, { x: 0, y: 0, width: W, height: H });
          pages[p.n] = page;
        });
      });

      return chain.then(function () {
        function tick(pg, box) {
          pages[pg].drawSvgPath('M1.6 5.2 L4 7.6 L8.9 1.8', {
            x: box[0] - 0.5, y: H - (box[1] - 1.5), scale: 0.9,
            borderColor: ink, borderWidth: 1.5, borderLineCap: PL.LineCapStyle.Round
          });
        }
        function lines(key, ls) {
          var v = ctx.value(key);
          if (!/\S/.test(v)) return;
          var w = ctx.wrap(v, ls.map(function (l) { return l[3] - l[1]; }), measure);
          w.lines.forEach(function (s, i) {
            if (!s) return;
            var l = ls[i];
            pages[l[0]].drawText(s, { x: l[1] + 2, y: H - (l[2] - 1.8), size: ctx.fontPt, font: light, color: ink });
          });
        }

        data.cover.forEach(function (c) { lines('cover.' + c.id, c.lines); });
        data.sections.forEach(function (s) {
          s.questions.forEach(function (q) {
            if (q.type === 'text') return lines(q.id, q.lines);
            if (q.type === 'fields') return q.fields.forEach(function (f) { lines(q.id + '.' + f.id, f.lines); });
            q.options.forEach(function (o) {
              var on = ctx.selected(q.id, o.id);
              if (o.drawBox && on) {
                pages[o.page].drawRectangle({ x: o.box[0], y: H - o.box[3], width: o.box[2] - o.box[0], height: o.box[3] - o.box[1],
                  color: paper, borderColor: taupe, borderWidth: 0.6 });
              }
              if (on) tick(o.page, o.box);
              if (on && o.photo) {
                pages[o.page].drawRectangle({ x: o.photo[0], y: H - o.photo[3], width: o.photo[2] - o.photo[0], height: o.photo[3] - o.photo[1],
                  borderColor: ink, borderWidth: 1.3 });
              }
              if (o.detail) lines(q.id + '.' + o.id, o.detail.lines);
            });
            if (q.other) lines(q.id + '.other', q.other.lines);
            if (q.comment) lines(q.id + '.comment', q.comment.lines);
          });
        });

        // Штамп на обложке: дата, код проекта, телефон
        var stamp = ['Заполнено ' + dateStr];
        if (ctx.project) stamp.push('Проект: ' + ctx.project);
        if (ctx.phone) stamp.push('Тел.: ' + ctx.phone);
        pages[1].drawText(stamp.join('   ·   '), { x: 27, y: H - 790, size: 8, font: light, color: taupe });

        // 2. Сводка ответов
        summary(PL, doc, light, medium, ink, taupe, gold, dateStr);
        return doc.save();
      });
    }

    function summary(PL, doc, light, medium, ink, taupe, gold, dateStr) {
      var M = 42, maxW = W - 2 * M, y = 0, page, pageNo = 0, first = data.pages.length + 1;
      var st = ctx.config.studio || {};
      function newPage() {
        page = doc.addPage([W, H]); pageNo++;
        page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PL.rgb(245 / 255, 245 / 255, 245 / 255) });
        page.drawText('ANTONOVYCH DESIGN', { x: M, y: H - 40, size: 9, font: medium, color: taupe });
        page.drawLine({ start: { x: M, y: H - 50 }, end: { x: M + 40, y: H - 50 }, thickness: 0.6, color: gold });
        var foot = [].concat(st.phones || [], [st.email, st.site, st.address]).filter(Boolean).join('   ·   ');
        page.drawText(foot, { x: M, y: 28, size: 7, font: light, color: taupe });
        var num = String(first + pageNo - 1);
        page.drawText(num, { x: W - M - light.widthOfTextAtSize(num, 8), y: 28, size: 8, font: light, color: taupe });
        y = H - 78;
      }
      function para(text, font, size, color, gap) {
        var words = String(text).split(/\s+/), line = '';
        function flush() {
          if (y < 60) newPage();
          page.drawText(line, { x: M, y: y, size: size, font: font, color: color });
          y -= size * 1.35; line = '';
        }
        String(text).split('\n').forEach(function (raw) {
          words = raw.split(/ +/);
          words.forEach(function (w) {
            var cand = line ? line + ' ' + w : w;
            if (font.widthOfTextAtSize(cand, size) <= maxW) { line = cand; return; }
            if (line) flush();
            while (font.widthOfTextAtSize(w, size) > maxW) {       // очень длинное слово
              var cut = w.length;
              while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--;
              line = w.slice(0, cut); flush(); w = w.slice(cut);
            }
            line = w;
          });
          if (line) flush();
        });
        y -= gap || 0;
      }
      newPage();
      para('Сводка ответов', medium, 16, ink, 4);
      var meta = [data.title + (data.subtitle ? ' · ' + data.subtitle : ''), 'Заполнено ' + dateStr];
      if (ctx.project) meta.push('Проект: ' + ctx.project);
      if (ctx.phone) meta.push('Телефон: ' + ctx.phone);
      para(meta.join('   ·   '), light, 9, taupe, 12);
      ctx.answers.forEach(function (it) {
        if (y < 90) newPage();
        para(it.q, medium, 9.5, taupe, 1);
        para(it.a || '—', light, 10, ink, 9);
      });
    }
  }

  window.PassportPDF = { build: build };
})();
