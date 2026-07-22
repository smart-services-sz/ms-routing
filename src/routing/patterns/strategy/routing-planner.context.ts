import { Injectable } from '@nestjs/common';
import { RouteOptimizationResult, RouteDraft } from './route-optimization.types';
import { LocalOptimizationStrategy } from './local-optimization.strategy';
import { GoogleMapsOptimizationStrategy } from './google-maps-optimization.strategy';
import { FallbackOptimizationStrategy } from './fallback-optimization.strategy';

@Injectable()
export class RoutingPlannerContext {
  private readonly googleWithFallback: FallbackOptimizationStrategy;

  constructor(
    private readonly localStrategy: LocalOptimizationStrategy,
    private readonly googleStrategy: GoogleMapsOptimizationStrategy,
  ) {
    this.googleWithFallback = new FallbackOptimizationStrategy(
      this.googleStrategy,
      this.localStrategy,
    );
  }

  async optimize(
    routes: RouteDraft[],
    options: {
      useGoogleOptimization: boolean;
      originLat?: number;
      originLng?: number;
    },
  ): Promise<RouteOptimizationResult> {
    if (!options.useGoogleOptimization) {
      return this.localStrategy.optimize(routes, {
        originLat: options.originLat,
        originLng: options.originLng,
      });
    }

    return this.googleWithFallback.optimize(routes, {
      originLat: options.originLat,
      originLng: options.originLng,
    });
  }
}
