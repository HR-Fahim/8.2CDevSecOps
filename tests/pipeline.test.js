const test = require('node:test');
const assert = require('node:assert/strict');

const utils = require('../utils');
const usersRouter = require('../routes/users');

function routeHandler(method, path) {
    const layer = usersRouter.stack.find((item) => {
        return item.route &&
            item.route.path === path &&
            item.route.methods[method];
    });

    assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
    return layer.route.stack[0].handle;
}

function createResponse() {
    return {
        statusCode: 200,
        body: undefined,

        json(value) {
            this.body = value;
            return this;
        },

        send(value) {
            this.body = value;
            return this;
        },

        sendStatus(statusCode) {
            this.statusCode = statusCode;
            this.body = String(statusCode);
            return this;
        },

        status(statusCode) {
            this.statusCode = statusCode;
            return this;
        }
    };
}

test('ran_no works with a different valid range', () => {
    for (let i = 0; i < 20; i++) {
        const value = utils.ran_no(10, 50);

        assert.ok(value >= 10);
        assert.ok(value <= 50);
        assert.equal(Number.isInteger(value), true);
    }
});

test('ran_no returns the boundary value for a single-value range', () => {
    assert.equal(utils.ran_no(5, 5), 5);
});

test('uid returns the requested length for 4 characters', () => {
    const value = utils.uid(4);

    assert.equal(typeof value, 'string');
    assert.equal(value.length, 4);
});

test('uid returns the requested length for 16 characters', () => {
    const value = utils.uid(16);

    assert.equal(typeof value, 'string');
    assert.equal(value.length, 16);
});

test('uid returns strings', () => {
    const value = utils.uid(10);

    assert.equal(typeof value, 'string');
    assert.equal(value.length, 10);
});

test('ran_no returns a value inside the requested range', () => {
    const value = utils.ran_no(1, 10);

    assert.ok(value >= 1);
    assert.ok(value <= 10);
    assert.equal(Number.isInteger(value), true);
});

test('uid returns the requested length', () => {
    const value = utils.uid(10);

    assert.equal(typeof value, 'string');
    assert.equal(value.length, 10);
});

test('forbidden returns status 403', () => {
    const response = {
        statusCode: 200,
        headers: {},
        body: null,

        setHeader(name, value) {
            this.headers[name] = value;
        },

        end(body) {
            this.body = body;
        }
    };

    utils.forbidden(response);

    assert.equal(response.statusCode, 403);
    assert.equal(response.body, 'Forbidden');
});

test('users route lists seeded users without a database dependency', async () => {
    const response = createResponse();

    await routeHandler('get', '/')({}, response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.equal(Array.isArray(response.body), true);
    assert.equal(response.body[0].name, 'Liran');
});

test('users route rejects invalid role values', async () => {
    const response = createResponse();

    await routeHandler('post', '/')({
        body: { name: 'Asha', address: 'AU', role: 'owner' }
    }, response, assert.fail);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, { ok: false, error: 'Invalid user payload' });
});

test('users route accepts a valid user payload', async () => {
    const response = createResponse();

    await routeHandler('post', '/')({
        body: { name: 'Asha', address: 'AU', role: 'user' }
    }, response, assert.fail);

    assert.equal(response.statusCode, 201);
});

test('users route rejects missing, non-string and blank fields', async () => {
    for (const body of [
        {}, { name: 42, address: 'AU', role: 'user' },
        { name: 'Asha', address: {}, role: 'user' },
        { name: 'Asha', address: 'AU', role: [] },
        { name: ' ', address: 'AU', role: 'user' },
        { name: 'Asha', address: ' ', role: 'user' }
    ]) {
        const response = createResponse();
        await routeHandler('post', '/')({ body }, response, assert.fail);
        assert.equal(response.statusCode, 400);
    }
});
