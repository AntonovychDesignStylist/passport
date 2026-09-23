/**
 * Паспорт интерьера — отправка PDF с ответами на почту.
 * Веб-приложение Google Apps Script. Ничего не сохраняет: ни таблиц, ни файлов на Диске.
 *
 * Настройки (Настройки проекта → Свойства скрипта), все необязательные:
 *   SENDER_NAME      — имя отправителя, по умолчанию «Antonovych Design»
 *   DAILY_LIMIT      — сколько писем в сутки всего, по умолчанию 60
 *   PER_DRAFT_LIMIT  — сколько отправок с одной анкеты в сутки, по умолчанию 3
 *   MAX_EMAILS       — сколько адресов в одной отправке, по умолчанию 3
 */

var EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
var MAX_PDF_BYTES = 10 * 1024 * 1024;

function doGet() {
  return ContentService.createTextOutput('Паспорт интерьера: сервис отправки работает.');
}

function doPost(e) {
  try {
    return json(handle(JSON.parse(e.postData.contents)));
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'Письмо не отправилось. Попробуйте ещё раз через минуту.' });
  }
}

function handle(p) {
  var props = PropertiesService.getScriptProperties();
  var maxEmails = Number(props.getProperty('MAX_EMAILS')) || 3;
  var dailyLimit = Number(props.getProperty('DAILY_LIMIT')) || 60;
  var perDraft = Number(props.getProperty('PER_DRAFT_LIMIT')) || 3;
  var sender = props.getProperty('SENDER_NAME') || 'Antonovych Design';

  // Ловушка для ботов: настоящий человек это поле не видит и не заполняет
  if (p.website) return { ok: true };

  var emails = (p.emails || []).map(function (s) { return String(s).trim(); }).filter(String);
  if (!emails.length) return { ok: false, error: 'Укажите хотя бы один адрес почты.' };
  if (emails.length > maxEmails) return { ok: false, error: 'Можно указать не больше ' + maxEmails + ' адресов.' };
  for (var i = 0; i < emails.length; i++) {
    if (!EMAIL_RE.test(emails[i])) return { ok: false, error: 'Проверьте адрес: ' + emails[i] };
  }
  if (!p.pdf || typeof p.pdf !== 'string') return { ok: false, error: 'PDF не получен. Попробуйте ещё раз.' };
  var bytes = Utilities.base64Decode(p.pdf);
  if (bytes.length > MAX_PDF_BYTES) return { ok: false, error: 'PDF слишком большой.' };

  // Лимиты: не больше N писем с одной анкеты и M писем в сутки всего
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cache = CacheService.getScriptCache();
    var day = Utilities.formatDate(new Date(), 'Asia/Almaty', 'yyyy-MM-dd');
    var dayKey = 'day-' + day;
    var draftKey = 'draft-' + String(p.draftId || 'none').slice(0, 40);
    var dayCount = Number(props.getProperty(dayKey)) || 0;
    var draftCount = Number(cache.get(draftKey)) || 0;
    if (dayCount + emails.length > dailyLimit) {
      return { ok: false, error: 'Сегодня отправлено слишком много писем. Попробуйте завтра или скачайте PDF и перешлите студии.' };
    }
    if (draftCount >= perDraft) {
      return { ok: false, error: 'Эта анкета уже отправлялась несколько раз. Попробуйте позже.' };
    }
    if (MailApp.getRemainingDailyQuota() < emails.length) {
      return { ok: false, error: 'Почтовый лимит на сегодня исчерпан. Попробуйте завтра.' };
    }

    var name = clean(p.name) || 'Заказчик';
    var project = clean(p.project);
    var subject = (clean(p.title) || 'Паспорт интерьера') + ' — ' + name + (project ? ' — ' + project : '');
    var filename = clean(p.filename).replace(/[\\/:*?"<>|]/g, '') || 'Паспорт_интерьера.pdf';
    if (!/\.pdf$/i.test(filename)) filename += '.pdf';
    var blob = Utilities.newBlob(bytes, 'application/pdf', filename);

    // Текст письма фиксированный: ответы заказчика есть только внутри PDF
    var body = 'Здравствуйте!\n\n' +
      'Во вложении — PDF с ответами на анкету «Паспорт интерьера».\n\n' +
      'Antonovych Design\n+7 776 111 01 35, +7 776 111 01 19\nap@antonovych-design.kz · antonovych-design.kz\nАмман 10 / Астана';
    MailApp.sendEmail({ to: emails.join(','), subject: subject, body: body, name: sender, attachments: [blob] });

    props.setProperty(dayKey, String(dayCount + emails.length));
    cache.put(draftKey, String(draftCount + 1), 21600);
    cleanupOldDays(props, dayKey);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function clean(s) {
  return String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
}

function cleanupOldDays(props, keep) {
  var all = props.getKeys();
  for (var i = 0; i < all.length; i++) {
    if (/^day-/.test(all[i]) && all[i] !== keep) props.deleteProperty(all[i]);
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
