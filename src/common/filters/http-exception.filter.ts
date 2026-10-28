import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { getTimestamp } from '../utils/metrics.util';
import { LoggerService } from '../../logger/logger.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger?: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    // Unexpected errors can carry file paths or system details, so clients only get a
    // generic message; the real one goes to the server log.
    let message: string | string[] = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message = typeof exceptionResponse === 'string' ? exceptionResponse : (exceptionResponse as any).message || message;
      code = `HTTP_${status}`;
    } else {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger?.error(err.message, err.stack, 'AllExceptionsFilter');
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
      },
      timestamp: getTimestamp(),
    });
  }
}
