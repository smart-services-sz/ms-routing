import { Injectable } from '@nestjs/common';
import { RouteOptimizationStrategy } from './route-optimization-strategy.interface';
import { RouteOptimizationOptions, RouteOptimizationResult, RouteDraft } from './route-optimization.types';

@Injectable()
export class LocalOptimizationStrategy implements RouteOptimizationStrategy {
  async optimize(
    routes: RouteDraft[],
    _options?: RouteOptimizationOptions,
  ): Promise<RouteOptimizationResult> {
    return {
      routes,
      optimizedRoutes: 0,
      failedRoutes: 0,
    };
  }
}
