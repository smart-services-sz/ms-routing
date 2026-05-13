import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RoutingService } from './routing.service';
import { SimulateRoutingDto } from './dto/simulate-routing.dto';
import { UpsertRoutingRulesDto } from './dto/upsert-routing-rules.dto';
import { RoutingPlanIdDto } from './dto/routing-plan-id.dto';

@Controller()
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  @MessagePattern('routing.simulate')
  simulate(@Payload() payload: SimulateRoutingDto) {
    return this.routingService.simulate(payload);
  }

  @MessagePattern('routing.generate')
  generate(@Payload() payload: SimulateRoutingDto) {
    return this.routingService.generate(payload);
  }

  @MessagePattern('routing.rules.upsert')
  upsertRules(@Payload() payload: UpsertRoutingRulesDto) {
    return this.routingService.upsertRules(payload);
  }

  @MessagePattern('routing.rules.get')
  getRules() {
    return this.routingService.getRules();
  }

  @MessagePattern('routing.plan.get')
  getPlan(@Payload() payload: RoutingPlanIdDto) {
    return this.routingService.getPlan(payload.id);
  }

  @MessagePattern('routing.plan.confirm')
  confirmPlan(@Payload() payload: RoutingPlanIdDto) {
    return this.routingService.confirmPlan(payload.id);
  }
}
