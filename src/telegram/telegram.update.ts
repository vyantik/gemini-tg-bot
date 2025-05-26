import { Command, InjectBot, On, Start, Update } from '@grammyjs/nestjs'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Bot, Context, InlineKeyboard } from 'grammy'

import { FileSystemService } from './file-system.service.js'
import { TelegramService } from './telegram.service.js'
import { UserAccessService } from './user-access.service.js'

@Update()
@Injectable()
export class TelegramUpdate {
	private readonly botToken: string
	private readonly logger = new Logger(TelegramUpdate.name)
	private adminState: Map<number, 'add_user' | 'remove_user'> = new Map()

	constructor(
		@InjectBot() private readonly bot: Bot<Context>,
		private readonly configService: ConfigService,
		private readonly telegramService: TelegramService,
		private readonly fileSystemService: FileSystemService,
		private readonly userAccessService: UserAccessService,
	) {
		this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN')
	}

	@Start()
	async onStart(ctx: Context): Promise<void> {
		if (!(await this.userAccessService.isAllowed(ctx.from?.id ?? 0))) {
			await ctx.reply('Извините, у вас нет доступа к боту.')
			return
		}
		await ctx.reply(
			'👋 Привет! Отправь мне любой вопрос, и я постараюсь ответить на него.',
		)
	}

	@Command('admin')
	async onAdmin(ctx: Context): Promise<void> {
		if (!this.userAccessService.isAdmin(ctx.from?.id ?? 0)) {
			await ctx.reply('У вас нет прав администратора.')
			return
		}

		const keyboard = new InlineKeyboard()
			.text('📋 Список пользователей', 'list_users')
			.row()
			.text('➕ Добавить пользователя', 'add_user')
			.row()
			.text('➖ Удалить пользователя', 'remove_user')

		await ctx.reply('Панель администратора:', {
			reply_markup: keyboard,
		})
	}

	@On('callback_query')
	async onCallbackQuery(ctx: Context): Promise<void> {
		if (!this.userAccessService.isAdmin(ctx.from?.id ?? 0)) {
			await ctx.answerCallbackQuery('У вас нет прав администратора.')
			return
		}

		const data = ctx.callbackQuery.data
		if (!data) return

		switch (data) {
			case 'list_users':
				const users = await this.userAccessService.getAllowedUsers()
				await ctx.reply(
					`Список разрешенных пользователей:\n${users.join('\n')}`,
				)
				break
			case 'add_user':
				this.adminState.set(ctx.from?.id ?? 0, 'add_user')
				await ctx.reply(
					'Отправьте ID пользователя, которого хотите добавить.',
				)
				break
			case 'remove_user':
				this.adminState.set(ctx.from?.id ?? 0, 'remove_user')
				await ctx.reply(
					'Отправьте ID пользователя, которого хотите удалить.',
				)
				break
		}

		await ctx.answerCallbackQuery()
	}

	@On('message:text')
	async onMessage(ctx: Context): Promise<void> {
		try {
			const userId = ctx.from?.id ?? 0

			if (this.userAccessService.isAdmin(userId)) {
				const state = this.adminState.get(userId)
				if (state) {
					const message = ctx.message.text
					if (!message) return

					const targetUserId = parseInt(message)
					if (isNaN(targetUserId)) {
						await ctx.reply(
							'Пожалуйста, отправьте корректный ID пользователя (число).',
						)
						return
					}

					if (state === 'add_user') {
						await this.userAccessService.addAllowedUser(
							targetUserId,
						)
						await ctx.reply(
							`Пользователь ${targetUserId} успешно добавлен.`,
						)
					} else {
						await this.userAccessService.removeAllowedUser(
							targetUserId,
						)
						await ctx.reply(
							`Пользователь ${targetUserId} успешно удален.`,
						)
					}

					this.adminState.delete(userId)
					return
				}
			}

			if (!(await this.userAccessService.isAllowed(userId))) {
				await ctx.reply('Извините, у вас нет доступа к боту.')
				return
			}

			const message = ctx.message.text
			if (!message) {
				return
			}

			this.logger.log(
				`Received message: "${message}" from user "${ctx.from?.id}"`,
			)

			await ctx.reply('Подождите, я анализирую ваше сообщение...🤔')

			const response = await this.telegramService.processTextMessage(
				message,
				ctx.from?.id ?? 0,
			)

			this.telegramService.sendMessage(ctx, response)
		} catch (error) {
			this.logger.error(error)
			await ctx.reply('Произошла ошибка при обработке сообщения.')
		}
	}

	@On('message:photo')
	async onPhoto(ctx: Context): Promise<void> {
		try {
			if (!this.userAccessService.isAllowed(ctx.from?.id ?? 0)) {
				await ctx.reply('Извините, у вас нет доступа к боту.')
				return
			}

			const photo = ctx.message.photo
			if (!photo) {
				return
			}
			this.logger.log(`Получено фото от пользователя ${ctx.from?.id}`)
			const largestPhoto = ctx.message.photo.pop()

			await ctx.reply('Подождите, я анализирую фото...🤔')

			if (largestPhoto) {
				const fileId = largestPhoto.file_id
				this.logger.log(`File ID полученного фото: ${fileId}`)

				const file = await ctx.api.getFile(fileId)
				this.logger.log(`Информация о файле: ${JSON.stringify(file)}`)
				const downloadPath =
					await this.fileSystemService.processPhoto(file)

				const response = await this.telegramService.processPhotoMessage(
					downloadPath,
					ctx.message.caption ?? undefined,
					ctx.from?.id ?? undefined,
				)

				this.telegramService.sendMessage(ctx, response)
			} else {
				await ctx.reply('Не удалось получить информацию о фото.')
			}
		} catch (error) {
			this.logger.error(error)
			await ctx.reply('Произошла ошибка при обработке фото.')
		}
	}

	@On('message:voice')
	async onVoice(ctx: Context): Promise<void> {
		try {
			if (!this.userAccessService.isAllowed(ctx.from?.id ?? 0)) {
				await ctx.reply('Извините, у вас нет доступа к боту.')
				return
			}

			const voice = ctx.message.voice
			if (!voice) {
				return
			}

			const fileId = voice.file_id
			this.logger.log(
				`File ID полученного голосового сообщения: ${fileId}`,
			)

			const file = await ctx.api.getFile(fileId)
			this.logger.log(`Информация о файле: ${JSON.stringify(file)}`)

			const downloadPath = await this.fileSystemService.processVoice(file)

			const response = await this.telegramService.processVoiceMessage(
				downloadPath,
				ctx.from?.id ?? undefined,
			)

			this.telegramService.sendMessage(ctx, response)
		} catch (error) {
			this.logger.error(error)
			await ctx.reply(
				'Произошла ошибка при обработке голосового сообщения.',
			)
		}
	}
}
