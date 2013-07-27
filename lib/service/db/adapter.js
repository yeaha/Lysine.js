"use strict";

var _ = require('underscore');
var util = require('util');
var Q = require('q');
var Expr = require(__dirname+'/utils').Expr;
var Select = require(__dirname+'/select');
var _driver = {};

function Adapter(dsn, options) {
    this._dsn = dsn;
    this._options = options;

    var driver = dsn.match(/^(\w+):/)[1];

    if (_driver[driver])
        _.extend(this, _driver[driver]);
}

Adapter.prototype.quote = function(value) {
    if (value instanceof Expr)
        return value.toString();

    if (value === null || _.isUndefined(value))
        return 'NULL';

    value = value.replace("'", "\\'");

    return "'"+value+"'";
};

Adapter.prototype.quoteIdentifier = function(identifier) {
    if (identifier instanceof Expr)
        return identifier.toString();

    var symbol = this._identifier_symbol;

    if (identifier.substr(0, 1) === symbol)
        return identifier;

    identifier = identifier.replace(symbol, '').split('.');
    return _.map(identifier, function(s) { return symbol+s+symbol; }).join('.');
};

Adapter.prototype.query = function() {
    return this._query.apply(this, arguments);
};

Adapter.prototype.select = function(table) {
    return new Select(this, table);
};

// returning: 需要返回自增长ID值的字段
Adapter.prototype.insert = function(table, data, returning) {
    var sql = 'INSERT INTO %s (%s) VALUES (%s)';
    var columns = [];
    var params = [];
    var placeholder = [];

    _.each(data, function(value, key) {
        columns.push(this.quoteIdentifier(key));

        if (value instanceof Expr) {
            placeholder.push(value.toString());
        } else {
            placeholder.push('?');
            params.push(value);
        }
    }, this);

    sql = util.format(sql, this.quoteIdentifier(table), columns.join(','), placeholder.join(','));
    if (this._replacePlaceholder)
        sql = this._replacePlaceholder(sql);

    if (_.isUndefined(returning)) {
        returning = [];
    } else if (!_.isArray(returning)) {
        returning = [returning];
    }

    var self = this;
    var pool = this._pool();

    return Q.ninvoke(pool, 'acquire')
            .then(function(conn) {
                return Q.ninvoke(conn, 'query', sql, params)
                        .then(function() {
                            if (!returning.length)
                                return true;

                            var queue = [];
                            _.each(returning, function(column) {
                                var sql = self._lastIdStatement(table, column);
                                queue.push(Q.ninvoke(conn, 'query', sql));
                            });

                            return Q.spread(queue, function() {
                                var values = _.map(arguments, function(res) {
                                    var rows = res.rows;
                                    return rows.length ? rows[0]['last_id'] : null;
                                });

                                return _.object(returning, values);
                            });
                        })
                        .finally(function() {
                            pool.release(conn);
                        });
            });
};

Adapter.prototype.update = function(table, data, where, where_params) {
    var sql = 'UPDATE %s SET %s';
    var set = [];
    var params = [];

    _.each(data, function(value, key) {
        var column = this.quoteIdentifier(key);

        if (value instanceof Expr) {
            set.push(util.format('%s = %s', column, value.toString()));
        } else {
            set.push(util.format('%s = ?', column));
            params.push(value);
        }
    }, this);

    sql = util.format(sql, this.quoteIdentifier(table), set.join(','));

    if (where)
        sql += ' WHERE '+ where;

    where_params = (!where || _.isUndefined(where_params))
                 ? []
                 : (_.isArray(where_params) ? where_params : _.values(arguments).slice(3));

    params.push.apply(params, where_params);

    return this.query(sql, params);
};

Adapter.prototype.delete = function(table, where, where_params) {
    var sql = util.format('DELETE FROM %s', this.quoteIdentifier(table));
    var params = (!where || _.isUndefined(where_params))
               ? []
               : (_.isArray(where_params) ? where_params : _.values(arguments).slice(2));

    if (where)
        sql += ' WHERE '+ where;

    return this.query(sql, params);
};

Adapter.prototype._pool = function() {
    if (this.pool)
        return this.pool;

    var pool = require('any-db').createPool(this._dsn, this._options);

    _.each(['exit', 'SIGHUP', 'SIGINT', 'SIGQUIT'], function(event) {
        process.on(event, _.bind(pool.close, pool));
    });

    return this.pool = pool;
};

Adapter.prototype._query = function(sql, params, stream_mode) {
    var defered = Q.defer();

    if (_.isUndefined(params))
        params = [];

    this._pool().query(sql, params)
        .on('row', function(row, res) {
            if (!stream_mode) res.addRow(row);
            defered.notify(row);
        })
        .on('end', _.bind(defered.resolve, defered))
        .on('error', _.bind(defered.reject, defered));

    return defered.promise;
};

_driver['postgres'] = {
    _identifier_symbol: '"',

    query: function(sql, params, stream_mode) {
        sql = this._replacePlaceholder(sql);

        return this._query(sql, params, stream_mode);
    },

    // 把sql语句内的"?"占位符，替换成$1...$n
    _replacePlaceholder: function(sql) {
        if (sql.indexOf('?') === -1)
            return sql;

        var counter = 1;
        var quote = false;
        var replaced = [];

        for (var c, p, i = 0, len = sql.length; i < len; i++) {
            c = sql[i];

            if (c == "'" && p != '\\')
                quote = !quote;

            if (c == '?' && !quote)
                c = '$'+(counter++);

            replaced.push(c);

            p = c;
        }

        return replaced.join('');
    },

    // 查询字段自增ID值的语句
    _lastIdStatement: function(table, column) {
        if (!table || !column)
            return 'SELECT LASTVAL() AS last_id';

        table = table.replace(this._identifier_symbol, '').split('.');

        var schema = '';
        if (table.length === 2) {
            schema = table[0];
            table = table[1];
        } else {
            table = table[0];
        }

        var sequence = util.format('%s_%s_seq', table, column);
        if (schema)
            sequence = schema+'.'+sequence;

        return util.format("SELECT CURRVAL('%s') AS last_id", this.quoteIdentifier(sequence));
    },
};

_driver['mysql'] = {
    _identifier_symbol: '`',

    _lastIdStatement: function() {
        return 'SELECT last_insert_id() AS last_id';
    }
};

module.exports = exports = Adapter;