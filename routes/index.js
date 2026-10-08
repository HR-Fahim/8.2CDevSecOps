const utils = require('../utils');
const mongoose = require('mongoose');
const Todo = mongoose.model('Todo');
const User = mongoose.model('User');
const hms = require('humanize-ms');
const ms = require('ms');
const streamBuffers = require('stream-buffers');
const readline = require('readline');
const moment = require('moment');
const exec = require('child_process').exec;
const validator = require('validator');
const fileType = require('file-type');
const AdmZip = require('adm-zip');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const _ = require('lodash');

function onLoginSuccessHook(redirectPage, session, username, res) {
  session.loggedIn = 1;
  console.log(`User logged in: ${username}`);

  if (redirectPage) {
    return res.redirect(redirectPage);
  }
  return res.redirect('/admin');
}

exports.index = function (req, res, next) {
  Todo.find({})
    .sort('-updated_at')
    .exec((err, todos) => {
      if (err) return next(err);
      res.render('index', {
        title: 'Patch TODO List',
        subhead: 'Vulnerabilities at their best',
        todos
      });
    });
};

exports.loginHandler = function (req, res, next) {
  const username = req.body.username;
  const password = req.body.password;

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).send('Invalid credentials');
  }

  if (!validator.isEmail(username)) {
    return res.status(401).send();
  }

  User.find({ username, password }, (err, users) => {
    if (users.length > 0) {
      const redirectPage = req.body.redirectPage;
      const session = req.session;
      return adminLoginSuccess(redirectPage, session, username, res);
    }
    return res.status(401).send();
  });
};

function adminLoginSuccess(redirectPage, session, username, res) {
  session.loggedIn = 1;
  console.log(`User logged in: ${username}`);

  if (redirectPage) {
    return res.redirect(redirectPage);
  }
  return res.redirect('/admin');
}

exports.login = function (req, res, next) {
  let redirectPage = req.query.redirectPage;

  if (
    typeof redirectPage !== 'string' ||
    !redirectPage.startsWith('/') ||
    redirectPage.startsWith('//')
  ) {
    redirectPage = '/';
  }

  return res.render('admin', {
    title: 'Admin Access',
    granted: false,
    redirectPage
  });
};

exports.admin = function (req, res, next) {
  return res.render('admin', {
    title: 'Admin Access Granted',
    granted: true
  });
};

exports.get_account_details = function (req, res, next) {
  return res.render('account.hbs', {});
};

exports.save_account_details = function (req, res, next) {
  const profile = req.body;

  if (
    validator.isEmail(profile.email, { allow_display_name: true }) &&
    validator.isMobilePhone(profile.phone, 'he-IL') &&
    validator.isAscii(profile.firstname) &&
    validator.isAscii(profile.lastname) &&
    validator.isAscii(profile.country)
  ) {
    const accountData = {
      email: validator.rtrim(profile.email),
      firstname: validator.rtrim(profile.firstname),
      lastname: validator.rtrim(profile.lastname),
      country: validator.rtrim(profile.country),
      phone: profile.phone
    };

    return res.render('account_details', accountData);
  }

  return res.render('account_details');
};

exports.isLoggedIn = function (req, res, next) {
  if (req.session.loggedIn === 1) {
    return next();
  }
  return res.redirect('/');
};

exports.logout = function (req, res, next) {
  req.session.loggedIn = 0;
  req.session.destroy(() => {
    return res.redirect('/');
  });
};

function parse(todo) {
  let t = todo;
  const marker = ' in ';
  const pos = t.toString().indexOf(marker);

  if (pos > 0) {
    let time = t.slice(pos + marker.length).replace(/\n$/, '');
    const period = hms(time);

    t = t.slice(0, pos);
    if (typeof period !== 'undefined') {
      t += ` [${ms(period)}]`;
    }
  }
  return t;
}

