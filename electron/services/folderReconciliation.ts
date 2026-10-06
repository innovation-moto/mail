export interface FolderMembershipEntry {
  id: string;
  accountId: string;
  folder: string;
  uid: number;
  isRead: boolean;
  isStarred: boolean;
}

export interface RemoteMessageFlags {
  uid: number;
  isRead: boolean;
  isStarred: boolean;
}

export interface FolderReconciliationPlan {
  flagUpdates: Array<FolderMembershipEntry & { isRead: boolean; isStarred: boolean }>;
  removals: FolderMembershipEntry[];
  uidValidity?: string;
}

export interface FolderReconciliationResult {
  status: 'reconciled' | 'baseline-recorded' | 'uid-validity-changed';
  updated: number;
  removed: number;
}

interface ReconcileFolderSnapshotOptions {
  accountId: string;
  folder: string;
  previousUidValidity: string | null;
  currentUidValidity: string;
  entries: FolderMembershipEntry[];
  batchSize?: number;
  signal?: AbortSignal;
  fetchFlagsBatch: (uids: number[]) => Promise<RemoteMessageFlags[]>;
  commit: (plan: FolderReconciliationPlan) => void | Promise<void>;
}

export function assessUidValidity(
  previousUidValidity: string | null,
  currentUidValidity: string,
  hasExistingEntries: boolean,
): 'ready' | 'baseline-needed' | 'uid-validity-changed' {
  if (previousUidValidity && previousUidValidity !== currentUidValidity) {
    return 'uid-validity-changed';
  }
  if (!previousUidValidity && hasExistingEntries) {
    return 'baseline-needed';
  }
  return 'ready';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('folder reconciliation aborted');
  }
}

/**
 * Reconciles one account+folder membership snapshot.
 *
 * No database mutation happens until every requested UID batch has completed.
 * A missing UID therefore means "not present in this folder" only after a
 * complete, UIDVALIDITY-matched scan.
 */
export async function reconcileFolderSnapshot(
  options: ReconcileFolderSnapshotOptions,
): Promise<FolderReconciliationResult> {
  const {
    accountId,
    folder,
    previousUidValidity,
    currentUidValidity,
    fetchFlagsBatch,
    commit,
    signal,
  } = options;
  const batchSize = options.batchSize ?? 100;
  const entries = options.entries.filter(
    (entry) => entry.accountId === accountId && entry.folder === folder,
  );

  throwIfAborted(signal);

  const validityStatus = assessUidValidity(
    previousUidValidity,
    currentUidValidity,
    entries.length > 0,
  );
  if (validityStatus === 'uid-validity-changed') {
    return { status: 'uid-validity-changed', updated: 0, removed: 0 };
  }

  // Existing rows predate UIDVALIDITY tracking. Record a trusted baseline but
  // do not interpret their UIDs until the next sync.
  if (validityStatus === 'baseline-needed') {
    await commit({ flagUpdates: [], removals: [], uidValidity: currentUidValidity });
    return { status: 'baseline-recorded', updated: 0, removed: 0 };
  }

  const found = new Map<number, RemoteMessageFlags>();
  for (let i = 0; i < entries.length; i += batchSize) {
    throwIfAborted(signal);
    const batch = entries.slice(i, i + batchSize);
    const requested = new Set(batch.map((entry) => entry.uid));
    const remote = await fetchFlagsBatch([...requested]);
    for (const flags of remote) {
      if (!requested.has(flags.uid)) {
        throw new Error(`unexpected UID ${flags.uid} while reconciling ${folder}`);
      }
      found.set(flags.uid, flags);
    }
  }

  throwIfAborted(signal);

  const flagUpdates: FolderReconciliationPlan['flagUpdates'] = [];
  const removals: FolderMembershipEntry[] = [];
  for (const entry of entries) {
    const remote = found.get(entry.uid);
    if (!remote) {
      removals.push(entry);
    } else if (remote.isRead !== entry.isRead || remote.isStarred !== entry.isStarred) {
      flagUpdates.push({ ...entry, isRead: remote.isRead, isStarred: remote.isStarred });
    }
  }

  await commit({
    flagUpdates,
    removals,
    uidValidity: previousUidValidity ? undefined : currentUidValidity,
  });
  return { status: 'reconciled', updated: flagUpdates.length, removed: removals.length };
}
