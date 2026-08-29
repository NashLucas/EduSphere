import { describe, expect, it } from 'vitest';
import spec from '../../src/config/swagger.js';

const HEALTH_KEYS = ['status', 'database', 'redis', 'uptime'];

describe('swaggerSpec — GET /health (apidoc §8.1, AC-10)', () => {
  const pathItem = spec.paths?.['/health'];
  const op = pathItem?.get;

  it('documents the endpoint', () => {
    expect(op).toBeDefined();
  });

  it('is public — the root bearerAuth requirement is cleared', () => {
    // Rate limiting is bypassed for /health (apidoc §4). Inheriting the root
    // security block would publish a public probe as an authenticated one.
    expect(op.security).toEqual([]);
  });

  it('resolves outside the /api/v1 prefix', () => {
    // The root server URL carries the prefix; /health deliberately sits outside
    // it, so the path item must override the server. Without the override the
    // documented URL is /api/v1/health, which no probe hits.
    expect(pathItem.servers?.[0]?.url).toBe('http://localhost:3000');
  });

  it.each(['200', '503'])('documents the flat four-key body on %s', (status) => {
    const schema = op.responses?.[status]?.content?.['application/json']?.schema;
    expect(schema, `response ${status} declares no JSON schema`).toBeDefined();

    const ref = schema.$ref?.replace('#/components/schemas/', '');
    const resolved = ref ? spec.components.schemas[ref] : schema;

    // Set equality, not containment — an extra key is a contract change too,
    // and 503 must carry the same shape so a probe can read which dependency
    // failed without parsing a message string.
    expect(new Set(Object.keys(resolved.properties))).toEqual(new Set(HEALTH_KEYS));
    expect(resolved.required).toEqual(expect.arrayContaining(HEALTH_KEYS));
  });

  it('types the dependency keys as strings, not booleans', () => {
    // AC-10 asserts the literal string "ok". A boolean here validates as JSON
    // and fails the probe that greps for it.
    const props = spec.components.schemas.HealthStatus.properties;
    expect(props.status.type).toBe('string');
    expect(props.database.type).toBe('string');
    expect(props.redis.type).toBe('string');
    expect(props.uptime.type).toBe('number');
  });

  it('is not wrapped in the §1 response envelope', () => {
    const props = spec.components.schemas.HealthStatus.properties;
    expect(props.data).toBeUndefined();
    expect(props.message).toBeUndefined();
  });
});
