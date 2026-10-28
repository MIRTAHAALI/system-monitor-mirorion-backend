import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { verifyPassword } from './auth-credentials.service';
import { AuthConfig, LoginResponse, JwtPayload } from './auth.types';

const JWT_ALGORITHM: jwt.Algorithm = 'HS256';
const DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Same cost as stored credentials, so a dummy comparison takes as long as a real one.
const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private config: AuthConfig | null = null;
  private readonly tokenTtlSeconds: number;
  /**
   * Hash of a random secret, compared against when the username is wrong so a failed login
   * takes the same time whether or not the user exists.
   */
  private readonly dummyPasswordHash = bcrypt.hashSync(
    crypto.randomBytes(32).toString('hex'),
    BCRYPT_ROUNDS,
  );

  constructor(private readonly configService: ConfigService) {
    const configured = this.configService.get<number>('jwtExpiresInSeconds', DEFAULT_TOKEN_TTL_SECONDS);
    this.tokenTtlSeconds =
      Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TOKEN_TTL_SECONDS;
  }

  setConfig(config: AuthConfig): void {
    this.config = config;
  }

  getConfig(): AuthConfig | null {
    return this.config;
  }

  async login(username: string, password: string): Promise<LoginResponse | null> {
    if (!this.config) return null;

    const userMatches = username === this.config.username;
    // Always run bcrypt so response time does not reveal whether the username exists.
    const valid = await verifyPassword(
      password,
      userMatches ? this.config.passwordHash : this.dummyPasswordHash,
    );
    if (!userMatches || !valid) return null;

    const expiresIn = this.tokenTtlSeconds;
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: username,
      username,
    };

    const token = jwt.sign(payload, this.config.jwtSecret, { expiresIn, algorithm: JWT_ALGORITHM });

    return { token, username, expiresIn };
  }

  verifyToken(token: string): JwtPayload | null {
    if (!this.config || typeof token !== 'string' || !token) return null;
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        algorithms: [JWT_ALGORITHM],
      }) as JwtPayload;
      // Tokens are only ever issued for the configured user.
      if (decoded.sub !== this.config.username) return null;
      return decoded;
    } catch {
      return null;
    }
  }
}
