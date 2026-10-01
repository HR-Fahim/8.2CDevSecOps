const test = require('node:test');
const assert = require('node:assert/strict');

const utils = require('../utils');

test('ran_no returns a value inside the requested range', () => {
    const value = utils.ran_no(1, 10);

    assert.ok(value >= 1);
    assert.ok(value <= 10);
    assert.equal(Number.isInteger(value), true);
});

test('uid returns the requested length', () => {
    const value = utils.uid(10);

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