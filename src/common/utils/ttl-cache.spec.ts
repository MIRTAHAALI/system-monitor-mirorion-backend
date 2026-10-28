import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('shares one in-flight load between concurrent callers', async () => {
    const cache = new TtlCache();
    const loader = jest.fn().mockResolvedValue('value');

    const [a, b] = await Promise.all([cache.get('k', 1000, loader), cache.get('k', 1000, loader)]);

    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads once the entry has expired', async () => {
    const cache = new TtlCache();
    const loader = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.get('k', 1000, loader)).toBe(1);
    expect(await cache.get('k', 1000, loader, Date.now() + 500)).toBe(1);
    expect(await cache.get('k', 1000, loader, Date.now() + 5000)).toBe(2);
  });

  it('does not cache failures', async () => {
    const cache = new TtlCache();
    const loader = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');

    await expect(cache.get('k', 1000, loader)).rejects.toThrow('boom');
    expect(await cache.get('k', 1000, loader)).toBe('ok');
  });
});
