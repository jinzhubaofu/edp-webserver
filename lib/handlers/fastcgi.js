var fastcgi = require('../util/fastcgi');
var u = require('underscore');
var url = require('url');


/**
 * @param {object} options 参数
 * @param {number} options.port fpm的本地端口
 * @param {string} options.host fpm的host地址
 */
module.exports = function fcgi(options) {

    var fcgiRequester = fastcgi.get(options);

    return function (context) {

        var request = context.request;
        var targetURL = request.url;
        var targetPathName = request.pathname;
        var targetSearch = request.search;

        var docRoot = context.conf.documentRoot;
        var path = require('path');
        var scriptName = targetPathName;
        var scriptFileName = path.normalize(docRoot + targetPathName);
        var query = url.parse(targetURL).query || '';

        var params = fastcgi.makeParams(
            request.headers,
            [
                ["SCRIPT_FILENAME", scriptFileName],
                ["REMOTE_ADDR", request.connection.remoteAddress],
                ["QUERY_STRING", query],
                ["REQUEST_METHOD", request.method],
                ["SCRIPT_NAME", scriptFileName],
                ["PATH_INFO", scriptFileName],
                ["DOCUMENT_URI", scriptFileName],
                ["REQUEST_URI", targetURL],
                ["DOCUMENT_ROOT", docRoot],
                ["PHP_SELF", scriptFileName],
                ["GATEWAY_PROTOCOL", "CGI/1.1"],
                ["SERVER_SOFTWARE", "node/" + process.version]
            ]
        );

        console.dir(request.headers);

        context.stop();

        fcgiRequester(params, request.bodyBuffer, function (err, data) {
            context.status = data.headers.status || 200;
            u.extend(context.header, data.headers);
            context.content = data.body;
            context.start();
        });

    };

};
