import { describe, it, expect } from 'vitest';
import { publicUrlFor, scpCommand } from './fileshost.js';

describe('publicUrlFor', () => {
  it('builds the /public/extensions URL mirroring the SFTP path', () => {
    expect(publicUrlFor('acme-dark-mode', 'dist.crx'))
      .toBe('https://files.profullstack.com/public/extensions/acme-dark-mode/dist.crx');
  });
  it('encodes path segments', () => {
    expect(publicUrlFor('a b', 'x y.crx'))
      .toBe('https://files.profullstack.com/public/extensions/a%20b/x%20y.crx');
  });
});

describe('scpCommand', () => {
  it('shows the scp line for a slug', () => {
    expect(scpCommand('acme-dark-mode', 'dist.crx'))
      .toBe('scp dist.crx files@files.profullstack.com:/public/extensions/acme-dark-mode/');
  });
});
