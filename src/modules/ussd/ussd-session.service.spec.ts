import { UssdSessionService } from './ussd-session.service';

describe('UssdSessionService helpers', () => {
  const service = new UssdSessionService({} as never, {} as never);

  it('detects duplicate callbacks via input hash', () => {
    const session = {
      lastInputHash: 'abc',
    } as never;
    expect(service.isDuplicate(session, 'abc')).toBe(true);
    expect(service.isDuplicate(session, 'def')).toBe(false);
  });

  it('expires sessions after the configured TTL', () => {
    const session = {
      lastActivityAt: new Date(Date.now() - 200_000),
    } as never;
    expect(service.isExpired(session, 180)).toBe(true);
  });

  it('hashes provider input deterministically', () => {
    const first = service.hashInput('test-ussd', 's1', 'callback-1');
    const second = service.hashInput('test-ussd', 's1', 'callback-1');
    const different = service.hashInput('test-ussd', 's1', 'callback-2');
    expect(first).toBe(second);
    expect(different).not.toBe(first);
  });

  it('only treats a callback as duplicate when a stable provider request id is available', () => {
    const session = { lastInputHash: service.hashInput('test-ussd', 's1', 'callback-1') } as never;
    expect(service.isDuplicate(session, undefined)).toBe(false);
    expect(service.isDuplicate(session, service.hashInput('test-ussd', 's1', 'callback-1'))).toBe(true);
  });
});