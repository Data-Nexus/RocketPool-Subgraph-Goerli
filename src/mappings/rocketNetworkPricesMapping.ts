import { PricesUpdated } from '../../generated/rocketNetworkPrices/rocketNetworkPrices'
import { rocketNetworkFees } from '../../generated/rocketNetworkPrices/rocketNetworkFees'
import { rocketDAOProtocolSettingsMinipool } from '../../generated/rocketNetworkPrices/rocketDAOProtocolSettingsMinipool'
import { rocketDAOProtocolSettingsNode } from '../../generated/rocketNetworkPrices/rocketDAOProtocolSettingsNode'
import { rocketNodeStaking } from '../../generated/rocketNetworkPrices/rocketNodeStaking'
import {
  Node,
  NetworkNodeBalanceCheckpoint,
  RocketPoolProtocol,
} from '../../generated/schema'
import { generalUtilities } from '../utilities/generalUtilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import { NetworkNodeBalanceMetadata } from '../models/networkNodeBalanceMetadata'
import {
  ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL_CONTRACT_ADDRESS,
  ROCKET_DAO_PROTOCOL_SETTINGS_NODE_CONTRACT_ADDRESS,
  ROCKET_NETWORK_FEES_CONTRACT_ADDRESS,
  ROCKET_NODE_STAKING_CONTRACT_ADDRESS,
} from './../constants/contractconstants'
import { BigInt, Address, BigDecimal } from '@graphprotocol/graph-ts'
import { nodeUtilities } from '../utilities/nodeutilities'
import { EffectiveMinipoolRPLBounds } from '../models/effectiveMinipoolRPLBounds'
import { ONE_ETHER_IN_WEI } from '../constants/generalconstants'

/**
 * When enough ODAO members submitted their votes and a consensus threshold is reached, a new RPL price is comitted to the smart contracts.
 */
export function handlePricesUpdated(event: PricesUpdated): void {
  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
  }
  if (protocol === null) return

  // Preliminary check to ensure we haven't handled this before.
  if (
    nodeUtilities.hasNetworkNodeBalanceCheckpointHasBeenIndexed(protocol, event)
  )
    return

  // Determine the fee for a new minipool.
  let networkFeesContract = rocketNetworkFees.bind(
    Address.fromString(ROCKET_NETWORK_FEES_CONTRACT_ADDRESS),
  )
  let nodeFeeForNewMinipool = networkFeesContract.getNodeFee()

  // Determine the RPL minimum and maximum for a new minipool.
  let effectiveRPLBoundsNewMinipool = getEffectiveMinipoolRPLBounds(
    event.params.rplPrice,
  )

  // Create a new network node balance checkpoint.
  let checkpoint = rocketPoolEntityFactory.createNetworkNodeBalanceCheckpoint(
    generalUtilities.extractIdForEntity(event),
    protocol.lastNetworkNodeBalanceCheckPoint,
    effectiveRPLBoundsNewMinipool.minimum,
    effectiveRPLBoundsNewMinipool.maximum,
    event.params.rplPrice,
    nodeFeeForNewMinipool,
    event.block.number,
    event.block.timestamp,
  )
  if (checkpoint === null) return

  // Retrieve the previous network node checkpoint & store some of the running totals it holds for later.
  let previousCheckpoint: NetworkNodeBalanceCheckpoint | null = null
  let previousCheckpointId = protocol.lastNetworkNodeBalanceCheckPoint
  if (previousCheckpointId != null) {
    previousCheckpoint = NetworkNodeBalanceCheckpoint.load(
      <string>previousCheckpointId,
    )
    if (previousCheckpoint !== null) {
      previousCheckpoint.nextCheckpointId = checkpoint.id
    }
  }

  // Handle the node impact.
  let metadata = generateNodeBalanceCheckpoints(
    protocol.nodes,
    <NetworkNodeBalanceCheckpoint>checkpoint,
    event.block.number,
    event.block.timestamp,
  )

  // Some of the running totals should be set to the ones from the previous checkpoint if they are 0 after generating the individual node balance checkpoints.
  nodeUtilities.coerceRunningTotalsBasedOnPreviousCheckpoint(
    <NetworkNodeBalanceCheckpoint>checkpoint,
    previousCheckpoint,
  )

  // Update certain totals/averages based on minipool metadata.
  nodeUtilities.updateNetworkNodeBalanceCheckpointForMinipoolMetadata(
    <NetworkNodeBalanceCheckpoint>checkpoint,
    metadata.minipoolMetadata,
  )
  nodeUtilities.updateNetworkNodeBalanceCheckpointForRPLMetadata(
    <NetworkNodeBalanceCheckpoint>checkpoint,
    metadata.rplMetadata,
  )

  // Determine the average RPL/ETH ratio for the current network node balance checkpoint.
  setAverageRplEthRatio(protocol, checkpoint);

  // Update the link so the protocol points to the last network node balance checkpoint.
  protocol.lastNetworkNodeBalanceCheckPoint = checkpoint.id

  // Add the new network node balance checkpoint to the protocol collection.
  let nodeBalanceCheckpoints = protocol.networkNodeBalanceCheckpoints
  if (nodeBalanceCheckpoints.indexOf(checkpoint.id) == -1)
    nodeBalanceCheckpoints.push(checkpoint.id)
  protocol.networkNodeBalanceCheckpoints = nodeBalanceCheckpoints

  // Index these changes.
  checkpoint.save()
  if (previousCheckpoint !== null) previousCheckpoint.save()
  protocol.save()
}

