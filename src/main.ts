import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ConfiguredIoAdapter } from './common/adapters/socket-io.adapter';
import { LoggerService } from './logger/logger.service';
import { promptForCredentials } from './auth/auth-credentials.service';
import { AuthService } from './auth/auth.service';

async function bootstrap() {
  // Prompt for credentials before starting the server
  const authConfig = await promptForCredentials();

  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const logger = app.get(LoggerService);
  const authService = app.get(AuthService);

  // Set auth config on the service
  authService.setConfig(authConfig);

  const port = configService.get<number>('port', 4000);
  const corsOrigin = configService.get<string>('corsOrigin', 'http://localhost:5173');

  app.use(helmet());
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, corsOrigin));
  app.enableCors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(logger));

  // API docs map the whole attack surface, so they are off in production unless asked for.
  const enableSwagger = configService.get<boolean>('enableSwagger', false);
  if (enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('System Monitor API')
      .setDescription('System Monitoring Platform REST API')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
  logger.log(`Server running on http://localhost:${port}`, 'Bootstrap');
  if (enableSwagger) {
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`, 'Bootstrap');
  }
  logger.log(`Authenticated user: ${authConfig.username}`, 'Bootstrap');

  const gracefulShutdown = async (signal: string) => {
    logger.log(`Received ${signal}. Starting graceful shutdown...`, 'Bootstrap');
    await app.close();
    logger.log('Server shut down gracefully', 'Bootstrap');
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap();
