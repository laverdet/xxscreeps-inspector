import fs from 'fs/promises';
import mount from 'koa-mount';
import serve from 'koa-static';
import ws from 'ws';
import config from 'xxscreeps/config';
import { fileURLToPath } from 'url';
import { hooks } from 'xxscreeps/backend';
import { isolatesByUser } from './driver';

if (!config.runner.unsafeSandbox) {
	const index = new URL(await import.meta.resolve('chrome-devtools-frontend/front_end/inspector.html'));
	const content = await fs.readFile(index, 'utf8');
	hooks.register('middleware', (koa, router) => {
		koa.use(mount('/inspector', serve(fileURLToPath(new URL('.', index)), {
			immutable: true,
			maxAge: 31536000,
		})));
		router.get(/\/inspector$/, context => context.redirect('/inspector/'));
		router.get('/inspector/', (context, next) => {
			const { userId } = context.state;
			if (userId) {
				context.set('Content-Type', 'text/html');
				context.body = content.replace(
					'<head>',
					`<head>
					<title>xxscreeps | Inspector</title>
					<script type="text/javascript">
					history.replaceState({}, 'Session', ${JSON.stringify(`?experiments=true&v8only=true&panel=sources&ws=${context.request.host}/inspector/session/${userId}`)});
					</script>
				`);
			} else {
				return next();
			}
		});

		// Listen for inspector websocket
		const fakeServer = new ws.Server({ noServer: true });
		router.get('/inspector/session/:id', async context => {
			const sandbox = isolatesByUser.get(context.params.id);
			if (context.upgrade && sandbox) {
				const session = sandbox.sandbox.createInspectorSession();
				try {
					await context.upgrade((req, socket, head) => new Promise<void>((resolve, reject) => {
						socket.on('end', reject);
						fakeServer.handleUpgrade(req, socket, head, ws => {
							socket.removeListener('end', reject);

							ws.send(JSON.stringify({
								method: 'Runtime.consoleAPICalled',
								params: {
									type: 'log',
									args: [
										{
											type: 'string',
											value: '',
											description: `Welcome to the Screeps inspector. You can also connect to this debugger using Chrome's built-in inspector: devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&panel=sources&ws=${context.request.host}/inspector/session/${context.params.id}`,
										},
									],
									executionContextId: 0,
									timestamp: 0,
									stackTrace: { callFrames: [] },
								},
							}));

							// Listen for close
							ws.once('close', resolve);
							ws.once('error', reject);
							// Relay messages from frontend to backend
							ws.on('message', message => {
								try {
									session.dispatchProtocolMessage(message.toString('utf8'));
								} catch (err) {
									reject(err);
									ws.close();
								}
							});
							// Relay messages from backend to frontend
							const send = (message: string) => {
								try {
									ws.send(message);
								} catch (err) {
									reject(err);
								}
							};
							session.onNotification = send;
							session.onResponse = (callId, message) => send(message);
						});
					}));
				} finally {
					session.dispose();
				}
			}
		});
	});
}
