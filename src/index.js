import './style.css';
import cc from './cc';
import util from './util';
import User from './User';
import admin from './applications/admin';
import arbcom from './applications/arbcom';

mw.loader.using([ 'mediawiki.api', 'mediawiki.util', 'oojs', 'oojs-ui' ]).done(() => {
  cc.util = util;
  cc.admin = admin;
  cc.arbcom = arbcom;

  cc.customHandlers = [];

  cc.createMessage = (message, anchor) => {
    if (!message.icons) {
      message.icons = message.icon ? [message.icon] : [];
    }
    const $icons = message.icons.map((icon) => $('<span>')
      .addClass('criteriaCheck-icon')
      .addClass('criteriaCheck-icon-' + icon)
    );

    if (!message.texts) {
      message.texts = message.text ? [message.text] : [];
    }
    const text = message.texts.length === 1
      ? message.texts[0]
      : message.texts.reduce((s, text, i) => `${s}${i + 1}. ${text} `, '');

    const $el = $(text ? '<div>' : '<span>')
      .addClass('criteriaCheck-message')
      .attr('id', anchor)
      .append($icons);
    if (text) {
      const $text = $('<span>').append(text);
      $el
        .addClass('criteriaCheck-message-withText')
        .append($text);
    }
    if (message.accented) {
      $el.addClass('criteriaCheck-message-accented');
    }
    if (message.big) {
      $el.addClass('criteriaCheck-message-big');
    }
    return $el;
  };

  cc.getUser = (name) => {
    if (!name) return;
    cc.users = cc.users || [];
    if (!cc.users[name]) {
      cc.users[name] = new User(name);
    }
    return cc.users[name];
  };

  cc.extractCriteria = ($container) => (
    $container
      .find('[data-criterion]')
      .map(function () {
        const data = Object.assign({}, $(this).data());
        data.text = $(this).text().replace(/[,;.]$/, '');
        data.type = data.criterion;
        delete data.criterion;
        return data;
      }).get()
  );

  cc.summarize = (results) => {
    const details = [];
    let conclusion = 'meets';
    let warnings = [];
    let summary = {};
    for (const result of results) {
      if (result.result === 'userMissing') {
        conclusion = 'userMissing';
        break;
      } else if (result.result === 'notMeets') {
        conclusion = 'notMeets';
        summary.firstFailedResult = result;
      } else if (['possiblyMeets', 'notEnoughRights', 'needsManualCheck'].includes(result.result) &&
        conclusion !== 'notMeets'
      ) {
        conclusion = 'possiblyMeets';
      }
      if (['notEnoughRights', 'needsManualCheck'].includes(result.result)) {
        warnings.push(result.result);
      }
      if (result.overallEditCount === 0) {
        warnings.push('0edits');
      }
    }
    warnings = cc.util.removeDuplicates(warnings);
    if (conclusion !== 'userMissing') {
      summary.results = results;
      summary.warnings = warnings;
    }
    summary.conclusion = conclusion;
    summary.user = results && results[0].user;
    return summary;
  };

  cc.check = async (userNames, criteria, callback, doSummarize = true) => {
    if (typeof userNames === 'string') {
      userNames = [userNames];
    }
    const results = [];
    for (var userName of userNames) {
      let result = await cc.getUser(userName).check(criteria);
      if (doSummarize) {
        result = cc.summarize(result);
      }
      results.push(result);
      if (callback) {
        callback(result);
      }
    }
    return results;
  };

  cc.addHandler = (criterionType, handler) => {
    cc.customHandlers[criterionType] = handler;
  };

  cc.currentUser = cc.getUser(mw.config.get('wgUserName'));

  if (cc.admin.isRelevantPage()) {
    cc.admin.main();
  }

  // Предзагружаем иконки
  $('<div>')
    .css({
      position: 'absolute',
      top: -10000,
    })
    .append(cc.createMessage({ icons: ['check', 'close', 'help', 'error', 'loading', 'warning'] }))
    .appendTo('body');
});
