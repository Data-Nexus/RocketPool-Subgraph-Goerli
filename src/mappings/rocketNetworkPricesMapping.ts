import { PricesUpdated } from '../../generated/rocketNetworkPrices/rocketNetworkPrices'
import { rocketNetworkFees } from '../../generated/rocketNetworkPrices/rocketNetworkFees'
import { rocketStorage } from '../../generated/rocketNetworkPrices/rocketStorage'
import { rocketDAOProtocolSettingsMinipool } from '../../generated/rocketNetworkPrices/rocketDAOProtocolSettingsMinipool'
import { rocketDAOProtocolSettingsNode } from '../../generated/rocketNetworkPrices/rocketDAOProtocolSettingsNode'
import { rocketMinipoolManager } from '../../generated/rocketNetworkPrices/rocketMinipoolManager'
import {
  Node,
  NetworkStakerBalanceCheckpoint,
  NetworkNodeBalanceCheckpoint,
} from '../../generated/schema'
import { generalUtilities } from '../utilities/generalUtilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import {
  ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL,
  ROCKET_DAO_PROTOCOL_SETTINGS_NODE,
  ROCKET_MINIPOOL_MANAGER_CONTRACT_NAME,
  ROCKET_NETWORK_FEES_CONTRACT_NAME,
  ROCKET_STORAGE_ADDRESS,
} from './../constants/contractconstants'
import { BigInt } from '@graphprotocol/graph-ts'
import {
  nodeUtilities,
  RPLMinipoolCollateralBounds,
} from '../utilities/nodeutilities'
import { ONE_ETHER_IN_WEI } from '../constants/generalconstants'

// !!WIP!!

/**
 * Occurs when enough ODAO members votes on a price and a consensus threshold is reached.
 */
export function handlePricesUpdated(event: PricesUpdated): void {
  // Preliminary check to ensure we haven't handled this before.
  if (nodeUtilities.hasNetworkNodeBalanceCheckpointHasBeenIndexed(event)) return

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
  }
  if (protocol === null) return

  // Define the rocket storage contract, we are going to need it to query the current smart contract state.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS)

  // Determine the fee for a new minipool.
  let nodeFeeForNewMinipool = getNewMinipoolFee(rocketStorageContract)

  // Determine the RPL minimum and maximum for a new minipool.
  let rplCollateralBoundsForNewMinipool = getRPLCollateralBoundsForNewMinipool(
    event.params.rplPrice,
    rocketStorageContract,
  )

  // Create a new network node balance checkpoint.
  let checkpoint = rocketPoolEntityFactory.createNetworkNodeBalanceCheckpoint(
    generalUtilities.extractIdForEntity(event),
    protocol.lastNetworkNodeBalanceCheckPoint,
    event.params.rplPrice,
    rplCollateralBoundsForNewMinipool.minimumRPLRequired,
    rplCollateralBoundsForNewMinipool.maximumRPLRequired,
    nodeFeeForNewMinipool,
    event.block.number,
    event.block.timestamp,
  )
  if (checkpoint === null) return

  // Retrieve the previous network node checkpoint & store some of the running totals it holds for later.
  let previousCheckpoint: NetworkNodeBalanceCheckpoint | null = null
  let totalRPLSlashedRPLUpToThisCheckpoint = BigInt.fromI32(0)
  let totalClaimedRPLRewardsUpToThisCheckpoint = BigInt.fromI32(0)
  let totalFinalizedMinipoolsUpToThisCheckpoint = BigInt.fromI32(0)
  let previousCheckpointId = protocol.lastNetworkNodeBalanceCheckPoint
  if (previousCheckpointId != null) {
    previousCheckpoint = NetworkNodeBalanceCheckpoint.load(<string>previousCheckpointId)
    if(previousCheckpoint !== null) {
      totalRPLSlashedRPLUpToThisCheckpoint = previousCheckpoint.totalRPLSlashed
      totalClaimedRPLRewardsUpToThisCheckpoint =
        previousCheckpoint.totalClaimedRPLRewards
      totalFinalizedMinipoolsUpToThisCheckpoint =
        previousCheckpoint.totalFinalizedMinipools
      previousCheckpoint.nextCheckpointId = checkpoint.id
    }
  }

  // Handle the node impact.
  checkpoint.averageFeeForActiveMinipools = generateNodeBalanceCheckpoints(
    protocol.nodes,
    checkpoint,
    event.block.number,
    event.block.timestamp,
  )

  // If for some reason our total claimed RPL rewards up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
  if (
    checkpoint.totalClaimedRPLRewards == BigInt.fromI32(0) &&
    totalClaimedRPLRewardsUpToThisCheckpoint > BigInt.fromI32(0)
  ) {
    checkpoint.totalClaimedRPLRewards = totalClaimedRPLRewardsUpToThisCheckpoint
  }

  // If for some reason our total slashed RPL rewards up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
  if (
    checkpoint.totalRPLSlashed == BigInt.fromI32(0) &&
    totalRPLSlashedRPLUpToThisCheckpoint > BigInt.fromI32(0)
  ) {
    checkpoint.totalRPLSlashed = totalRPLSlashedRPLUpToThisCheckpoint
  }

  // If for some reason our total finalized minipools up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
  if (
    checkpoint.totalFinalizedMinipools == BigInt.fromI32(0) &&
    totalFinalizedMinipoolsUpToThisCheckpoint > BigInt.fromI32(0)
  ) {
    checkpoint.totalFinalizedMinipools = totalFinalizedMinipoolsUpToThisCheckpoint
  }

  // Update the link so the protocol points to the last network node balance checkpoint.
  protocol.lastNetworkNodeBalanceCheckPoint = checkpoint.id

  // TODO: Calculate total RPL needed to min/max collateralize network at this checkpoint.

  // Index these changes.
  checkpoint.save()
  if (previousCheckpoint !== null) previousCheckpoint.save()
  protocol.save()
}

