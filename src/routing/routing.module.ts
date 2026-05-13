import { Module } from '@nestjs/common';
import { RoutingService } from './routing.service';
import { RoutingController } from './routing.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NatsModule } from '../nats/nats.module';

@Module({
  imports: [NatsModule, PrismaModule],
  controllers: [RoutingController],
  providers: [RoutingService],
})
export class RoutingModule {}
