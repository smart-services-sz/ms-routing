import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RoutingService } from './routing.service';
import { SimulateRoutingDto } from './dto/simulate-routing.dto';
import { UpsertRoutingRulesDto } from './dto/upsert-routing-rules.dto';
import { RoutingPlanIdDto } from './dto/routing-plan-id.dto';
import { SaveRoutingAreaPlanDto } from './dto/save-routing-area-plan.dto';
import { RoutingAreaPlanIdDto } from './dto/routing-area-plan-id.dto';
import { GetAssignedRouteDto } from './dto/get-assigned-route.dto';
import { UpdateRouteStatusDto } from './dto/update-route-status.dto';
import { RegisterInterventionDto } from './dto/register-intervention.dto';
import { AttachInterventionEvidenceDto } from './dto/attach-intervention-evidence.dto';

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

  @MessagePattern('routing.plans.list')
  listPlans() {
    return this.routingService.listPlans();
  }

  @MessagePattern('routing.plan.confirm')
  confirmPlan(@Payload() payload: RoutingPlanIdDto) {
    return this.routingService.confirmPlan(payload.id);
  }

  @MessagePattern('routing.plan.delete')
  deletePlan(@Payload() payload: RoutingPlanIdDto) {
    return this.routingService.deletePlan(payload.id);
  }

  @MessagePattern('routing.area-plans.list')
  listAreaPlans() {
    return this.routingService.listAreaPlans();
  }

  @MessagePattern('routing.area-plans.get')
  getAreaPlan(@Payload() payload: RoutingAreaPlanIdDto) {
    return this.routingService.getAreaPlan(payload.id);
  }

  @MessagePattern('routing.area-plans.save')
  saveAreaPlan(@Payload() payload: SaveRoutingAreaPlanDto) {
    return this.routingService.saveAreaPlan(payload);
  }

  @MessagePattern('routing.area-plans.delete')
  deleteAreaPlan(@Payload() payload: RoutingAreaPlanIdDto) {
    return this.routingService.deleteAreaPlan(payload.id);
  }

  @MessagePattern('routing.assigned-route.get')
  getAssignedRoute(@Payload() payload: GetAssignedRouteDto) {
    return this.routingService.getAssignedRoute(payload);
  }

  @MessagePattern('routing.route.status.update')
  updateRouteStatus(@Payload() payload: UpdateRouteStatusDto) {
    return this.routingService.updateRouteStatus(payload);
  }

  @MessagePattern('routing.intervention.register')
  registerIntervention(@Payload() payload: RegisterInterventionDto) {
    return this.routingService.registerIntervention(payload);
  }

  @MessagePattern('routing.intervention.evidence.attach')
  attachInterventionEvidence(@Payload() payload: AttachInterventionEvidenceDto) {
    return this.routingService.attachInterventionEvidence(payload);
  }
}