/**
 * Loops through all nodes of the protocol.
 * Create a NodeBalanceCheckpoint
 */
function generateNodeBalanceCheckpoints(
  nodeIds: Array<string>,
  networkCheckpoint: NetworkNodeBalanceCheckpoint,
  blockNumber: BigInt,
  blockTime: BigInt,
): NetworkNodeBalanceMetadata {
  let networkMetadata = new NetworkNodeBalanceMetadata()

  // If we don't have any registered nodes at this time, stop.
  if (nodeIds.length === 0) return networkMetadata

  // We will need the rocket node staking contract to get some latest state for the associated node.
  let rocketNodeStakingContract = rocketNodeStaking.bind(
    Address.fromString(ROCKET_NODE_STAKING_CONTRACT_ADDRESS),
  )

  // Loop through all the node id's in the protocol.
  for (let index = 0; index < nodeIds.length; index++) {
    // Determine current node ID.
    let nodeId = <string>nodeIds[index]
    if (nodeId == null) continue

    // Load the indexed node.
    let node = Node.load(nodeId)
    if (node === null) continue

    // We'll need this to pass to the rocketnodestaking contract.
    let nodeAddress = Address.fromString(node.id)

    // Update the node state that is affected by the update in RPL/ETH price.
    node.effectiveRPLStaked = rocketNodeStakingContract.getNodeEffectiveRPLStake(
      nodeAddress,
    )
    node.minimumEffectiveRPL = rocketNodeStakingContract.getNodeMinimumRPLStake(
      nodeAddress,
    )
    node.maximumEffectiveRPL = rocketNodeStakingContract.getNodeMaximumRPLStake(
      nodeAddress,
    )

    // Update network balance(s) based on this node.
    nodeUtilities.updateNetworkNodeBalanceCheckpointForNode(
      networkCheckpoint,
      <Node>node,
    )

    // We need this to calculate the min/max effective RPL needed for the network.
    nodeUtilities.updateMinipoolMetadataWithNode(
      networkMetadata.minipoolMetadata,
      <Node>node,
    )

    // We need this to calculate the average RPL claimed rewards on the network level.
    nodeUtilities.updateRPLMetadataWithNode(
      networkMetadata.rplMetadata,
      <Node>node,
    )

    // Create a new node balance checkpoint
    let nodeBalanceCheckpoint = rocketPoolEntityFactory.createNodeBalanceCheckpoint(
      networkCheckpoint.id + ' - ' + node.id,
      networkCheckpoint.id,
      <Node>node,
      blockNumber,
      blockTime,
    )
    if (nodeBalanceCheckpoint == null) continue
    node.lastNodeBalanceCheckpoint = nodeBalanceCheckpoint.id

    // Index both the updated node & the new node balance checkpoint.
    nodeBalanceCheckpoint.save()
    node.save()
  }

  return networkMetadata
}

/**
 * Loops through all network node balance checkpoints and determines the new average RPL price.
 */
