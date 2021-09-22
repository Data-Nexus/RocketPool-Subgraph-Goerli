import { BalancesUpdated } from '../../generated/rocketNetworkBalances/rocketNetworkBalances'
import { Staker, NetworkStakerBalanceCheckpoint } from '../../generated/schema'
import { rocketTokenRETH } from '../../generated/rocketNetworkBalances/rocketTokenRETH'
import { rocketDepositPool } from '../../generated/rocketNetworkBalances/rocketDepositPool'
import { generalUtilities } from '../utilities/generalUtilities'
import { stakerUtilities } from '../utilities/stakerutilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import {
  ZERO_ADDRESS_STRING,
  ROCKET_STORAGE_ADDRESS,
  ROCKET_DEPOSIT_POOL_CONTRACT_NAME,
  ROCKET_TOKEN_RETH_CONTRACT_NAME,
} from './../constants/contractconstants'
import { BigInt } from '@graphprotocol/graph-ts'
import { rocketStorage } from '../../generated/rocketRewardsPool/rocketStorage'

/**
 * Occurs when enough ODAO members votes on a balance and a consensus threshold is reached.
 */
export function handleBalancesUpdated(event: BalancesUpdated): void {
  // Preliminary check to ensure we haven't handled this before.
  if (stakerUtilities.hasNetworkStakerBalanceCheckpointHasBeenIndexed(event))
    return


  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
  }
  if(protocol === null) return;

  // Load the RocketTokenRETH contract via the rocketstorage.
  // We will need the rocketvault smart contract state to get specific addresses.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);
  let rETHContractAddress = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_TOKEN_RETH_CONTRACT_NAME))
  let rETHContract = rocketTokenRETH.bind(rETHContractAddress)
  if (rETHContract === null) return
  
  // Load the rocketDepositPool contract
  let rocketDepositPoolContractAddress = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_DEPOSIT_POOL_CONTRACT_NAME)) 
  let rocketDepositPoolContract = rocketDepositPool.bind(rocketDepositPoolContractAddress)
  if (rocketDepositPoolContract === null) return

  // How much is the total staker ETH balance in the deposit pool?
  let depositPoolBalance = rocketDepositPoolContract.getBalance()
  let depositPoolExcessBalance = rocketDepositPoolContract.getExcessBalance()

  // The RocketEth contract balance is equal to the total collateral - the excess deposit pool balance.
  let stakerETHInRocketETHContract = generalUtilities.getRocketETHBalance(
    depositPoolExcessBalance,
    rETHContract.getTotalCollateral(),
  )

  // Attempt to create a new network balance checkpoint.
  let rETHExchangeRate = rETHContract.getExchangeRate()
  let checkpoint = rocketPoolEntityFactory.createNetworkStakerBalanceCheckpoint(
    generalUtilities.extractIdForEntity(event),
    event,
    depositPoolBalance,
    stakerETHInRocketETHContract,
    rETHExchangeRate,
  )
  if (checkpoint === null) return

  // Retrieve previous checkpoint.
  let previousCheckpointId = protocol.lastNetworkStakerBalanceCheckPoint
  let previousTotalStakerETHRewards = BigInt.fromI32(0)
  let previousTotalStakersWithETHRewards = BigInt.fromI32(0)
  let previousRETHExchangeRate = BigInt.fromI32(1)
  if (previousCheckpointId != null) {
    let previousCheckpoint = NetworkStakerBalanceCheckpoint.load(
      <string>previousCheckpointId,
    )
    if (previousCheckpoint !== null) {
      previousTotalStakerETHRewards = previousCheckpoint.totalStakerETHRewards
      previousTotalStakersWithETHRewards = previousCheckpoint.totalStakersWithETHRewards;
      previousRETHExchangeRate = previousCheckpoint.rETHExchangeRate
    }
  }

  // Handle the staker impact.
  generateStakerBalanceCheckpoints(
    protocol.stakers,
    checkpoint,
    previousRETHExchangeRate,
    event.block.number,
    event.block.timestamp,
  )

  // If for some reason the running summary totals up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
  if (checkpoint.totalStakerETHRewards == BigInt.fromI32(0)) {
    checkpoint.totalStakerETHRewards = previousTotalStakerETHRewards
  }
  if (checkpoint.totalStakersWithETHRewards == BigInt.fromI32(0)) {
    checkpoint.totalStakersWithETHRewards = previousTotalStakersWithETHRewards;
  }

  // Calculate average staker reward up to this checkpoint.
  if (
    checkpoint.totalStakerETHRewards != BigInt.fromI32(0) &&
    checkpoint.totalStakersWithETHRewards >= BigInt.fromI32(1)
  ) {
    checkpoint.averageStakerETHRewards = checkpoint.totalStakerETHRewards.div(
      checkpoint.totalStakersWithETHRewards,
    )
  }
  
  // Update the link so the protocol points to the last network staker balance checkpoint.
  protocol.lastNetworkStakerBalanceCheckPoint = checkpoint.id

  // Index these changes.
  checkpoint.save()
  protocol.save()
}

