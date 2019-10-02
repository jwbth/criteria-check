import cc from './cc';

const isCurrentUserSysop = mw.config.get('wgUserGroups').includes('sysop');

export default class User {
  constructor(name) {
    this.name = name;
    if (cc.admin && cc.admin.isRelevantPage()) {
      this.nameWhenVoted = name;
      this.votes = [];
    }
  }

  changeName(newName) {
    this.name = newName;
    this.missing = null;
    this.infoRequest = null;
  }

  async checkOne(criterion) {
    if (!cc.apiRateLimit) {
      const entry = cc.currentUser && await cc.currentUser.getUserInfo();
      cc.apiRateLimit = entry && entry.rights && entry.rights.includes('apihighlimits')
        ? 5000
        : 500;
    }

    const options = Object.assign({}, criterion);
    delete options.type;
    delete options.text;
    let result;
    if (criterion.needsManualCheck) {
      result = { result: 'needsManualCheck' };
    } else if (this.missing) {
      result = { result: 'userMissing' };
    } else if (this[criterion.type]) {
      result = await this[criterion.type](options);
    } else if (cc.customHandlers[criterion.type]) {
      result = await cc.customHandlers[criterion.type](this, options);
    } else {
      throw new Error(`Не найден тип критерия ${criterion.type}.`);
    }
    result.user = this;
    result.criterion = criterion;
    return result;
  }

