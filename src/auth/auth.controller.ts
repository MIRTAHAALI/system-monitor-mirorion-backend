import { Controller, Post, Body, Ip, UnauthorizedException, HttpException, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginRequest, VerifyTokenRequest } from './auth.types';
import { LoginRateLimiter } from './login-rate-limiter';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  private readonly rateLimiter = new LoginRateLimiter();

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Login and receive a JWT token' })
  async login(@Body() body: LoginRequest, @Ip() ip: string) {
    const clientKey = ip || 'unknown';
    const retryAfter = this.rateLimiter.retryAfterSeconds(clientKey);
    if (retryAfter > 0) {
      throw new HttpException(
        `Too many failed login attempts. Try again in ${retryAfter}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const result = await this.authService.login(body.username, body.password);
    if (!result) {
      this.rateLimiter.recordFailure(clientKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.rateLimiter.reset(clientKey);
    return {
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Post('verify')
  @ApiOperation({ summary: 'Verify if a token is valid' })
  verify(@Body() body: VerifyTokenRequest) {
    const result = this.authService.verifyToken(body.token);
    if (!result) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return {
      success: true,
      data: { valid: true, username: result.username },
      timestamp: new Date().toISOString(),
    };
  }
}
