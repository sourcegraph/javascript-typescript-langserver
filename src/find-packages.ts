/// <reference path="../typings/node/node.d.ts"/>
const findfiles = require('find-files-excluding-dirs');
const readJsonSync = require('read-json-sync');
import * as path from 'path';

export function collectFiles(dir, excludes) {
    var files = findfiles(dir, {
        exclude: excludes,
        matcher: function (directory, name) {
            return /\package.json?$/.test(name);
        }
    }).map(function (f) {
        try {
            let jsFiles = findfiles(path.dirname(f), {
                exclude: excludes,
                matcher: function (directory, name) {
                    return (/\.(js|jsx|ts|tsx)$/i).test(name);
                }
            });
            let fileNames = jsFiles.map(file => {
                return file.toLowerCase();
            });
            return { path: f, package: readJsonSync(f), files: fileNames };
        } catch (error) {
            console.error("Error in parsing file = ", f);
            console.error(error);
        }
        //return util.normalizePath(f);
    });
    return files;
}



