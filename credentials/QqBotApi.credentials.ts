import type { ICredentialTestRequest, ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class QqBotApi implements ICredentialType {
	name = 'qqBotApi';

	displayName = 'QQ Bot API';

	icon: Icon = {
		light: 'file:../nodes/QqBot/qqbot.svg',
		dark: 'file:../nodes/QqBot/qqbot.dark.svg',
	};

	documentationUrl = 'https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/webhook.html';

	properties: INodeProperties[] = [
		{
			displayName: 'AppID',
			name: 'appId',
			type: 'string',
			required: true,
			default: '',
			description: 'The AppID of the QQ bot from the QQ Open Platform console',
		},
		{
			displayName: 'AppSecret',
			name: 'appSecret',
			type: 'string',
			typeOptions: {
				password: true,
			},
			required: true,
			default: '',
			description:
				'The AppSecret of the QQ bot, used to sign webhook callback validation responses and verify incoming events',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.bot.qq.com',
			url: '/app/getAppAccessToken',
			method: 'POST',
			body: {
				appId: '={{ $credentials.appId }}',
				clientSecret: '={{ $credentials.appSecret }}',
			},
		},
	};
}
