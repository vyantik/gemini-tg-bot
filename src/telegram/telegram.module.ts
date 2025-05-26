import { NestjsGrammyModule } from '@grammyjs/nestjs'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { PrismaModule } from '../prisma/prisma.module.js'

import { FileSystemService } from './file-system.service.js'
import { TelegramService } from './telegram.service.js'
import { TelegramUpdate } from './telegram.update.js'
import { UserAccessService } from './user-access.service.js'

@Module({
	imports: [
		ConfigModule,
		PrismaModule,
		NestjsGrammyModule.forRoot({
			token: process.env.TELEGRAM_BOT_TOKEN,
		}),
	],
	providers: [
		TelegramUpdate,
		TelegramService,
		FileSystemService,
		UserAccessService,
	],
})
export class TelegramModule {}
