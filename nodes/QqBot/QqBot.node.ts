import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, jsonParse } from 'n8n-workflow';

import { getAccessToken, recallMessage, sendMessage, uploadFile } from './GenericFunctions';

const RECEIVER_SHOW = {
	show: {
		resource: ['message', 'file'],
		operation: ['send', 'recall', 'upload'],
	},
};

const SEND_SHOW = {
	show: {
		resource: ['message'],
		operation: ['send'],
	},
};

export class QqBot implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'QQ Bot',
		name: 'qqBot',
		icon: { light: 'file:qqbot.svg', dark: 'file:qqbot.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with the QQ Bot OpenAPI',
		defaults: {
			name: 'QQ Bot',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'qqBotApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Message',
						value: 'message',
					},
					{
						name: 'File',
						value: 'file',
					},
				],
				default: 'message',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				options: [
					{
						name: 'Send',
						value: 'send',
						description: 'Send a message to a group or a user',
						action: 'Send a message',
					},
					{
						name: 'Recall',
						value: 'recall',
						description: 'Recall a message in a group or a user chat',
						action: 'Recall a message',
					},
				],
				default: 'send',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['file'],
					},
				},
				options: [
					{
						name: 'Upload',
						value: 'upload',
						description:
							'Upload a media file and get a file_info to pass to the Send operation (Rich Media message type)',
						action: 'Upload a file',
					},
				],
				default: 'upload',
			},
			{
				displayName: 'Send To',
				name: 'receiveType',
				type: 'options',
				noDataExpression: true,
				displayOptions: RECEIVER_SHOW,
				options: [
					{
						name: 'Group',
						value: 'group',
						description: 'A QQ group chat',
					},
					{
						name: 'User (C2C)',
						value: 'c2c',
						description: 'A direct chat with a QQ user',
					},
				],
				default: 'group',
				description: 'Which chat to operate on',
			},
			{
				displayName: 'OpenID',
				name: 'openId',
				type: 'string',
				required: true,
				displayOptions: RECEIVER_SHOW,
				default: '',
				description:
					'The group_openid for group chats, or the user_openid for user (C2C) chats, taken from the message event. Note that files uploaded through the group API can only be sent to that group, and likewise for users.',
			},
			{
				displayName: 'File Type',
				name: 'fileType',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['upload'],
					},
				},
				options: [
					{
						name: 'Image',
						value: 1,
						description: 'PNG or JPG image (soft limit 20MB, hard limit 200MB)',
					},
					{
						name: 'Video',
						value: 2,
						description: 'MP4 video (soft limit 30MB, hard limit 200MB)',
					},
					{
						name: 'Voice',
						value: 3,
						description: 'Silk voice (soft limit 20MB, hard limit 200MB)',
					},
					{
						name: 'File',
						value: 4,
						description: 'Generic file (limit 200MB)',
					},
				],
				default: 1,
				description:
					'The kind of media to upload. Oversized media is downgraded to a generic file.',
			},
			{
				displayName: 'Media URL',
				name: 'mediaUrl',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['upload'],
					},
				},
				default: '',
				placeholder: 'https://example.com/image.png',
				description:
					'A publicly accessible HTTP(S) URL of the media; the platform downloads and re-hosts the file',
			},
			{
				displayName: 'File Name',
				name: 'fileName',
				type: 'string',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['upload'],
					},
				},
				default: '',
				description: 'Optional file name to give the uploaded media',
			},
			{
				displayName: 'Send Immediately',
				name: 'sendImmediately',
				type: 'boolean',
				displayOptions: {
					show: {
						resource: ['file'],
						operation: ['upload'],
					},
				},
				default: false,
				description:
					'Whether to send the media to the chat right away as an active message instead of only returning a file_info; this consumes active-message quota and the response then contains the sent message ID',
			},
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['recall'],
					},
				},
				default: '',
				description:
					'The ID of the message to recall: the ID returned by the send operation, or the ID of a group member message taken from the message event. Messages can only be recalled within 2 minutes of sending. Recalling messages of other members requires the bot to be a group admin.',
			},
			{
				displayName: 'Message Type',
				name: 'msgType',
				type: 'options',
				noDataExpression: true,
				displayOptions: SEND_SHOW,
				options: [
					{
						name: 'Text',
						value: 'text',
						description: 'Plain text content (msg_type=0)',
					},
					{
						name: 'Markdown',
						value: 'markdown',
						description:
							'Markdown content (msg_type=2), optionally with an inline keyboard; requires the bot to have markdown permission',
					},
					{
						name: 'Rich Media',
						value: 'media',
						description:
							'Image, video, voice or file (msg_type=7); requires a file_info obtained from the file upload API',
					},
				],
				default: 'text',
				description: 'The format of the message content',
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						...SEND_SHOW.show,
						msgType: ['text'],
					},
				},
				default: '',
				description: 'The text content to send',
			},
			{
				displayName: 'Markdown',
				name: 'markdown',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						...SEND_SHOW.show,
						msgType: ['markdown'],
					},
				},
				default: '',
				description: 'The markdown content to send',
				typeOptions: {
					rows: 4,
				},
			},
			{
				displayName: 'Keyboard (JSON)',
				name: 'keyboard',
				type: 'json',
				displayOptions: {
					show: {
						...SEND_SHOW.show,
						msgType: ['markdown'],
					},
				},
				default: '',
				// The keyboard short form's field is literally named `id` in the QQ API,
				// so the lowercase spelling in the JSON example must be kept verbatim.
				// eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-id, n8n-nodes-base/node-param-description-unencoded-angle-brackets
				description:
					'Optional inline keyboard sent with the markdown message, as a Keyboard object: the long form { "content": { "rows": [ ... ] } } or the short form { "id": "<keyboard template id>" }.',
			},
			{
				displayName: 'File Info',
				name: 'fileInfo',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						...SEND_SHOW.show,
						msgType: ['media'],
					},
				},
				default: '',
				description:
					'The file_info returned by the file upload API; it expires after a while, in which case the file must be uploaded again',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				displayOptions: SEND_SHOW,
				default: {},
				options: [
					{
						displayName: 'Message ID',
						name: 'msgId',
						type: 'string',
						default: '',
						description:
							'The ID of the message to reply to (passive reply). Group replies are valid for 5 minutes with up to 5 replies, user replies for 60 minutes with up to 4 replies. Leave empty to send an active message',
					},
					{
						displayName: 'Message Sequence',
						name: 'msgSeq',
						type: 'number',
						default: 1,
						description:
							'Sequence number to distinguish multiple passive replies to the same message; increment for each additional reply',
					},
					{
						displayName: 'Reference Message IDX',
						name: 'messageReferenceId',
						type: 'string',
						default: '',
						description:
							'The REFIDX_… string from the message event’s message_scene.ext or from a send response’s ext_info.ref_idx, to send the message as a quoted reply',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('qqBotApi');
		const appId = credentials.appId as string;
		const appSecret = credentials.appSecret as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;
				const receiveType = this.getNodeParameter('receiveType', i) as 'group' | 'c2c';
				const openId = this.getNodeParameter('openId', i) as string;

				const accessToken = await getAccessToken.call(this, appId, appSecret);

				let responseData: INodeExecutionData['json'];

				if (operation === 'recall') {
					const messageId = this.getNodeParameter('messageId', i) as string;
					await recallMessage.call(this, accessToken, receiveType, openId, messageId);
					responseData = { success: true };
				} else if (operation === 'upload') {
					const fileType = this.getNodeParameter('fileType', i) as number;
					const mediaUrl = this.getNodeParameter('mediaUrl', i) as string;
					const fileName = this.getNodeParameter('fileName', i, '') as string;
					const sendImmediately = this.getNodeParameter('sendImmediately', i, false) as boolean;

					const body: Record<string, unknown> = {
						file_type: fileType,
						url: mediaUrl,
						srv_send_msg: sendImmediately,
					};
					if (fileName) {
						body.file_name = fileName;
					}

					responseData = await uploadFile.call(this, accessToken, receiveType, openId, body);
				} else {
					responseData = await buildAndSendMessage.call(this, accessToken, receiveType, openId, i);
				}

				returnData.push({
					json: responseData,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

async function buildAndSendMessage(
	this: IExecuteFunctions,
	accessToken: string,
	receiveType: 'group' | 'c2c',
	openId: string,
	itemIndex: number,
): Promise<INodeExecutionData['json']> {
		const msgType = this.getNodeParameter('msgType', itemIndex) as 'text' | 'markdown' | 'media';
		const options = this.getNodeParameter('options', itemIndex, {}) as {
			msgId?: string;
			msgSeq?: number;
			messageReferenceId?: string;
		};

		const body: Record<string, unknown> = {
			msg_type: msgType === 'markdown' ? 2 : msgType === 'media' ? 7 : 0,
		};

		if (msgType === 'markdown') {
			body.markdown = { content: this.getNodeParameter('markdown', itemIndex) as string };
			const keyboard = this.getNodeParameter('keyboard', itemIndex, '') as string | object;
			if (keyboard !== '' && keyboard !== undefined) {
				body.keyboard = typeof keyboard === 'string' ? jsonParse(keyboard) : keyboard;
			}
		} else if (msgType === 'media') {
			body.media = { file_info: this.getNodeParameter('fileInfo', itemIndex) as string };
		} else {
			body.content = this.getNodeParameter('content', itemIndex) as string;
		}

		if (options.msgId) {
			body.msg_id = options.msgId;
		}
		if (options.msgSeq !== undefined) {
			body.msg_seq = options.msgSeq;
		}
		if (options.messageReferenceId) {
			body.message_reference = { message_id: options.messageReferenceId };
		}

		return await sendMessage.call(this, accessToken, receiveType, openId, body);
}

