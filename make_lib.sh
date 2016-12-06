#!/bin/bash

if ! git diff-index --quiet HEAD --; then
    echo ""
    echo "!!! Working directory is dirty, aborting."
    echo ""
    git status
    exit 1
fi

if [ "$(git rev-parse --abbrev-ref HEAD)" != "master" ]; then
    echo ""
    echo "!!! Must be on master branch"
    echo ""
    exit 1
fi

git branch build && git checkout build && ./node_modules/.bin/tsc --declaration --outDir ./src && git add :/src && git commit -m'[GENERATED FILES]' && git push -f origin HEAD:build && git checkout master
