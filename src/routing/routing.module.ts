import { Module } from '@nestjs/common';
import { RoutingService } from './routing.service';
import { RoutingController } from './routing.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NatsModule } from '../nats/nats.module';
import { LocalOptimizationStrategy } from './patterns/strategy/local-optimization.strategy';
import { GoogleMapsOptimizationStrategy } from './patterns/strategy/google-maps-optimization.strategy';
import { RoutingPlannerContext } from './patterns/strategy/routing-planner.context';
import { RouteStateFactory } from './patterns/state/route-state.factory';
import { RouteLifecycleContext } from './patterns/state/route-lifecycle.context';

@Module({
  imports: [NatsModule, PrismaModule],
  controllers: [RoutingController],
  providers: [
    RoutingService,
    LocalOptimizationStrategy,
    GoogleMapsOptimizationStrategy,
    RoutingPlannerContext,
    RouteStateFactory,
    RouteLifecycleContext,
  ],
})
export class RoutingModule {}
