import { RouteOptimizationOptions, RouteOptimizationResult, RouteDraft } from './route-optimization.types';

export interface RouteOptimizationStrategy {
  optimize(routes: RouteDraft[], options?: RouteOptimizationOptions): Promise<RouteOptimizationResult>;
}
