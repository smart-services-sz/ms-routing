import { Injectable } from '@nestjs/common';
import { RouteOptimizationStrategy } from './route-optimization-strategy.interface';
import {
  RouteOptimizationOptions,
  RouteOptimizationResult,
  RouteDraft,
} from './route-optimization.types';

@Injectable()
export class LocalOptimizationStrategy implements RouteOptimizationStrategy {
  optimize(
    routes: RouteDraft[],
    options?: RouteOptimizationOptions,
  ): Promise<RouteOptimizationResult> {
    void options;

    return Promise.resolve({
      routes,
      optimizedRoutes: 0,
      failedRoutes: 0,
    });
  }
}
