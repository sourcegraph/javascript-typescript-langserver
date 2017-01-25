import * as cp from 'child_process';
import * as path_ from 'path';

import * as tmp from 'tmp';

import * as utils from './test-utils';
import { LocalFileSystem } from '../fs';

import { TypeScriptService } from '../typescript-service';

// forcing strict mode
import * as util from '../util';
util.setStrict(true);


function exec(command: string, cwd: string) {
	const opts = {
		cwd
	};
	console.log('executing:', command);
	console.log(cp.execSync(command, opts).toString());
}

function clone(repo: string, hash: string, temp: string) {
	exec('git clone --single-branch ' + repo + ' .', temp);
	exec('git checkout ' + hash, temp);
}

function e2e(repo: string, hash: string, descriptor: utils.TestDescriptor) {
	describe('e2e ' + repo, () => {

		let cleanup: () => void = null;
		let root: string = null;

		before(function (done) {
			this.timeout(0);
			cleanup = null;
			tmp.dir({ unsafeCleanup: true }, (err, path, callback) => {
				if (err) {
					return done(err);
				}
				console.log('using temporary directory', path);
				cleanup = callback;
				root = path;

				try {
					clone(repo, hash, path);
				} catch (e) {
					return done(e);
				}
				utils.setUp(new TypeScriptService(), new LocalFileSystem(root, path_.join), done);
			});
		});
		describe('passes', () => {
			utils.tests(descriptor);
		});
		after(function (done) {
			this.timeout(0);
			if (cleanup) {
				cleanup();
			}
			utils.tearDown(done);
		});
	});
}

