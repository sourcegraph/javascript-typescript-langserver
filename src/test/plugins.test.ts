import * as path from 'path'
import * as sinon from 'sinon'
import * as ts from 'typescript'
import { InMemoryFileSystem } from '../memfs'
import { PluginLoader, PluginModule, PluginModuleFactory } from '../plugins'
import { PluginSettings } from '../request-type'
import { path2uri } from '../util'

describe('plugins', () => {
    describe('loadPlugins()', () => {
        it('should do nothing if no plugins are configured', () => {
            const memfs = new InMemoryFileSystem('/')

            const loader = new PluginLoader('/', memfs)
            const compilerOptions: ts.CompilerOptions = {}
            const applyProxy: (pluginModuleFactory: PluginModuleFactory) => PluginModule = sinon.spy()
            loader.loadPlugins(compilerOptions, applyProxy)
        })

        it('should load a global plugin if specified', () => {
            const memfs = new InMemoryFileSystem('/')
            const peerPackagesPath = path.resolve(__filename, '../../../../')
            const peerPackagesUri = path2uri(peerPackagesPath)
            memfs.add(
                peerPackagesUri + '/node_modules/some-plugin/package.json',
                '{ "name": "some-plugin", "version": "0.1.1", "main": "plugin.js"}'
            )
            memfs.add(peerPackagesUri + '/node_modules/some-plugin/plugin.js', '')
            const pluginSettings: PluginSettings = {
                globalPlugins: ['some-plugin'],
                allowLocalPluginLoads: false,
                pluginProbeLocations: [],
            }
            const pluginFactoryFunc = (modules: any) => 5
            const fakeRequire = (path: string) => pluginFactoryFunc
            const loader = new PluginLoader('/', memfs, pluginSettings, undefined, memfs, fakeRequire)
            const compilerOptions: ts.CompilerOptions = {}
            const applyProxy = sinon.spy()
            loader.loadPlugins(compilerOptions, applyProxy)
            sinon.assert.calledOnce(applyProxy)
            sinon.assert.calledWithExactly(
                applyProxy,
                pluginFactoryFunc,
                sinon.match({ name: 'some-plugin', global: true })
            )
        })

        it('should load a local plugin if specified', () => {
            const rootDir = (process.platform === 'win32' ? 'c:\\' : '/') + 'some-project'
            const rootUri = path2uri(rootDir) + '/'
            const memfs = new InMemoryFileSystem('/some-project')
            memfs.add(
                rootUri + 'node_modules/some-plugin/package.json',
                '{ "name": "some-plugin", "version": "0.1.1", "main": "plugin.js"}'
            )
            memfs.add(rootUri + 'node_modules/some-plugin/plugin.js', '')
            const pluginSettings: PluginSettings = {
                globalPlugins: [],
                allowLocalPluginLoads: true,
                pluginProbeLocations: [],
            }
            const pluginFactoryFunc = (modules: any) => 5
            const fakeRequire = (path: string) => pluginFactoryFunc
            const loader = new PluginLoader(rootDir, memfs, pluginSettings, undefined, memfs, fakeRequire)
            const pluginOption: ts.PluginImport = {
                name: 'some-plugin',
            }
            const compilerOptions: ts.CompilerOptions = {
                plugins: [pluginOption],
            }
            const applyProxy = sinon.spy()
            loader.loadPlugins(compilerOptions, applyProxy)
            sinon.assert.calledOnce(applyProxy)
            sinon.assert.calledWithExactly(applyProxy, pluginFactoryFunc, sinon.match(pluginOption))
        })
    })
})
