/// <reference path="../typings/node/node.d.ts"/>
const findfiles = require('find-files-excluding-dirs');
const readJsonSync = require('read-json-sync');

export function collectFiles(dir, excludes) {
    var files = findfiles(dir, {
        exclude: excludes,
        matcher: function (directory, name) {
            return /\package.json?$/.test(name);
        }
    }).map(function (f) {
        try {
            return { path: f, package: readJsonSync(f) };
        } catch (error) {
            console.error("Error in parsing file = ", f);
        }
        //return util.normalizePath(f);
    });
    return files;
}



