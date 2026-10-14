export type ProjectStatus = "new" | "working" | "done" | "error";

export type UserRole = "user" | "admin";

export type Viewer = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  balanceRub: number;
};

export type ProjectView = {
  id: string;
  title: string;
  status: ProjectStatus;
  updatedText: string;
  description: string;
  columns: string;
  projectPriceRub: number;
  pricePending?: boolean;
  oldProjectPriceRub?: number | null;
  pricePromoMessage?: string | null;
  priceHint?: string | null;
  priceHintDetails?: string[];
  resultFile?: string;
  errorMessage?: string | null;
  statusHistory: string[];
  ownerId?: string;
  ownerName?: string;
  ownerEmail?: string;
  hasOwnerConsent?: boolean;
  pipelineJobId?: string | null;
  pipelineJobStatus?: string | null;
  pipelineProgressPercent?: number | null;
  pipelineProcessedSites?: number | null;
  pipelineTotalSites?: number | null;
  pipelineEtaSeconds?: number | null;
  pipelineCurrentSiteUrl?: string | null;
};

export type ProjectDebugLogView = {
  id: number;
  level: string;
  service: string;
  message: string;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type FinanceOperationView = {
  id: string;
  type: "Пополнение" | "Списание";
  amount: string;
  date: string;
  note: string;
};

export type PromoCodeView = {
  id: string;
  code: string;
  amountRub: number;
  maxActivations: number;
  usedActivations: number;
  expiresAt: string | null;
  expiresTimeZone: string | null;
  expiresDisplay: string;
  totalCreditedRub: number;
  lastActivatedAt?: string | null;
  isActive: boolean;
};

export type SystemWorkerView = {
  workerId: string;
  workerRole: string;
  status: "busy" | "idle" | "unknown";
  currentJobId?: string | null;
  projectId?: string | null;
  projectTitle?: string | null;
  message?: string | null;
  queueDepth?: number | null;
  host?: string | null;
  updatedAt: string;
};

export type SystemWorkersSnapshot = {
  updatedAt: string;
  workersTotal: number;
  workersBusy: number;
  workersIdle: number;
  queueSize: number;
  queueDepths: Record<string, number>;
  workers: SystemWorkerView[];
  backendAvailable: boolean;
};
