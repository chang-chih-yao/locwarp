// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
//
// Locks who gets a WiFi 通道 attempt during 自動連線 and WiFi 掃描
// (GLOSSARY.md: 裝置連線), and how a WiFi 掃描's results are counted for the
// button. Q / review numbers refer to
// .scratch/wifi-scan-button/issues/01-wifi-scan-button.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillFreeSlots, tallyWifiResults, wifiCandidates } from '../../frontend/src/wifiCandidates.ts';
import type { CandidateInput, CandidateOutcome } from '../../frontend/src/wifiCandidates.ts';

const NONE: CandidateInput = {
  mode: 'scan',
  savedIps: [],
  discovered: [],
  connectedUdids: [],
  tunnelIps: [],
  pinnedUdids: [],
};

/** Candidate IPs in the order they would be tried. */
const ips = (input: Partial<CandidateInput>) => wifiCandidates({ ...NONE, ...input }).map((c) => c.ip);

test('WiFi 掃描不受釘選限制：照樣用偵測結果，也不濾掉未釘選裝置存過的 IP（Q5）', () => {
  assert.deepEqual(
    ips({
      mode: 'scan',
      pinnedUdids: ['PINNED'],
      savedIps: [
        { ip: '192.168.1.10', port: 49152, udid: 'PINNED', lastUsed: 2 },
        { ip: '192.168.1.11', port: 49152, udid: 'FRIEND', lastUsed: 1 },
      ],
      discovered: [{ ip: '192.168.1.12', port: 50000, method: 'mdns' }],
    }),
    ['192.168.1.12', '192.168.1.10', '192.168.1.11'],
  );
});

test('自動連線有釘選時只用釘選裝置存過的 IP、不用偵測結果，沒有 UDID 的存檔 IP 不出現（issue #35）', () => {
  assert.deepEqual(
    ips({
      mode: 'auto',
      pinnedUdids: ['PINNED'],
      savedIps: [
        { ip: '192.168.1.10', port: 49152, udid: 'PINNED', lastUsed: 3 },
        { ip: '192.168.1.11', port: 49152, udid: 'FRIEND', lastUsed: 2 },
        { ip: '192.168.1.13', port: 49152, lastUsed: 1 },
      ],
      discovered: [{ ip: '192.168.1.12', port: 50000, method: 'mdns' }],
    }),
    ['192.168.1.10'],
  );
});

test('自動連線沒有釘選時會用偵測結果', () => {
  assert.deepEqual(
    ips({
      mode: 'auto',
      savedIps: [{ ip: '192.168.1.13', port: 49152, lastUsed: 1 }],
      discovered: [{ ip: '192.168.1.12', port: 50000, method: 'mdns' }],
    }),
    ['192.168.1.12', '192.168.1.13'],
  );
});

test('兩種模式都跳過 UDID 已連上（USB 或 WiFi）的存檔 IP（Q9、Q12）', () => {
  for (const mode of ['auto', 'scan'] as const) {
    assert.deepEqual(
      ips({
        mode,
        // Pinned too, so 自動連線 would otherwise pick it.
        pinnedUdids: ['ON_USB', 'FREE'],
        connectedUdids: ['ON_USB'],
        savedIps: [
          { ip: '192.168.1.10', port: 49152, udid: 'ON_USB', lastUsed: 2 },
          { ip: '192.168.1.11', port: 49152, udid: 'FREE', lastUsed: 1 },
        ],
      }),
      ['192.168.1.11'],
      mode,
    );
  }
});

test('IP 等於某條 WiFi 通道的手機 IP 就跳過：沒有 UDID 的存檔 IP、mDNS、子網掃描都擋（review 5）', () => {
  assert.deepEqual(
    ips({
      tunnelIps: ['192.168.1.10', '192.168.1.12', '192.168.1.14'],
      savedIps: [
        { ip: '192.168.1.10', port: 49152, lastUsed: 2 },
        { ip: '192.168.1.11', port: 49152, lastUsed: 1 },
      ],
      discovered: [
        { ip: '192.168.1.12', port: 50000, method: 'mdns' },
        { ip: '192.168.1.13', port: 50000, method: 'mdns' },
        { ip: '192.168.1.14', port: 50001, ports: [50001], method: 'tcp_scan' },
      ],
    }),
    ['192.168.1.13', '192.168.1.11'],
  );
});

