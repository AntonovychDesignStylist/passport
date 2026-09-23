// Настройки сайта. Меняются без правки остального кода.
window.PASSPORT_CONFIG = {
  // Ссылка на веб-приложение Google Apps Script (см. DEPLOY.md, шаг «Отправка писем»).
  // Пока пусто — анкету можно заполнить и скачать PDF, но письмо не уйдёт.
  appsScriptUrl: '',
  // Почта, которая по умолчанию стоит в поле получателя PDF
  defaultEmail: 'ap@antonovych-design.kz',
  // Сколько адресов можно указать за одну отправку
  maxEmails: 3,
  // Контакты студии для футера PDF и экрана «Спасибо»
  studio: {
    name: 'Antonovych Design',
    phones: ['+7 776 111 01 35', '+7 776 111 01 19'],
    email: 'ap@antonovych-design.kz',
    site: 'antonovych-design.kz',
    address: 'Амман 10 / Астана'
  }
};
