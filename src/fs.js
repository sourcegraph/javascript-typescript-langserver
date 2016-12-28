"use strict";
const fs = require("fs");
const path_ = require("path");
var ReadDirRequest;
(function (ReadDirRequest) {
    ReadDirRequest.type = { get method() { return 'fs/readDir'; } };
})(ReadDirRequest = exports.ReadDirRequest || (exports.ReadDirRequest = {}));
var ReadFileRequest;
(function (ReadFileRequest) {
    ReadFileRequest.type = { get method() { return 'fs/readFile'; } };
})(ReadFileRequest = exports.ReadFileRequest || (exports.ReadFileRequest = {}));
class RemoteFileSystem {
    constructor(connection) {
        this.connection = connection;
    }
    readDir(path, callback) {
        this.connection.sendRequest(ReadDirRequest.type, path).then((f) => {
            return callback(null, f);
        }, callback);
    }
    readFile(path, callback) {
        this.connection.sendRequest(ReadFileRequest.type, path).then((content) => {
            return callback(null, Buffer.from(content, 'base64').toString());
        }, callback);
    }
}
exports.RemoteFileSystem = RemoteFileSystem;
class LocalFileSystem {
    constructor(root) {
        this.root = root;
    }
    readDir(path, callback) {
        path = path_.resolve(this.root, path);
        fs.readdir(path, (err, files) => {
            if (err) {
                return callback(err);
            }
            let ret = [];
            files.forEach((f) => {
                const stats = fs.statSync(path_.resolve(path, f));
                ret.push({
                    name: f,
                    size: stats.size,
                    dir: stats.isDirectory()
                });
            });
            return callback(null, ret);
        });
    }
    readFile(path, callback) {
        path = path_.resolve(this.root, path);
        fs.readFile(path, (err, buf) => {
            if (err) {
                return callback(err);
            }
            return callback(null, buf.toString());
        });
    }
}
exports.LocalFileSystem = LocalFileSystem;
//# sourceMappingURL=fs.js.map