test('同一個 UDID 只出一個候選，取最新的那筆（review 6）', () => {
  const got = wifiCandidates({
    ...NONE,
    savedIps: [
      // Older first on purpose: the newest must win whatever the input order.
      { ip: '192.168.1.20', port: 49152, udid: 'A', lastUsed: 100 },
      { ip: '192.168.1.21', port: 50000, udid: 'A', lastUsed: 200 },
      { ip: '192.168.1.22', port: 49152, udid: 'B', lastUsed: 150 },
    ],
  });
  assert.deepEqual(got.map((c) => [c.ip, c.udid]), [['192.168.1.21', 'A'], ['192.168.1.22', 'B']]);
});

test('最新的存檔 IP 被通道 IP 擋掉時，同一台手機不退回較舊的位址（review 6）', () => {
  // A's newest address is already tunnelled; its older one is most likely a
  // dead DHCP lease and would only burn the 45 s start budget.
  assert.deepEqual(
    ips({
      tunnelIps: ['192.168.1.21'],
      savedIps: [
        { ip: '192.168.1.20', port: 49152, udid: 'A', lastUsed: 100 },
        { ip: '192.168.1.21', port: 50000, udid: 'A', lastUsed: 200 },
      ],
    }),
    [],
  );
});

test('同一個 IP 只出一個候選：Port 合併、存過的在前，來源合併', () => {
  const got = wifiCandidates({
    ...NONE,
    savedIps: [
      { ip: '192.168.1.30', port: 49152, udid: 'A', lastUsed: 2 },
      { ip: '192.168.1.31', port: 49152, lastUsed: 1 },
    ],
    discovered: [
      { ip: '192.168.1.30', port: 50000, method: 'mdns' },
      { ip: '192.168.1.31', port: 50001, ports: [50001, 50002, 49152], method: 'tcp_scan' },
    ],
  });
  assert.deepEqual(got, [
    { ip: '192.168.1.30', ports: [49152, 50000], udid: 'A', sources: ['saved', 'mdns'] },
    { ip: '192.168.1.31', ports: [49152, 50001, 50002], udid: undefined, sources: ['saved', 'subnet'] },
  ]);
});

test('只有 mDNS 找到的排在只有存過的 IP 前面；候選不截斷，超過名額的留給 fillFreeSlots 補位', () => {
  assert.deepEqual(
    ips({
      connectedUdids: ['U1'],
      savedIps: [{ ip: '192.168.1.40', port: 49152, udid: 'S', lastUsed: 1 }],
      discovered: [
        { ip: '192.168.1.41', port: 50000, method: 'mdns' },
        { ip: '192.168.1.42', port: 50000, method: 'mdns' },
        { ip: '192.168.1.43', port: 50000, method: 'mdns' },
      ],
    }),
    ['192.168.1.41', '192.168.1.42', '192.168.1.43', '192.168.1.40'],
  );
});

// A failed attempt holds its slot (fillFreeSlots), so whoever is most likely
// to answer goes first; .scratch/wifi-tunnel-parallel-start/issues/01-parallel-tunnel-start.md.
test('排序（mDNS）：存過且這次也找到的、只有 mDNS 找到的、只有存過的', () => {
  assert.deepEqual(
    ips({
      savedIps: [
        { ip: '192.168.1.50', port: 49152, udid: 'A', lastUsed: 200 },
        { ip: '192.168.1.51', port: 49152, udid: 'B', lastUsed: 100 },
      ],
      discovered: [
        { ip: '192.168.1.52', port: 50000, method: 'mdns' },
        { ip: '192.168.1.51', port: 50000, method: 'mdns' },
      ],
    }),
    ['192.168.1.51', '192.168.1.52', '192.168.1.50'],
  );
});

