/// <reference path="../typings/node/node.d.ts"/>
/// <reference path="../typings/express/express.d.ts"/>
/// <reference path="../typings/body-parser/body-parser.d.ts"/>
/// <reference path="../typings/vscode-extension-vscode/es6.d.ts"/>

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import * as express from 'express';
import * as bodyParser from 'body-parser';

import * as ts from 'typescript';

import TypeScriptService from './typescript';
import * as util from './util';

var nodefs = require('node-fs');

export function serve(port: number, workspaceRoot: string) {

	function workspace(req: any, sync?: boolean): Promise<string> {
		console.log('checking workspace', req.body.Repo, req.body.Commit);
		return new Promise((resolve, reject) => {
			let p = path.join(workspaceRoot, req.body.Repo, req.body.Commit, "workspace");
			fs.stat(p, function (err, stats) {
				if (err) {
					if (sync) {
						clone(req.body.Repo, req.body.Commit, p, true).then(function res() {
							resolve(p);
						}, function rej() {
							reject('Clone failed');
						});
						return;
					} else {
						setTimeout(function () { clone(req.body.Repo, req.body.Commit, p) }, 0);
						return reject('being configured');
					}
				}
				configure(p, sync).then(function res() {
					resolve(p);
				}, function rej() {
					reject(p);
				});
			});
		});
	}

	function clone(repo, commit, directory: string, sync?: boolean): Promise<boolean> {
		console.log('cloning', repo, commit, 'to', directory);
		return new Promise((resolve, reject) => {
			let parent = path.dirname(directory).replace(/\\/g, '/');
			nodefs.mkdir(parent, 0o777 & (~process.umask()), true, function (err) {
				if (err) {
					console.error('Failed to make directory ' + parent, err);
					return reject(false);
				}
				child_process.exec('git clone https://' + repo + ' ' + directory, {
					cwd: parent
				}, function (err) {
					if (err) {
						console.error('Failed to clone ' + repo + ' to ' + directory, err);
						return reject(false);
					}
					console.log('cloned', repo, 'to', directory);
					child_process.exec('git reset --hard ' + commit, {
						cwd: directory
					}, function (err) {
						if (err) {
							console.error('Failed to reset ' + directory + ' to ' + commit, err);
							return reject(false);
						}
						console.log('reset', repo, 'to', commit);
						configure(directory, sync).then(function res() {
							resolve(true);
						}, function rej() {
							reject(false);
						});
					});
				});
			});
		});
	}

	function configure(p: string, sync?: boolean): Promise<string> {
		console.log('configuring', p);
		return new Promise((resolve, reject) => {
			let lock = path.join(p, '.sourcegraph.lock');
			fs.stat(lock, function (err, stats) {
				if (err) {
					fs.closeSync(fs.openSync(lock, 'w'));
					console.log('installing packages into', p);
					child_process.exec('npm install', {
						cwd: p
					}, function (err) {
						console.log('installed packages into', p);
						if (sync) {
							return resolve(p);
						}
					});
					if (!sync) {
						reject('npm packages being installed');
					}
					return;
				}
				return resolve(p);
			});
		});
	}

	var app = express();
	app.use(bodyParser.json());

	app.post('/prepare', (req, res) => {
		workspace(req, true).then(function () {
			res.sendStatus(200);
		}, function () {
			res.sendStatus(400);
		});
	});

	app.post('/hover', (req, res) => {
		let future = workspace(req);
		future.then(function (path) {
			let service = new TypeScriptService(path);
			try {
				console.log('hover', req.body.Repo, req.body.Commit, req.body.File, req.body.Line, req.body.Character);
				const quickInfo: ts.QuickInfo = service.getHover('file:///' + req.body.File, req.body.Line + 1, req.body.Character + 1);
				res.send({
					Title: quickInfo.kind,
					DocHTML: util.docstring(quickInfo.documentation)
				});
			} catch (e) {
				console.error('hover', req.body, e, e.stack);
				res.status(500).send({ Error: '' + e });
			}
		}, function () {
			res.sendStatus(503);
		});
	});

	app.post('/definition', (req, res) => {
		let future = workspace(req);
		future.then(function (p) {
			let service = new TypeScriptService(p);
			try {
				console.log('definition', req.body.Repo, req.body.Commit, req.body.File, req.body.Line, req.body.Character);
				const defs: ts.DefinitionInfo[] = service.getDefinition('file:///' + req.body.File, req.body.Line + 1, req.body.Character + 1);
				// TODO: what if there are more than 1 def?
				if (defs.length == 0) {
					return res.status(400).send({ Error: 'No definition found' });
				}
				const def: ts.DefinitionInfo = defs[0];
				const start = service.position(def.fileName, def.textSpan.start);
				const end = service.position(def.fileName, def.textSpan.start + def.textSpan.length);
				let rel = path.relative(path.normalize(p), path.normalize(def.fileName));
				res.send({
					File: util.normalizePath(rel),
					StartLine: start.line - 1,
					StartCharacter: start.character - 1,
					EndLine: end.line - 1,
					EndCharacter: end.character - 1
				});
			} catch (e) {
				console.error('definition', req.body, e, e.stack);
				res.status(500).send({ Error: '' + e });
			}
		}, function () {
			res.sendStatus(503);
		});
	});

	app.post('/local-refs', (req, res) => {
		let future = workspace(req, true);
		future.then(function (p) {
			let service = new TypeScriptService(p);
			try {
				console.log('local-refs', req.body.Repo, req.body.Commit, req.body.File, req.body.Line, req.body.Character);
				const refs: ts.ReferenceEntry[] = service.getReferences('file:///' + req.body.File, req.body.Line + 1, req.body.Character + 1);
				let ret = { Refs: [] };
				refs.forEach(function (ref) {
					const start = service.position(ref.fileName, ref.textSpan.start);
					const end = service.position(ref.fileName, ref.textSpan.start + ref.textSpan.length);
					let rel = path.relative(path.normalize(p), path.normalize(ref.fileName));
					ret.Refs.push({
						File: util.normalizePath(rel),
						StartLine: start.line - 1,
						StartCharacter: start.character - 1,
						EndLine: end.line - 1,
						EndCharacter: end.character - 1
					});
				});
				res.send(ret);
			} catch (e) {
				console.error('local-refs', req.body, e, e.stack);
				res.status(500).send({ Error: '' + e });
			}
		}, function () {
			res.status(500).send({ Error: 'Ooops, shouldn\'t happen' });
		});
	});

	app.post('/external-refs', (req, res) => {
		let future = workspace(req, true);
		future.then(function (path) {
			let service = new TypeScriptService(path);
			try {
				console.log('external-refs', req.body.Repo, req.body.Commit);
				const externals = service.getExternalRefs();
				let ret = { Defs: [] };
				externals.forEach(function (external) {
					ret.Defs.push({
						Repo: external.repoURL,
						Commit: external.repoCommit,
						Unit: external.repoName,
						Path: external.path
					});
				});
				res.send(ret);
			} catch (e) {
				console.error('external-refs', req.body, e, e.stack);
				res.status(500).send({ Error: '' + e });
			}
		}, function () {
			res.status(500).send({ Error: 'Ooops, shouldn\'t happen' });
		});
	});

	app.post('/exported-symbols', (req, res) => {
		let future = workspace(req, true);
		future.then(function (p) {
			let service = new TypeScriptService(p);
			try {
				console.log('exported-symbols', req.body.Repo, req.body.Commit);
				const exported = service.getExportedEnts();
				let ret = { Symbols: [] };
				exported.forEach(function (entry) {
					ret.Symbols.push({
						Name: entry.name,
						Kind: entry.kind,
						File: entry.location.file,
						DocHTML: entry.documentation,
						Path: entry.path
					});
				});
				res.send(ret);
			} catch (e) {
				console.error('exported-symbols', req.body, e, e.stack);
				res.status(500).send({ Error: '' + e });
			}
		}, function () {
			res.status(500).send({ Error: 'Ooops, shouldn\'t happen' });
		});
	});

	app.post('/position-to-defspec', (req, res) => {
		let future = workspace(req, true);
		future.then(function (p) {
			let service = new TypeScriptService(p);
			try {
				console.log('position-to-defspec', req.body.Repo, req.body.Commit, req.body.File, req.body.Line, req.body.Character);
				let specs = service.getPathForPosition('file:///' + req.body.File, req.body.Line + 1, req.body.Character + 1);
				let spec = specs[0];
				res.send({
					Repo: req.body.Repo,
					Commit: req.body.Commit,
					UnitType: "JSModule",
					Unit: req.body.Repo,
					Path: spec,
				});
			} catch (e) {
				console.error('position-to-defspec', req.body, e, e.stack);
				res.status(500).send({ Error: '' + e });
			}
		}, function () {
			res.status(500).send({ Error: 'Ooops, shouldn\'t happen' });
		});
	});

	app.post('/defspec-to-position', (req, res) => {
		let future = workspace(req, true);
		future.then(function (p) {
			let service = new TypeScriptService(p);
			try {
				console.log('defspec-to-position', req.body.Repo, req.body.Commit, req.body.UnitType, req.body.Unit, req.body.Path);
				let posVariants = service.getPositionForPath(req.body.Path);
				let pos = posVariants[0];
				let start = service.position(pos.fileName, pos.start);
				let rel = path.relative(path.normalize(p), path.normalize(pos.fileName));
				res.send({
					Repo: req.body.Repo,
					Commit: req.body.Commit,
					File: util.normalizePath(rel),
					Line: start.line - 1,
					Character: start.character - 1
				});
			} catch (e) {
				console.error('defspec-to-position', req.body, e, e.stack);
				res.status(500).send({ Error: '' + e });
			}
		}, function () {
			res.status(500).send({ Error: 'Ooops, shouldn\'t happen' });
		});
	});
	app.listen(port);

}