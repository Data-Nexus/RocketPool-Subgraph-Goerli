import { Address, ethereum } from '@graphprotocol/graph-ts'
import { RocketETHTransaction, NetworkBalanceCheckpoint, Staker, RocketPoolProtocol } from '../generated/schema'
import { BigInt } from '@graphprotocol/graph-ts'
import { rocketPoolEntityFactory } from './entityfactory'
import { ROCKETPOOL_PROTOCOL_ROOT_ID } from './constants'

class ArrayUtilities {
   /**
   * Returns an array as a dictionary based on a specific key.
   */
  public groupArrayOfObjects(list: Array<any>, key: string) {
    return list.reduce(function(rv, x) {
      (rv[x[key]] = rv[x[key]] || []).push(x);
      return rv;
    }, {});
  };
}

class TransactionStakers{
   fromStaker: Staker;
   toStaker: Staker;
}

export let arrayUtilities = new ArrayUtilities()
