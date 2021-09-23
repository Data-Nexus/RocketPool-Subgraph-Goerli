import { BigInt } from '@graphprotocol/graph-ts'
import { DecrementNodeStakingMinipoolCountCall, IncrementNodeFinalisedMinipoolCountCall, IncrementNodeStakingMinipoolCountCall, MinipoolCreated, MinipoolDestroyed } from '../../generated/rocketMinipoolManager/rocketMinipoolManager'
import { rocketNetworkFees } from '../../generated/rocketNetworkPrices/rocketNetworkFees'
import { rocketStorage } from '../../generated/rocketNodeStaking/rocketStorage'
import {rocketNodeStaking } from '../../generated/rocketNodeStaking/rocketNodeStaking'
import {
  ROCKET_STORAGE_ADDRESS,
  ROCKET_NETWORK_FEES_CONTRACT_NAME,
  ROCKET_NODE_STAKING_CONTRACT_NAME,
} from './../constants/contractconstants'
import { Minipool, Node } from '../../generated/schema'
import { rocketPoolEntityFactory } from '../entityfactory'
import { generalUtilities } from '../utilities/generalUtilities'

/**
 * Occurs when a node operator makes an ETH deposit on his node to create a minipool.
 */
export function handleMinipoolCreated(event: MinipoolCreated): void {
  // Preliminary null checks.
  if (
    event === null ||
    event.params === null ||
    event.params.node === null ||
    event.params.minipool === null
  )
    return

  // Retrieve the parent node. It has to exist.
  let nodeAddress = event.params.node
  let node = Node.load(nodeAddress.toHexString())
  if (node === null) return

  // There can't be an existing minipool with the same address.
  let minipoolAddress = event.params.minipool
  let minipool = Minipool.load(minipoolAddress.toHexString())
  if (minipool !== null) return

  // We will need this to retrieve certain state.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS)

  // Create a new minipool.
  minipool = rocketPoolEntityFactory.createMinipool(
    minipoolAddress.toHexString(),
    node,
    /**
     * This will be called immediately after this event was emitted and before this minipool is queued.
     * Therefor it is safe to call the minipool fee smart contract and assume it will give the same fee
     *  that the minipool just received in its constructor.
     */
    getNewMinipoolFee(rocketStorageContract),
    event.block.timestamp,
  )
  if (minipool === null) return

  // Add this minipool to the collection of the node
  let nodeMinipools = node.minipools
  if (nodeMinipools.indexOf(minipool.id) == -1) nodeMinipools.push(minipool.id)
  node.minipools = nodeMinipools

  // We need to get the new (minimum/maximum) effective RPL staked for the node.
  let rocketNodeStakingAddress = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_NODE_STAKING_CONTRACT_NAME))
  let rocketNodeStakingContract = rocketNodeStaking.bind(rocketNodeStakingAddress)
  if (rocketNodeStakingContract === null) return

  /**
   * TODO:
   * node.effectiveRPLStaked = 
   * node.minimumEffectiveRPL =
   * node.maximumEffectiveRPL = 
   */

  // Index the minipool and the associated node.
  minipool.save()
  node.save();
}

/**
 * Occurs when a minipool is dissolved and the node operator calls destroy on his minipool.
 */
export function handleMinipoolDestroyed(event: MinipoolDestroyed) : void {
     // Preliminary null checks.
  if (
    event === null ||
    event.params === null ||
    event.params.node === null ||
    event.params.minipool === null
  )
    return

  // There must be an indexed minipool.
  // If a minipool, it shouldn't be staking, withdrawable, finalized or destroyed.
  // If a minipool, it should've been queued before this.
  let minipoolAddress = event.params.minipool
  let minipool = Minipool.load(minipoolAddress.toHexString())
  if (minipool === null ||
    minipool.queuedBlockTime == BigInt.fromI32(0) ||
    minipool.stakingBlockTime != BigInt.fromI32(0) ||    
    minipool.withdrawableBlockTime != BigInt.fromI32(0) ||
    minipool.finalizedBlockTime != BigInt.fromI32(0) || 
    minipool.destroyedBlockTime != BigInt.fromI32(0)) return

  // Retrieve the parent node. It has to exist.
  let nodeAddress = event.params.node
  let node = Node.load(nodeAddress.toHexString())
  if (node === null) return

  // We need this to get the new (minimum/maximum) effective RPL staked for the node.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);
  let rocketNodeStakingAddress = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_NODE_STAKING_CONTRACT_NAME))
  let rocketNodeStakingContract = rocketNodeStaking.bind(rocketNodeStakingAddress)
  if (rocketNodeStakingContract === null) return

  /**
   * TODO:
   * node.effectiveRPLStaked = 
   * node.minimumEffectiveRPL =
   * node.maximumEffectiveRPL = 
   */

  // Update the minipool so it will contain its destroyed state.
  // No other node state has to be changed related to the minipools
  // because the minipool was either waiting to receive a user deposit or waiting to get into the staking status.
  // if it was waiting for a user deposit, it should've been previously dequeued first when dissolved.
  minipool.destroyedBlockTime = event.block.timestamp;

  // Index changes.
  minipool.save();
  node.save();
}

/**
 * This is only called by minipools who transition to the staking state, after they leave the queue.
 */
