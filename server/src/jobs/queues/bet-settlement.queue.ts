import { createQueue } from '../queue-config';

export interface SettleBetsJobData {
  roundId: string;
}

export const betSettlementQueue = createQueue('bet-settlement');
