// Run from the repo root:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test "tests/frontend/*.ts"
//
// Locks who gets a WiFi 通道 attempt during 自動連線 and WiFi 掃描
// (GLOSSARY.md: 裝置連線), and how a WiFi 掃描's results are counted for the
// button. Q / review numbers refer to
// .scratch/wifi-scan-button/issues/01-wifi-scan-button.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyWifiResults, wifiCandidates } from '../../frontend/src/wifiCandidates.ts';
import type { CandidateInput } from '../../frontend/src/wifiCandidates.ts';

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
    ['192.168.1.10', '192.168.1.11', '192.168.1.12'],
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
    ['192.168.1.13', '192.168.1.12'],
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
    ['192.168.1.11', '192.168.1.13'],
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

test('候選數最多 3 − 已連上裝置數，存過的 IP 優先', () => {
  const discovered = [
    { ip: '192.168.1.41', port: 50000, method: 'mdns' },
    { ip: '192.168.1.42', port: 50000, method: 'mdns' },
    { ip: '192.168.1.43', port: 50000, method: 'mdns' },
  ];
  const savedIps = [{ ip: '192.168.1.40', port: 49152, udid: 'S', lastUsed: 1 }];
  assert.deepEqual(ips({ connectedUdids: ['U1'], savedIps, discovered }), ['192.168.1.40', '192.168.1.41']);
  assert.deepEqual(ips({ connectedUdids: [], savedIps, discovered }), ['192.168.1.40', '192.168.1.41', '192.168.1.42']);
  assert.deepEqual(ips({ connectedUdids: ['U1', 'U2', 'U3'], savedIps, discovered }), []);
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
