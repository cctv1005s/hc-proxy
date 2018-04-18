'use strict';

const pathToRegexp = require('path-to-regexp');
const http = require('http');
const url = require('url');
const crypto = require('crypto');
const qs = require('querystring');
const utils = require('./utils');

module.exports = function (u, proxyHeaders) {
  let endpoint = u.endpoint;
  let serviceInfo = url.parse(endpoint);
  let route = u.route;
  let method = u.method;
  let client = u.client;
  let timeout = u.timeout;
  let ws = u.ws;

  let routeKeys = [];
  let routePathGrep = pathToRegexp(u.route, routeKeys);

  return (clientReq, socket, clientHead, proxyUrl) => {
    const clientReqUrlInfo = url.parse(clientReq.url);
    socket.setTimeout(0);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 0);

    const options = {};
    options.method = 'GET';
    options.timeout = timeout || 0;   // ws 一直连着
    options.headers = {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Version': clientReq.headers['sec-websocket-version'] || '13',
      'Sec-WebSocket-Key': clientReq.headers['sec-websocket-key'] || crypto.randomBytes(24).toString('base64'),
      'Sec-Websocket-Extensions': clientReq.headers['sec-websocket-extensions'] || 'permessage-deflate; client_max_window_bits'
    };
    // options.protocol = serviceInfo.protocol || 'ws';
    options.hostname = serviceInfo.hostname;
    options.port = serviceInfo.port || 80;

    let defaultQuery = u.defaultQuery instanceof Object ? u.defaultQuery : qs.decode(u.defaultQuery);
    let customerQuery = qs.decode(url.parse(clientReq.url).query);
    options.path = utils.mergeQuery(proxyUrl, defaultQuery, customerQuery);

    const proxyReq = http.request(options);
    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      proxySocket.on('error', function (err) {
        socket.end('');
      });
      // The pipe below will end proxySocket if socket closes cleanly, but not
      // if it errors (eg, vanishes from the net and starts returning
      // EHOSTUNREACH). We need to do that explicitly.
      socket.on('error', function () {
        proxySocket.end();
      });

      proxySocket.setTimeout(0);
      proxySocket.setNoDelay(true);
      proxySocket.setKeepAlive(true, 0);

      if (proxyHead && proxyHead.length) {
        proxySocket.unshift(proxyHead);
      }
      //
      // Remark: Handle writing the headers to the socket when switching protocols
      // Also handles when a header is an array
      //
      let info = Object.keys(proxyRes.headers).reduce(function (head, key) {
        var value = proxyRes.headers[key];

        if (!Array.isArray(value)) {
          head.push(key + ': ' + value);
          return head;
        }

        for (var i = 0; i < value.length; i++) {
          head.push(key + ': ' + value[i]);
        }
        return head;
      }, ['HTTP/1.1 101 Switching Protocols']);

      socket.write(info.join('\r\n') + '\r\n\r\n');
      proxySocket.pipe(socket).pipe(proxySocket);
    });
    proxyReq.end();
  };
}