const findfiles = require('find-files-excluding-dirs');
const readJsonSync = require('read-json-sync');
import * as path from 'path';

export function collectFiles(dir, excludes) {
    return findfiles(dir, {
        exclude: excludes,
        matcher: function (directory, name) {
            return /\package.json?$/.test(name);
        }
    }).map(function (f) {
        try {
            let jsFiles = findfiles(path.dirname(f), {
                exclude: excludes,
                matcher: function (directory, name) {
                    return (/\.(jsx?|tsx?)$/i).test(name);
                }
            }).map(function(f) {
                return path.normalize(f);
            });
            let packageContent = null;
            try {
                packageContent = readJsonSync(f);
            } catch (e) {
                // ignore bad packages
            }
            return { path: f, package: packageContent, files: jsFiles };
        } catch (error) {
            console.error("Error in parsing file = ", f);
            console.error(error);
        }
    }).filter(function(item) {
        // include only properly parsed ones
        return item.package;
    });
}



