import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvAccountResolver } from '../src/infrastructure/index.js';

async function setup(projectEnv: string | undefined, accounts: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ig-gateway-registry-'));
  const project = join(root, 'project');
  const accountsDir = join(root, 'accounts');
  await mkdir(project);
  await mkdir(accountsDir);
  if (projectEnv !== undefined) await writeFile(join(project, '.env'), projectEnv);
  for (const [name, content] of Object.entries(accounts)) await writeFile(join(accountsDir, `${name}.env`), content);
  return { project, resolver: new EnvAccountResolver(accountsDir) };
}

const example_studio = 'IG_FB_PAGE_TOKEN=page-token\nIG_FB_ACCOUNT_ID=2\nIG_USERNAME=example_studio\n';

describe('account registry', () => {
  it('project points to an account with IG_ACCOUNT and credentials come from the registry', async () => {
    const { project, resolver } = await setup('IG_ACCOUNT=example_studio\nOTRA_COSA=x\n', { example_studio });
    expect(await resolver.resolve(project)).toMatchObject({ id: '2', accessToken: 'page-token', username: 'example_studio' });
  });

  it('--account picks the account without project or own .env', async () => {
    const { resolver } = await setup(undefined, { example_studio });
    expect(await resolver.resolve('', undefined, 'example_studio')).toMatchObject({ id: '2', accessToken: 'page-token' });
  });

  it('--account overrides the project IG_ACCOUNT', async () => {
    const { project, resolver } = await setup('IG_ACCOUNT=example_studio\n', { example_studio, other: 'IG_FB_PAGE_TOKEN=other\nIG_FB_ACCOUNT_ID=9\n' });
    expect(await resolver.resolve(project, undefined, 'other')).toMatchObject({ id: '9', accessToken: 'other' });
  });

  it('registry keys win over project ones, which are kept when missing', async () => {
    const { project, resolver } = await setup('IG_ACCOUNT=example_studio\nIG_USERNAME=local\nIG_CAPABILITY_LOCATION=0\n', { example_studio });
    const account = await resolver.resolve(project);
    expect(account.username).toBe('example_studio');
    expect(account.capabilities.has('location')).toBe(false);
  });

  it('a project without IG_ACCOUNT keeps using its own keys', async () => {
    const { project, resolver } = await setup('IG_FB_PAGE_TOKEN=propio\nIG_FB_ACCOUNT_ID=7\n', { example_studio });
    expect(await resolver.resolve(project)).toMatchObject({ id: '7', accessToken: 'propio' });
  });

  it('an unknown account gives AUTHENTICATION without leaking secrets', async () => {
    const { project, resolver } = await setup('IG_ACCOUNT=fantasma\n');
    await expect(resolver.resolve(project)).rejects.toMatchObject({ code: 'AUTHENTICATION', message: expect.stringContaining('fantasma') });
  });

  it.each(['../etc/passwd', 'a/b', 'con espacios', ''.padEnd(65, 'a')])('rejects the account name %j', async (name) => {
    const { resolver } = await setup(undefined, { example_studio });
    await expect(resolver.resolve('', undefined, name)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it.each([
    ['IG_FB_ACCOUNT_ID=2\n', 'IG_FB_PAGE_TOKEN'],
    ['IG_FB_PAGE_TOKEN=page-token\n', 'IG_FB_ACCOUNT_ID'],
  ])('reports which key is missing (%j)', async (content, missing) => {
    const { resolver } = await setup(undefined, { incomplete: content });
    await expect(resolver.resolve('', undefined, 'incomplete')).rejects.toMatchObject({ code: 'AUTHENTICATION', message: expect.stringContaining(missing) });
  });

  it('no longer accepts Instagram Login keys', async () => {
    const { resolver } = await setup(undefined, { legacy: 'IG_TOKEN=t\nIG_ACCESS_TOKEN=t\nIG_ACCOUNT_ID=1\n' });
    await expect(resolver.resolve('', undefined, 'legacy')).rejects.toMatchObject({ code: 'AUTHENTICATION', message: expect.stringContaining('IG_FB_PAGE_TOKEN') });
  });
});
