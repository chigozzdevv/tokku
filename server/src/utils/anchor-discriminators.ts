import { sha256 } from '@noble/hashes/sha2.js';

export function getAnchorDiscriminator(instructionName: string): Buffer {
  const hash = sha256(Buffer.from(`global:${instructionName}`));
  return Buffer.from(hash.slice(0, 8));
}

export const DISCRIMINATORS = {
  OPEN_ROUND: getAnchorDiscriminator('open_round'),
  PLACE_BET: getAnchorDiscriminator('place_bet'),
  LOCK_ROUND: getAnchorDiscriminator('lock_round'),
  SETTLE_BET: getAnchorDiscriminator('settle_bet'),
  SETTLE_ROUND: getAnchorDiscriminator('settle_round'),
  COMMIT_OUTCOME_HASH: getAnchorDiscriminator('commit_outcome_hash'),
  REVEAL_OUTCOME_NUMERIC: getAnchorDiscriminator('reveal_outcome_numeric'),
  REVEAL_OUTCOME_SHAPE: getAnchorDiscriminator('reveal_outcome_shape'),
  REVEAL_OUTCOME_PATTERN: getAnchorDiscriminator('reveal_outcome_pattern'),
  REVEAL_OUTCOME_ENTROPY: getAnchorDiscriminator('reveal_outcome_entropy'),
  REVEAL_OUTCOME_COMMUNITY: getAnchorDiscriminator('reveal_outcome_community'),
  REQUEST_RANDOMNESS: getAnchorDiscriminator('request_randomness'),
  ER_REVEAL_OUTCOME_NUMERIC: getAnchorDiscriminator('er_reveal_outcome_numeric'),
  ER_REVEAL_OUTCOME_SHAPE: getAnchorDiscriminator('er_reveal_outcome_shape'),
  ER_REVEAL_OUTCOME_PATTERN: getAnchorDiscriminator('er_reveal_outcome_pattern'),
  ER_REVEAL_OUTCOME_ENTROPY: getAnchorDiscriminator('er_reveal_outcome_entropy'),
  ER_REVEAL_OUTCOME_COMMUNITY: getAnchorDiscriminator('er_reveal_outcome_community'),
  DELEGATE_ROUND: getAnchorDiscriminator('delegate_round'),
  COMMIT_ROUND: getAnchorDiscriminator('commit_round'),
  COMMIT_AND_UNDELEGATE_ROUND: getAnchorDiscriminator('commit_and_undelegate_round'),
  SET_HOUSE_EDGE_BPS: getAnchorDiscriminator('set_house_edge_bps'),
  INITIALIZE_MARKET: getAnchorDiscriminator('initialize_market'),
};
