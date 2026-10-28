import {
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../logger/logger.service';
import { AuthService } from '../auth/auth.service';
import { JwtPayload } from '../auth/auth.types';

// setTimeout cannot schedule further out than ~24.8 days.
const MAX_TIMER_MS = 2 ** 31 - 1;

// CORS is applied by ConfiguredIoAdapter, which can read the configured origin.
@WebSocketGateway({
  namespace: '/',
})
export class SystemGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private connectedClients = 0;
  /** Disconnects each socket when its token expires; tokens are only checked at handshake. */
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private readonly logger: any;

  constructor(
    private readonly loggerService: LoggerService,
    private readonly authService: AuthService,
  ) {
    this.logger = loggerService.child('SystemGateway');
  }

  afterInit(): void {
    // Add auth middleware
    this.server.use((socket: Socket, next) => {
      // Only the auth payload is accepted: query-string tokens end up in proxy and access logs.
      const token = socket.handshake.auth?.token;

      if (!token || typeof token !== 'string') {
        this.logger.warn({ clientId: socket.id }, 'Socket connection rejected: no token');
        return next(new Error('Authentication required'));
      }

      const result = this.authService.verifyToken(token);
      if (!result) {
        this.logger.warn({ clientId: socket.id }, 'Socket connection rejected: invalid token');
        return next(new Error('Invalid or expired token'));
      }

      (socket as any).user = result;
      next();
    });

    this.logger.info('Socket.IO gateway initialized with auth middleware');
  }

  handleConnection(client: Socket): void {
    this.connectedClients++;
    const user = (client as any).user as JwtPayload | undefined;
    this.logger.info({ clientId: client.id, user: user?.username }, `Client connected (${this.connectedClients} total)`);

    if (user?.exp) {
      const msUntilExpiry = user.exp * 1000 - Date.now();
      const timer = setTimeout(() => {
        this.logger.info({ clientId: client.id }, 'Disconnecting client: token expired');
        client.disconnect(true);
      }, Math.max(0, Math.min(msUntilExpiry, MAX_TIMER_MS)));
      timer.unref();
      this.expiryTimers.set(client.id, timer);
    }
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients = Math.max(0, this.connectedClients - 1);
    const timer = this.expiryTimers.get(client.id);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(client.id);
    }
    this.logger.info({ clientId: client.id }, `Client disconnected (${this.connectedClients} total)`);
  }

  broadcastMetrics(event: string, data: any): void {
    if (this.server) {
      this.server.emit(event, data);
    }
  }

  broadcastSnapshot(data: any): void {
    if (this.server) {
      this.server.emit('system:metrics', data);
    }
  }

  hasClients(): boolean {
    return this.connectedClients > 0;
  }

  getConnectedClients(): number {
    return this.connectedClients;
  }

  getStatus(): string {
    return this.server ? 'healthy' : 'unhealthy';
  }
}
