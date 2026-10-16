import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('MS-ROUTING');
  const natsConfigured = Boolean(process.env.NATS_SERVERS);
  const natsServer = process.env.NATS_SERVERS || 'nats://localhost:4222';

  const app = await NestFactory.createMicroservice(AppModule, {
    transport: Transport.NATS,
    options: {
      servers: [natsServer],
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen();

  logger.log(`
  ----------------------------------------
    MS-ROUTING STARTED
    NATS: ${natsConfigured ? 'configured' : 'default'}
    ENV : ${process.env.NODE_ENV}
  ----------------------------------------
  `);
}

void bootstrap();
