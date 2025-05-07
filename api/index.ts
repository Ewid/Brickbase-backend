import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from 'http';

// Add crypto polyfill for Node.js on Vercel
import crypto from 'crypto';
if (!crypto.randomUUID) {
  crypto.randomUUID = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };
}

let cachedServer: Server;

async function bootstrap() {
  if (!cachedServer) {
    const app = await NestFactory.create(AppModule);
    
    app.enableCors({
      origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    });

    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));

    await app.init();
    cachedServer = app.getHttpServer();
  }
  return cachedServer;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  // Handle the request through NestJS
  const server = await bootstrap();
  
  // Process the request through the NestJS HTTP server
  server.emit('request', req, res);
};