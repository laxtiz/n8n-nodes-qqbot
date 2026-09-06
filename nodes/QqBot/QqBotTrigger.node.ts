import type {
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHookFunctions,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { signCallbackValidation, verifyEventSignature } from './GenericFunctions';

const OP_EVENT_DISPATCH = 0;
const OP_HTTP_CALLBACK_ACK = 12;
const OP_CALLBACK_VALIDATE = 13;

interface QqBotWebhookPayload {
	id?: string;
	op: number;
	s?: number;
	t?: string;
	d?: Record<string, unknown>;
}

interface CallbackValidationPayload {
	plain_token?: string;
	event_ts?: string;
}

interface ExpressRequestWithRawBody {
	body?: QqBotWebhookPayload;
	rawBody?: Buffer;
	headers: Record<string, string | string[] | undefined>;
}

export class QqBotTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'QQ Bot Trigger',
		name: 'qqBotTrigger',
		icon: { light: 'file:qqbot.svg', dark: 'file:qqbot.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'On new event',
		description: 'Handle QQ Bot events via the webhook callback mode',
		defaults: {
			name: 'QQ Bot Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'qqBotApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [],
	};

	// The QQ Open Platform has no OpenAPI for registering callback addresses —
	// the callback URL is configured manually in the bot console, where the
	// platform validates it with an opcode-13 request. The lifecycle is a no-op.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const credentials = await this.getCredentials('qqBotApi');
		const appId = credentials.appId as string;
		const appSecret = credentials.appSecret as string;

		const req = this.getRequestObject() as unknown as ExpressRequestWithRawBody;
		const res = this.getResponseObject();

		let body = req.body;
		if (body === undefined && req.rawBody) {
			body = JSON.parse(req.rawBody.toString('utf8')) as QqBotWebhookPayload;
		}

		// When the callback address is configured, the platform sends opcode 13
		// and expects the plain token echoed back with a signature over
		// `event_ts` + `plain_token`.
		if (body?.op === OP_CALLBACK_VALIDATE) {
			const { plain_token: plainToken, event_ts: eventTs } = (body.d ??
				{}) as CallbackValidationPayload;
			if (!plainToken || !eventTs) {
				res.status(400).json({ error: 'Missing plain_token or event_ts in validation payload' });
				return { noWebhookResponse: true };
			}

			const signature = signCallbackValidation(appSecret, eventTs, plainToken);
			res.status(200).json({ plain_token: plainToken, signature });
			return { noWebhookResponse: true };
		}

		// Event pushes are signed; verify `timestamp` + raw body before accepting.
		const timestamp = req.headers['x-signature-timestamp'];
		const signatureHex = req.headers['x-signature-ed25519'];
		const headerAppId = req.headers['x-bot-appid'];

		if (
			!body ||
			body.op !== OP_EVENT_DISPATCH ||
			typeof timestamp !== 'string' ||
			typeof signatureHex !== 'string' ||
			req.rawBody === undefined ||
			(headerAppId !== undefined && headerAppId !== appId) ||
			!verifyEventSignature(appSecret, timestamp, req.rawBody, signatureHex)
		) {
			res.status(401).json({ error: 'Invalid webhook signature' });
			return { noWebhookResponse: true };
		}

		// Opcode 12 (HTTP Callback ACK) tells the platform the event was received.
		res.status(200).json({ op: OP_HTTP_CALLBACK_ACK });

		const item: INodeExecutionData = {
			json: {
				event: body.t,
				...(body.d ?? {}),
			},
		};
		return { workflowData: [[item]], noWebhookResponse: true };
	}
}
