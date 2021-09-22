import { PricesUpdated } from '../../generated/rocketNetworkPrices/rocketNetworkPrices'
import { rocketNetworkFees } from '../../generated/rocketNetworkPrices/rocketNetworkFees'
import { rocketStorage } from '../../generated/rocketNetworkPrices/rocketStorage'
import { Node, NetworkStakerBalanceCheckpoint, NetworkNodeBalanceCheckpoint } from '../../generated/schema'
import { generalUtilities } from '../utilities/generalUtilities'
import { rocketPoolEntityFactory } from '../entityfactory'
import {
  ROCKET_NETWORK_FEES_CONTRACT_NAME,
  ROCKET_STORAGE_ADDRESS,
} from './../constants/contractconstants'
import { BigInt } from '@graphprotocol/graph-ts'
import { nodeUtilities } from '../utilities/nodeutilities'

// !!WIP!!

/**
 * Occurs when enough ODAO members votes on a price and a consensus threshold is reached.
 */
export function handlePricesUpdated(event: PricesUpdated): void {
  // Preliminary check to ensure we haven't handled this before.
  if (nodeUtilities.hasNetworkNodeBalanceCheckpointHasBeenIndexed(event))
    return

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity()
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol()
  }
  if(protocol === null) return


  // Define the rocket storage contract, we might need it to query the current smart contract state.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);
  let networkFeesContract = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_NETWORK_FEES_CONTRACT_NAME))
  let networkFees = rocketNetworkFees.bind(networkFeesContract)
  if (networkFees === null) return

  // TODO: Get minimum and maximum RPL for a minipool.

  let currentNetworkFee = networkFees.getNodeFee();
   let checkpoint = rocketPoolEntityFactory.createNetworkNodeBalanceCheckpoint(
    generalUtilities.extractIdForEntity(event),
    event.params.rplPrice,
    BigInt.fromI32(0), //TODO: Replace
    BigInt.fromI32(0), //TODO: Replace
    currentNetworkFee,
    event.block.number,
    event.block.timestamp
  )
  if (checkpoint === null) return

   // Retrieve the previous network node checkpoint & derive some state for later.
   let previousCheckpoint : NetworkNodeBalanceCheckpoint | null = null;
   let totalRPLSlashedRPLUpToThisCheckpoint = BigInt.fromI32(0);
   let totalClaimedRPLRewardsUpToThisCheckpoint = BigInt.fromI32(0);
   let previousCheckpointId = protocol.lastNetworkNodeBalanceCheckPoint
   if(previousCheckpointId != null) {
     previousCheckpoint = NetworkNodeBalanceCheckpoint.load(previousCheckpointId)
     totalRPLSlashedRPLUpToThisCheckpoint = previousCheckpoint.totalRPLSlashed;
     totalClaimedRPLRewardsUpToThisCheckpoint = previousCheckpoint.totalClaimedRPLRewards;
   }

  // Handle the node impact.
  generateNodeBalanceCheckpoints(
    protocol.nodes,
    checkpoint,
    event.block.number,
    event.block.timestamp,
  )

  // If for some reason our total claimed RPL rewards up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
  if (checkpoint.totalClaimedRPLRewards == BigInt.fromI32(0) && totalClaimedRPLRewardsUpToThisCheckpoint > BigInt.fromI32(0)) {
    checkpoint.totalClaimedRPLRewards = totalClaimedRPLRewardsUpToThisCheckpoint;
  }

  // If for some reason our total slashed RPL rewards up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
  if (checkpoint.totalRPLSlashed == BigInt.fromI32(0) && totalRPLSlashedRPLUpToThisCheckpoint > BigInt.fromI32(0)) {
    checkpoint.totalRPLSlashed = totalRPLSlashedRPLUpToThisCheckpoint;
  }

 // Update the link so the protocol points to the last network node balance checkpoint.
  protocol.lastNetworkNodeBalanceCheckPoint = checkpoint.id

  // Index these changes.
  checkpoint.save()
  protocol.save()
}

/**
 * Loops through all nodes of the protocol.
 * Create a NodeBalanceCheckpoint
 * Return the average minipool fee for all actively contributing nodes.
 */
function generateNodeBalanceCheckpoints(
  nodeIds: Array<string>,
  networkCheckpoint: NetworkNodeBalanceCheckpoint,
  blockNumber: BigInt,
  blockTime: BigInt,
): BigInt {
  // If we don't have any nodes, stop.
  if (nodeIds.length === 0) {
    return
  }

  // Loop through all the node id's in the protocol.
  for (let index = 0; index < nodeIds.length; index++) {
    // Determine current node ID.
    let nodeId = <string>nodeIds[index]
    if (nodeId == null) continue

    // // Load the indexed node.
    // let node = Node.load(nodeId)
    // if (node === null) continue
    // if (node.rplStaked == BigInt.fromI32(0) && node.queuedMinipools == BigInt.fromI32(0) && node.stakingMinipools == BigInt.fromI32(0)) {
    //   // Those nodes don't get a new node balance checkpoint
    //   // But their running totals (e.g. totalRPLClaimed) are accounted for in the total(s) of the current network checkpoint.
    //   nodeUtilities.updateNetworkNodeBalanceCheckpoint(
    //     networkCheckpoint,
    //     node,
    //   )

    //   // Only generate a node balance checkpoint if the node is affected by the change in price.
    //   continue
    // }

    // // Update the totals for the node. 

    // // Create a new staker balance checkpoint
    // let nodeBalanceCheckpoint = rocketPoolEntityFactory.createStakerBalanceCheckpoint(
    //   networkCheckpoint.id + ' - ' + node.id,
    //   node,
    //   networkCheckpoint,
    //   stakerBalance.currentETHBalance,
    //   stakerBalance.currentRETHBalance,
    //   staker.totalETHRewards,
    //   blockNumber,
    //   blockTime,
    // )
    // if (stakerBalanceCheckpoint == null) continue
    // node.lastNodeBalanceCheckpoint = nodeBalanceCheckpoint.id

    // // Index both the updated node & the new node balance checkpoint.   
    // nodeBalanceCheckpoint.save()
    // node.save()
  }
}

