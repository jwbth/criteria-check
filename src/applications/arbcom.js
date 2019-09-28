import cc from '../cc';

import { subMonths, addDays } from 'date-fns';

export default {
  getVoterCriteria: (nominationStartDate) => [
    {
      text: 'стаж не менее трёх месяцев',
      name: 'registrationDateNotLater',
      // addDays, потому что трактовка с датой невключительно закреплена на основных страницах
      // выборов
      value: addDays(subMonths(nominationStartDate, 3), 1),
    },
    {
      text: 'не менее 500 действий к началу выдвижения кандидатов',
      name: 'actionCountNotLess',
      value: 500,
      periodEnd: nominationStartDate,
      filterVotes: true,
    },
    {
      text: 'не менее 100 действий за последние полгода до начала выдвижения кандидатов',
      name: 'actionCountNotLess',
      value: 100,
      periodStart: subMonths(nominationStartDate, 6),
      periodEnd: nominationStartDate,
      filterVotes: true,
    },
  ],

  getCandidateCriteria: (nominationStartDate) => [
    {
      text: 'с момента регистрации в русской Википедии до момента начала номинации кандидатов прошло не менее 8 месяцев',
      name: 'registrationDateNotLater',
      // addDays, потому что эта трактовка закреплена на основных страницах выборов
      value: addDays(subMonths(nominationStartDate, 8), 1),
    },
    {
      text: 'сделал в русской Википедии не менее 2000 правок до момента начала номинации',
      name: 'editCountNotLess',
      value: 2000,
      periodEnd: nominationStartDate,
    },
    {
      text: 'Кандидатом в арбитры не может быть бессрочно заблокированный участник, а также участник, имеющий на момент начала выдвижения кандидатур блокировку, срок действия которой истекает после окончания процедуры обсуждения кандидатур арбитров',
      name: 'noActiveBlockBetweenDates',
      ns: 4,
      periodStart: nominationStartDate,
      periodEnd: addDays(nominationStartDate, 10),
    },
  ],

  extractVoters: async (election) => {
    if (!election) return;
    election = encodeURI(election.replace(/ /g, '_'));
    const response = await fetch(`https://ru.wikipedia.org/wiki/%D0%92%D0%B8%D0%BA%D0%B8%D0%BF%D0%B5%D0%B4%D0%B8%D1%8F:%D0%92%D1%8B%D0%B1%D0%BE%D1%80%D1%8B_%D0%B0%D1%80%D0%B1%D0%B8%D1%82%D1%80%D0%BE%D0%B2/${election}/%D0%93%D0%BE%D0%BB%D0%BE%D1%81%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5/*`, {
      credentials: 'omit',
    });
    const text = await response.text();
    const content = text
      .replace(/^[\s\S]+id="mw-content-text"[^>]+>/, '')
      .replace(/<\/div><noscript>[\s\S]+$/, '');
    const $sandbox = $('<div>')
      .addClass('criteriaCheck-sandbox')
      .append(content)
      .appendTo('body');

    const $userLinks = $sandbox
      .find('.mw-parser-output table:has(td[id]) a')
      .filter(cc.util.filterUserLinks);
    const voters = cc.util.removeDuplicates($userLinks
      .map((i, el) => cc.util.getUserNameFromLink($(el)))
      .get()
    );
    $sandbox.remove();
    return voters;
  },
};