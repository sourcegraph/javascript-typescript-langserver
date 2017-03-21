
import {TypeScriptService} from '../typescript-service';
import {describeTypeScriptService} from './typescript-service-helpers';

describe('TypeScriptService', () => {
	describeTypeScriptService((client, options) => new TypeScriptService(client, options));
});
