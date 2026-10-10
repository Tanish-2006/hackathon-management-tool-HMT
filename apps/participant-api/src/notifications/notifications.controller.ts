import {
  Controller,
  Get,
  Post,
  Param,
  Req,
  NotFoundException,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../database/prisma.service';

function toPublic(n: any) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    teamId: n.teamId ?? null,
    hackathonId: n.hackathonId ?? null,
    requestId: n.requestId ?? null,
    requestKind: n.requestKind ?? null,
    link: n.link ?? null,
    read: !!n.read,
    createdAt: n.createdAt,
    readAt: n.readAt ?? null,
  };
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Own inbox, newest first (bounded so the bell stays fast). */
  @Get()
  async list(@Req() req: any) {
    const rows = await (this.prisma as any).notification.findMany({
      where: { userId: req.user.id },
    });
    return { data: rows.slice(0, 50).map(toPublic) };
  }

  /** Unread count — drives the bell badge. */
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    const rows = await (this.prisma as any).notification.findMany({
      where: { userId: req.user.id, read: false },
    });
    return { count: rows.length };
  }

  /** Mark one notification read — own rows only. */
  @Post(':id/read')
  async markRead(@Req() req: any, @Param('id') id: string) {
    const n: any = await (this.prisma as any).notification.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.userId !== req.user.id) throw new ForbiddenException('Not your notification');
    if (!n.read) {
      await (this.prisma as any).notification.update({
        where: { id },
        data: { read: true, readAt: new Date() },
      });
    }
    return { id, read: true };
  }

  /** Mark the whole inbox read. */
  @Post('read-all')
  async markAllRead(@Req() req: any) {
    const rows = await (this.prisma as any).notification.findMany({
      where: { userId: req.user.id, read: false },
    });
    for (const n of rows) {
      await (this.prisma as any).notification.update({
        where: { id: n.id },
        data: { read: true, readAt: new Date() },
      });
    }
    return { read: rows.length };
  }
}
