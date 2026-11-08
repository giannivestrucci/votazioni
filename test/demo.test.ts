import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.ts';
import { popolaDemo, databaseVuoto, ACCOUNT_DEMO } from '../src/demo.ts';

describe('modalità dimostrativa', () => {
  it('espone il flag e carica i dati di esempio una sola volta', async () => {
    const a = await buildApp({ service: 'all', registryDb: ':memory:', urnaDb: ':memory:', urnaToken: 't', devOtp: true, demo: true, secureCookie: false });
    expect((await a.app.inject({ url: '/api/pubblico/ambiente' })).json()).toEqual({ demo: true });
    expect(databaseVuoto(a.registry!)).toBe(true);
    await popolaDemo(a.registry!, a.elezioni!);
    expect(databaseVuoto(a.registry!)).toBe(false);

    const { codiceSviluppo } = (await a.app.inject({ method: 'POST', url: '/api/auth/codice', payload: { email: ACCOUNT_DEMO.genitore } })).json();
    expect(codiceSviluppo).toMatch(/^\d{6}$/);
    const r = await a.app.inject({ method: 'POST', url: '/api/auth/accedi', payload: { email: ACCOUNT_DEMO.genitore, codice: codiceSviluppo } });
    const cookie = `sid=${r.cookies.find((c) => c.name === 'sid')!.value}`;
    const schede = (await a.app.inject({ url: '/api/mie-schede', headers: { cookie } })).json();
    expect(schede.length).toBe(2);
    await a.app.close();
  });

  it('di norma non è attiva', async () => {
    const a = await buildApp({ service: 'all', registryDb: ':memory:', urnaDb: ':memory:', urnaToken: 't', devOtp: false, secureCookie: false });
    expect((await a.app.inject({ url: '/api/pubblico/ambiente' })).json()).toEqual({ demo: false });
    await a.app.close();
  });
});
