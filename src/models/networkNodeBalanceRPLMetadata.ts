import { BigInt } from '@graphprotocol/graph-ts'

/**
 * Everything that is needed to calculate the network summaries (e.g. average) regarding RPL for a network node balance checkpoint.
 */
export class NetworkNodeBalanceRPLMetadata {
  totalNodesWithClaimedRPLRewards: BigInt

  constructor() {
    this.totalNodesWithClaimedRPLRewards = BigInt.fromI32(0)
  }
}
