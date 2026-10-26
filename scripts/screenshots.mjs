// Capture the real app with synthetic demo data in an isolated profile.
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(os.tmpdir(), 'dockloom-docs-'));
const env = { ...process.env, DOCKLOOM_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir('docs/images', { recursive: true });
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  for (const language of ['en', 'zh']) {
    const zh = language === 'zh';
    await page.evaluate(language => localStorage.setItem('dockloom.language', language), language);
    await page.reload();
    await page.getByRole('switch', { name: zh ? '演示模式' : 'Demo mode' }).click();
    await page.getByRole('button', { name: /portfolio-web-1/ }).waitFor();
    const shot = name => page.screenshot({ path: `docs/images/${name}-${language}.png`, scale: 'css' });
    await shot('workspace');
    await page.getByRole('button', { name: zh ? '部署 Compose' : 'Deploy Compose', exact: true }).click();
    await page.getByRole('textbox', { name: zh ? /应用名称/ : /Application name/ }).fill('my-stack');
    await page.getByRole('button', { name: zh ? '选择目录' : 'Choose directory', exact: true }).click();
    await page.getByRole('button', { name: zh ? '生成部署计划' : 'Generate deployment plan', exact: true }).click();
    await page.getByRole('heading', { name: zh ? '将发布的服务' : 'Services to publish', exact: true }).waitFor();
    await shot('compose');
    await page.getByRole('dialog').locator('button.primary').click();
    await page.locator('.job-detail .status').filter({ hasText: zh ? '已完成' : 'Succeeded' }).waitFor();
    await shot('releases');
  }
  console.log('Saved six bilingual demo screenshots to docs/images');
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
