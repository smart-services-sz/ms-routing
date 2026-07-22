import { Logger } from '@nestjs/common';
import { RouteOptimizationStrategy } from './route-optimization-strategy.interface';
import { RouteOptimizationOptions, RouteOptimizationResult, RouteDraft } from './route-optimization.types';

export class FallbackOptimizationStrategy implements RouteOptimizationStrategy {
  private readonly logger = new Logger(FallbackOptimizationStrategy.name);

  constructor(
    private readonly primary: RouteOptimizationStrategy,
    private readonly fallback: RouteOptimizationStrategy,
  ) {}

  async optimize(
    routes: RouteDraft[],
    options?: RouteOptimizationOptions,
  ): Promise<RouteOptimizationResult> {
    try {
      const primaryResult = await this.primary.optimize(routes, options);
      return {
        routes: primaryResult.routes,
        optimizedRoutes: primaryResult.optimizedRoutes,
        failedRoutes: primaryResult.failedRoutes,
      };
    } catch (error) {
      this.logger.warn(
        `Fallo estrategia primaria, aplicando fallback local: ${error instanceof Error ? error.message : String(error)}`,
      );

      const fallbackResult = await this.fallback.optimize(routes, options);
      return {
        routes: fallbackResult.routes,
        optimizedRoutes: 0,
        failedRoutes: routes.length,
      };
    }
  }
}
