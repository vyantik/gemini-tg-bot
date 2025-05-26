import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { PrismaModule } from './prisma/prisma.module.js'
import { TelegramModule } from './telegram/telegram.module.js'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			envFilePath: ['.env'],
		}),
		TelegramModule,
		PrismaModule,
	],
})
export class AppModule {}
