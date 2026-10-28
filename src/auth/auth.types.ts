import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class LoginRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  username!: string;

  // bcrypt only looks at the first 72 bytes; the cap also stops oversized payloads.
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}

export class VerifyTokenRequest {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;
}

export interface LoginResponse {
  token: string;
  username: string;
  expiresIn: number;
}

export interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

export interface AuthConfig {
  username: string;
  passwordHash: string;
  jwtSecret: string;
}
