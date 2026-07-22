import { RoutingRouteStatus } from '../../routing.types';

export interface RouteStatusTransitionContext {
  now: Date;
  startedAt: Date | null;
}

export interface RouteStatusUpdate {
  status: RoutingRouteStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface RouteLifecycleState {
  code: RoutingRouteStatus;
  transitionTo(target: RoutingRouteStatus, context: RouteStatusTransitionContext): RouteStatusUpdate;
}
