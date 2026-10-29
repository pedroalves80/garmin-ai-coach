export type AutoSyncStatus = {
  enabled: boolean;
  workerOnline: boolean;
  nextRunAt: string | null;
  failures: number;
  lastError: string | null;
};
export type GarminStatus = {
  configured: boolean;
  running: boolean;
  lastSync: string | null;
  lastError: string | null;
  automatic: AutoSyncStatus;
};