e2e('https://github.com/palantir/tslint', 'f53ec359b7d95795f1da58463b73fc4987bbf554', {
	hovers: {
		'src/utils.ts:52:20': {
			contents: [
				{
					'language': 'typescript',
					'value': 'function dedent(strings: TemplateStringsArray, ...values: string[]): string'
				},
				'Removes leading indents from a template string without removing all leading whitespace'
			]
		}
	},
	definitions: {
		'src/configuration.ts:108:20': 'src/configuration.ts:129:0:155:1'
	},
	references: {
		'src/utils.ts:45:20': 5
	},
	xdefinitions: {
		'src/rules/arrayTypeRule.ts:31:43': [
			{
				'location': {
					'range': {
						'end': {
							'character': 1,
							'line': 69
						},
						'start': {
							'character': 0,
							'line': 52
						}
					},
					'uri': 'file:///src/utils.ts'
				},
				'symbol': {
					'containerKind': '',
					'containerName': '/src/utils',
					'kind': 'function',
					'name': 'dedent'
				}
			}
		]
	},
	packages: [
		{
			'dependencies': [
				{
					'attributes': {
						'name': 'babel-code-frame',
						'version': '^6.20.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'colors',
						'version': '^1.1.2'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'diff',
						'version': '^3.0.1'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'findup-sync',
						'version': '~0.3.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'glob',
						'version': '^7.1.1'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'optimist',
						'version': '~0.6.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'resolve',
						'version': '^1.1.7'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'update-notifier',
						'version': '^1.0.2'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/babel-code-frame',
						'version': '^6.20.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/chai',
						'version': '^3.4.34'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/colors',
						'version': '^0.6.33'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/diff',
						'version': '0.0.31'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/findup-sync',
						'version': '^0.3.29'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/glob',
						'version': '^5.0.30'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/js-yaml',
						'version': '^3.5.29'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/mocha',
						'version': '^2.2.35'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/node',
						'version': '^6.0.56'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/optimist',
						'version': '0.0.29'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/resolve',
						'version': '0.0.4'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': '@types/update-notifier',
						'version': '^1.0.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'chai',
						'version': '^3.5.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'js-yaml',
						'version': '^3.7.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'mocha',
						'version': '^3.2.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'npm-run-all',
						'version': '^3.1.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'rimraf',
						'version': '^2.5.4'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'tslint',
						'version': 'latest'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'tslint-test-config-non-relative',
						'version': 'file:test/external/tslint-test-config-non-relative'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'typescript',
						'version': '2.1.4'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				},
				{
					'attributes': {
						'name': 'typescript',
						'version': '>=2.0.0'
					},
					'hints': {
						'dependeePackageName': 'tslint'
					}
				}
			],
			'package': {
				'name': 'tslint',
				'repoURL': 'https://github.com/palantir/tslint.git',
				'version': '4.3.1'
			}
		},
		{
			'dependencies': [
				{
					'attributes': {
						'name': 'tslint-test-config',
						'version': '../external/tslint-test-config'
					},
					'hints': {
						'dependeePackageName': 'tslint-test-configs'
					}
				},
				{
					'attributes': {
						'name': 'tslint-test-custom-rules',
						'version': '../external/tslint-test-custom-rules'
					},
					'hints': {
						'dependeePackageName': 'tslint-test-configs'
					}
				}
			],
			'package': {
				'name': 'tslint-test-configs',
				'version': '0.0.1'
			}
		},
		{
			'dependencies': [],
			'package': {
				'name': 'tslint-test-config',
				'version': '0.0.1'
			}
		},
		{
			'dependencies': [],
			'package': {
				'name': 'tslint-test-config-non-relative',
				'version': '0.0.1'
			}
		},
		{
			'dependencies': [],
			'package': {
				'name': 'tslint-test-custom-rules',
				'version': '0.0.1'
			}
		}
	],
	completions: {
		'src/language/languageServiceHost.ts:62:13': [
			{
				'detail': '(method) LanguageServiceEditableHost.editFile(fileName: string, newContent: string): void',
				'documentation': '',
				'kind': 2,
				'label': 'editFile',
				'sortText': '0'
			}
		]
	},
	dependencies: [
		{
			'attributes': {
				'name': 'babel-code-frame',
				'version': '^6.20.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'colors',
				'version': '^1.1.2'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'diff',
				'version': '^3.0.1'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'findup-sync',
				'version': '~0.3.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'glob',
				'version': '^7.1.1'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'optimist',
				'version': '~0.6.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'resolve',
				'version': '^1.1.7'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'update-notifier',
				'version': '^1.0.2'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/babel-code-frame',
				'version': '^6.20.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/chai',
				'version': '^3.4.34'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/colors',
				'version': '^0.6.33'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/diff',
				'version': '0.0.31'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/findup-sync',
				'version': '^0.3.29'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/glob',
				'version': '^5.0.30'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/js-yaml',
				'version': '^3.5.29'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/mocha',
				'version': '^2.2.35'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/node',
				'version': '^6.0.56'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/optimist',
				'version': '0.0.29'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/resolve',
				'version': '0.0.4'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': '@types/update-notifier',
				'version': '^1.0.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'chai',
				'version': '^3.5.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'js-yaml',
				'version': '^3.7.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'mocha',
				'version': '^3.2.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'npm-run-all',
				'version': '^3.1.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'rimraf',
				'version': '^2.5.4'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'tslint',
				'version': 'latest'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'tslint-test-config-non-relative',
				'version': 'file:test/external/tslint-test-config-non-relative'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'typescript',
				'version': '2.1.4'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'typescript',
				'version': '>=2.0.0'
			},
			'hints': {
				'dependeePackageName': 'tslint'
			}
		},
		{
			'attributes': {
				'name': 'tslint-test-config',
				'version': '../external/tslint-test-config'
			},
			'hints': {
				'dependeePackageName': 'tslint-test-configs'
			}
		},
		{
			'attributes': {
				'name': 'tslint-test-custom-rules',
				'version': '../external/tslint-test-custom-rules'
			},
			'hints': {
				'dependeePackageName': 'tslint-test-configs'
			}
		}
	],
	symbols: null, // TODO
	workspaceReferences: null, // TODO
	documentSymbols: {
		// TODO
	}
});