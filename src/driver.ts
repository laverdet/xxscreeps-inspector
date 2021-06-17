import type { Sandbox } from 'xxscreeps/driver/sandbox';
import config from 'xxscreeps/config';
import * as uuid from 'uuid';
import { hooks } from 'xxscreeps/driver';

export const isolatesByUser = new Map<string, {
	sandbox: Sandbox;
	secret: string;
}>();

if (config.runner.unsafeSandbox) {
	console.error('⚠️  @xxscreeps/inspector will not work when `runner.unsafeSandbox` is used');
} else {
	hooks.register('isolateInspector', true);
	hooks.register('sandboxCreated', (sandbox, userId) => {
		const secret = uuid.v4();
		isolatesByUser.set(userId, {
			sandbox,
			secret,
		});
	});
}
