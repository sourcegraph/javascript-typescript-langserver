#!/bin/bash

./node_modules/.bin/tsc --declaration --outDir ./src && git add -A && git commit -m'[GENERATED FILES]' && git push -f origin HEAD:build
