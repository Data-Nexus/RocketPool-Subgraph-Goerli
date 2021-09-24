import { BigInt } from '@graphprotocol/graph-ts'
import { rocketStorage } from '../../generated/rocketDAONodeTrusted/rocketStorage';
import { DecrementMemberUnbondedValidatorCountCall, IncrementMemberUnbondedValidatorCountCall } from '../../generated/rocketDAONodeTrusted/rocketDAONodeTrusted'
import { Minipool, Node } from '../../generated/schema'
import { ROCKET_MINIPOOL_MANAGER_CONTRACT_NAME, ROCKET_STORAGE_ADDRESS } from '../constants/contractconstants';
import { generalUtilities } from '../utilities/generalUtilities';

/**
 * Occurs after a trusted node operator creates a minipool, via the RocketMinipoolManager.
 */
export function handleIncrementMemberUnbondedValidatorCount(call: IncrementMemberUnbondedValidatorCountCall) : void {
    // Preliminary null checks.
    if(call === null || call.from === null || call.inputs === null || call.inputs._nodeAddress === null) return;

    // Calling address should be something.
    let callingAddress = call.from.toHexString();
    if(callingAddress == null) return;

    // Calling address should be the rocketMinipoolManager
    let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);
    let rocketMinipoolManagerContractAddress = rocketStorageContract.getAddress(generalUtilities.getRocketVaultContractAddressKey(ROCKET_MINIPOOL_MANAGER_CONTRACT_NAME))
    if (rocketMinipoolManagerContractAddress === null ||
        rocketMinipoolManagerContractAddress.toHexString() != callingAddress) return

    // Retrieve the parent node. It has to exist.
    let node = Node.load(call.inputs._nodeAddress.toHexString())
    if (node === null) return
 
    // TODO: Change naming.
    // Increment total unbonded minipools
    node.stakingUnbondedMinipools = node.stakingUnbondedMinipools.plus(BigInt.fromI32(1));
   
    // RPL Effective balances don't need to be updated; this will be done in the finalize call of the RocketMiniPoolManager.

    // Index the minipool and the associated node.
    node.save();     
}

/**
 * Occurs after a minipool finalizes his unbonded validator.
 */
 export function handleDecrementMemberUnbondedValidatorCount(call: DecrementMemberUnbondedValidatorCountCall) : void {
    // Preliminary null checks.
    if(call === null || call.from === null || call.inputs === null || call.inputs._nodeAddress === null) return;

    // Calling address should be something.
    let callingAddress = call.from.toHexString();
    if(callingAddress == null) return;

    // There must be a minipool with the same address as the calling address.
    // If a minipool, it shouldn't be finalized or destroyed.
    // If a minipool, it should've been queued, staking and set withdrawable before this.
    let minipool = Minipool.load(callingAddress)
    if (minipool !== null ||
        minipool.queuedBlockTime == BigInt.fromI32(0) ||
        minipool.stakingBlockTime == BigInt.fromI32(0) ||    
        minipool.withdrawableBlockTime == BigInt.fromI32(0) ||
        minipool.finalizedBlockTime != BigInt.fromI32(0) || 
        minipool.destroyedBlockTime != BigInt.fromI32(0)) return

    // Retrieve the parent node. It has to exist.
    let node = Node.load(call.inputs._nodeAddress.toHexString())
    if (node === null) return
 
    // TODO: Change naming.
    // Decrement total unbonded minipools
    node.stakingUnbondedMinipools = node.stakingUnbondedMinipools.minus(BigInt.fromI32(1));
    if(node.stakingUnbondedMinipools < BigInt.fromI32(0)) node.stakingUnbondedMinipools = BigInt.fromI32(0);

    // RPL Effective balances don't need to be updated; this will be done in the finalize call of the RocketMiniPoolManager.

    // Index the minipool and the associated node.
    node.save();     
}