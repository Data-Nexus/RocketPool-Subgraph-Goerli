import { BigInt, Bytes } from '@graphprotocol/graph-ts'
import { rocketRewardsPool, RPLTokensClaimed } from '../../generated/rocketRewardsPool/rocketRewardsPool'
import { rocketStorage } from '../../generated/rocketRewardsPool/rocketStorage'
import { rocketNetworkPrices } from '../../generated/rocketRewardsPool/rocketNetworkprices'
import { RPLRewardClaim, RPLRewardInterval, Node } from '../../generated/schema'
import { generalUtilities } from '../utilities/generalutilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import {
  ONE_ETHER_IN_WEI,
  ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX,
} from '../constants/generalconstants'
import {
  ROCKET_STORAGE_ADDRESS,
  ROCKET_REWARDS_POOL_CONTRACT_NAME,
  ROCKET_NETWORK_PRICES_CONTRACT_NAME,
} from '../constants/contractconstants'
import { rplRewardUtilities } from '../utilities/rplrewardutilities'
/**
 * Occurs when an eligible stakeholder on the protocol claims an RPL reward.
 */
export function handleRPLTokensClaimed(event: RPLTokensClaimed): void {
  if (
    event === null ||
    event.params === null ||
    event.params.claimingAddress == null ||
    event.params.claimingContract == null ||
    event.block === null ||
    event.params.amount == BigInt.fromI32(0)
  )
    return

  // Determine the ID for the new RPL reward claim based on the event.
  // If this was null or the ID has already been indexed; stop.
  let rplRewardClaimId = generalUtilities.extractIdForEntity(event)
  if (
    rplRewardClaimId == null ||
    RPLRewardClaim.load(rplRewardClaimId) !== null
  )
    return

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
    protocol.save()
  }

  // We will need the rocketvault smart contract state to get specific addresses.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS)

  // We will need the rocket rewards pool contract to get its smart contract state.
  let rocketRewardPoolContract = rocketRewardsPool.bind(
    rocketStorageContract.getAddress(
      generalUtilities.getRocketVaultContractAddressKey(ROCKET_REWARDS_POOL_CONTRACT_NAME) 
    ),
  )

  // We need to retrieve the last RPL rewards interval so we can compare it to the current state in the smart contracts.
  let activeIndexedRewardInterval: RPLRewardInterval | null = null
  let lastRPLRewardIntervalId = protocol.lastRPLRewardInterval
  if (lastRPLRewardIntervalId != null) {
    activeIndexedRewardInterval = RPLRewardInterval.load(
      lastRPLRewardIntervalId,
    )
  }

  // Determine claimer type based on the claiming contract and/or claiming address.
  let rplRewardClaimerType:
    | string
    | null = rplRewardUtilities.getRplRewardClaimerType(
    rocketStorageContract,
    event.params.claimingContract,
    event.params.claimingAddress,
  )

  // Something is wrong; the contract associated with this claim couldn't be processed.
  // Maybe this implementation needs to be updated as a result of a contract upgrade of RocketPool.
  if (rplRewardClaimerType == null) return

  // If we don't have an indexed RPL Reward interval,
  // or if the last indexed RPL Reward interval isn't equal to the current one in the smart contracts:
  let smartContractCurrentRewardIntervalStartTime = rocketRewardPoolContract.getClaimIntervalTimeStart()
  if (
    activeIndexedRewardInterval === null ||
    activeIndexedRewardInterval.intervalStartTime !=
      smartContractCurrentRewardIntervalStartTime
  ) {
    // If there was an indexed RPL Reward interval which has a different start time then the interval in the smart contracts.
    if (activeIndexedRewardInterval !== null) {
      // We need to close our indexed RPL Rewards interval.
      activeIndexedRewardInterval.intervalClosedTime = event.block.timestamp;
      activeIndexedRewardInterval.isClosed = true;
      activeIndexedRewardInterval.intervalDurationActual = event.block.timestamp.minus(activeIndexedRewardInterval.intervalStartTime);
      activeIndexedRewardInterval.save();
    }

    // Create a new RPL Reward interval so we can add this first claim to it.
    activeIndexedRewardInterval = rocketPoolEntityFactory.createRPLRewardInterval(
      ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX +
        generalUtilities.extractIdForEntity(event),
      rocketRewardPoolContract.getClaimIntervalRewardsTotal(),
      smartContractCurrentRewardIntervalStartTime,
      rocketRewardPoolContract.getClaimIntervalTime(),
      event.block.number,
      event.block.timestamp,
    )
    protocol.lastRPLRewardInterval = activeIndexedRewardInterval.id
  }

  // We need this to determine the current RPL/ETH price based on the smart contracts.
  // If for some reason this fails, something is horribly wrong and we need to stop indexing.
  let networkPricesContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(ROCKET_NETWORK_PRICES_CONTRACT_NAME) 
  )
  let networkPricesContract = rocketNetworkPrices.bind(
    networkPricesContractAddress,
  )
  let rplETHExchangeRate = networkPricesContract.getRPLPrice()
  let rplRewardETHAmount = BigInt.fromI32(0)
  if (rplETHExchangeRate > BigInt.fromI32(0)) {
    rplRewardETHAmount = event.params.amount
      .times(rplETHExchangeRate)
      .div(ONE_ETHER_IN_WEI)
  }

  // Create a new reward claim.
  let rplRewardClaim = rocketPoolEntityFactory.createRPLRewardClaim(
    rplRewardClaimId,
    event.params.claimingAddress.toHexString(),
    rplRewardClaimerType,
    event.params.amount,
    rplRewardETHAmount,
    event.block.number,
    event.block.timestamp,
  )

  // Index the reward claim.
  rplRewardClaim.save()

  // If the claimer was a (trusted) node, then increment its total claimed rewards.
  let associatedNode = Node.bind(event.params.claimingAddress);
  if(associatedNode !== null) {
    associatedNode.totalClaimedRPLRewards =  associatedNode.totalClaimedRPLRewards.plus(event.params.amount);
  }

  // Update the grand total claimed of the current interval.
  activeIndexedRewardInterval.totalRPLClaimed = activeIndexedRewardInterval.totalRPLClaimed.plus(rplRewardClaim.amount);

   // Add this reward claim to the current interval
  let currentRPLRewardClaims = activeIndexedRewardInterval.rplRewardClaims
  currentRPLRewardClaims.push(rplRewardClaim.id)
  activeIndexedRewardInterval.rplRewardClaims = currentRPLRewardClaims

  // Index changes to the (new) interval and protocol.
  activeIndexedRewardInterval.save()
  protocol.save()
}
