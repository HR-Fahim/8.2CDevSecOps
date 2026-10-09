const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const AdmZip = require('adm-zip');

// Register schemas without opening a connection. Mock only the database boundary.
const Todo = mongoose.model('Todo', new mongoose.Schema({ content: Buffer, updated_at: Date }));
const User = mongoose.model('User', new mongoose.Schema({ username: String, password: String }));
const chatEnvironment = {
  CHAT_USER_NAME: 'test-user', CHAT_USER_PASSWORD: 'test-user-password',
  CHAT_ADMIN_NAME: 'test-admin', CHAT_ADMIN_PASSWORD: 'test-admin-password'
};
const previousEnvironment = {};
for (const [key, value] of Object.entries(chatEnvironment)) {
  previousEnvironment[key] = process.env[key];
  process.env[key] = value;
}
const routes = require('../routes');
for (const [key, value] of Object.entries(previousEnvironment)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

let saved;
beforeEach(() => {
  saved = [];
  mock.method(Todo.prototype, 'save', async function () {
    saved.push(this);
    return this;
  });
});
afterEach(() => mock.restoreAll());

function response() {
  return {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
    type(value) { this.contentType = value; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    redirect(path) { this.location = path; return this; },
    render(view, data) { this.view = view; this.data = data; return this; }
  };
}

function query(value, error) {
  const result = {
    sort(field) { assert.equal(field, '-updated_at'); return this; },
    where(field) { assert.equal(field, 'username'); return this; },
    equals(value) { assert.equal(value, 'user@example.com'); return this; },
    async exec() { if (error) throw error; return value; }
  };
  return result;
}

test('list and edit render sorted todos and forward database failures', async () => {
  const todos = [{ content: 'A task' }];
  for (const handler of ['index', 'edit']) {
    mock.method(Todo, 'find', (filter) => {
      assert.deepEqual(filter, {});
      return query(todos);
    });
    const res = response();
    await routes[handler]({ params: { id: 'abc' } }, res, assert.fail);
    assert.equal(res.view, handler);
    assert.deepEqual(res.data.todos, todos);
    if (handler === 'edit') assert.equal(res.data.current, 'abc');
    const error = new Error('Database unavailable');
    mock.method(Todo, 'find', () => query(null, error));
    await routes[handler]({}, response(), (actual) => assert.equal(actual, error));
  }
});

test('login rejects non-string credentials and malformed email', async () => {
  const lookup = mock.method(User, 'findOne', () => assert.fail('No lookup for invalid credentials'));
  for (const body of [
    { username: { $ne: null }, password: 'x' },
    { username: 'user@example.com', password: { $ne: null } },
    { username: 'not-an-email', password: 'x' }
  ]) {
    const res = response();
    await routes.loginHandler({ body }, res, assert.fail);
    assert.equal(res.statusCode, typeof body.username !== 'string' || typeof body.password !== 'string' ? 400 : 401);
  }
  assert.equal(lookup.mock.callCount(), 0);
});

test('login rejects unknown users, wrong passwords and database failures', async () => {
  const req = { body: { username: 'user@example.com', password: 'correct' }, session: {} };
  for (const user of [null, { password: 'wrong' }, { password: 123 }]) {
    mock.method(User, 'findOne', () => query(user));
    const res = response();
    await routes.loginHandler(req, res, assert.fail);
    assert.equal(res.statusCode, 401);
    assert.equal(req.session.loggedIn, undefined);
  }
  const error = new Error('Lookup failed');
  mock.method(User, 'findOne', () => query(null, error));
  await routes.loginHandler(req, response(), (actual) => assert.equal(actual, error));
});

test('successful login allows local redirects and blocks external redirect forms', async () => {
  mock.method(User, 'findOne', () => query({ password: 'correct' }));
  const targets = [
    ['/admin?tab=tasks#top', '/admin?tab=tasks#top'],
    [undefined, '/admin'], ['https://evil.example', '/admin'],
    ['//evil.example', '/admin'], ['/\\evil.example', '/admin'],
    ['/\t/evil.example', '/admin']
  ];
  for (const [redirectPage, expected] of targets) {
    const req = { body: { username: 'user@example.com', password: 'correct', redirectPage }, session: {} };
    const res = response();
    await routes.loginHandler(req, res, assert.fail);
    assert.equal(req.session.loggedIn, 1);
    assert.equal(res.location, expected);
  }
});

test('login page, admin page and account form render expected state', () => {
  for (const [redirectPage, expected] of [[undefined, '/'], ['https://evil.example', '/'], ['//evil.example', '/'], ['/admin', '/admin']]) {
    const res = response();
    routes.login({ query: { redirectPage } }, res);
    assert.equal(res.view, 'admin');
    assert.equal(res.data.granted, false);
    assert.equal(res.data.redirectPage, expected);
  }
  const admin = response();
  routes.admin({}, admin);
  assert.equal(admin.data.granted, true);
  const account = response();
  routes.get_account_details({}, account);
  assert.equal(account.view, 'account.hbs');
});

test('account profile accepts valid fields and rejects each invalid field', () => {
  const profile = { email: 'user@example.com', phone: '0501234567', firstname: 'Ada', lastname: 'Lovelace', country: 'IL' };
  const res = response();
  routes.save_account_details({ body: profile }, res);
  assert.deepEqual(res.data, profile);
  for (const [field, value] of [['email', 'bad'], ['phone', 'bad'], ['firstname', '\u00e9'], ['lastname', '\u00e9'], ['country', '\u00e9']]) {
    const rejected = response();
    routes.save_account_details({ body: { ...profile, [field]: value } }, rejected);
    assert.equal(rejected.data, undefined);
  }
});

test('session middleware grants access only when logged in and logout destroys the session', () => {
  let called = false;
  routes.isLoggedIn({ session: { loggedIn: 1 } }, response(), () => { called = true; });
  assert.equal(called, true);
  const denied = response();
  routes.isLoggedIn({ session: { loggedIn: 0 } }, denied, assert.fail);
  assert.equal(denied.location, '/');
  const req = { session: { loggedIn: 1, destroy(callback) { assert.equal(this.loggedIn, 0); callback(); } } };
  const res = response();
  routes.logout(req, res);
  assert.equal(res.location, '/');
  called = false;
  routes.current_user({}, response(), () => { called = true; });
  assert.equal(called, true);
});

test('create validates content, parses durations and treats shell commands as text', async () => {
  for (const content of [undefined, {}, 'x'.repeat(10001)]) {
    const res = response();
    await routes.create({ body: { content } }, res, assert.fail);
    assert.equal(res.statusCode, 400);
  }
  for (const [content, expected] of [
    ['A task', 'A task'], ['Call in 2 hours\n', 'Call [2h]'],
    ['Call in nonsense', 'Call'], ['$(whoami)', '$(whoami)']
  ]) {
    const res = response();
    await routes.create({ body: { content } }, res, assert.fail);
    assert.equal(saved.at(-1).content.toString(), expected);
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, '/');
    assert.equal(Buffer.from(res.body, 'base64').toString(), expected);
  }
  const error = new Error('Save failed');
  mock.method(Todo.prototype, 'save', async () => { throw error; });
  await routes.create({ body: { content: 'Task' } }, response(), (actual) => assert.equal(actual, error));
});

test('delete reports missing todos and database errors instead of hanging', async () => {
  const req = { params: { id: 'abc' } };
  for (const value of [{ _id: 'abc' }, null]) {
    mock.method(Todo, 'findByIdAndDelete', (id) => { assert.equal(id, 'abc'); return query(value); });
    const res = response();
    await routes.destroy(req, res, assert.fail);
    if (value) assert.equal(res.location, '/');
    else assert.equal(res.statusCode, 404);
  }
  const error = new Error('Delete failed');
  mock.method(Todo, 'findByIdAndDelete', () => query(null, error));
  await routes.destroy(req, response(), (actual) => assert.equal(actual, error));
});

test('update validates input, persists changes and forwards lookup/save errors', async () => {
  for (const content of [undefined, {}, 'x'.repeat(10001)]) {
    const res = response();
    await routes.update({ body: { content } }, res, assert.fail);
    assert.equal(res.statusCode, 400);
  }
  const req = { params: { id: 'abc' }, body: { content: 'Changed' } };
  const todo = new Todo({ content: 'Old' });
  mock.method(Todo, 'findById', (id) => { assert.equal(id, 'abc'); return query(todo); });
  const res = response();
  await routes.update(req, res, assert.fail);
  assert.equal(todo.content.toString(), 'Changed');
  assert.ok(todo.updated_at instanceof Date);
  assert.equal(res.location, '/');
  mock.method(Todo, 'findById', () => query(null));
  const missing = response();
  await routes.update(req, missing, assert.fail);
  assert.equal(missing.statusCode, 404);
  const error = new Error('Update failed');
  mock.method(Todo, 'findById', () => query(null, error));
  await routes.update(req, response(), (actual) => assert.equal(actual, error));
  mock.method(Todo, 'findById', () => query(todo));
  mock.method(Todo.prototype, 'save', async () => { throw error; });
  await routes.update(req, response(), (actual) => assert.equal(actual, error));
});

function upload(data) { return { files: { importFile: { data } } }; }
function archive(name, content) {
  const zip = new AdmZip();
  zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

test('import rejects absent, oversized, corrupt and incomplete uploads', async () => {
  for (const [req, status] of [
    [{}, 400], [{ files: {} }, 400], [{ files: { importFile: {} } }, 400],
    [upload(Buffer.alloc(5 * 1024 * 1024 + 1)), 413],
    [upload(archive('other.txt', 'Task')), 400],
    [upload(archive('backup.txt/', '')), 400],
    [upload(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), 400]
  ]) {
    const res = response();
    await routes.import(req, res, assert.fail);
    assert.equal(res.statusCode, status);
  }
  assert.equal(saved.length, 0);
});

test('import reads text and ZIP without extracting files and skips blank/oversized lines', async () => {
  for (const data of [Buffer.from('First\r\n \r\n,ignored\r\n' + 'x'.repeat(10001)), archive('backup.txt', 'Second')]) {
    const res = response();
    await routes.import(upload(data), res, assert.fail);
    assert.equal(res.location, '/');
  }
  assert.deepEqual(saved.map((todo) => todo.content.toString()), ['First', 'Second']);
  const res = response();
  await routes.import(upload(Buffer.alloc(0)), res, assert.fail);
  assert.equal(res.location, '/');
});

test('import formats valid dates, rejects unsafe formatting and forwards save errors', async () => {
  const data = Buffer.from('Dated,2026-10-10,en,YYYY-MM-DD\nBadDate,not-a-date,en,YYYY\nUnsafe,2026-10-10,../../secret,YYYY\nBadFormat,2026-10-10,en,<script>');
  await routes.import(upload(data), response(), assert.fail);
  assert.deepEqual(saved.map((todo) => todo.content.toString()), ['Dated [2026-10-10]', 'BadDate', 'Unsafe', 'BadFormat']);
  const error = new Error('Import save failed');
  mock.method(Todo.prototype, 'save', async () => { throw error; });
  await routes.import(upload(Buffer.from('Task')), response(), (actual) => assert.equal(actual, error));
});

test('about escapes device HTML and supplies a default device', () => {
  const res = response();
  routes.about_new({ query: { device: '<script>alert(1)</script>' } }, res);
  assert.equal(res.contentType, 'html');
  assert.ok(res.body.includes('&lt;script&gt;'));
  assert.ok(!res.body.includes('<script>'));
  const fallback = response();
  routes.about_new({ query: {} }, fallback);
  assert.ok(fallback.body.includes('Device: browser'));
});

test('chat authenticates, validates messages, limits content and restricts deletion', () => {
  const user = { name: 'test-user', password: 'test-user-password' };
  const admin = { name: 'test-admin', password: 'test-admin-password' };
  for (const auth of [undefined, { name: user.name, password: 'wrong' }]) {
    const res = response();
    routes.chat.add({ body: { auth, message: {} } }, res);
    assert.equal(res.statusCode, 403);
  }
  for (const message of [undefined, 'text', []]) {
    const res = response();
    routes.chat.add({ body: { auth: user, message } }, res);
    assert.equal(res.statusCode, 400);
  }
  const added = response();
  routes.chat.add({ body: { auth: user, message: { icon: 'i'.repeat(30), text: 't'.repeat(3000), content: 'content', message: 'message', userName: 'spoof' } } }, added);
  assert.deepEqual(added.body, { ok: true });
  routes.chat.add({ body: { auth: admin, message: {} } }, response());
  const list = response();
  routes.chat.get({}, list);
  assert.equal(list.body.length, 2);
  assert.equal(list.body[0].userName, user.name);
  assert.equal(list.body[0].text.length, 2000);
  assert.equal(list.body[0].icon.length, 16);
  assert.equal(list.body[1].userName, admin.name);
  for (const auth of [undefined, user]) {
    const denied = response();
    routes.chat.delete({ body: { auth, messageId: list.body[0].id } }, denied);
    assert.equal(denied.statusCode, 403);
  }
  const deleted = response();
  routes.chat.delete({ body: { auth: admin, messageId: list.body[0].id } }, deleted);
  assert.deepEqual(deleted.body, { ok: true });
  const remaining = response();
  routes.chat.get({}, remaining);
  assert.equal(remaining.body.length, 1);
  assert.equal(remaining.body[0].id, list.body[1].id);
});
