// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) request on node:http
// / node:https, answering the body as text. Bounded in time and size (the
// history of a busy MeTube is a few hundred kilobytes).
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory MeTube (test/helpers/fakeMetube.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

const MAX_BODY_BYTES = 16 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method] GET by default
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body] sent as is (JSON text)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest(url, { method = 'GET', headers = {}, body, timeoutMs } = {}) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  timeoutMs ??= 15_000;
  const requestHeaders = { accept: 'application/json', ...headers };
  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    requestHeaders['content-length'] = String(Buffer.byteLength(body));
  }

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      { method, headers: requestHeaders, timeout: timeoutMs },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(body);
  });
}
