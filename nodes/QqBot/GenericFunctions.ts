import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type {
	ILoadOptionsFunctions,
	IExecuteFunctions,
	INodeExecutionData,
} from 'n8n-workflow';

export const QQ_API_BASE_URL = 'https://api.bot.qq.com';

const ED25519_SEED_SIZE = 32;
const ED25519_SIGNATURE_SIZE = 64;
// PKCS#8 (DER) header for an Ed25519 private key carrying a 32-byte seed
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

interface Ed25519KeyPair {
	privateKey: KeyObject;
	publicKey: KeyObject;
}

/**
 * Derives an Ed25519 key pair from a QQ bot AppSecret.
 *
 * QQ Open Platform webhook signatures use a key derived from the AppSecret:
 * the secret is repeated until it is at least 32 bytes long and the first
 * 32 bytes are used as the Ed25519 seed.
 */
export function deriveEd25519KeyPair(secret: string): Ed25519KeyPair {
	let seed = Buffer.from(secret, 'utf8');
	while (seed.length < ED25519_SEED_SIZE) {
		seed = Buffer.concat([seed, seed]);
	}
	seed = seed.subarray(0, ED25519_SEED_SIZE);

	const privateKey = createPrivateKey({
		key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
		format: 'der',
		type: 'pkcs8',
	});
	return { privateKey, publicKey: createPublicKey(privateKey) };
}

/**
 * Signs the callback URL validation payload (`event_ts` + `plain_token`)
 * with the key derived from the AppSecret, as required when configuring the
 * webhook callback address (opcode 13).
 */
export function signCallbackValidation(secret: string, eventTs: string, plainToken: string): string {
	const { privateKey } = deriveEd25519KeyPair(secret);
	return sign(null, Buffer.from(eventTs + plainToken, 'utf8'), privateKey).toString('hex');
}

/**
 * Verifies the signature of an event push against `timestamp` + raw request
 * body, using the public key derived from the AppSecret. Also applies the
 * platform's signature sanity checks (64-byte signature, last byte's upper
 * three bits must be zero).
 */
export function verifyEventSignature(
	secret: string,
	timestamp: string,
	rawBody: Buffer,
	signatureHex: string,
): boolean {
	if (!timestamp || !signatureHex) {
		return false;
	}

	const signature = Buffer.from(signatureHex, 'hex');
	if (signature.length !== ED25519_SIGNATURE_SIZE || (signature[63] & 0xe0) !== 0) {
		return false;
	}

	const { publicKey } = deriveEd25519KeyPair(secret);
	return verify(
		null,
		Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]),
		publicKey,
		signature,
	);
}

interface CachedAccessToken {
	access_token: string;
	expiresAt: number;
}

// The QQ API answers with HTTP 200 even for errors; the code/message live in the body
interface QqBotApiErrorResponse {
	code: number;
	message: string;
}

function assertApiSuccess(response: unknown): void {
	if (
		typeof response === 'object' &&
		response !== null &&
		typeof (response as QqBotApiErrorResponse).code === 'number' &&
		(response as QqBotApiErrorResponse).code !== 0
	) {
		const { code, message } = response as QqBotApiErrorResponse;
		throw new Error(`QQ Bot API error ${code}: ${message}`);
	}
}

interface AccessTokenCache {
	qqBot?: Record<string, CachedAccessToken>;
}

// First-level in-process cache; static data (below) survives restarts and queue-mode workers
const inMemoryTokenCache = new Map<string, CachedAccessToken>();

// Tokens are valid for 7200s; refresh early to avoid using a token at the edge of expiry
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Returns a cached access token for the bot, refreshing it via the
 * `/app/getAppAccessToken` endpoint when missing or expired. The token is
 * cached in the workflow's static data (per appId), so repeated calls within
 * a workflow do not re-exchange the AppSecret on every API call.
 */
export async function getAccessToken(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	appId: string,
	appSecret: string,
): Promise<string> {
	const cached = inMemoryTokenCache.get(appId);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.access_token;
	}

	const staticData = this.getWorkflowStaticData('global') as AccessTokenCache;
	staticData.qqBot ??= {};
	const stored = staticData.qqBot[appId];
	if (stored && Date.now() < stored.expiresAt) {
		inMemoryTokenCache.set(appId, stored);
		return stored.access_token;
	}

	const response = await this.helpers.httpRequest({
		method: 'POST',
		url: `${QQ_API_BASE_URL}/app/getAppAccessToken`,
		body: {
			appId,
			clientSecret: appSecret,
		},
		json: true,
	});

	assertApiSuccess(response);

	const expiresInMs = Number(response.expires_in) * 1000;
	const token: CachedAccessToken = {
		access_token: response.access_token,
		expiresAt: Date.now() + expiresInMs - TOKEN_EXPIRY_MARGIN_MS,
	};
	staticData.qqBot[appId] = token;
	inMemoryTokenCache.set(appId, token);
	return token.access_token;
}

/**
 * Sends a message to a QQ group or to a user (C2C) and returns the raw
 * API response for one item.
 */
export async function sendMessage(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	accessToken: string,
	receiverType: 'group' | 'c2c',
	openId: string,
	body: Record<string, unknown>,
): Promise<INodeExecutionData['json']> {
	const url =
		receiverType === 'group'
			? `${QQ_API_BASE_URL}/v2/groups/${openId}/messages`
			: `${QQ_API_BASE_URL}/v2/users/${openId}/messages`;

	const response = await this.helpers.httpRequest({
		method: 'POST',
		url,
		headers: {
			Authorization: `QQBot ${accessToken}`,
		},
		body,
		json: true,
	});
	assertApiSuccess(response);
	return response as INodeExecutionData['json'];
}

/**
 * Uploads a media file (by URL) for a group or a user (C2C) chat and returns
 * the raw API response containing `file_info` (to pass to the send message
 * API as `media.file_info`) and its TTL in seconds. Files uploaded through
 * the group API can only be sent to that group, and likewise for users.
 */
export async function uploadFile(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	accessToken: string,
	receiverType: 'group' | 'c2c',
	openId: string,
	body: Record<string, unknown>,
): Promise<INodeExecutionData['json']> {
	const url =
		receiverType === 'group'
			? `${QQ_API_BASE_URL}/v2/groups/${openId}/files`
			: `${QQ_API_BASE_URL}/v2/users/${openId}/files`;

	const response = await this.helpers.httpRequest({
		method: 'POST',
		url,
		headers: {
			Authorization: `QQBot ${accessToken}`,
		},
		body,
		json: true,
	});
	assertApiSuccess(response);
	return response as INodeExecutionData['json'];
}

/**
 * Recalls a message in a group or a user (C2C) chat. Messages can only be
 * recalled within 2 minutes of sending; recalling other members' group
 * messages requires the bot to be a group admin.
 */
export async function recallMessage(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	accessToken: string,
	receiverType: 'group' | 'c2c',
	openId: string,
	messageId: string,
): Promise<INodeExecutionData['json']> {
	const url =
		receiverType === 'group'
			? `${QQ_API_BASE_URL}/v2/groups/${openId}/messages/${messageId}`
			: `${QQ_API_BASE_URL}/v2/users/${openId}/messages/${messageId}`;

	const response = await this.helpers.httpRequest({
		method: 'DELETE',
		url,
		headers: {
			Authorization: `QQBot ${accessToken}`,
		},
		json: true,
	});
	assertApiSuccess(response);
	return response as INodeExecutionData['json'];
}
