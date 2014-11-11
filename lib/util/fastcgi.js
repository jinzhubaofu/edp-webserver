var fastcgi = require('fastcgi-parser');
var u       = require('underscore');
var url     = require('url');
var net     = require('net');
var sys     = require('sys');

// FCGI的常量们
var FCGI_RESPONDER = fastcgi.constants.role.FCGI_RESPONDER;
var FCGI_BEGIN     = fastcgi.constants.record.FCGI_BEGIN;
var FCGI_STDIN     = fastcgi.constants.record.FCGI_STDIN;
var FCGI_STDOUT    = fastcgi.constants.record.FCGI_STDOUT;
var FCGI_PARAMS    = fastcgi.constants.record.FCGI_PARAMS;
var FCGI_END       = fastcgi.constants.record.FCGI_END;


/**
 * 默认参数
 *
 * @namespace
 */
var DEFAULTS = {
    port: 9000,
    host: 'localhost'
};

/**
 * 尝试在一段文本中找出http的header部分
 *
 * @param {string} text http响应文本
 * @return {object}
 */
function getHeader(text) {

    var fragments = text.split('\r\n\r\n');
    var headers = fragments[0];

    if (!headers) {
        return null;
    }

    var result = {
        headers: headers.split('\r\n').reduce(function (result, header) {
            header = header.split(':');

            var key = header[0];
            var value = header[1];

            if (key.toLowerCase() === 'status') {
                result.status = value.trim().slice(0, 3);
            }
            else {
                result[header[0]] = header.slice(1).join(':');
            }

            return result;
        }, {}),
        extra: fragments.slice(1).join('\r\n\r\n')
    };

    return result;

};


/**
 * @param {object} options 参数
 * @param {number} options.port fpm的本地端口
 * @param {string} options.host fpm的host地址
 */
module.exports.get = function fcgi(options) {

    options = u.extend({}, DEFAULTS, options);

    return function (params, load, callback) {

        var connection = new net.Stream();
        connection.setNoDelay(true);

        var header = {
            "version": fastcgi.constants.version,
            "type": FCGI_BEGIN,
            "recordId": 0,
            "contentLength": 0,
            "paddingLength": 0
        };

        var begin = {
            "role": FCGI_RESPONDER,
            "flags": fastcgi.constants.keepalive.OFF
        };

        var headers = '';
        var body = '';

        // 解析器
        var parser = new fastcgi.parser();

        // 当parser解析出错时
        parser.onError = function (err) {
            console.log('error: ', err);
        };

        // 当parser解析好数据时，存到response里
        parser.onRecord = function (record) {

            // 正常输出的数据
            if (record.header.type === FCGI_STDOUT) {

                // 如果还没有找到headres，那么尝试找
                if (!headers) {

                    // 这里先使用body做headers的缓存
                    body += record.body;

                    var tryHeaders = getHeader(body);

                    // 如果没找到，那么返回
                    if (!tryHeaders) {
                        return;
                    }

                    // 如果找到了，那么把headers给headers，body更新为除了headers以外的东西
                    headers = tryHeaders.headers;
                    body = tryHeaders.extra;
                    return;
                }

                body += record.body;
                return;
            }

            // 输出结束啦 全剧终
            if (record.header.type === FCGI_END) {

                // 如果响应结束时，还是只有headers，那么有点奇怪啊。。。
                // 我们把body的内容当作headers返回，body返回为空

                if (!headers) {
                    callback('', {
                        headers: body,
                        body: ''
                    });
                    return;
                }

                callback('', {
                    headers: headers,
                    body: body
                });

            }
        };

        // php-fpm 返回的数据，用parser解析掉
        connection.on('data', function (buffer, start, end) {
            parser.execute(buffer, start, end);
        });

        // 当连接到php-fpm时，初始化writer和parser;
        connection.on('connect', function() {
            send();
        });

        // 当与fcgi的连接被关闭时，结束
        connection.on("close", function() {
            connection.end();
        });

        connection.on("error", function(err) {
            sys.puts(sys.inspect(err.stack));
            connection.end();
        });

        connection.connect(options.port, options.host);

        function send() {

            var writer = new fastcgi.writer();
            writer.encoding = 'binary';

            // 发送开始头
            header.type = FCGI_BEGIN;
            header.contentLength = 8;
            writer.writeHeader(header);
            writer.writeBegin(begin);
            connection.write(writer.tobuffer());

            // 发送参数
            header.type = FCGI_PARAMS;
            header.contentLength = fastcgi.getParamLength(params);
            writer.writeHeader(header);
            writer.writeParams(params);
            connection.write(writer.tobuffer());

            // 发送参数结束？
            header.type = FCGI_PARAMS;
            header.contentLength = 0;
            writer.writeHeader(header);
            connection.write(writer.tobuffer());

            // 发送负载
            if (load && load.length) {
                header.type = FCGI_STDIN;
                header.contentLength = load.length;
                header.paddingLength = 0;
                writer.writeHeader(header);
                writer.writeBody(load);
                connection.write(writer.tobuffer());
            }

            // 发送结束部分
            header.type = FCGI_STDIN;
            header.contentLength = 0;
            header.paddingLength = 0;
            writer.writeHeader(header)
            connection.write(writer.tobuffer());

            // 结束
            connection.end();
        }

    };
};

/**
 * Make headers for FPM
 *
 * Some headers have to be modified to fit the FPM
 * handler and some others don't. For instance, the Content-Type
 * header, when received, has to be made upper-case and the
 * hyphen has to be made into an underscore. However, the Accept
 * header has to be made uppercase, hyphens turned into underscores
 * and the string "HTTP_" has to be appended to the header.
 *
 * @param  array headers An array of existing user headers from Node.js
 * @param  array params  An array of pre-built headers set in serveFpm
 *
 * @return array         An array of complete headers.
 */
exports.makeParams = function (headers, params) {
    if (headers.length <= 0) {
        return params;
    }
    for (var prop in headers) {
        var head = headers[prop];
        prop = prop.replace(/-/, '_').toUpperCase();
        if (prop.indexOf('CONTENT_') < 0) {
            // Quick hack for PHP, might be more or less headers.
            prop = 'HTTP_' + prop;
        }

        params[params.length] = [prop, head]
    }
    return params;
};
