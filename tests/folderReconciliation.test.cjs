const test = require('node:test');
const assert = require('node:assert/strict');

const {
  reconcileFolderSnapshot,
} = require('../dist/electron/services/folderReconciliation.js');

function entry(id, accountId, folder, uid, isRead = false, isStarred = false) {
  return { id, accountId, folder, uid, isRead, isStarred };
}

test('records a UIDVALIDITY baseline without interpreting legacy UIDs', async () => {
  const commits = [];
  let fetchCalled = false;
  const result = await reconcileFolderSnapshot({
    accountId: 'account-a',
    folder: 'INBOX',
    previousUidValidity: null,
    currentUidValidity: '100',
    entries: [entry('legacy', 'account-a', 'INBOX', 10)],
    fetchFlagsBatch: async () => {
      fetchCalled = true;
      return [];
    },
    commit: (plan) => commits.push(plan),
  });

  assert.equal(result.status, 'baseline-recorded');
  assert.equal(fetchCalled, false);
  assert.deepEqual(commits, [{ flagUpdates: [], removals: [], uidValidity: '100' }]);
});

test('a later manual refresh reconciles after the baseline pass', async () => {
  let storedUidValidity = null;
  const commits = [];
  const entries = [entry('stale-inbox', 'account-a', 'INBOX', 10)];
  const run = () => reconcileFolderSnapshot({
    accountId: 'account-a',
    folder: 'INBOX',
    previousUidValidity: storedUidValidity,
    currentUidValidity: '100',
    entries,
    fetchFlagsBatch: async () => [],
    commit: (plan) => {
      commits.push(plan);
      if (plan.uidValidity) storedUidValidity = plan.uidValidity;
    },
  });

  assert.equal((await run()).status, 'baseline-recorded');
  const second = await run();
  assert.equal(second.status, 'reconciled');
  assert.equal(second.removed, 1);
  assert.deepEqual(commits[1].removals.map((item) => item.id), ['stale-inbox']);
});

test('removes only missing memberships in the requested account and folder', async () => {
  const commits = [];
  const result = await reconcileFolderSnapshot({
    accountId: 'account-a',
    folder: 'INBOX',
    previousUidValidity: '100',
    currentUidValidity: '100',
    entries: [
      entry('keep', 'account-a', 'INBOX', 10, false, false),
      entry('remove', 'account-a', 'INBOX', 11, true, false),
      entry('other-folder', 'account-a', 'NewsPicks', 11, false, false),
      entry('other-account', 'account-b', 'INBOX', 11, false, false),
    ],
    fetchFlagsBatch: async (uids) => {
      assert.deepEqual(uids, [10, 11]);
      return [{ uid: 10, isRead: true, isStarred: true }];
    },
    commit: (plan) => commits.push(plan),
  });

  assert.equal(result.status, 'reconciled');
  assert.equal(result.updated, 1);
  assert.equal(result.removed, 1);
  assert.deepEqual(commits[0].removals.map((item) => item.id), ['remove']);
  assert.deepEqual(commits[0].flagUpdates.map((item) => item.id), ['keep']);
  assert.equal(commits[0].flagUpdates[0].isRead, true);
  assert.equal(commits[0].flagUpdates[0].isStarred, true);
});

test('does not commit flags or removals when a UID batch fails', async () => {
  let calls = 0;
  let committed = false;
  await assert.rejects(
    reconcileFolderSnapshot({
      accountId: 'account-a',
      folder: 'INBOX',
      previousUidValidity: '100',
      currentUidValidity: '100',
      entries: [
        entry('one', 'account-a', 'INBOX', 1),
        entry('two', 'account-a', 'INBOX', 2),
      ],
      batchSize: 1,
      fetchFlagsBatch: async ([uid]) => {
        calls++;
        if (uid === 2) throw new Error('connection lost');
        return [{ uid, isRead: true, isStarred: false }];
      },
      commit: () => { committed = true; },
    }),
    /connection lost/,
  );
  assert.equal(calls, 2);
  assert.equal(committed, false);
});

test('does not commit after timeout cancellation', async () => {
  const controller = new AbortController();
  let committed = false;
  await assert.rejects(
    reconcileFolderSnapshot({
      accountId: 'account-a',
      folder: 'INBOX',
      previousUidValidity: '100',
      currentUidValidity: '100',
      entries: [entry('one', 'account-a', 'INBOX', 1)],
      signal: controller.signal,
      fetchFlagsBatch: async () => {
        controller.abort();
        return [];
      },
      commit: () => { committed = true; },
    }),
    /aborted/,
  );
  assert.equal(committed, false);
});

test('stops without fetching or committing when UIDVALIDITY changes', async () => {
  let fetched = false;
  let committed = false;
  const result = await reconcileFolderSnapshot({
    accountId: 'account-a',
    folder: 'INBOX',
    previousUidValidity: '100',
    currentUidValidity: '200',
    entries: [entry('one', 'account-a', 'INBOX', 1)],
    fetchFlagsBatch: async () => {
      fetched = true;
      return [];
    },
    commit: () => { committed = true; },
  });

  assert.equal(result.status, 'uid-validity-changed');
  assert.equal(fetched, false);
  assert.equal(committed, false);
});

test('rejects an unexpected UID without committing', async () => {
  let committed = false;
  await assert.rejects(
    reconcileFolderSnapshot({
      accountId: 'account-a',
      folder: 'INBOX',
      previousUidValidity: '100',
      currentUidValidity: '100',
      entries: [entry('one', 'account-a', 'INBOX', 1)],
      fetchFlagsBatch: async () => [{ uid: 999, isRead: false, isStarred: false }],
      commit: () => { committed = true; },
    }),
    /unexpected UID/,
  );
  assert.equal(committed, false);
});
