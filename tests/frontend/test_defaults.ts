// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
// (the warning is because frontend/package.json can't declare "type": "module":
// electron/main.js is CommonJS).
//
// Locks the initial values (GLOSSARY.md: 初始值) and keeps the 模式速度
// table identical across the three runtimes that each hold a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INITIAL_MOVE_MODE,
  INITIAL_PIPI_KINDS,
  MODE_SPEED_KMH,
  resolveMoveMode,
  resolvePipiKinds,
} from '../../frontend/src/defaults.ts';

const repo = join(import.meta.dirname, '..', '..');
const read = (rel: string) => readFileSync(join(repo, rel), 'utf8');

test('腳踏車的模式速度是 19.5 km/h，全新安裝從腳踏車開始', () => {
  assert.equal(MODE_SPEED_KMH.running, 19.5);
  assert.equal(INITIAL_MOVE_MODE, 'running');
  assert.equal(resolveMoveMode(null), 'running');
});

test('存過的移動模式不被初始值覆蓋', () => {
  for (const m of ['walking', 'running', 'driving'] as const) assert.equal(resolveMoveMode(m), m);
});

test('無法辨識的移動模式退回初始值', () => {
  for (const bad of ['', 'cycling', 'Walking']) assert.equal(resolveMoveMode(bad), INITIAL_MOVE_MODE);
});

test('沒存過點位種類時只顯示蘑菇', () => {
  assert.deepEqual(resolvePipiKinds(null), { mushroom: true, flower: false, smoke: false });
});

test('存過的點位種類原樣保留，包括全開與全關', () => {
  const all = { mushroom: true, flower: true, smoke: true };
  const none = { mushroom: false, flower: false, smoke: false };
  assert.deepEqual(resolvePipiKinds(JSON.stringify(all)), all);
  assert.deepEqual(resolvePipiKinds(JSON.stringify(none)), none);
});

test('存下來的點位種類缺少或不是布林值的項目用初始值', () => {
  assert.deepEqual(resolvePipiKinds('{"flower":true}'), { mushroom: true, flower: true, smoke: false });
  assert.deepEqual(resolvePipiKinds('{"mushroom":false,"smoke":"yes"}'), { mushroom: false, flower: false, smoke: false });
});

test('壞掉或不是物件的點位種類設定整份用初始值', () => {
  for (const bad of ['not json', '"mushroom"', '42', 'null', '[true,true,true]']) {
    assert.deepEqual(resolvePipiKinds(bad), { ...INITIAL_PIPI_KINDS }, bad);
  }
});

test('backend 的模式速度與前端一致', () => {
  const src = read('backend/config.py');
  const block = src.match(/^MODE_SPEED_KMH[^=]*=\s*\{([^}]*)\}/m);
  assert.ok(block, 'backend/config.py 找不到 MODE_SPEED_KMH');
  const backend = Object.fromEntries(
    [...block[1].matchAll(/"(\w+)":\s*([\d.]+)/g)].map(([, k, v]) => [k, Number(v)]),
  );
  assert.deepEqual(backend, { ...MODE_SPEED_KMH });
});

test('手機控制頁的模式按鈕與初始模式與前端一致', () => {
  const html = read('backend/static/phone.html');
  const row = html.match(/<div class="mode-row" id="sheet-modes"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(row, 'phone.html 找不到 #sheet-modes');
  const buttons = [...row[1].matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attrs, label]) => ({
    mode: attrs.match(/data-mode="(\w+)"/)?.[1],
    kmh: Number(attrs.match(/data-kmh="([\d.]+)"/)?.[1]),
    active: /class="[^"]*\bactive\b/.test(attrs),
    label,
  }));
  assert.deepEqual(
    Object.fromEntries(buttons.map((b) => [b.mode, b.kmh])),
    { ...MODE_SPEED_KMH },
  );
  for (const b of buttons) assert.ok(b.label.includes(`(${b.kmh}km/h)`), `按鈕文字與 data-kmh 不符：${b.label}`);
  assert.deepEqual(buttons.filter((b) => b.active).map((b) => b.mode), [INITIAL_MOVE_MODE]);
  const initial = html.match(/let navigateMode = '(\w+)'/);
  assert.equal(initial?.[1], INITIAL_MOVE_MODE);
});
