import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoutingModule } from './routing/routing.module';
import { PrismaModule } from './prisma/prisma.module';
import { NatsModule } from './nats/nats.module';
import { AuditLoggingModule } from './audit/audit-logging.module';

@Module({
  imports: [NatsModule, PrismaModule, RoutingModule, AuditLoggingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
