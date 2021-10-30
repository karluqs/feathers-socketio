const feathers = require('@feathersjs/feathers');
const express = require('@feathersjs/express');
const assert = require('assert');
const _ = require('lodash');
const io = require('socket.io-client');
const request = require('request');
const { Service } = require('feathers-commons/lib/test/fixture');

const methodTests = require('./methods.js');
const eventTests = require('./events');
const socketio = require('../lib');

describe('@feathersjs/socketio', () => {
  let app, server, socket;

  const socketParams = {
    user: { name: 'David' },
    provider: 'socketio'
  };
  const options = {
    get app () {
      return app;
    },

    get socket () {
      return socket;
    }
  };

  before(done => {
    const errorHook = function (hook) {
      if (hook.params.query.hookError) {
        throw new Error(`Error from ${hook.method}, ${hook.type} hook`);
      }
    };

    app = feathers()
      .configure(socketio(function (io) {
        io.use(function (socket, next) {
          socket.feathers.user = { name: 'David' };

          const { channel } = socket.handshake.query;

          if (channel) {
            socket.feathers.channel = channel;
          }

          next();
        });
      }))
      .use('/todo', Service);

    app.service('todo').hooks({
      before: {
        get: errorHook
      }
    });

    server = app.listen(7886, function () {
      app.use('/tasks', Service);
      app.service('tasks').hooks({
        before: {
          get: errorHook
        }
      });
    });

    socket = io('http://localhost:7886');
    socket.on('connect', () => done());
  });

  after(done => {
    socket.disconnect();
    server.close(done);
  });

  it('exports default and SOCKET_KEY', () => {
    assert.ok(socketio.SOCKET_KEY);
    assert.strictEqual(socketio, socketio.default);
  });

  it('throws an error when using an incompatible version of Feathers', () => {
    const oldFeathers = require('feathers');

    try {
      oldFeathers().configure(socketio());
      assert.ok(false, 'Should never get here');
    } catch (e) {
      assert.strictEqual(e.message, '@feathersjs/socketio is not compatible with this version of Feathers. Use the latest at @feathersjs/feathers.');
    }
  });

  it('runs io before setup (#131)', done => {
    let counter = 0;
    const app = feathers().configure(socketio(() => {
      assert.strictEqual(counter, 0);
      counter++;
    }));

    const srv = app.listen(8887).on('listening', () => srv.close(done));
  });

  it('can set MaxListeners', done => {
    const app = feathers().configure(socketio(io =>
      io.sockets.setMaxListeners(100)
    ));

    const srv = app.listen(8987).on('listening', () => {
      assert.strictEqual(app.io.sockets.getMaxListeners(), 100);
      srv.close(done);
    });
  });

  it('expressified app works', done => {
    const data = { message: 'Hello world' };
    const app = express(feathers())
      .configure(socketio())
      .use('/test', (req, res) => res.json(data));
    const srv = app.listen(8992).on('listening', () => {
      const url = 'http://localhost:8992/socket.io/socket.io.js';

      request(url, (err, res) => {
        assert.ok(!err);
        assert.strictEqual(res.statusCode, 200);

        const url = 'http://localhost:8992/test';

        request({ url, json: true }, (err, res) => {
          assert.ok(!err);
          assert.deepStrictEqual(res.body, data);
          srv.close(done);
        });
      });
    });
  });

  it('can set options (#12)', done => {
    const app = feathers().configure(socketio({
      path: '/test/'
    }, io => assert.ok(io)));

    const srv = app.listen(8987).on('listening', () => {
      const url = 'http://localhost:8987/test/socket.io.js';

      // eslint-disable-next-line handle-callback-err
      request(url, (err, res) => {
        assert.strictEqual(res.statusCode, 200);
        srv.close(done);
      });
    });
  });

  it('passes handshake as service parameters', done => {
    const service = app.service('todo');
    const old = {
      create: service.create,
      update: service.update
    };

    service.create = function (data, params) {
      assert.deepStrictEqual(_.omit(params, 'query', 'route', 'connection'), socketParams, 'Passed handshake parameters');
      return old.create.apply(this, arguments);
    };

    service.update = function (id, data, params) {
      assert.deepStrictEqual(params, _.extend({
        route: {},
        connection: socketParams,
        query: {
          test: 'param'
        }
      }, socketParams), 'Passed handshake parameters as query');
      return old.update.apply(this, arguments);
    };

    socket.emit('create', 'todo', {}, error => {
      assert.ok(!error);

      socket.emit('update', 'todo', 1, {}, {
        test: 'param'
      }, error => {
        assert.ok(!error);
        _.extend(service, old);
        done();
      });
    });
  });

  it('missing parameters in socket call works (#88)', done => {
    const service = app.service('todo');
    const old = { find: service.find };

    service.find = function (params) {
      assert.deepStrictEqual(_.omit(params, 'query', 'route', 'connection'), socketParams, 'Handshake parameters passed on proper position');
      return old.find.apply(this, arguments);
    };

    socket.emit('find', 'todo', error => {
      assert.ok(!error);
      _.extend(service, old);
      done();
    });
  });

  describe('Service method calls', () => {
    describe('(\'method\', \'service\')  event format', () => {
      describe('Service', () => methodTests('todo', options));
      describe('Dynamic Service', () => methodTests('todo', options));
    });

    describe('(\'service::method\') legacy event format', () => {
      describe('Service', () => methodTests('tasks', options, true));
      describe('Dynamic Service', () => methodTests('tasks', options, true));
    });
  });

  describe('Service events', () => {
    describe('Service', () => eventTests('todo', options));
    describe('Dynamic Service', () => eventTests('tasks', options));
  });
});