/**
 * Loops through all stakers of the protocol.
 * If an active rETH balance is found..
 * Create a StakerBalanceCheckpoint
 */
function generateStakerBalanceCheckpoints(
  stakerIds: Array<string>,
  networkCheckpoint: NetworkStakerBalanceCheckpoint,
  previousRETHExchangeRate: BigInt,
  blockNumber: BigInt,
  blockTime: BigInt,
): void {
  // If we don't have any stakers, stop.
  if (stakerIds.length === 0) {
    return
  }

  // Loop through all the staker id's in the protocol.
  for (let index = 0; index < stakerIds.length; index++) {
    // Determine current staker ID.
    let stakerId = <string>stakerIds[index]
    if (stakerId == null || stakerId == ZERO_ADDRESS_STRING) continue

    // Load the indexed staker.
    let staker = Staker.load(stakerId)
    if (staker === null) continue
    if (staker.rETHBalance == BigInt.fromI32(0)) {
      // Stakers with 0 rETH don't get new staker balance checkpoint(s)
      // But their rewards are accounted for in the total(s) of the current network checkpoint.
      stakerUtilities.updateNetworkStakerBalanceCheckpoint(
        networkCheckpoint,
        staker,
      )

      // Only generate a staker balance checkpoint if the staker still has an rETH balance.
      continue
    }

    // Get the current & previous balances for this staker and update the staker balance for the current exchange rate.
    let stakerBalance = stakerUtilities.getStakerBalance(
      staker,
      networkCheckpoint.rETHExchangeRate,
    )
    staker.ethBalance = stakerBalance.currentETHBalance

    // Calculate rewards (+/-) for this staker since the previous checkpoint.
    let ethRewardsSincePreviousCheckpoint = stakerUtilities.getETHRewardsSincePreviousStakerBalanceCheckpoint(
      stakerBalance.currentRETHBalance,
      stakerBalance.currentETHBalance,
      stakerBalance.previousRETHBalance,
      stakerBalance.previousETHBalance,
      previousRETHExchangeRate,
      networkCheckpoint.rETHExchangeRate,
    )
    stakerUtilities.handleEthRewardsSincePreviousCheckpoint(
      ethRewardsSincePreviousCheckpoint,
      staker,
      networkCheckpoint,
    )

    // Create a new staker balance checkpoint
    let stakerBalanceCheckpoint = rocketPoolEntityFactory.createStakerBalanceCheckpoint(
      networkCheckpoint.id + ' - ' + stakerId,
      staker,
      networkCheckpoint,
      stakerBalance.currentETHBalance,
      stakerBalance.currentRETHBalance,
      staker.totalETHRewards,
      blockNumber,
      blockTime,
    )
    if (stakerBalanceCheckpoint == null) continue
    staker.lastBalanceCheckpoint = stakerBalanceCheckpoint.id

    // Index both the updated staker & the new staker balance checkpoint.   
    stakerBalanceCheckpoint.save()
    staker.save()
  }
}

