import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(new URL('../.cache/gemini-ui/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = resolve(ROOT, '.cache/library-generation');
const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? new Set(args[onlyIndex + 1].split(',').filter(Boolean)) : null;
const checkOnly = args.includes('--check');

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('gemini.google.com'));
if (!page) throw new Error('Страница Gemini не найдена в отдельном Chrome-профиле');
await page.bringToFront();
async function regionUnavailable() {
  const text = await page.locator('body').innerText().catch(() => '');
  return text.includes('поддерживается в вашей стране') || text.includes('supported in your country') || text.includes('not available in your country');
}
if (checkOnly) {
  console.log(JSON.stringify({
    url: new URL(page.url()).origin,
    promptVisible: await page.locator('[contenteditable="true"]').first().isVisible().catch(() => false),
    toolsVisible: await page.getByRole('button', { name: 'Загрузка и инструменты', exact: true }).isVisible().catch(() => false),
    loginVisible: await page.getByRole('button', { name: 'Войти', exact: true }).first().isVisible().catch(() => false),
    regionUnavailable: await regionUnavailable(),
  }, null, 2));
  process.exit(0);
}
if (await regionUnavailable()) {
  console.error('REGION_UNAVAILABLE: Gemini сообщает об ограничении региона. Генерация не отправлена.');
  process.exit(3);
}

let loginRequired = page.url().includes('accounts.google.com') || await page.getByRole('button', { name: 'Войти', exact: true }).first().isVisible().catch(() => false);
if (loginRequired && args.includes('--wait-auth')) {
  console.log('WAITING_FOR_MANUAL_LOGIN: войдите в Gemini в отдельном Chrome-профиле. Серия начнётся после авторизации.');
  const started = Date.now();
  while (loginRequired && Date.now() - started < 1200000) {
    await page.waitForTimeout(5000);
    loginRequired = page.url().includes('accounts.google.com') || await page.getByRole('button', { name: 'Войти', exact: true }).first().isVisible().catch(() => false);
  }
}
if (loginRequired) {
  console.error('AUTH_REQUIRED: войдите в Gemini в отдельном Chrome-профиле. Генерация не отправлена.');
  process.exit(2);
}

const requests = JSON.parse(await readFile(resolve(ROOT, 'tools/library-generation.json'), 'utf8'));
if (new Set(requests.assets.map(asset => asset.id)).size !== requests.assets.length) throw new Error('Duplicate asset id in generation requests');
const assets = requests.assets.filter(asset => !only || only.has(asset.id));
if (!assets.length) throw new Error('Нет ассетов для генерации');
console.log(`QUEUE=${assets.map(asset => asset.id).join(',')}`);

function probe(path) {
  const result = spawnSync('python', ['-c', 'from PIL import Image; import json,sys; im=Image.open(sys.argv[1]); im.load(); print(json.dumps({"format":im.format,"size":list(im.size),"mode":im.mode}))', path], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Файл не декодируется: ${path}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function readyMetadata(directory) {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(resolve(directory, 'metadata.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const files = await readdir(directory);
    if (files.some(file => file.startsWith('original.'))) throw new Error(`SOURCE_NEEDS_REVIEW: ${directory} содержит исходник без metadata. Проверьте текущий чат и восстановите JSON, не отправляя новый запрос.`);
    return null;
  }
  if (metadata.visualReview === 'rejected') {
    metadata.retryRequired = true;
    return metadata;
  }
  if (!metadata.originalPath || !metadata.sha256 || !metadata.originalFormat) throw new Error(`METADATA_INCOMPLETE: ${directory}. Проверьте чат и метаданные перед продолжением.`);
  const path = resolve(ROOT, metadata.originalPath);
  const bytes = await readFile(path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const actual = probe(path);
  if (hash !== metadata.sha256 || actual.format !== metadata.originalFormat) throw new Error(`SOURCE_CHANGED: ${path}. Сначала проверьте файл и восстановите корректные метаданные.`);
  return metadata;
}

async function prepareImageMode() {
  const promptBox = page.getByRole('textbox', { name: 'Введите запрос для Gemini' });
  await promptBox.waitFor({ state: 'visible', timeout: 60000 });
  const tools = page.getByRole('button', { name: 'Загрузка и инструменты', exact: true });
  await tools.click();
  const imageMode = page.getByText('Создание изображений', { exact: true }).first();
  await imageMode.waitFor({ state: 'visible', timeout: 15000 });
  await imageMode.click();
  await page.getByRole('button', { name: /Отменить выбор: (?:Создание изображений|Изображения)/ }).waitFor({ state: 'visible', timeout: 15000 });
  const aspect = page.getByRole('button', { name: /16:9|1:1/ }).first();
  let aspectSetting = 'default UI setting (not changed)';
  if (await aspect.isVisible().catch(() => false)) {
    const label = await aspect.textContent();
    if (/16:9|1:1/.test(label || '')) {
      await aspect.click();
      aspectSetting = label.trim();
    }
  }
  const selectedMode = await page.locator('button[aria-label^="Отменить выбор:"]').first().getAttribute('aria-label');
  await page.keyboard.press('Escape');
  return { aspectSetting, imageMode: selectedMode };
}

async function attachReferences(references) {
  if (!references.length) return;
  if (references.length > 8) throw new Error('UI: больше восьми референсов не подтверждено');
  for (const reference of references) await stat(reference.path);
  const tools = page.getByRole('button', { name: 'Загрузка и инструменты', exact: true });
  const upload = page.locator('[data-test-id="local-images-files-uploader-button"]');
  if (!await upload.isVisible()) await tools.click();
  await upload.waitFor({ state: 'visible', timeout: 15000 });
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15000 });
  await upload.click({ force: true });
  const chooser = await chooserPromise;
  await chooser.setFiles(references.map(reference => reference.path));
  await page.keyboard.press('Escape');
  await page.waitForFunction(count => document.querySelectorAll('button[aria-label="закрыть прикрепленный файл"]').length === count, references.length, { timeout: 60000 });
}

async function generate(asset) {
  const directory = resolve(CACHE, asset.id);
  await mkdir(directory, { recursive: true });
  const previous = await readyMetadata(directory);
  if (previous) {
    if (!previous.retryRequired) {
      console.log(`SKIP=${asset.id}`);
      return;
    }
    if (asset.prompt === previous.prompt) throw new Error(`PROMPT_UNCHANGED: ${asset.id}. Измените prompt в tools/library-generation.json перед повторной генерацией.`);
    await copyFile(resolve(ROOT, previous.originalPath), resolve(directory, `rejected-${Date.now()}${extname(previous.originalPath)}`));
    console.log(`RETRY=${asset.id}`);
  }
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  if (await regionUnavailable()) throw new Error(`REGION_UNAVAILABLE=${asset.id}. Запрос не отправлен; обход ограничения не выполняется.`);
  const { aspectSetting, imageMode } = await prepareImageMode();
  await attachReferences(asset.references || []);
  const promptBox = page.getByRole('textbox', { name: 'Введите запрос для Gemini' });
  await promptBox.waitFor({ state: 'visible', timeout: 60000 });
  await promptBox.fill(asset.prompt);
  const generated = page.locator('img[alt=", создано искусственным интеллектом"]');
  const previousCount = await generated.count();
  const send = page.getByRole('button', { name: 'Отправить сообщение', exact: true });
  await send.waitFor({ state: 'visible' });
  await send.click();
  console.log(`SENT_ONCE=${asset.id}`);
  const outcome = await page.waitForFunction(count => {
    if (document.querySelectorAll('img[alt=", создано искусственным интеллектом"]').length > count) return 'image';
    const responses = [...document.querySelectorAll('message-content')];
    if (responses.at(-1)?.innerText.includes("I can't generate the image you requested")) return 'refusal';
    return false;
  }, previousCount, { timeout: 240000 });
  if (await outcome.jsonValue() === 'refusal') {
    await writeFile(resolve(directory, `refusal-${Date.now()}.json`), JSON.stringify({ prompt: asset.prompt, reason: 'Gemini refused this prompt; a revised prompt is required.', visualReview: 'rejected' }, null, 2) + '\n');
    throw new Error(`GENERATION_REFUSED=${asset.id}. Запрос не повторяется: измените prompt.`);
  }
  const downloadButton = page.getByRole('button', { name: 'Скачать изображение в полном размере', exact: true }).last();
  await downloadButton.waitFor({ state: 'visible', timeout: 60000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await downloadButton.click();
  const download = await downloadPromise;
  const originalPath = resolve(directory, `original${extname(download.suggestedFilename()) || '.png'}`);
  await download.saveAs(originalPath);
  if (await download.failure()) throw new Error(`Скачивание не удалось: ${asset.id}`);
  const actual = probe(originalPath);
  const bytes = await readFile(originalPath);
  const metadata = {
    id: asset.id,
    promptVersion: 'library-v1',
    prompt: asset.prompt,
    references: asset.references || [],
    kind: asset.kind || 'unit',
    rows: asset.rows,
    columns: asset.columns,
    slots: asset.slots,
    imageMode,
    aspectSetting,
    downloadedAt: new Date().toISOString(),
    originalPath: relative(ROOT, originalPath).replaceAll('\\', '/'),
    originalFormat: actual.format,
    originalSize: actual.size,
    originalMode: actual.mode,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    visualReview: 'pending',
  };
  await writeFile(resolve(directory, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(`OUTPUT=${originalPath}`);
}

for (const asset of assets) await generate(asset);
console.log('SERIES_DONE');
process.exit(0);
