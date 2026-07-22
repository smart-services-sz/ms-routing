import { Injectable } from '@nestjs/common';
import { RoutingRouteStatus } from '../../routing.types';
import { RouteLifecycleState, RouteStatusUpdate } from './route-lifecycle-state.interface';
import { RouteStateFactory } from './route-state.factory';

@Injectable()
export class RouteLifecycleContext {
  constructor(private readonly stateFactory: RouteStateFactory) {}

  transition(params: {
    currentStatus: RoutingRouteStatus;
    targetStatus: RoutingRouteStatus;
    startedAt: Date | null;
    now: Date;
  }): RouteStatusUpdate {
    const state: RouteLifecycleState = this.stateFactory.fromStatus(params.currentStatus);
    return state.transitionTo(params.targetStatus, {
      now: params.now,
      startedAt: params.startedAt,
    });
  }
}