  async check(criteria) {
    if (!Array.isArray(criteria)) {
      criteria = [criteria];
    }

    let results;
    while (true) {
      results = await Promise.all(criteria.map((criterion) => this.checkOne(criterion)));

      // Если с результатами что-то не так, выясняем, того ли участника мы проверяли. Не используем
      // только условие this.missing, так как старая учётка может быть занята. У такой
      // последовательности есть уязвимость — если проверяемый участник был переименован, а кто-то
      // встал на его имя, то, если участник, которому принадлежало имя прежде, соответствует
      // критериям, а новый нет, скрипт ошибается. Мы жертвуем возможностью такого стечения
      // обстоятельств по причине того, что его вероятность крайне мала.
      if (!this.missing &&
        !results.some((result) => ['notMeets', 'notEnoughRights'].includes(result.result))
      ) {
        break;
      }

      const dataRename = await new mw.Api().get({
        action: 'query',
        list: 'logevents',
        letype: 'renameuser',
        letitle: 'Участник:' + this.name,
        formatversion: 2,
      });
      const entry = dataRename &&
        dataRename.query &&
        dataRename.query.logevents &&
        dataRename.query.logevents[0];
      const newUserName = entry && entry.params && entry.params.newuser;
      const renameDate = entry && entry.timestamp && new Date(entry.timestamp);
      if (newUserName && (!this.votes || !this.votes.length || renameDate > this.votes[0].date)) {
        this.changeName(newUserName);
      } else {
        // Журнал переименований участников не всегда содержат нужные записи (например,
        // https://ru.wikipedia.org/wiki/Служебная:Журналы?page=Участник%3ABorealis55), поэтому
        // можно заглянуть ещё в журнал переименований страниц. Тут надо обязательно проверять на
        // this.missing, так как иначе открывается уязвимость — можно переименовать личную страницу
        // в чужую, и скрипт будет проверять критерии для того участника, в которого переименовали.
        if (this.missing) {
          const dataMove = await new mw.Api().get({
            action: 'query',
            list: 'logevents',
            letype: 'move',
            letitle: 'Участник:' + this.name,
            formatversion: 2,
          });
          const entryMove = dataMove &&
            dataMove.query &&
            dataMove.query.logevents &&
            dataMove.query.logevents[0];
          const newUserNameMove = entryMove &&
            entryMove.comment &&
            // Не всегда умещается, см. https://ru.wikipedia.org/w/index.php?title=Участник:Hausratte&action=history
            entryMove.comment.includes('Автоматическое переим') &&
            entryMove.ns &&
            entryMove.ns === 2 &&
            entryMove.params &&
            entryMove.params.target_title &&
            entryMove.params.target_title.slice(entryMove.params.target_title.indexOf(':') + 1);
          const renameDateMove = entryMove && entryMove.timestamp && new Date(entryMove.timestamp);
          if (newUserNameMove &&
            (!this.votes || !this.votes.length || renameDateMove > this.votes[0].date)
          ) {
            this.changeName(newUserNameMove);
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }

    return results;
  }

  getUserInfo() {
    if (this.infoRequest) {
      return this.infoRequest;
    } else {
      this.infoRequest = new mw.Api().get({
        action: 'query',
        list: 'users',
        ususers: this.name,
        usprop: 'registration|editcount|groups|rights',
        formatversion: 2,
      }).then((data) => {
        const entry = data && data.query && data.query.users && data.query.users[0];
        if (entry && entry.missing) {
          // Если критериев, требующих получения списка users, нет, это свойство останется
          // незаполненным
          this.missing = true;
        }
        return entry;
      });
      return this.infoRequest;
    }
  }

  async requestContribs(options, enoughEditCount) {
    const contribs = [];
    let uccontinue;
    let doContinue;
    do {
      let uclimit;
      if (enoughEditCount) {
        uclimit = Math.min(
          cc.apiRateLimit,
          options.filterVotes
            ? cc.util.calcOptimalLimit(enoughEditCount - contribs.length)
            : enoughEditCount - contribs.length
        );
      } else {
        uclimit = cc.apiRateLimit;
      }
      const data = await new mw.Api().get({
        list: 'usercontribs',
        ucprop: 'title|timestamp',
        ucuser: this.name,
        ucnamespace: options.ns,
        ucstart: options.periodStart && options.periodStart.toISOString(),
        ucend: options.periodEnd && options.periodEnd.toISOString(),
        ucdir: 'newer',
        uclimit,
        uccontinue,
        formatversion: 2,
      });
      let entries = data && data.query && data.query.usercontribs;
      if (!entries) break;
      if (options.filterVotes) {
        entries = entries.filter(cc.util.isntVotePage);
      }
      contribs.push(...entries);
      uccontinue = data && data.continue && data.continue.uccontinue;
      doContinue = uccontinue && (!enoughEditCount || contribs.length < enoughEditCount);
      if (options.filterVotes && uclimit < cc.apiRateLimit && doContinue) {
        console.info(`Неоптимальный расчёт в функции calcOptimalLimit: запрошено ${uclimit}, нашлось ${entries.length}, пришлось запрашивать ещё записи. Участник ${this.name}.`, entries);
      }
    } while (doContinue);

    return contribs;
  }

  async requestDeletedContribs(options, enoughEditCount) {
    const deletedContribs = [];
    let adrcontinue;
    let doContinue;
    do {
      let adrlimit;
      if (enoughEditCount) {
        adrlimit = Math.min(
          cc.apiRateLimit,
          options.filterVotes
            ? cc.util.calcOptimalLimit(enoughEditCount - deletedContribs.length)
            : enoughEditCount - deletedContribs.length
        );
      } else {
        adrlimit = cc.apiRateLimit;
      }
      const data = await new mw.Api().get({
        action: 'query',
        list: 'alldeletedrevisions',
        adrprop: 'timestamp',
        adruser: this.name,
        adrstart: options.periodStart && options.periodStart.toISOString(),
        adrend: options.periodEnd && options.periodEnd.toISOString(),
        adrdir: 'newer',
        adrlimit,
        adrcontinue,
        formatversion: 2,
      });
      let entries = data && data.query && data.query.alldeletedrevisions;
      if (!entries) break;
      if (options.filterVotes) {
        entries = entries.filter(cc.util.isntVotePage);
      }
      const revisions = [];
      for (const entry of entries) {
        revisions.push(...entry.revisions);
      }
      deletedContribs.push(...revisions);
      adrcontinue = data && data.continue && data.continue.adrcontinue;
      doContinue = adrcontinue && (!enoughEditCount || deletedContribs.length < enoughEditCount);
      if (options.filterVotes && adrlimit < cc.apiRateLimit && doContinue) {
        console.info(`Неоптимальный расчёт в функции calcOptimalLimit: запрошено ${adrlimit}, нашлось ${revisions.length}, пришлось запрашивать ещё записи. Участник ${this.name}.`, entries);
      }
    } while (doContinue);

    return deletedContribs;
  }

  async collectActions(options, enoughActionCount) {
    const actions = [];
    if (options.deleted == undefined) {
      options.deleted = true;
    }
    const contribs = await this.requestContribs(options, enoughActionCount);
    actions.push(...contribs);

    if (options.deleted &&
      isCurrentUserSysop &&
      (!enoughActionCount || actions.length < enoughActionCount)
    ) {
      const deletedContribs = await this.requestDeletedContribs(
        options,
        enoughActionCount && enoughActionCount - actions.length
      );
      actions.push(...deletedContribs);
    }

    if (!enoughActionCount || actions.length < enoughActionCount) {
      // Логируемые действия
      let lecontinue;
      // [[Википедия:Патрулирование#Обозначения действий патрулирования в API]]
      // hit — относится к spamblacklist, abusefilter
      do {
        const data = await new mw.Api().get({
          action: 'query',
          list: 'logevents',
          leprop: 'timestamp|type',
          leuser: this.name,
          lestart: options.periodStart && options.periodStart.toISOString(),
          leend: options.periodEnd && options.periodEnd.toISOString(),
          ledir: 'newer',
          lelimit: cc.apiRateLimit,
          lecontinue,
          formatversion: 2,
        });
        let entries = data && data.query && data.query.logevents;
        if (!entries) break;
        entries = entries.filter(cc.util.isntAutomaticAction);
        actions.push(...entries);
        lecontinue = data && data.continue && data.continue.lecontinue;
      } while (lecontinue && (!enoughActionCount || actions.length < enoughActionCount));
    }

    actions.sort((a, b) => {
      if (a.timestamp > b.timestamp) {
        return 1;
      } else if (a.timestamp < b.timestamp) {
        return -1;
      } else {
        return 0;
      }
    });

    return actions;
  }


  /* Функции типов критериев */

  async editCountNotLess(options) {
    options.periodStart = cc.util.prepareDate(options.periodStart);
    options.periodEnd = cc.util.prepareDate(options.periodEnd, true);
    options.meaningful = Boolean(Number(options.meaningful));
    options.deleted = Boolean(Number(options.deleted));
    if (options.meaningful && options.margin == undefined) {
      options.margin = 0.5;
    }
    if (options.margin == undefined) {
      options.margin = 0;
    }

    const safeValue = Math.round(options.value * (1 + options.margin));

    const edits = await this.requestContribs(options, safeValue);

    if (edits.length >= safeValue) {
      return {
        result: 'meets',
        editCount: edits.length,
      };
    } else if (options.deleted && isCurrentUserSysop) {
      const deletedContribs = await this.requestDeletedContribs(options, safeValue - edits.length);
      edits.push(...deletedContribs);
    }

    if (edits.length >= safeValue) {
      return {
        result: 'meets',
        editCount: edits.length,
        edits,
      };
    } else if (edits.length >= options.value) {
      return {
        result: !options.deleted || isCurrentUserSysop ? 'possiblyMeets' : 'notEnoughRights',
        editCount: edits.length,
        edits,
      };
    } else {
      return {
        result: !options.deleted || isCurrentUserSysop ? 'notMeets' : 'notEnoughRights',
        editCount: edits.length,
        edits,
      };
    }
  }

  async registrationDateNotLater(options) {
    options.value = cc.util.prepareDate(options.value, true);

    const entry = await this.getUserInfo();
    if (this.missing) {
      return { result: 'userMissing' };
    }
    let registrationDate = entry && entry.registration && new Date(entry.registration);
    const overallEditCount = entry && entry.editcount;

    // У зарегистрировавшихся до 2 декабря 2005 года нет даты регистрации
    if (entry && !entry.registration) {
      const dataUc = await new mw.Api().get({
        action: 'query',
        list: 'usercontribs',
        ucuser: this.name,
        ucdir: 'newer',
        uclimit: 1,
        formatversion: 2,
      });
      registrationDate = dataUc &&
        dataUc.query &&
        dataUc.query.usercontribs &&
        dataUc.query.usercontribs[0] &&
        dataUc.query.usercontribs[0].timestamp &&
        new Date(dataUc.query.usercontribs[0].timestamp);
    }

    return {
      result: registrationDate <= options.value ? 'meets' : 'notMeets',
      registrationDate,
      overallEditCount,
    };
  }

  async editsBetweenDates(options) {
    options.periodStart = cc.util.prepareDate(options.periodStart);
    options.periodEnd = cc.util.prepareDate(options.periodEnd, true);

    const data = await new mw.Api().get({
      action: 'query',
      list: 'usercontribs',
      ucuser: this.name,
      ucstart: options.periodStart.toISOString(),
      ucend: options.periodEnd.toISOString(),
      ucdir: 'newer',
      uclimit: 1,
      formatversion: 2,
    });
    if (data &&
      data.query &&
      data.query.usercontribs &&
      data.query.usercontribs.length
    ) {
      return { result: 'meets' };
    } else {
      return { result: 'notMeets' };
    }
  }

  async hadFlagFor(options) {
    options.referenceDate = cc.util.prepareDate(options.referenceDate, true);
    if (!options.flags) {
      options.flags = options.flag && [options.flag];
    }

    let lecontinue;
    const entries = [];
    do {
      const data = await new mw.Api().get({
        action: 'query',
        list: 'logevents',
        letype: 'rights',
        letitle: 'Участник:' + this.name,
        leend: options.referenceDate && options.referenceDate.toISOString(),
        lelimit: cc.apiRateLimit,
        ledir: 'newer',
        formatversion: 2,
      });
      const logEvents = data && data.query && data.query.logevents;
      if (!logEvents) break;
      entries.push(...logEvents);
      lecontinue = data && data.continue && data.continue.lecontinue;
    } while (lecontinue);

    let multiplierMin;
    let multiplierMax;
    switch (options.unit) {
      case 'year':
      case 'years':
        multiplierMin = 1000 * 60 * 60 * 24 * 365;
        multiplierMax = 1000 * 60 * 60 * 24 * 366;
        break;
      case 'month':
      case 'months':
        multiplierMin = 1000 * 60 * 60 * 24 * 28;
        multiplierMax = 1000 * 60 * 60 * 24 * 31;
        break;
      case 'day':
      case 'days':
        multiplierMin = multiplierMax = 1000 * 60 * 60 * 24;
    }
    const neededPeriodMin = multiplierMin * options.value;
    const neededPeriodMax = multiplierMax * options.value;

    let periodsCount = 0;
    let result;

    for (const flag of options.flags) {
      let period = 0;
      let lastEndedHavingFlag;
      let lastStartedHavingFlag;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const newGroups = entry.params && entry.params.newgroups;
        if (newGroups && newGroups.includes(flag)) {
          const startedHavingFlag = new Date(entry.timestamp);
          lastStartedHavingFlag = startedHavingFlag;
          let endedHavingFlag;
          for (i++; i < entries.length; i++) {
            const laterEntry = entries[i];
            const laterNewGroups = laterEntry.params && laterEntry.params.newgroups;
            if (laterNewGroups && !laterNewGroups.includes(flag)) {
              lastEndedHavingFlag = endedHavingFlag = new Date(entries[i].timestamp);
              break;
            }
          }
          period += (endedHavingFlag ? endedHavingFlag.getTime() : Date.now()) -
            startedHavingFlag.getTime();
          periodsCount++;
        }
      }
      if (period >= neededPeriodMax) {
        return {
          result: 'meets',
          flag,
          period,
        };
      } else if (periodsCount === 1) {
        // Если период всего один, вычисляем по классическим правилам для дат (например, 1 месяц
        // назад для 31 марта — 28 февраля в невисокосном году)
        const subFunc = cc.util.createSubFunc(options.value, options.unit);
        if (subFunc(lastEndedHavingFlag) > lastStartedHavingFlag) {
          return {
            result: 'meets',
            flag,
            period,
          };
        }
      } else if (period >= neededPeriodMin) {
        // Если периодов несколько и трактовка количества месяцев/лет может отличаться, оставляем
        // выводы на усмотрение бюрократам
        result = {
          result: 'possiblyMeets',
          flag,
          period,
        };
      }
    }

    return result || { result: 'notMeets' };
  }

  async notLostFlagInLast(options) {
    options.referenceDate = cc.util.prepareDate(options.referenceDate || new Date());
    const subFunc = cc.util.createSubFunc(options.value, options.unit);

    if (!options.flags) {
      options.flags = options.flag && [options.flag];
    }

    let lecontinue;
    const entries = [];
    do {
      const data = await new mw.Api().get({
        action: 'query',
        list: 'logevents',
        letype: 'rights',
        letitle: 'Участник:' + this.name,
        lestart: subFunc(options.referenceDate).toISOString(),
        leend: options.referenceDate.toISOString(),
        lelimit: cc.apiRateLimit,
        ledir: 'newer',
        formatversion: 2,
      });
      const logEvents = data && data.query && data.query.logevents;
      if (!logEvents) break;
      entries.push(...logEvents);
      lecontinue = data && data.continue && data.continue.lecontinue;
    } while (lecontinue);

    for (const flag of options.flags) {
      for (const entry of entries) {
        const oldGroups = entry.params && entry.params.oldgroups;
        const newGroups = entry.params && entry.params.newgroups;
        if (oldGroups && newGroups && oldGroups.includes(flag) && !newGroups.includes(flag)) {
          return {
            result: 'notMeets',
            flag,
            lostFlagTimestamp: entry.timestamp,
          };
        }
      }
    }

    return { result: 'meets' };
  }

  async notInactiveFor(options) {
    options.periodStart = cc.util.prepareDate(options.periodStart);
    options.periodEnd = cc.util.prepareDate(options.periodEnd, true);
    const subFunc = cc.util.createSubFunc(options.value, options.unit);

    const actions = await this.collectActions(options);

    for (let i = 0; i <= actions.length; i++) {
      const previousDate = i === 0 ? options.periodStart : new Date(actions[i - 1].timestamp);
      const currentDate = i === actions.length ? options.periodEnd : new Date(actions[i].timestamp);
      if (subFunc(currentDate) > previousDate) {
        return {
          result: isCurrentUserSysop ? 'notMeets' : 'notEnoughRights',
          inactivityPeriodStart: previousDate,
          inactivityPeriodEnd: currentDate,
        };
      }
    }

    return { result: 'meets' };
  }

  async actionCountNotLess(options) {
    options.periodStart = cc.util.prepareDate(options.periodStart);
    options.periodEnd = cc.util.prepareDate(options.periodEnd, true);

    const actions = await this.collectActions(options, options.value);

    if (actions.length < options.value) {
      return {
        result: isCurrentUserSysop ? 'notMeets' : 'notEnoughRights',
        actionCount: actions.length,
        actions,
      };
    } else {
      return {
        result: 'meets',
        actionCount: actions.length,
        actions,
      };
    }
  }

  async noActiveBlockBetweenDates(options) {
    options.periodStart = cc.util.prepareDate(options.periodStart);
    options.periodEnd = cc.util.prepareDate(options.periodEnd, true);

    const data = await new mw.Api().get({
      action: 'query',
      list: 'blocks',
      bkprop: 'timestamp|expiry|restrictions',
      bkuser: this.name,
      formatversion: 2,
    });
    const entry = data && data.query && data.query.blocks && data.query.blocks[0];
    if (!entry) return;

    let partiallyBlockedInSpecifiedNs = false;
    if (options.ns &&
      entry.restrictions &&
      entry.restrictions.namespaces &&
      entry.restrictions.namespaces.includes(options.ns)
    ) {
     partiallyBlockedInSpecifiedNs = true;
    }

    if (new Date(entry.timestamp) <= options.periodStart &&
      (entry.expiry === 'infinity' || new Date(entry.expiry) > options.periodEnd) &&
      (!entry.restrictions ||
        (Array.isArray(entry.restrictions) && !entry.restrictions.length) ||
        partiallyBlockedInSpecifiedNs
      )
    ) {
      return {
        result: 'notMeets',
      };
    } else {
      return {
        result: 'meets',
      };
    }
  }
}