/**
 * Loops through all nodes of the protocol.
 * Create a NodeBalanceCheckpoint
 * Return the average minipool fee for all active minipools accross all nodes.
 */
function generateNodeBalanceCheckpoints(
  nodeIds: Array<string>,
  networkCheckpoint: NetworkNodeBalanceCheckpoint,
  blockNumber: BigInt,
  blockTime: BigInt,
): BigInt {
  // Define return variable.
  let averageNetworkFeeForActiveMinipools = BigInt.fromI32(0)

  // If we don't have any registered nodes at this time, stop.
  if (nodeIds.length === 0) {
    return averageNetworkFeeForActiveMinipools
  }

  let totalFeeInEtherAccrossAllActiveMinipools = BigInt.fromI32(0)
  let totalNodesThatHadAnAverageFeeForActiveMinipools = BigInt.fromI32(0)

  // Loop through all the node id's in the protocol.
  for (let index = 0; index < nodeIds.length; index++) {
    // Determine current node ID.
    let nodeId = <string>nodeIds[index]
    if (nodeId == null) continue

    // Load the indexed node.
    let node = Node.load(nodeId)
    if (node === null) continue

    // Keep track of this so we can calculate the average on the network level later.
    if (node.averageFeeForActiveMinipools > BigInt.fromI32(0)) {
      totalFeeInEtherAccrossAllActiveMinipools = totalFeeInEtherAccrossAllActiveMinipools.plus(
        node.averageFeeForActiveMinipools.div(ONE_ETHER_IN_WEI),
      )
      totalNodesThatHadAnAverageFeeForActiveMinipools = totalNodesThatHadAnAverageFeeForActiveMinipools.plus(
        BigInt.fromI32(1),
      )
    }

    // Create a new node balance checkpoint
    let nodeBalanceCheckpoint = rocketPoolEntityFactory.createNodeBalanceCheckpoint(
      networkCheckpoint.id + ' - ' + node.id,
      networkCheckpoint.id,
      node,
      blockNumber,
      blockTime,
    )
    if (nodeBalanceCheckpoint == null) continue
    node.lastNodeBalanceCheckpoint = nodeBalanceCheckpoint.id

    // Index both the updated node & the new node balance checkpoint.
    nodeBalanceCheckpoint.save()
    node.save()
  }

  // Calculate the network fee average for active minipools if possible.
  if (
    totalNodesThatHadAnAverageFeeForActiveMinipools > BigInt.fromI32(0) &&
    totalFeeInEtherAccrossAllActiveMinipools > BigInt.fromI32(0)
  ) {
    // Return it in WEI.
    averageNetworkFeeForActiveMinipools = totalFeeInEtherAccrossAllActiveMinipools
      .div(totalNodesThatHadAnAverageFeeForActiveMinipools)
      .times(ONE_ETHER_IN_WEI)
  }

  return averageNetworkFeeForActiveMinipools
}

