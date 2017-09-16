import * as assert from 'assert';
import * as sinon from 'sinon';
import * as ts from 'typescript';
import {InMemoryFileSystem} from '../memfs';
import {PluginLoader, PluginModule, PluginModuleFactory} from '../plugins';
import {InitializationOptions} from '../request-type';

describe('plugins', () => {
	describe('constructor', () => {
		it('should use defaults if no initializationOptions are provided', () => {
			const memfs = new InMemoryFileSystem('/');

			const loader = new PluginLoader('/', memfs);
			assert(!loader.allowLocalPluginLoads);
			assert.equal(loader.globalPlugins.length, 0);
			assert.equal(loader.pluginProbeLocations.length, 0);
		});
	});
	describe('loader', () => {
		it('should do nothing if no plugins are configured', () => {
			const memfs = new InMemoryFileSystem('/');

			const loader = new PluginLoader('/', memfs);
			const compilerOptions: ts.CompilerOptions = {};
			const applyProxy: (pluginModuleFactory: PluginModuleFactory) => PluginModule = sinon.spy();
			loader.loadPlugins(compilerOptions, applyProxy);

		});

		it('should load a global plugin if specified', () => {
			const memfs = new InMemoryFileSystem('/');
			memfs.add('file:///Users/tomv/Projects/sourcegraph/node_modules/some-plugin/package.json', '{ "name": "some-plugin", "version": "0.1.1", "main": "plugin.js"}');
			memfs.add('file:///Users/tomv/Projects/sourcegraph/node_modules/some-plugin/plugin.js', 'module.exports = function (modules) { return 5; };');
			const initializationOptions: InitializationOptions = {
				globalPlugins: ['some-plugin'],
				allowLocalPluginLoads: false,
				pluginProbeLocations: []
			};
			const pluginFactoryFunc = (modules: any) => 5;
			const loader = new PluginLoader('/', memfs, initializationOptions);
			loader.require = (path: string) => pluginFactoryFunc;
			const compilerOptions: ts.CompilerOptions = {};
			const applyProxy = sinon.spy();
			loader.loadPlugins(compilerOptions, applyProxy);
			sinon.assert.calledOnce(applyProxy);
			sinon.assert.calledWithExactly(applyProxy, pluginFactoryFunc, sinon.match({ name: 'some-plugin', global: true}));
		});

		it('should load a local plugin if specified', () => {
			const memfs = new InMemoryFileSystem('/some-project');
			memfs.add('file:///some-project/node_modules/some-plugin/package.json', '{ "name": "some-plugin", "version": "0.1.1", "main": "plugin.js"}');
			memfs.add('file:///some-project/node_modules/some-plugin/plugin.js', 'module.exports = function (modules) { return 5; };');
			const initializationOptions: InitializationOptions = {
				globalPlugins: [],
				allowLocalPluginLoads: true,
				pluginProbeLocations: []
			};
			const pluginFactoryFunc = (modules: any) => 5;
			const loader = new PluginLoader('/some-project', memfs, initializationOptions);
			loader.require = (path: string) => pluginFactoryFunc;
			const pluginOption: ts.PluginImport = {
				name: 'some-plugin'
			};
			const compilerOptions: ts.CompilerOptions = {
				plugins: [pluginOption]
			};
			const applyProxy = sinon.spy();
			loader.loadPlugins(compilerOptions, applyProxy);
			sinon.assert.calledOnce(applyProxy);
			sinon.assert.calledWithExactly(applyProxy, pluginFactoryFunc, sinon.match({ name: 'some-plugin'}));
		});

	});
});
