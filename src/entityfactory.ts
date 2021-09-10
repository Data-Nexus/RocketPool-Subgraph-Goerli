import { ethereum, BigInt } from '@graphprotocol/graph-ts'
import { Staker, RocketETHTransaction } from '../generated/schema'

class RocketPoolEntityFactory {
  /**
   * Attempts to create a new RocketETHTransaction.
   */
  public createRocketETHTransaction(
    id: string,
    from: Staker,
    to: Staker,
    amount: BigInt,
    event: ethereum.Event,
  ): RocketETHTransaction {
    if (id === null || from === null || to === null) return

    // Instantiate a new transaction.
    const rocketETHTransaction = new RocketETHTransaction(id)
    rocketETHTransaction.from = from.id
    rocketETHTransaction.amount = amount
    rocketETHTransaction.to = to.id
    rocketETHTransaction.block = event.block.number
    rocketETHTransaction.blockTime = event.block.timestamp
    rocketETHTransaction.transactionHash = event.transaction.hash

    // Return our new transaction.
    return rocketETHTransaction
  }

  /**
   * Attempts to create a new Staker.
   */
  public createStaker(
    id: string,
    blockNumber: BigInt,
    blockTime: BigInt,
  ): Staker {
    if (id === null) return

    // Instantiate a new staker.
    const staker = new Staker(id)
    staker.block = blockNumber
    staker.blockTime = blockTime

    // Return our new Staker.
    return staker
  }
}

export const rocketPoolEntityFactory = new RocketPoolEntityFactory()
