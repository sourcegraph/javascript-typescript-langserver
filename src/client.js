/// <reference path="../typings/node/node.d.ts"/>
var net = require('net');
var client = net.connect({ port: 2088 }, function () {
    // 'connect' listener
    console.log('connected to server!');
    client.write('world!\r\n');
});
client.on('data', function (data) {
    console.log(data.toString());
    client.end();
});
client.on('end', function () {
    console.log('disconnected from server');
});