function setAverageRplEthRatio(
  protocol: RocketPoolProtocol,
  currentCheckpoint: NetworkNodeBalanceCheckpoint,
): void {
  // Preliminary null checks.
  if (
    protocol === null ||
    currentCheckpoint === null ||
    currentCheckpoint.rplPriceInETH == BigInt.fromI32(0)
  )
    return

  // We will use this to calculate the average RPL/ETH price accross all the network node balance checkpoints.
  let totalRplPriceInEth = BigDecimal.fromString('0')
  let totalCheckpointsWithAnRplPriceInETH = BigDecimal.fromString('0')

  // Loop through all of the node balance checkpoints up until this time.
  for (
    let index = 0;
    index < protocol.networkNodeBalanceCheckpoints.length;
    index++
  ) {
    // Determine current network node balance checkpoint ID.
    let networkNodeBalanceCheckpointId = <string>(
      protocol.networkNodeBalanceCheckpoints[index]
    )
    if (networkNodeBalanceCheckpointId == null) continue

    // Load the indexed network node balance checkpoint.
    let activeIterationCheckpoint = NetworkNodeBalanceCheckpoint.load(
      networkNodeBalanceCheckpointId,
    )
    if (
      activeIterationCheckpoint === null ||
      activeIterationCheckpoint.rplPriceInETH == BigInt.fromI32(0)
    )
      continue

    // Increment running totals.
    totalCheckpointsWithAnRplPriceInETH = totalCheckpointsWithAnRplPriceInETH.plus(
      BigDecimal.fromString('1'),
    )
    totalRplPriceInEth = totalRplPriceInEth.plus(
      activeIterationCheckpoint.rplPriceInETH.divDecimal(BigDecimal.fromString(ONE_ETHER_IN_WEI.toString())),
    )
  }

  // Calculate the average rpl/eth price for the current node network balance checkpoint.
  if (
    totalRplPriceInEth > BigDecimal.fromString('0') &&
    totalCheckpointsWithAnRplPriceInETH > BigDecimal.fromString('0')
  ) {
    currentCheckpoint.averageRplPriceInETH = BigInt.fromString(totalRplPriceInEth.div(
      totalCheckpointsWithAnRplPriceInETH,
    ).times(BigDecimal.fromString(ONE_ETHER_IN_WEI.toString())).truncate(0).toString())
  } else {
    /*
     If we didn't succeed in determining the average rpl/eth price from the history,
     then our average price is the current one.
    */
    currentCheckpoint.averageRplPriceInETH = currentCheckpoint.rplPriceInETH
  }
}

/**
 * Returns the minimum and maximum RPL needed to collateralize a new minipool based on the current smart contract state.
 */
function getEffectiveMinipoolRPLBounds(
  rplPrice: BigInt,
): EffectiveMinipoolRPLBounds {
  let effectiveRPLBounds = new EffectiveMinipoolRPLBounds()

  // Get the DAO Protocol settings minipool contract instance.
  let rocketDAOProtocolSettingsMinipoolContract = rocketDAOProtocolSettingsMinipool.bind(
    Address.fromString(ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL_CONTRACT_ADDRESS),
  )

  // Get the DAO Protocol settings node contract instance.
  let rocketDAOProtocolSettingsNodeContract = rocketDAOProtocolSettingsNode.bind(
    Address.fromString(ROCKET_DAO_PROTOCOL_SETTINGS_NODE_CONTRACT_ADDRESS),
  )

  // What is the current deposit amount a node operator has to deposit to start a minipool?
  let halfDepositAmount = rocketDAOProtocolSettingsMinipoolContract.getHalfDepositNodeAmount()

  // Determine the minimum and maximum RPL a minipool needs to be collateralized.
  effectiveRPLBounds.minimum = nodeUtilities.getMinimumRPLForNewMinipool(
    halfDepositAmount,
    rocketDAOProtocolSettingsNodeContract.getMinimumPerMinipoolStake(),
    rplPrice,
  )
  effectiveRPLBounds.maximum = nodeUtilities.getMaximumRPLForNewMinipool(
    halfDepositAmount,
    rocketDAOProtocolSettingsNodeContract.getMaximumPerMinipoolStake(),
    rplPrice,
  )

  return effectiveRPLBounds
}
