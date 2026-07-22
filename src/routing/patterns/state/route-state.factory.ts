import { Injectable } from '@nestjs/common';
import { RoutingRouteStatus } from '../../routing.types';
import { RouteLifecycleState } from './route-lifecycle-state.interface';
import {
  AssignedState,
  CancelledState,
  CompletedState,
  InProgressState,
} from './route-lifecycle.states';

@Injectable()
export class RouteStateFactory {
  private readonly assignedState = new AssignedState();
  private readonly inProgressState = new InProgressState();
  private readonly completedState = new CompletedState();
  private readonly cancelledState = new CancelledState();

  fromStatus(status: RoutingRouteStatus): RouteLifecycleState {
    if (status === 'assigned') return this.assignedState;
    if (status === 'in_progress') return this.inProgressState;
    if (status === 'completed') return this.completedState;
    return this.cancelledState;
  }
}
