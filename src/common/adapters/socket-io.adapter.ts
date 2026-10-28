import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

// Clients only receive data; nothing they send should come close to this.
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;

/**
 * Applies the configured CORS origin to Socket.IO. Gateway decorator options are evaluated
 * at import time, before `.env` is loaded, so they cannot read the configured origin.
 */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOrigin: string,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      maxHttpBufferSize: MAX_CLIENT_MESSAGE_BYTES,
    });
  }
}
