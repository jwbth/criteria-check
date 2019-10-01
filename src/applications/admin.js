import cc from '../cc';

import { addDays, subMonths, subYears } from 'date-fns';

function extractVotes() {
  return $('#За')
    .closest('h3')
    .nextUntil('h3:has([id^="Вопросы"])')
    .filter('ol')
    .children('li')
    .map((i, li) => {
      let date;
      const $li = $(li);
      const $el = $li.clone();
      $el.find('li, dd').remove();

      const text = $el.text();
      const matches = cc.util.getLastMatch(text, /(\b\d?\d):(\d\d), (\d\d?) ([а-я]+) (\d\d\d\d) \(UTC\)/g);
      if (matches) {
        const hours = matches[1];
        const minutes = matches[2];
        const day = matches[3];
        const month = cc.util.getMonthNumber(matches[4]);
        const year = matches[5];
        if (!month) return;
        date = new Date(`${year}-${month}-${day} ${hours}:${minutes}Z`);
      }

      const $userLinks = $el
        .find('a')
        .filter(cc.util.filterUserLinks);
      const usersInMsg = $userLinks
        .map((i, el) => cc.util.getUserNameFromLink($(el)))
        .get();

      const authorName = usersInMsg[usersInMsg.length - 1];
      if (!authorName) return;
      const author = cc.getUser(authorName);

      const vote = {
        $el: $li,
        author,
        date,
        confusingAuthor: cc.util.removeDuplicates(usersInMsg).length > 1 &&
          (!/\(UTC\)\s*/.test(text) ||
            text.indexOf('(UTC)') !== text.lastIndexOf('(UTC)') ||
            $userLinks.closest('small').length
          ),
        anchor: `vote${i}`,
      };
      author.votes.push(vote);
      return vote;
    }).get();
}

function updateButtonsBlock() {
  $buttonsBlock.children().detach();
  $(buttons).map((i, el) => el.hide ? null : el.$element[0]).appendTo($buttonsBlock);
}

function showButton(id) {
  for (const button of buttons) {
    if (id === button.bindings.click[0].method.name) {
      button.hide = false;
    }
  }
  updateButtonsBlock();
}

function hideButton(id) {
  for (const button of buttons) {
    if (id === button.bindings.click[0].method.name) {
      button.hide = true;
    }
  }
  updateButtonsBlock();
}

let $criteriaBox;
let buttons;
let $buttonsBlock;
let rawCriteria = false;
let candidate;
let voterCriteria;
let candidateCriteria;
let votingPeriod;
let votingPeriodOk;
let resultsTable;
let isRelevantPage;

