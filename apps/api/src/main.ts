import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { SCENE_IMAGES_DIR } from "./scene-images";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors();
  // imagens reais das cenas: o front lê os pixels para o mapa de mudança, então precisam de CORS liberado
  app.useStaticAssets(SCENE_IMAGES_DIR, {
    prefix: "/api/scene-images/",
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
    },
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.log(`API de exemplo do Nexxus em http://localhost:${port}/api`);
}
void bootstrap();
