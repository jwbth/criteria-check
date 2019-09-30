import { subSeconds, subDays, subMonths, subYears } from 'date-fns';

// Чтобы сделать возможным автоматическую генерации кода вызова этих функций без использования eval
// (см. https://stackoverflow.com/questions/9464921/dynamically-call-local-function-in-javascript)
const dateFns = { subDays, subMonths, subYears, addDays };

const captureUserRegexp = /(?:Участник:|Участница:|Обсуждение_участника:|Обсуждение_участницы:|Служебная:Вклад\/)([^#\/]+)/;

export default {
  prepareDate: (date, isPeriodEnd) => {
    if (!date) return;

    let addOneDay = false;
    if (typeof date !== 'object') {
      if (date.includes(':')) {
        date += 'Z';
      } else if (isPeriodEnd) {
        addOneDay = true;
      }
      date = new Date(date);
    }

    if (addOneDay) {
      date = addDays(date, 1);
    }

    return isPeriodEnd ? subSeconds(date, 1) : date;
  },

  ddmmyyyyToYyyymmdd: (ddmmyyyy) => {
    const date = ddmmyyyy.match(/(\d{2})-(\d{2})-(\d{4})/);
    return date && `${date[3]}-${date[2]}-${date[1]}`;
  },

  getMonthNumber: (mesyats) => {
    const month = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
      'сентября', 'октября', 'ноября', 'декабря']
        .indexOf(mesyats) + 1;
    return month || null;
  },

  plural: (count, one, two, five) => {
    const cases = [five, one, two, two, two, five];  // 0, 1, 2, 3, 4, 5
    return ((count % 100 > 4 && count % 100 < 20) ? five : cases[Math.min(count % 10, 5)]);
  },

  getLastMatch: (s, regexp) => {
    if (!regexp.global) {
      console.error('Функция работает только с регулярными выражениями с флагом global.');
      return;
    }
    let matches;
    let lastMatch;
    while (matches = regexp.exec(s)) {
      lastMatch = matches;
    }
    return lastMatch;
  },

  filterUserLinks: function () {
    return decodeURIComponent($(this).attr('href')).match(captureUserRegexp);
  },

  getUserNameFromLink($link) {
    const userMatches = decodeURIComponent($link.attr('href')).match(captureUserRegexp);
    return userMatches && userMatches[1]
      .replace(/&action=edit.*/, '')
      .replace(/_/g, ' ');
  },

  removeDuplicates: (array) => [...new Set(array)],

  isntVotePage: (entry) => {
    const title = entry.title;
    const isAdminElection = title.startsWith('Википедия:Заявки на статус администратора/') &&
      title !== 'Википедия:Заявки на статус администратора/Шаблон' &&
      title !== 'Википедия:Заявки на статус администратора/Шаблон требований к голосующим' &&
      title !== 'Википедия:Заявки на статус администратора/styles.css';
    const isBureaucratElection = title.startsWith('Википедия:Заявки на статус администратора/') &&
      title !== 'Википедия:Заявки на статус администратора/Шаблон' &&
      title !== 'Википедия:Заявки на статус администратора/Шаблон требований к голосующим' &&
      title !== 'Википедия:Заявки на статус администратора/styles.css';
    const isConfirmation = title.startsWith('Википедия:Конфирмации/') &&
      title !== 'Википедия:Конфирмации/Шаблон';
    const isArbcomElection = title.startsWith('Википедия:Выборы арбитров/');
    return !(isAdminElection || isBureaucratElection || isConfirmation || isArbcomElection);
  },

  isntAutomaticAction: (event) => {
    const notCountedActions = [
      'approve-a',
      'approve-ia',
      'approve2-a',
      'approve2-ia',
      'autopatrol',
      'autopromote',
      'delete_redir',
      'hit',
      'move',
      'move_prot',
      'move_redir',
      'renameuser',
      'thank',
    ];
    return !(notCountedActions.includes(event.action) ||
        (event.type === 'create' && event.action === 'create') ||
        event.type === 'newusers'
      );
  },

  createSubFunc: (value, unit) => {
    let ending;
    switch (unit) {
      case 'day':
        ending = 'days';
        break;
      case 'month':
        ending = 'months';
        break;
      case 'year':
        ending = 'years';
        break;
      case 'days':
      case 'years':
      case 'days':
        ending = unit;
    }
    if (!ending) return;

    return (date) => (
      dateFns['sub' + ending[0].toUpperCase() + ending.slice(1)].call(null, date, value)
    );
  },

  calcOptimalLimit: (neededEditCount) => Math.round(Math.max(neededEditCount, 200) * 1.2),

  otherThanMeets: (result) => result.conclusion !== 'meets',
};