test('排序（子網掃描）：存過且這次也找到的、只有存過的、只有子網掃描找到的（可能不是 iPhone，最多卡 45 秒）', () => {
  assert.deepEqual(
    ips({
      savedIps: [
        { ip: '192.168.1.50', port: 49152, udid: 'A', lastUsed: 200 },
        { ip: '192.168.1.51', port: 49152, udid: 'B', lastUsed: 100 },
      ],
      discovered: [
        { ip: '192.168.1.53', port: 50001, ports: [50001], method: 'tcp_scan' },
        { ip: '192.168.1.51', port: 50001, ports: [50001], method: 'tcp_scan' },
      ],
    }),
    ['192.168.1.51', '192.168.1.50', '192.168.1.53'],
  );
});

test('排序：自動連線有釘選時不看偵測結果，照存過的 lastUsed 從新到舊', () => {
  assert.deepEqual(
    ips({
      mode: 'auto',
      pinnedUdids: ['A', 'B'],
      savedIps: [
        { ip: '192.168.1.50', port: 49152, udid: 'A', lastUsed: 200 },
        { ip: '192.168.1.51', port: 49152, udid: 'B', lastUsed: 100 },
      ],
      // Would put B first if 自動連線 with pins looked at discovery.
      discovered: [{ ip: '192.168.1.51', port: 50000, method: 'mdns' }],
    }),
    ['192.168.1.50', '192.168.1.51'],
  );
});

/** Which candidates fillFreeSlots tries, each answering from `outcomes` (default connected). */
const tried = async (candidates: string[], connectedCount: number, outcomes: Record<string, CandidateOutcome> = {}) => {
  const order: string[] = [];
  await fillFreeSlots(candidates, connectedCount, async (c) => {
    order.push(c);
    return { outcome: outcomes[c] ?? 'connected' };
  });
  return order;
};

test('名額 = 3 − 已連上裝置數，依候選順序取', async () => {
  const four = ['A', 'B', 'C', 'D'];
  assert.deepEqual(await tried(four, 0), ['A', 'B', 'C']);
  assert.deepEqual(await tried(four, 1), ['A', 'B']);
  assert.deepEqual(await tried(four, 3), []);
});

test('回 already_connected 的候選讓出名額給下一個：USB 連著的手機的 mDNS 結果不擠掉別台（Q12 群組不倒退）', async () => {
  // A is on USB and also answers mDNS, which carries no UDID to skip it by.
  // One phone connected leaves two slots, and B and C both still need one.
  assert.deepEqual(await tried(['A_MDNS', 'B', 'C'], 1, { A_MDNS: 'already_connected' }), ['A_MDNS', 'B', 'C']);
});

test('連線失敗照樣佔住名額、不往下試：子網掃描到的非 iPhone 主機一台最多耗 45 秒', async () => {
  assert.deepEqual(await tried(['X', 'Y'], 2, { X: 'failed' }), ['X']);
});

test('名額內平行送，同時進行的請求數不超過名額', async () => {
  // Never more than the free slots in flight, so the backend's device cap
  // holds; all at once within them, so dead addresses don't queue up here.
  let inFlight = 0;
  let peak = 0;
  const results = await fillFreeSlots(['A', 'B', 'C', 'D'], 1, async () => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return { outcome: 'already_connected' as const };
  });
  assert.equal(results.length, 4);
  assert.equal(peak, 2);
});

test('統計：already_connected 不算新連上也不算失敗', () => {
  assert.deepEqual(
    tallyWifiResults([
      { sources: ['mdns'], outcome: 'already_connected' },
      { sources: ['saved'], outcome: 'already_connected' },
      { sources: ['saved'], outcome: 'connected' },
    ]),
    { connected: 1, failed: 0 },
  );
});

test('統計：只有來源含 mDNS 的失敗算進 m；只有存過的 IP、只有子網掃描、存過的 IP 加子網掃描都不算', () => {
  assert.deepEqual(
    tallyWifiResults([
      { sources: ['mdns'], outcome: 'failed' },
      { sources: ['saved', 'mdns'], outcome: 'failed' },
      { sources: ['saved'], outcome: 'failed' },
      { sources: ['subnet'], outcome: 'failed' },
      { sources: ['saved', 'subnet'], outcome: 'failed' },
    ]),
    { connected: 0, failed: 2 },
  );
});
