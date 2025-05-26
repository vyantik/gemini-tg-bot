import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { createWriteStream } from 'fs'
import { File } from 'grammy/types'

import { mkdir, unlink } from 'fs/promises'

@Injectable()
export class FileSystemService {
	private readonly logger = new Logger(FileSystemService.name)
	private readonly botToken: string

	constructor(private readonly configService: ConfigService) {
		this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN')
	}

	private async downloadFile(
		fileUrl: string,
		outputPath: string
	): Promise<void> {
		try {
			const dir = outputPath.substring(0, outputPath.lastIndexOf('/'))
			await mkdir(dir, { recursive: true })

			const response = await axios({
				method: 'get',
				url: fileUrl,
				responseType: 'stream'
			})

			const writer = createWriteStream(outputPath)
			response.data.pipe(writer)

			return new Promise((resolve, reject) => {
				writer.on('finish', resolve)
				writer.on('error', reject)
			})
		} catch (error) {
			this.logger.error(
				`Ошибка при скачивании файла с ${fileUrl} в ${outputPath}`,
				error
			)
			throw error
		}
	}

	public async deleteFile(filePath: string): Promise<void> {
		try {
			await unlink(filePath)
			this.logger.log(`Файл успешно удален: ${filePath}`)
		} catch (error) {
			if (error.code === 'ENOENT') {
				this.logger.warn(
					`Попытка удалить несуществующий файл: ${filePath}`
				)
			} else {
				this.logger.error(
					`Ошибка при удалении файла ${filePath}:`,
					error
				)
				throw error
			}
		}
	}

	public async processPhoto(file: File) {
		try {
			if (file.file_path) {
				const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`
				this.logger.log(`URL фото для скачивания: ${fileUrl}`)

				const downloadPath = `./downloads/${file.file_id}.jpg`
				await this.downloadFile(fileUrl, downloadPath)
				this.logger.log(`Фото сохранено в ${downloadPath}`)

				return downloadPath
			} else {
				this.logger.error('Не удалось найти путь к фото.')
			}
		} catch (error) {
			this.logger.error('Ошибка при скачивании фото:', error)
		}
	}

	public async processVoice(file: File) {
		try {
			if (file.file_path) {
				const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`
				this.logger.log(
					`URL голосового сообщения для скачивания: ${fileUrl}`
				)

				const downloadPath = `./downloads/${file.file_id}.ogg`
				await this.downloadFile(fileUrl, downloadPath)
				this.logger.log(
					`Голосовое сообщение сохранено в ${downloadPath}`
				)

				return downloadPath
			} else {
				this.logger.error(
					'Не удалось найти путь к голосовому сообщению.'
				)
			}
		} catch (error) {
			this.logger.error(
				'Ошибка при скачивании голосового сообщения:',
				error
			)
		}
	}
}