/**
 * Returns the minimum and maximum RPL needed to collateralize a new minipool based on the current smart contract state.
 */
function getRPLCollateralBoundsForNewMinipool(
  rplPrice: BigInt,
  rocketStorageContract: rocketStorage,
): RPLMinipoolCollateralBounds {
  let result = new RPLMinipoolCollateralBounds()

  // Get the DAO Protocol settings minipool contract instance.
  let rocketDAOProtocolSettingsMinipoolContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL,
    ),
  )
  let rocketDAOProtocolSettingsMinipoolContract = rocketDAOProtocolSettingsMinipool.bind(
    rocketDAOProtocolSettingsMinipoolContractAddress,
  )
  if (rocketDAOProtocolSettingsMinipoolContract === null) return result

  // Get the DAO Protocol settings node contract instance.
  let rocketDAOProtocolSettingsNodeAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_DAO_PROTOCOL_SETTINGS_NODE,
    ),
  )
  let rocketDAOProtocolSettingsNodeContract = rocketDAOProtocolSettingsNode.bind(
    rocketDAOProtocolSettingsNodeAddress,
  )
  if (rocketDAOProtocolSettingsNodeContract === null) return result

  // Get the Rocket Minipool manager contract instance.
  let rocketMinipoolManagerAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_MINIPOOL_MANAGER_CONTRACT_NAME,
    ),
  )
  let rocketMinipoolManagerContract = rocketMinipoolManager.bind(
    rocketMinipoolManagerAddress,
  )
  if (rocketMinipoolManagerContract === null) return result

  // What is the current deposit amount a node operator has to deposit to start a minipool?
  let halfDepositAmount = rocketDAOProtocolSettingsMinipoolContract.getHalfDepositNodeAmount()

  // Determine the minimum and maximum RPL a minipool needs to be collateralized.
  result.minimumRPLRequired = nodeUtilities.getMinimumRPLForNewMinipool(
    halfDepositAmount,
    rocketDAOProtocolSettingsNodeContract.getMinimumPerMinipoolStake(),
    rplPrice,
  )
  result.maximumRPLRequired = nodeUtilities.getMaximumRPLForNewMinipool(
    halfDepositAmount,
    rocketDAOProtocolSettingsNodeContract.getMaximumPerMinipoolStake(),
    rplPrice,
  )

  return result
}

/**
 * Gets the new minipool fee form the smart contract state.
 */
function getNewMinipoolFee(rocketStorageContract: rocketStorage): BigInt {
  // Get the network fees contract instance.
  let networkFeesContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_NETWORK_FEES_CONTRACT_NAME,
    ),
  )
  let networkFeesContract = rocketNetworkFees.bind(networkFeesContractAddress)
  if (networkFeesContract === null) return BigInt.fromI32(0)

  return networkFeesContract.getNodeFee()
}