export function handleIncrementNodeStakingMinipoolCount(call: IncrementNodeStakingMinipoolCountCall) : void {
  // Preliminary null checks.
  if(call === null || call.inputs === null || call.from === null) return;

  // Calling address should be something.
  let callingAddress = call.from.toHexString();
  if(callingAddress == null) return;

  // Calling address should be a minipool with a valid link to a node.
  // If a minipool, it shouldn't be staking, withdrawable, finalized or destroyed.
  // If a minipool, it should've been queued and dequeued before this occured.
  let minipool = Minipool.load(callingAddress);
  if(minipool === null || 
     minipool.node == null ||
     minipool.queuedBlockTime == BigInt.fromI32(0) ||
     minipool.dequeuedBlockTime == BigInt.fromI32(0) ||
     minipool.stakingBlockTime != BigInt.fromI32(0) ||    
     minipool.withdrawableBlockTime != BigInt.fromI32(0) ||
     minipool.finalizedBlockTime != BigInt.fromI32(0) || 
     minipool.destroyedBlockTime != BigInt.fromI32(0)) return

  // Retrieve the parent node. It has to exist.
  let node = Node.load(minipool.node)
  if (node === null) return

  // Update the staking start time of this minipool. 
  // No other totals have to be reduced; at this point the minipool is already dequeued.
  minipool.stakingBlockTime = call.block.timestamp;
  node.stakingMinipools = node.stakingMinipools.plus(BigInt.fromI32(1));

  // Index the minipool and the associated node.
  minipool.save()
  node.save();
}

/**
 * This is only called by minipools who are set to withdrawable.
 */
 export function handleDecrementNodeStakingMinipoolCount(call: DecrementNodeStakingMinipoolCountCall) : void {
  // Preliminary null checks.
  if(call === null || call.inputs === null || call.from === null) return;

  // Calling address should be something.
  let callingAddress = call.from.toHexString();
  if(callingAddress == null) return;

  // Calling address should be a minipool with a valid link to a node.
  // If a minipool, it shouldn't be finalized or destroyed.
  // If a minipool, it should've been queued and dequeued and have been staking before this occured.
  let minipool = Minipool.load(callingAddress);
  if(minipool === null || 
     minipool.node == null ||
     minipool.queuedBlockTime == BigInt.fromI32(0) ||
     minipool.dequeuedBlockTime == BigInt.fromI32(0) ||
     minipool.stakingBlockTime == BigInt.fromI32(0) ||
     minipool.finalizedBlockTime != BigInt.fromI32(0) || 
     minipool.destroyedBlockTime != BigInt.fromI32(0)) return

  // Retrieve the parent node. It has to exist.
  let node = Node.load(minipool.node)
  if (node === null) return

  // Update the withdrawal block time and the total withdrawable minipool counter of this minipool.
  minipool.withdrawableBlockTime = call.block.timestamp;
  node.withdrawableMinipools = node.withdrawableMinipools.plus(BigInt.fromI32(1));

  // Decrement the number of staking minipools for the node.
  node.stakingMinipools = node.stakingMinipools.minus(BigInt.fromI32(1));
  if(node.stakingMinipools < BigInt.fromI32(0)) node.stakingMinipools = BigInt.fromI32(0);

  // Effective RPL related state only has to be recalculated after finalize.
  // So there's nothing to update related to that.

  // Index the minipool and the associated node.
  minipool.save()
  node.save();
}

/**
 * Occurs after a node operator finalizes his minipool to unlock his RPL stake.
 */
export function handleIncrementNodeFinalisedMinipoolCount(call: IncrementNodeFinalisedMinipoolCountCall) : void {
    // Preliminary null checks.
    if(call === null || call.inputs === null || call.from === null) return;

    // Calling address should be something.
    let callingAddress = call.from.toHexString();
    if(callingAddress == null) return;

    // Calling address should be a minipool with a valid link to a node.
    // If a minipool, it shouldn't be finalized or destroyed.
    // If a minipool, it should've been queued and dequeued, staking and marked as withdrawable before this occured.
    let minipool = Minipool.load(callingAddress);
    if(minipool === null || 
      minipool.node == null ||
      minipool.queuedBlockTime == BigInt.fromI32(0) ||
      minipool.dequeuedBlockTime == BigInt.fromI32(0) ||
      minipool.stakingBlockTime == BigInt.fromI32(0) ||
      minipool.withdrawableBlockTime == BigInt.fromI32(0) ||
      minipool.finalizedBlockTime != BigInt.fromI32(0) || 
      minipool.destroyedBlockTime != BigInt.fromI32(0)) return

    // Retrieve the parent node. It has to exist.
    let node = Node.load(minipool.node)
    if (node === null) return
 
    // Update the withdrawal block time and the total withdrawable minipool counter of this minipool.
    minipool.finalizedBlockTime = call.block.timestamp;

    // Increment the number of total finalized minipools for the node.
    // Decrement the number of staking minipools for the node.
    node.totalFinalizedMinipools = node.totalFinalizedMinipools.plus(BigInt.fromI32(1));
    node.withdrawableMinipools = node.totalFinalizedMinipools.minus(BigInt.fromI32(1));
    if(node.withdrawableMinipools < BigInt.fromI32(0)) node.withdrawableMinipools = BigInt.fromI32(0);

    // TODO: Effective RPL related state has to be recalculated after finalize.

    // Index the minipool and the associated node.
    minipool.save()
    node.save();     
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

