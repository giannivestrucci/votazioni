import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { createHash, generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey, randomBytes } from 'node:crypto';

/**
 * Firme cieche RSA (RFC 9474, RSABSSA-SHA384-PSS-Randomized).
 * Il Registro firma "alla cieca" un gettone per ogni avente diritto; l'Urna accetta
 * una scheda solo con un gettone firmato valido e mai usato. Il Registro non vede
 * mai il gettone in chiaro, l'Urna non vede mai l'identità: nessuno dei due, da solo,
 * può collegare votante e voto.
 */
export const blindSuite = () => RSABSSA.SHA384.PSS.Randomized();

export const b64u = {
  enc: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
  dec: (s: string) => new Uint8Array(Buffer.from(s, 'base64url')),
};

export const sha256hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export async function generateBlindKeyPair(bits = 2048) {
  const kp = await blindSuite().generateKey({ modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]) });
  const pub = await crypto.subtle.exportKey('spki', kp.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  return { publicKeySpki: b64u.enc(new Uint8Array(pub)), privateKeyPkcs8: b64u.enc(new Uint8Array(priv)) };
}

const ALG = { name: 'RSA-PSS', hash: 'SHA-384' } as const;

export const importBlindPublic = (spki: string) =>
  crypto.subtle.importKey('spki', b64u.dec(spki), ALG, true, ['verify']);
export const importBlindPrivate = (pkcs8: string) =>
  crypto.subtle.importKey('pkcs8', b64u.dec(pkcs8), ALG, true, ['sign']);

/** Chiave Ed25519 di sistema, usata per firmare verbali ed esiti. */
export function generateSigningKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export const signEd25519 = (privatePem: string, data: Uint8Array | string) =>
  sign(null, Buffer.from(data), createPrivateKey(privatePem)).toString('base64url');

export const verifyEd25519 = (publicPem: string, data: Uint8Array | string, sig: string) =>
  verify(null, Buffer.from(data), createPublicKey(publicPem), Buffer.from(sig, 'base64url'));
