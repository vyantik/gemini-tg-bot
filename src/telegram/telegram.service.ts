import {
	Content,
	createPartFromUri,
	createUserContent,
	GoogleGenAI
} from '@google/genai'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { createWriteStream } from 'fs'
import { Context } from 'grammy'
import { File } from 'grammy/types'
import { MessageRole } from 'prisma/__generated__/index.js'

import { PrismaService } from '../prisma/prisma.service.js'
import { mkdir, unlink } from 'fs/promises'

import { FileSystemService } from './file-system.service.js'

@Injectable()
export class TelegramService {
	private readonly ai: GoogleGenAI
	private readonly logger = new Logger(TelegramService.name)
	private readonly MAX_MESSAGES = 100
	private readonly botToken: string

	constructor(
		private readonly configService: ConfigService,
		private readonly prisma: PrismaService,
		private readonly fileSystemService: FileSystemService
	) {
		this.ai = new GoogleGenAI({
			apiKey: this.configService.get<string>('GEMINI_TOKEN')
		})
		this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN')
	}

	private async ctxSendMessage(ctx: Context, message: string) {
		try {
			await ctx.reply(message, {
				parse_mode: 'MarkdownV2'
			})
		} catch {
			await ctx.reply(message)
		}
	}

	public async sendMessage(ctx: Context, message: string) {
		while (message.length > 4096) {
			const messageSliced = message.slice(0, 4096)
			await this.ctxSendMessage(ctx, messageSliced)
			message = message.slice(4096)
		}
		await this.ctxSendMessage(ctx, message)
	}

	private async sendTypingAction(chatId: number): Promise<void> {
		try {
			await axios.post(
				`https://api.telegram.org/bot${this.botToken}/sendChatAction`,
				{
					chat_id: chatId,
					action: 'typing'
				}
			)
		} catch (error) {
			this.logger.error('Ошибка при отправке typing action:', error)
		}
	}

	public async processTextMessage(
		message: string,
		userId: number
	): Promise<string> {
		try {
			await this.sendTypingAction(userId)

			let user = await this.prisma.user.findUnique({
				where: { id: userId }
			})

			if (!user) {
				this.logger.log(
					`Пользователь не найден, создаем нового пользователя с id ${userId}`
				)
				user = await this.prisma.user.create({
					data: {
						id: userId
					}
				})
			}
			const messages = await this.prisma.message.findMany({
				where: { userId: userId },
				orderBy: { createdAt: 'asc' },
				select: { id: true }
			})

			const storedMessages = await this.prisma.message.findMany({
				where: { userId: userId },
				orderBy: { createdAt: 'asc' },
				take: this.MAX_MESSAGES * 2
			})

			let historyForGemini: Content[] = []

			if (messages.length > this.MAX_MESSAGES * 2) {
				const messagesToDelete = messages.slice(
					0,
					messages.length - this.MAX_MESSAGES * 2
				)
				await this.prisma.message.deleteMany({
					where: {
						id: {
							in: messagesToDelete.map(msg => msg.id)
						}
					}
				})
			}

			historyForGemini = storedMessages.map(msg => ({
				role: msg.role === MessageRole.USER ? 'user' : 'model',
				parts: [{ text: msg.content }]
			}))

			const chat = this.ai.chats.create({
				model: 'gemini-2.0-flash-lite',
				history: historyForGemini
			})

			const result = await chat.sendMessage({
				message: message
			})

			const modelResponse = result.text

			await this.prisma.$transaction(async prisma => {
				await prisma.message.create({
					data: {
						userId: user.id,
						content: message,
						role: MessageRole.USER
					}
				})

				await prisma.message.create({
					data: {
						userId: user.id,
						content: modelResponse,
						role: MessageRole.MODEL
					}
				})
			})

			return modelResponse
		} catch (error) {
			this.logger.error(error)
			return 'Произошла ошибка при обработке сообщения.'
		}
	}

	public async processPhotoMessage(
		file_path: string,
		message?: string,
		userId?: number
	): Promise<string> {
		try {
			if (userId) {
				await this.sendTypingAction(userId)
			}

			const image = await this.ai.files.upload({
				file: file_path
			})

			const response = await this.ai.models.generateContent({
				model: 'gemini-2.0-flash',
				contents: [
					createUserContent([
						message ?? 'Опиши, что ты видишь на картинке',
						createPartFromUri(image.uri, image.mimeType)
					])
				]
			})

			await this.fileSystemService.deleteFile(file_path)

			return response.text
		} catch (error) {
			this.logger.error(error)
			return 'Произошла ошибка при обработке фото.'
		}
	}

	public async processVoiceMessage(
		file_path: string,
		userId?: number
	): Promise<string> {
		try {
			if (userId) {
				await this.sendTypingAction(userId)
			}

			const audio = await this.ai.files.upload({
				file: file_path,
				config: {
					mimeType: 'audio/ogg'
				}
			})

			const response = await this.ai.models.generateContent({
				model: 'gemini-2.0-flash',
				contents: [
					createUserContent([
						'Ответь на голосовое сообщение',
						createPartFromUri(audio.uri, audio.mimeType)
					])
				]
			})

			await this.fileSystemService.deleteFile(file_path)

			return response.text
		} catch (error) {
			this.logger.error(error)
			return 'Произошла ошибка при обработке голосового сообщения.'
		}
	}
}
