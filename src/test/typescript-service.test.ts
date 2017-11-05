import { TypeScriptService } from '../typescript-service'
import { describeTypeScriptService } from './typescript-service-helpers'

describe('TypeScriptService', () => {
    for (const rootUri of ['file:///', 'file:///c:/foo/bar/', 'file:///foo/bar/']) {
        describe(`rootUri ${rootUri}`, () => {
            describeTypeScriptService((client, options) => new TypeScriptService(client, options), undefined, rootUri)
        })
    }
})
