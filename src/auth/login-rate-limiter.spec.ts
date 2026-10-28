import { LoginRateLimiter } from './login-rate-limiter';

describe('LoginRateLimiter', () => {
  it('blocks a client after too many failures within the window', () => {
    const limiter = new LoginRateLimiter(3, 60_000);
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfterSeconds('1.2.3.4', now)).toBe(0);
      limiter.recordFailure('1.2.3.4', now);
    }
    expect(limiter.retryAfterSeconds('1.2.3.4', now)).toBe(60);
    // Other clients are unaffected.
    expect(limiter.retryAfterSeconds('5.6.7.8', now)).toBe(0);
  });

  it('lets the client try again once the window has passed', () => {
    const limiter = new LoginRateLimiter(1, 60_000);
    limiter.recordFailure('ip', 0);
    expect(limiter.retryAfterSeconds('ip', 30_000)).toBe(30);
    expect(limiter.retryAfterSeconds('ip', 60_000)).toBe(0);
  });

  it('clears the counter after a successful login', () => {
    const limiter = new LoginRateLimiter(1, 60_000);
    limiter.recordFailure('ip', 0);
    limiter.reset('ip');
    expect(limiter.retryAfterSeconds('ip', 0)).toBe(0);
  });
});