export default {
  getAdminCandidateCriteria: (votingPeriod) => [
    {
      text: 'стаж регистрации в русскоязычном разделе Википедии не менее 6 месяцев',
      name: 'registrationDateNotLater',
      // Прибавляем один день согласно тому, как считается разница в критериях для голосующих и на
      // выборах в АК
      value: subMonths(votingPeriod.startNextDay, 6),
    },
    {
      text: 'не менее 1000 правок',
      name: 'editCountNotLess',
      value: 1000,
      periodEnd: votingPeriod.start,
    },
    {
      text: 'не баллотировавшийся в администраторы в последние 3 месяца',
      needsManualCheck: true,
    },
    {
      text: 'не лишённый полномочий администратора в последние 3 месяца',
      name: 'notLostFlagInLast',
      flag: 'sysop',
      value: 3,
      unit: 'month',
      referenceDate: votingPeriod.startNextDay,
    },
  ],

  getBureaucratCandidateCriteria: (votingPeriod) => [
    {
      text: 'стаж регистрации в русскоязычном разделе Википедии не менее 2 лет',
      name: 'registrationDateNotLater',
      // Прибавляем один день согласно тому, как считается разница в критериях для голосующих и на
      // выборах в АК
      value: addDays(subMonths(votingPeriod.startNextDay, 2), 1),
    },
    {
      text: 'не менее 2000 правок',
      name: 'editCountNotLess',
      value: 2000,
      periodEnd: votingPeriod.start,
    },
    {
      text: 'выполнявший обязанности администратора Википедии либо арбитра в течение не менее полугода до момента выдвижения',
      name: 'hadFlagFor',
      flags: ['sysop', 'arbcom'],
      value: 6,
      unit: 'month',
      referenceDate: votingPeriod.startNextDay,
    },
    {
      text: 'не имевший за последний год периодов неактивности в русской Википедии длительностью более 3 месяцев',
      name: 'notInactiveFor',
      value: 3,
      unit: 'month',
      periodStart: subYears(votingPeriod.startNextDay, 1),
      periodEnd: votingPeriod.startNextDay,
    },
    {
      text: 'не имевший за последние полгода до момента выдвижения взысканий, наложенных Арбитражным комитетом по итогам рассмотрения исков против кандидата',
      needsManualCheck: true,
      comment: '(См. <a href="https://ru.wikipedia.org/wiki/Арбитраж:Решения">Арбитраж:Решения</a>.)',
    },
    {
      text: 'не баллотировавшийся в бюрократы в последние 3 месяца',
      needsManualCheck: true,
    },
    {
      text: 'не лишённый полномочий бюрократа в последние 3 месяца',
      name: 'notLostFlagInLast',
      flag: 'bureaucrat',
      value: 3,
      unit: 'month',
      referenceDate: votingPeriod.startNextDay,
    },
  ],

  isRelevantPage: () => {
    if (typeof isRelevantPage === 'undefined') {
      isRelevantPage = Boolean($('.criteriaCheck-adminElection, .criteriaCheck-bureaucratElection, .criteriaCheck-confirmation').length);
    }
    return isRelevantPage;
  },

  main: () => {
    // Данные по голосующим
    $criteriaBox = $('.criteriaCheck-criteria');
    voterCriteria = cc.extractCriteria($criteriaBox);

    if (!$criteriaBox.length) {
      $criteriaBox = $('#Требования_к_голосующим').closest('h3').next('div');
      $criteriaBox.addClass('criteriaCheck-criteria');
    }
    let criteria4End;
    if (!voterCriteria.length) {
      rawCriteria = true;
      const $criteria = $criteriaBox.find('li');

      const criteria1Text = $criteria.eq(0).text().replace(/[,;.]$/, '');
      const criteria1Matches = criteria1Text.match(/(\d+) прав/);
      const criteria1Value = criteria1Matches && Number(criteria1Matches[1]);

      const criteria2Text = $criteria.eq(1).text().replace(/[,;.]$/, '');
      const criteria2Matches = criteria2Text.match(/\d{2}-\d{2}-\d{4}/);
      const criteria2Value = criteria2Matches && cc.util.ddmmyyyyToYyyymmdd(criteria2Matches[0]);

      const criteria3Text = $criteria.eq(2).text().replace(/[,;.]$/, '');
      const criteria3Matches = criteria3Text.match(/(\d{2}-\d{2}-\d{4}) по (\d{2}-\d{2}-\d{4})/);
      const criteria3Start = criteria3Matches && cc.util.ddmmyyyyToYyyymmdd(criteria3Matches[1]);
      const criteria3End = criteria3Matches && cc.util.ddmmyyyyToYyyymmdd(criteria3Matches[2]);

      const criteria4Text = $criteria.eq(3).text().replace(/[,;.]$/, '');
      const criteria4Matches = criteria4Text.match(/(\d{2}-\d{2}-\d{4}) по (\d{2}-\d{2}-\d{4})/);
      const criteria4Start = criteria4Matches && cc.util.ddmmyyyyToYyyymmdd(criteria4Matches[1]);
      criteria4End = criteria4Matches && cc.util.ddmmyyyyToYyyymmdd(criteria4Matches[2]);

      voterCriteria = [
        {
          text: criteria1Text,
          name: 'editCountNotLess',
          ns: 0,
          value: criteria1Value,
          periodEnd: criteria4End,
          meaningful: true,
        },
        {
          text: criteria2Text,
          name: 'registrationDateNotLater',
          value: criteria2Value,
        },
        {
          text: criteria3Text,
          name: 'editsBetweenDates',
          periodStart: criteria3Start,
          periodEnd: criteria3End,
        },
        {
          text: criteria4Text,
          name: 'editsBetweenDates',
          periodStart: criteria4Start,
          periodEnd: criteria4End,
        },
      ];
    }

    const deriveDates = (votingPeriod) => {
      if (!votingPeriod.start) return;
      votingPeriod.startTimeless = cc.util.prepareDate(votingPeriod.start.replace(/ [0-9:]+$/g, ''));
      votingPeriod.start = cc.util.prepareDate(votingPeriod.start);
      if (!votingPeriod.start) return;
      votingPeriod.startNextDay = addDays(votingPeriod.startTimeless, 1);
      votingPeriod.end = cc.util.prepareDate(votingPeriod.end, true);
      return votingPeriod;
    };

    votingPeriod = Object.assign({}, $('.criteriaCheck-votingPeriod').data());
    votingPeriod = deriveDates(votingPeriod);

    if (!votingPeriod &&
      // Удостоверяемся, что критерий тот, который нам нужен
      voterCriteria.length === 4 &&
      voterCriteria[3].name === 'editsBetweenDates' &&
      voterCriteria[3].periodEnd
    ) {
      votingPeriod = deriveDates({ start: voterCriteria[3].periodEnd });
    }

    votingPeriodOk = votingPeriod && votingPeriod.start && votingPeriod.end;

    // Данные по кандидату
    candidate = $criteriaBox.length && cc.getUser(cc.util.getUserNameFromLink($('h2')
      .find('a')
      .filter(cc.util.filterUserLinks)
      .first()
    ));

    if (votingPeriod) {
      if ($('.criteriaCheck-adminElection').length) {
        candidateCriteria = cc.admin.getAdminCandidateCriteria(votingPeriod);
      }
      if ($('.criteriaCheck-bureaucratElection').length) {
        candidateCriteria = cc.admin.getBureaucratCandidateCriteria(votingPeriod);
      }
    }

    // Парсим таблицу результатов
    resultsTable = {
      supportVotesCount: Number($('.criteriaCheck-supportVotesCount').text()),
      opposeVotesCount: Number($('.criteriaCheck-opposeVotesCount').text()),
      neutralVotesCount: Number($('.criteriaCheck-neutralVotesCount').text()),
      supportPercent: Number($('.criteriaCheck-supportPercent')
        .text()
        .replace(/[^0-9,.]/g, '')
        .replace(/,/, '.')
      ),
    };
    resultsTable.totalVotes = resultsTable.supportVotesCount + resultsTable.opposeVotesCount +
      resultsTable.neutralVotesCount;

    // Выводим в глобальный объект на случай, если какой-то скрипт захочет воспользоваться данными
    cc.admin.candidate = candidate;
    cc.admin.voterCriteria = voterCriteria;
    cc.admin.candidateCriteria = candidateCriteria;
    cc.admin.votingPeriod = votingPeriod;
    cc.admin.resultsTable = resultsTable;

    // Создаём блок ссылок
    $buttonsBlock = $('<div>').addClass('criteriaCheck-buttonsBlock');

    buttons = [];
    if (mw.config.get('wgUserName')) {
      const $button = new OO.ui.ButtonWidget({
        label: 'Проверить, соответствую ли я требованиям',
        classes: ['criteriaCheck-button'],
      });
      $button.on('click', cc.admin.checkMe);
      buttons.push($button);
    }
    if (mw.config.get('wgUserGroups').includes('bureaucrat') || cc.currentUser === candidate || true) {
      const $button = new OO.ui.ButtonWidget({
        label: 'Проверить все голоса',
        classes: ['criteriaCheck-button'],
      });
      $button.on('click', cc.admin.checkAll);
      buttons.push($button);
    }
    if (candidateCriteria &&
      (mw.config.get('wgUserGroups').includes('bureaucrat') || cc.currentUser === candidate || true)
    ) {
      const $button = new OO.ui.ButtonWidget({
        label: 'Проверить соответствие кандидата требованиям для выдвижения',
        classes: ['criteriaCheck-button'],
      });
      $button.on('click', cc.admin.checkCandidate);
      buttons.push($button);
    };

    updateButtonsBlock();

    $buttonsBlock.appendTo($criteriaBox);
  },

  checkMe: async () => {
    hideButton('checkMe');
    const $checkingMessage = cc.createMessage({
      icon: 'loading',
      text: 'Проверяем…',
      big: true,
    }).appendTo($criteriaBox);

    let summary;
    let message = {
      icons: [],
      texts: [],
    };
    try {
      summary = cc.summarize(await cc.currentUser.check(voterCriteria));
    } catch (e) {
      console.error(e);
      message = {
        icons: ['error'],
        texts: ['Не удалось завершить проверку. См. подробности в консоли (F12 → Консоль). '],
      };
      showButton('checkMe');
    }

    if (summary) {
      if (summary.conclusion === 'meets') {
        message = {
          icons: ['check'],
          texts: ['Ура, вы соответствуете требованиям и можете голосовать. '],
        };
      } else if (summary.conclusion === 'notMeets') {
        let text = `К сожалению, вы не соответствуете требованию: <em>${summary.firstFailedResult.criterion.text}</em>. `;
        if (summary.firstFailedResult.criterion.name === 'editCountNotLess') {
          text += `У вас только ${summary.firstFailedResult.editCount} правок. `;
        }
        message = {
          icons: ['close'],
          texts: [text],
        };
      } else if (summary.conclusion === 'possiblyMeets') {
        message.icons = ['help'];
        for (const result of summary.results.filter(cc.util.otherThanMeets)) {
          let text = `Вы можете не соответствовать требованию: <em>${result.criterion.text}</em>. `;
          if (result.criterion.name === 'editCountNotLess') {
            text += `У вас ${result.editCount} правок, но, согласно <a href="https://ru.wikipedia.org/wiki/Википедия:Правила_выборов_администраторов_и_бюрократов#Кто_может_голосовать_на_выборах_бюрократов_и_администраторов">правилам</a>, незначительные правки не учитываются при подсчёте. Требуется ручной подсчёт. `;
          }
          message.texts.push(text);
        }
      }
    }

    const currentDate = new Date();
    if (votingPeriodOk &&
      (currentDate < votingPeriod.start ||
        currentDate > votingPeriod.end ||
        $criteriaBox.closest('.ruwiki-closedDiscussion').length
      )
    ) {
      message.texts[message.texts.length - 1] += currentDate < votingPeriod.start
        ? 'Однако, голосование ещё не началось. '
        : 'Однако, голосование уже закончилось. ';
    }
    message.big = true;

    $checkingMessage.remove();
    $criteriaBox.append(cc.createMessage(message));
  },

  checkAll: async () => {
    hideButton('checkAll');
    $('.criteriaCheck-message').filter(function () {
      return !$(this).closest($criteriaBox).length;
    }).remove();
    const $criteriaBoxMessage = cc.createMessage({
      icon: 'loading',
      text: 'Проверяем все голоса (<span class="criteriaCheck-checkedPercent">0</span>%)…',
      big: true,
    }).appendTo($criteriaBox);
    const $checkedPercent = $criteriaBoxMessage.find('.criteriaCheck-checkedPercent');

    const votes = extractVotes();
    cc.admin.votes = votes;

    const votesSummary = {
      meets: [],
      notMeets: [],
      possiblyMeets: [],
      error: [],
    };
    for (let i = 0; i < votes.length; i++) {
      $checkedPercent.text(Math.round((i / votes.length) * 100));

      const vote = votes[i];
      const $target = vote.$el.contents().first().is('p, div')
        ? vote.$el.contents().first()
        : vote.$el;
      const $message = cc.createMessage({ icon: 'loading' });
      $target.prepend($message);

      let message = {
        icons: [],
        texts: [],
      };
      let category;
      let badTiming = false;
      let fitsOtherCriteria = true;

      if (votingPeriodOk && vote.date &&
        (vote.date < votingPeriod.start || vote.date > votingPeriod.end)
      ) {
        badTiming = true;
        category = 'notMeets';
        message = {
          icons: ['close'],
          texts: [vote.date < votingPeriod.start
            ? 'Голос подан до начала голосования.'
            : 'Голос подан после окончания голосования.'
          ],
        };
      }

      for (let j = 0; j < i; j++) {
        if (votes[j].author.name === vote.author.name) {
          category = 'notMeets';
          message = {
            icons: ['close'],
            texts: [vote.author.nameWhenVoted + ' уже голосовал.'],
          };
          break;
        }
      }

      let summary;
      if (!category) {
        try {
          summary = cc.summarize(await vote.author.check(voterCriteria));
        } catch (e) {
          console.error(e);
          category = 'error';
          message = {
            icons: ['error'],
            texts: ['Не удалось завершить проверку. См. подробности в консоли (F12 → Консоль).'],
          };
        }
      }

      if (summary) {
        category = summary.conclusion;
        if (summary.conclusion === 'meets') {
          message = {
            icons: ['check'],
            texts: [],
          };
        } else if (summary.conclusion === 'userMissing' || summary.warnings.includes('0edits')) {
          category = 'possiblyMeets';
          const logLink = mw.util.getUrl('Служебная:Журналы', {
            page: 'Участник:' + vote.author.name,
          });
          message = {
            icons: ['help'],
            texts: [summary.conclusion === 'userMissing'
              ? `Участник ${vote.author.name} не найден. Скорее всего, он был переименован, но в <a href="${logLink}">журнале</a> не найдено записи об этом. Необходима ручная проверка. `
              : `У участника ${vote.author.name} всего 0 правок. Скорее всего, он был переименован, но в <a href="${logLink}">журнале</a> не найдено записи об этом. Необходима ручная проверка. `
            ],
          };
          fitsOtherCriteria = false;
        } else if (summary.conclusion === 'notMeets') {
          let text = `Участник не соответствует требованию: <em>${summary.firstFailedResult.criterion.text}</em>. `;
          if (summary.firstFailedResult.criterion.name === 'editCountNotLess') {
            text += `У участника только ${summary.firstFailedResult.editCount} правок. `;
          }
          message = {
            icons: ['close'],
            texts: [text],
          };
        } else if (summary.conclusion === 'possiblyMeets') {
          message.icons = ['help'];
          for (const result of summary.results.filter(cc.util.otherThanMeets)) {
            let text = `Участник может не соответствовать требованию: <em>${result.criterion.text}</em>. `;
            if (result.criterion.name === 'editCountNotLess') {
              text += `У участника ${result.editCount} правок. `;
            }
            text += 'Необходима ручная проверка. ';
            // Если встретятся 2 и больше possiblyMeets или будет сомнение, что критерии проверены для
            // того участника (если в реплике больше одной ссылки на участника; см., например,
            // [[Википедия:Заявки на статус бюрократа/Deinocheirus]]), текст и во втором случае иконки
            // должны накапливаться.
            message.texts.push(text);
          }
        }
      }

      if (vote.confusingAuthor && !badTiming) {
        category = 'possiblyMeets';
        message.icons.push('help');
        message.texts.push(`Из-за странной разметки скрипт мог перепутать, кто автор этого голоса (он думает, что это ${vote.author.nameWhenVoted}). `);
        fitsOtherCriteria = false;
      }

      if (vote.author.name !== vote.author.nameWhenVoted) {
        const logLink = mw.util.getUrl('Служебная:Журналы', {
          page: 'Участник:' + vote.author.nameWhenVoted,
        });
        message.texts.push(`Соответствие требованиям определялось для учётной записи ${vote.author.name}, в которую <a href="${logLink}">была переименована</a> учётная запись ${vote.author.nameWhenVoted}.`);
      }

      if (votingPeriodOk && !vote.date) {
        if (category === 'meets' || category === 'possiblyMeets') {
          message.texts.push('Не удалось определить время голоса. Необходимо проверить, подан ли голос вовремя. ');
          if (!vote.confusingAuthor) {
            category = 'possiblyMeets';
            message.icons = ['help'];
          }
        }
      }

      if (category === 'possiblyMeets' && fitsOtherCriteria) {
        message.texts[message.texts.length - 1] += 'Остальным требованиям участник соответствует. ';
      }
      message.icons = cc.util.removeDuplicates(message.icons);
      message.accented = true;

      vote.summary = summary;
      votesSummary[category].push(vote);

      $message.remove();
      $target.prepend(cc.createMessage(message, vote.anchor));
    }
    $checkedPercent.text('100');

    cc.admin.votesSummary = votesSummary;

    const formUserList = (votes) => (
      votes.reduce(
        (s, vote) => `${s}<a href="#${vote.anchor}">${vote.author.nameWhenVoted}</a>, `,
        ''
      ).slice(0, -2)
    );

    let text = 'Проверка завершена. ';
    if (votes.length) {
      if (rawCriteria) {
        text += 'Не были найдены метаданные о требованиях, поэтому они извлекались прямо из текста, что могло привести к ошибкам (к примеру, неизвестно время начала голосования, поэтому все правки в день начала включались при определении соответствия 1-му и 4-му требованию). ';
      }
      if (!votingPeriodOk) {
        text += 'Не были найдены корректные метаданные о дате начала и конца голосования, поэтому время подачи голосов не проверялось. ';
      }
    } else {
      text += 'Никто ещё не голосовал. ';
    }
    const icons = [];
    if (votesSummary.error.length) {
      icons.push('error');
      const userList = formUserList(votesSummary.error);
      text += `Не удалось проверить ${votesSummary.error.length} ${cc.util.plural(votesSummary.error.length, 'голос', 'голоса', 'голосов')}: ${userList}. `;
      showButton('checkAll');
    }
    if (votesSummary.notMeets.length) {
      icons.push('close');
      const userList = formUserList(votesSummary.notMeets);
      text += `${votesSummary.notMeets.length} ${cc.util.plural(votesSummary.notMeets.length, 'голос', 'голоса', 'голосов')} не ${cc.util.plural(votesSummary.notMeets.length, 'соответствует', 'соответствуют', 'соответствуют')} правилам: ${userList}. `;
    }
    if (votesSummary.possiblyMeets.length) {
      icons.push('help');
      const userList = formUserList(votesSummary.possiblyMeets);
      text += `Необходима ручная проверка ${votesSummary.possiblyMeets.length} ${cc.util.plural(votesSummary.possiblyMeets.length, 'голоса', 'голосов', 'голосов')}: ${userList}. `;
    }
    if (votesSummary.meets.length) {
      icons.push('check');
      text += `${votesSummary.meets.length} ${cc.util.plural(votesSummary.meets.length, 'голос соответствует', 'голоса соответствуют', 'голосов соответствуют')} правилам. `;
    }

    $criteriaBoxMessage.remove();
    $criteriaBox.append(cc.createMessage({
      text,
      icons,
      big: true,
    }));

    if (votes.length &&
      (resultsTable.totalVotes === votes.length ||
        (!resultsTable.totalVotes &&
          resultsTable.totalVotes !== 0
        )
      )
    ) {
      $criteriaBox.append(cc.createMessage({
        text: 'Так как участники не всегда корректно используют вики-разметку, нет гарантии, что скрипт верно извлёк все голоса. Пожалуйста, убедитесь, что все голоса были проверены: пройдитесь по списку голосов и удостоверьтесь, что у каждого голоса стоит отметка. ',
        icon: 'warning',
      }));
    } else if (resultsTable.totalVotes || resultsTable.totalVotes === 0) {
      $criteriaBox.append(cc.createMessage({
        text: `<b>Число голосов согласно таблице результатов (${resultsTable.totalVotes}) не совпадает с числом голосов с точки зрения скрипта (${votes.length}).</b> ` +
          (resultsTable.totalVotes > votes.length
            ? 'Пожалуйста, пройдитесь по списку голосов, найдите недостающие голоса и проверьте их вручную. '
            : 'Пожалуйста, пройдитесь по списку голосов и удостоверьтесь в том, что отметки на них стоят корректно. '
          ),
        icon: 'warning',
      }));
    }
  },

  checkCandidate: async () => {
    hideButton('checkCandidate');
    const $checkingMessage = cc.createMessage({
      icon: 'loading',
      text: 'Проверяем кандидата…',
      big: true,
    }).appendTo($criteriaBox);

    let summary;
    let message = {
      icons: [],
      texts: [],
    };
    let fitsOtherCriteria = true;
    try {
      summary = cc.summarize(await candidate.check(candidateCriteria));
    } catch (e) {
      console.error(e);
      message = {
        icons: ['error'],
        texts: ['Не удалось завершить проверку. См. подробности в консоли (F12 → Консоль). '],
      };
      showButton('checkCandidate');
    }

    if (summary) {
      if (summary.conclusion === 'meets') {
        message = {
          icons: ['check'],
          texts: [],
        };
      } else if (summary.conclusion === 'notMeets') {
        let text = `Кандидат не соответствует требованию: <em>${summary.firstFailedResult.criterion.text}</em>. `;
        if (summary.firstFailedResult.criterion.name === 'editCountNotLess') {
          text += `У него только ${summary.firstFailedResult.editCount} правок. `;
        }
        message = {
          icons: ['close'],
          texts: [text],
        };
      } else if (summary.conclusion === 'possiblyMeets') {
        message.icons = ['help'];
        for (const result of summary.results.filter(cc.util.otherThanMeets)) {
          if (result.result === 'notEnoughRights') {
            let text = `У вас недостаточно прав, чтобы получить все данные, необходимые для определения соответствия требованию: <em>${result.criterion.text}</em>. Согласно тем данным, которые удалось получить, кандидат не соответствует требованиям. `;
            message.texts.push(text);
            fitsOtherCriteria = false;
          } else if (result.result === 'needsManualCheck') {
            let text = `Требуется ручная проверка соответствия требованию: <em>${result.criterion.text}</em>. `;
            if (result.criterion.comment) {
              text += result.criterion.comment + ' ';
            }
            message.texts.push(text);
          } else if (result.result === 'possiblyMeets') {
            let text = `Кандидат может не соответствовать требованию: <em>${result.criterion.text}</em>. `;
            if (result.criterion.name === 'hadFlagFor') {
              const distance = period % (1000 * 60 * 60 * 24);
              text += `Кандадат обладал флагом ${result.flag} в течение ${plural(distance, 'дня', 'дней', 'дней')}. `;
            }
            message.texts.push(text);
          }
        }
      }

      if (summary.result === 'meets') {
        message.texts.push('Кандидат соответствует требованиям для выдвижения. ');
      }
      if (summary.conclusion === 'possiblyMeets' && fitsOtherCriteria) {
        message.texts[message.texts.length - 1] += 'Остальным требованиям кандидат соответствует. ';
      }
    }
    message.big = true;

    $checkingMessage.remove();
    $criteriaBox.append(cc.createMessage(message));
  },
};
