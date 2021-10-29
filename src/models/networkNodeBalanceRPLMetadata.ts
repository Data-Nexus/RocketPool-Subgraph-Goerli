import { BigInt } from '@graphprotocol/graph-ts'

/**
 * Everything that is needed to calculate the network summaries (e.g. average) regarding RPL for a network node balance checkpoint.
 */
export class NetworkNodeBalanceRPLMetadata {
  totalNodesWithAnNodeRewardClaim: BigInt
  totalNodesWithAnODAORewardClaim: BigInt

  constructor() {
    this.totalNodesWithAnNodeRewardClaim = BigInt.fromI32(0)
    this.totalNodesWithAnODAORewardClaim = BigInt.fromI32(0)
  }
}
