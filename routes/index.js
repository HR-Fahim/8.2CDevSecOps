const mongoose = require('mongoose');
const Todo = mongoose.model('Todo');
const User = mongoose.model('User');
const hms = require('humanize-ms');
const ms = require('ms');
const moment = require('moment');
const validator = require('validator');
const fileType = require('file-type');
const AdmZip = require('adm-zip');


function safeRedirectPath(value) {
  const fallback = '/admin';
  const localOrigin = 'http://localhost';

  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return fallback;
  }

  try {
    const target = new URL(value, localOrigin);

    // Accept only paths that resolve to the expected local origin.
    if (target.origin !== localOrigin) {
      return fallback;
    }

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
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


exports.loginHandler = async function (req, res, next) {
  const username = req.body.username;
  const password = req.body.password;

  // Accept only primitive strings from the request.
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).send('Invalid credentials');
  }

  if (!validator.isEmail(username)) {
    return res.status(401).send();
  }

  try {
    // Use a validated scalar email as the only database query value.
    // Check the password as a string after lookup instead of placing request
    // data into the MongoDB filter.
    const user = await User.findOne()
      .where('username')
      .equals(username)
      .exec();

    if (user && typeof user.password === 'string' && user.password === password) {
      return adminLoginSuccess(
        req.body.redirectPage,
        req.session,
        username,
        res
      );
    }

    return res.status(401).send('Invalid credentials');
  } catch (err) {
    return next(err);
  }
};

function adminLoginSuccess(redirectPage, session, username, res) {
  session.loggedIn = 1;
  console.log(`User logged in: ${username}`);
  return res.redirect(safeRedirectPath(redirectPage));
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
  const submittedContent = req.body.content;
  if (typeof submittedContent !== 'string' || submittedContent.length > 10000) {
    return res.status(400).send('Invalid todo content');
  }

  // Store submitted markdown as text; never pass user-controlled URLs to a shell.
  const item = parse(submittedContent);

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
  if (!req.files || !req.files.importFile || !req.files.importFile.data) {
    return res.status(400).send('No import file was uploaded.');
  }

  const importFile = req.files.importFile;
  if (importFile.data.length > 5 * 1024 * 1024) {
    return res.status(413).send('Import file is too large. Maximum size is 5 MB.');
  }

  let importedFileType = fileType(importFile.data);
  if (importedFileType === null) {
    importedFileType = { ext: 'txt', mime: 'text/plain' };
  }

  let data;
  if (importedFileType.mime === 'application/zip') {
    try {
      const zip = new AdmZip(importFile.data);
      const backupEntry = zip.getEntry('backup.txt');
      if (!backupEntry || backupEntry.isDirectory) {
        return res.status(400).send('ZIP file must contain backup.txt at its root.');
      }
      data = backupEntry.getData().toString('ascii');
    } catch (err) {
      return res.status(400).send('Invalid ZIP import file.');
    }
  } else {
    data = importFile.data.toString('ascii');
  }

  if (typeof data !== 'string') {
    return res.status(400).send('Invalid import data.');
  }

  const lines = data.split(/\r?\n/).slice(0, 10000);
  let pending = 0;
  let finished = false;
  let failed = false;

  function finishIfReady() {
    if (finished || pending > 0) return;
    finished = true;
    if (failed) return next(new Error('One or more imported TODOs could not be saved.'));
    return res.redirect('/');
  }

  lines.forEach((line) => {
    if (isBlank(line)) return;
    const parts = line.split(',');
    const what = parts[0];
    const when = parts[1];
    const locale = parts[2];
    const format = parts[3];
    if (isBlank(what) || what.length > 10000) return;

    let item = what;
    if (!isBlank(when) && !isBlank(locale) && !isBlank(format)) {
      // Accept only known locale/format strings; never use input as a filesystem path.
      if (/^[a-zA-Z_-]{2,10}$/.test(locale) && /^[A-Za-z0-9 ,:./_-]{1,80}$/.test(format)) {
        moment.locale(locale);
        const date = moment(when);
        if (date.isValid()) item += ` [${date.format(format)}]`;
      }
    }

    pending += 1;
    new Todo({ content: item, updated_at: Date.now() }).save((err) => {
      if (err) failed = true;
      pending -= 1;
      finishIfReady();
    });
  });

  finishIfReady();
};

exports.about_new = function (req, res, next) {
  const device = typeof req.query.device === 'string'
    ? validator.escape(req.query.device.slice(0, 80))
    : 'browser';

  return res
    .type('html')
    .send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Patch TODO List</title></head>
<body>
  <h1>Patch TODO List</h1>
  <p>Vulnerabilities at their best</p>
  <p>Device: ${device}</p>
</body>
</html>`);
};

const users = [];
if (process.env.CHAT_USER_PASSWORD) {
  users.push({
    name: process.env.CHAT_USER_NAME || 'user',
    password: process.env.CHAT_USER_PASSWORD
  });
}
if (process.env.CHAT_ADMIN_PASSWORD) {
  users.push({
    name: process.env.CHAT_ADMIN_NAME || 'admin',
    password: process.env.CHAT_ADMIN_PASSWORD,
    canDelete: true
  });
}

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

    const incoming = req.body.message;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      res.status(400).send({ ok: false, error: 'Invalid message' });
      return;
    }

    const message = {
      icon: typeof incoming.icon === 'string' ? incoming.icon.slice(0, 16) : '👋',
      id: lastId++,
      timestamp: Date.now(),
      userName: user.name
    };
    ['text', 'content', 'message'].forEach((key) => {
      if (typeof incoming[key] === 'string') message[key] = incoming[key].slice(0, 2000);
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
