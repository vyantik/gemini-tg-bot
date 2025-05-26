import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from 'src/prisma/prisma.service.js'

@Injectable()
export class UserAccessService {
	private adminUsers: Set<number> = new Set()

	constructor(
		private readonly configService: ConfigService,
		private readonly prisma: PrismaService
	) {
		const adminIds =
			this.configService.get<string>('ADMIN_IDS')?.split(',') || []
		adminIds.forEach(id => this.adminUsers.add(Number(id)))
	}

	isAdmin(userId: number): boolean {
		return this.adminUsers.has(userId)
	}

	async isAllowed(userId: number): Promise<boolean> {
		if (this.isAdmin(userId)) return true

		const user = await this.prisma.allowedUser.findUnique({
			where: { userId }
		})
		return !!user
	}

	async addAllowedUser(userId: number): Promise<void> {
		await this.prisma.allowedUser.upsert({
			where: { userId },
			update: {},
			create: { userId }
		})
	}

	async removeAllowedUser(userId: number): Promise<void> {
		await this.prisma.allowedUser.delete({
			where: { userId }
		})
	}

	async getAllowedUsers(): Promise<number[]> {
		const users = await this.prisma.allowedUser.findMany({
			select: { userId: true }
		})
		return users.map(user => user.userId)
	}
}