exports.create = function (req, res, next) {
  let item = req.body.content;
  const imgRegex = /\!\[.*\]\((.*)\)/;

  if (typeof item === 'string' && item.match(imgRegex)) {
    const url = item.match(imgRegex)[1];
    exec(`identify ${url}`, () => {});
  } else {
    item = parse(item);
  }

  new Todo({
    content: item,
    updated_at: Date.now()
  }).save((err, todo) => {
    if (err) return next(err);
    res.setHeader('Location', '/');
    res.status(302).send(todo.content.toString('base64'));
  });
};

exports.destroy = function (req, res, next) {
  Todo.findById(req.params.id, (err, todo) => {
    try {
      todo.remove((err) => {
        if (err) return next(err);
        res.redirect('/');
      });
    } catch (e) {}
  });
};

exports.edit = function (req, res, next) {
  Todo.find({})
    .sort('-updated_at')
    .exec((err, todos) => {
      if (err) return next(err);
      res.render('edit', {
        title: 'TODO',
        todos,
        current: req.params.id
      });
    });
};

exports.update = function (req, res, next) {
  Todo.findById(req.params.id, (err, todo) => {
    todo.content = req.body.content;
    todo.updated_at = Date.now();
    todo.save((err) => {
      if (err) return next(err);
      res.redirect('/');
    });
  });
};

exports.current_user = function (req, res, next) {
  next();
};

function isBlank(str) {
  return !str || /^\s*$/.test(str);
}

exports.import = function (req, res, next) {
  if (!req.files) {
    res.send('No files were uploaded.');
    return;
  }

  const importFile = req.files.importFile;
  let data;
  let importedFileType = fileType(importFile.data);
  const zipFileExt = { ext: 'zip', mime: 'application/zip' };

  if (importedFileType === null) {
    importedFileType = { ext: 'txt', mime: 'text/plain' };
  }

  if (importedFileType.mime === zipFileExt.mime) {
    const zip = AdmZip(importFile.data);

    const extracted_path = fs.mkdtempSync(
      path.join(os.tmpdir(), 'goof-')
    );

    fs.chmodSync(extracted_path, 0o700);
    zip.extractAllTo(extracted_path, true);

    data = 'No backup.txt file found';

    fs.readFile('backup.txt', 'ascii', (err, fileData) => {
      if (!err) {
        data = fileData;
      }
    });
  } else {
    data = importFile.data.toString('ascii');
  }

  const lines = data.split('\n');
  lines.forEach((line) => {
    const parts = line.split(',');
    const what = parts[0];
    const when = parts[1];
    const locale = parts[2];
    const format = parts[3];

    if (!isBlank(what)) {
      let item = what;

      if (!isBlank(when) && !isBlank(locale) && !isBlank(format)) {
        moment.locale(locale);
        const d = moment(when);
        item += ` [${d.format(format)}]`;
      }

      new Todo({
        content: item,
        updated_at: Date.now()
      }).save(() => {});
    }
  });

  res.redirect('/');
};

exports.about_new = function (req, res, next) {
  return res.render('about_new.dust', {
    title: 'Patch TODO List',
    subhead: 'Vulnerabilities at their best',
    device: req.query.device
  });
};

const users = [
  { name: 'user', password: 'pwd' },
  { name: 'admin', password: crypto.randomInt(0, Number.MAX_SAFE_INTEGER).toString(32), canDelete: true }
];

let messages = [];
let lastId = 1;

function findUser(auth) {
  return users.find(
    (u) => u.name === auth.name && u.password === auth.password
  );
}

exports.chat = {
  get(req, res) {
    res.send(messages);
  },

  add(req, res) {
    const user = findUser(req.body.auth || {});
    if (!user) {
      res.status(403).send({ ok: false, error: 'Access denied' });
      return;
    }

    const message = { icon: '👋' };

    _.merge(message, req.body.message, {
      id: lastId++,
      timestamp: Date.now(),
      userName: user.name
    });

    messages.push(message);
    res.send({ ok: true });
  },

  delete(req, res) {
    const user = findUser(req.body.auth || {});
    if (!user || !user.canDelete) {
      res.status(403).send({ ok: false, error: 'Access denied' });
      return;
    }

    messages = messages.filter((m) => m.id !== req.body.messageId);
    res.send({ ok: true });
  }
};
