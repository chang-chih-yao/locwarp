// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
// (the warning is because frontend/package.json can't declare "type": "module":
// electron/main.js is CommonJS). The backend checks need the repo-root .venv.
//
// Locks the initial values (GLOSSARY.md: 初始值) and keeps the 模式速度
// table identical across the three runtimes that each hold a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  INITIAL_MOVE_MODE,
  INITIAL_PIPI_FLOWER_FILTER,
  INITIAL_PIPI_KINDS,
  MODE_SPEED_KMH,
  resolveMoveMode,
  resolvePipiFlowerFilter,
  resolvePipiKinds,
  resolvePipiMarkerSize,
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

// 顯示拿過精華的花 starts unticked: what the player wants is that 拿過精華
// flowers stop showing up (spec Q8).
test('沒存過花的子篩選時：不限彩帶、顯示普花、不顯示拿過精華的花', () => {
  assert.deepEqual(resolvePipiFlowerFilter(null), { ribbonOnly: false, showCommon: true, showEssenceTaken: false });
});

test('存過的花的子篩選原樣保留，三個子選項的八種勾法都是', () => {
  for (const ribbonOnly of [false, true]) {
    for (const showCommon of [false, true]) {
      for (const showEssenceTaken of [false, true]) {
        const saved = { ribbonOnly, showCommon, showEssenceTaken };
        assert.deepEqual(resolvePipiFlowerFilter(JSON.stringify(saved)), saved);
      }
    }
  }
});

test('拿過精華功能之前存的兩欄設定：兩欄照存的，顯示拿過精華的花用初始值（不勾）', () => {
  for (const ribbonOnly of [false, true]) {
    for (const showCommon of [false, true]) {
      assert.deepEqual(
        resolvePipiFlowerFilter(JSON.stringify({ ribbonOnly, showCommon })),
        { ribbonOnly, showCommon, showEssenceTaken: false },
      );
    }
  }
});

test('存下來的花的子篩選缺少或不是布林值的欄位用初始值，其他欄照存的', () => {
  assert.deepEqual(resolvePipiFlowerFilter('{"ribbonOnly":true}'), { ribbonOnly: true, showCommon: true, showEssenceTaken: false });
  assert.deepEqual(resolvePipiFlowerFilter('{"showCommon":false}'), { ribbonOnly: false, showCommon: false, showEssenceTaken: false });
  assert.deepEqual(resolvePipiFlowerFilter('{"ribbonOnly":"yes","showCommon":false}'), { ribbonOnly: false, showCommon: false, showEssenceTaken: false });
  assert.deepEqual(resolvePipiFlowerFilter('{"ribbonOnly":true,"showCommon":0}'), { ribbonOnly: true, showCommon: true, showEssenceTaken: false });
  assert.deepEqual(resolvePipiFlowerFilter('{"showEssenceTaken":true}'), { ribbonOnly: false, showCommon: true, showEssenceTaken: true });
  for (const bad of ['"yes"', '1', 'null', '"true"']) {
    assert.deepEqual(
      resolvePipiFlowerFilter(`{"ribbonOnly":true,"showCommon":false,"showEssenceTaken":${bad}}`),
      { ribbonOnly: true, showCommon: false, showEssenceTaken: false },
      bad,
    );
  }
});

test('壞掉或不是物件的花的子篩選設定整份用初始值', () => {
  for (const bad of ['not json', '"ribbonOnly"', '42', 'null', '[true,false]']) {
    assert.deepEqual(resolvePipiFlowerFilter(bad), { ...INITIAL_PIPI_FLOWER_FILTER }, bad);
  }
});

test('沒存過標記大小時是中', () => {
  assert.equal(resolvePipiMarkerSize(null), 'medium');
});

test('存過的標記大小原樣保留', () => {
  for (const s of ['small', 'medium', 'large'] as const) assert.equal(resolvePipiMarkerSize(s), s);
});

test('無法辨識的標記大小退回中', () => {
  for (const bad of ['', 'huge', 'Small', '"small"', '40']) assert.equal(resolvePipiMarkerSize(bad), 'medium', bad);
});

// Imports backend/config.py with the repo's .venv Python, so the checks below
// see the values the backend actually runs with, not just the source text.
function backendSpeeds(): { kmh: Record<string, number>; mps: Record<string, number> } {
  const py = ['.venv/Scripts/python.exe', '.venv/bin/python'].map((p) => join(repo, p)).find((p) => existsSync(p));
  assert.ok(py, '找不到 repo 根目錄的 .venv Python，無法驗證 backend 的值');
  const code = 'import json, config; print(json.dumps({"kmh": config.MODE_SPEED_KMH, '
    + '"mps": {k: p["speed_mps"] for k, p in config.SPEED_PROFILES.items()}}))';
  const r = spawnSync(py, ['-c', code], { cwd: join(repo, 'backend'), encoding: 'utf8' });
  assert.equal(r.status, 0, `import backend config 失敗：${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}

test('backend 的模式速度與前端一致', () => {
  assert.deepEqual(backendSpeeds().kmh, { ...MODE_SPEED_KMH });
});

test('backend 實際使用的 speed_mps 是模式速度 ÷ 3.6', () => {
  const { kmh, mps } = backendSpeeds();
  assert.deepEqual(Object.keys(mps).sort(), Object.keys(kmh).sort());
  for (const [mode, v] of Object.entries(kmh)) {
    assert.ok(Math.abs(mps[mode] - v / 3.6) < 1e-9, `${mode}: speed_mps ${mps[mode]} ≠ ${v} / 3.6`);
  }
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
