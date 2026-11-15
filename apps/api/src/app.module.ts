import { Module } from "@nestjs/common";
import { AskController, HealthController, PassesController, PlacesController, ScenesController } from "./controllers";
import { AgentService } from "./agent.service";
import { PassesService } from "./passes.service";
import { PlacesService } from "./places.service";

@Module({
  controllers: [HealthController, ScenesController, PassesController, PlacesController, AskController],
  providers: [PlacesService, PassesService, AgentService],
})
export class AppModule {}
