import { createQueue } from '../queue-config';

export interface RevealOutcomeJobData {
  roundId: string;
}

export interface LockRoundJobData {
  roundId: string;
}

export interface UndelegateRoundJobData {
  roundId: string;
}

export const roundLifecycleQueue = createQueue('round-lifecycle');
