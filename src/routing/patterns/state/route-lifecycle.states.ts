import { RoutingRouteStatus } from '../../routing.types';
import {
  RouteLifecycleState,
  RouteStatusTransitionContext,
  RouteStatusUpdate,
} from './route-lifecycle-state.interface';

abstract class BaseRouteState implements RouteLifecycleState {
  abstract code: RoutingRouteStatus;

  transitionTo(
    target: RoutingRouteStatus,
    context: RouteStatusTransitionContext,
  ): RouteStatusUpdate {
    if (target === 'in_progress') {
      return this.toInProgress(context);
    }

    if (target === 'completed') {
      return {
        status: 'completed',
        startedAt: this.startedAtOnComplete(context),
        completedAt: context.now,
      };
    }

    if (target === 'assigned') {
      return {
        status: 'assigned',
        startedAt: null,
        completedAt: null,
      };
    }

    return {
      status: 'cancelled',
      completedAt: context.now,
    };
  }

  protected abstract toInProgress(context: RouteStatusTransitionContext): RouteStatusUpdate;

  protected startedAtOnComplete(context: RouteStatusTransitionContext): Date | undefined {
    return context.startedAt ?? undefined;
  }
}

export class AssignedState extends BaseRouteState {
  code: RoutingRouteStatus = 'assigned';

  protected toInProgress(context: RouteStatusTransitionContext): RouteStatusUpdate {
    return {
      status: 'in_progress',
      startedAt: context.now,
      completedAt: null,
    };
  }

  protected startedAtOnComplete(context: RouteStatusTransitionContext): Date {
    return context.startedAt ?? context.now;
  }
}

export class InProgressState extends BaseRouteState {
  code: RoutingRouteStatus = 'in_progress';

  protected toInProgress(_context: RouteStatusTransitionContext): RouteStatusUpdate {
    return {
      status: 'in_progress',
      completedAt: null,
    };
  }
}

export class CompletedState extends BaseRouteState {
  code: RoutingRouteStatus = 'completed';

  protected toInProgress(context: RouteStatusTransitionContext): RouteStatusUpdate {
    return {
      status: 'in_progress',
      startedAt: context.now,
      completedAt: null,
    };
  }
}

export class CancelledState extends BaseRouteState {
  code: RoutingRouteStatus = 'cancelled';

  protected toInProgress(context: RouteStatusTransitionContext): RouteStatusUpdate {
    return {
      status: 'in_progress',
      startedAt: context.now,
      completedAt: null,
    };
  }
}
